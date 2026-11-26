"""
Stock Management Web Application (Python / Flask Edition for PythonAnywhere)
Srinivasa Enterprises — NOVUM Energy Infra
"""
import os
import re
import csv
import io
import json
import base64
import time
import random
import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, Response, g

from lib.sku_generator import SkuPatternEngine
from lib.excel_sync import (
    parse_csv_stock_master,
    parse_xlsx_stock_master,
    sync_rows_to_db,
    RACK_CATEGORY_MAP
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
UPLOADS_DIR = os.path.join(DATA_DIR, 'uploads')
DB_PATH = os.path.join(DATA_DIR, 'stock.db')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Units of measurement allowed to have decimal values
DECIMAL_UOMS = {'KGS', 'MTR', 'LTR'}

# Retention window for "NEW" product status (days)
NEW_PRODUCT_RETENTION_DAYS = 30

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024  # 30 MB upload limit for photos / excel

# ---------- Database Initialization ----------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_no INTEGER,
      description TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      cat_code TEXT,
      make TEXT,
      product_type TEXT,
      rack TEXT,
      location TEXT,
      section TEXT,
      category TEXT,
      uom TEXT NOT NULL,
      opening_qty REAL NOT NULL DEFAULT 0,
      cartons REAL DEFAULT NULL,
      boxes REAL DEFAULT NULL,
      pieces REAL DEFAULT NULL,
      physical_count REAL DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      item_id INTEGER NOT NULL REFERENCES items(id),
      type TEXT NOT NULL CHECK (type IN ('ISSUE', 'RECEIVE', 'ADJUST')),
      qty REAL NOT NULL,
      person TEXT NOT NULL,
      note TEXT,
      photo TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mov_ts ON movements(ts);
    CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
    CREATE INDEX IF NOT EXISTS idx_items_loc ON items(location);
    """)

    # Schema migrations for existing databases
    for col, typ in [
        ('category', 'TEXT'),
        ('section', 'TEXT'),
        ('physical_count', 'REAL'),
        ('serial_no', 'INTEGER'),
        ('created_at', 'TEXT'),
        ('cat_code', 'TEXT'),
        ('cartons', 'REAL'),
        ('boxes', 'REAL'),
        ('pieces', 'REAL'),
        ('amperes', 'REAL')
    ]:
        try:
            conn.execute(f"ALTER TABLE items ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass

    try:
        conn.execute("ALTER TABLE movements ADD COLUMN photo TEXT")
    except sqlite3.OperationalError:
        pass

    conn.execute("UPDATE items SET created_at = datetime('now', '-45 days', 'localtime') WHERE created_at IS NULL")

    # Seed from items.json if items table is empty
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM items")
    if cur.fetchone()[0] == 0:
        seed_path = os.path.join(DATA_DIR, 'items.json')
        if not os.path.exists(seed_path):
            seed_path = os.path.join(BASE_DIR, 'items.json')
        if os.path.exists(seed_path):
            with open(seed_path, 'r', encoding='utf-8') as f:
                seed_items = json.load(f)
            for idx, i in enumerate(seed_items):
                loc = i.get('location', '')
                rack = i.get('rack', '')
                section = ''
                if loc and '-' in loc:
                    rack, section = loc.split('-', 1)
                elif rack:
                    section = ''
                cat = RACK_CATEGORY_MAP.get(rack, i.get('category', 'Miscellaneous'))

                cur.execute("""
                    INSERT INTO items (
                        serial_no, description, sku, make, product_type,
                        rack, location, section, category, uom, opening_qty, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-45 days', 'localtime'))
                """, (
                    idx + 1,
                    i.get('description', ''),
                    i.get('sku', ''),
                    i.get('make', ''),
                    i.get('product_type', ''),
                    rack,
                    loc or f"{rack}-{section}".strip('-'),
                    section,
                    cat,
                    i.get('uom', 'NOS'),
                    float(i.get('qty', 0) or 0)
                ))
            conn.commit()
    conn.close()

# Initialize tables on load
init_db()

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH, check_same_thread=False)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode = WAL")
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# Stock aggregation SQL query
STOCK_SELECT = """
  SELECT 
    i.id,
    i.sku,
    i.cat_code,
    i.description,
    i.make,
    i.product_type,
    i.rack,
    i.location,
    i.section,
    i.category,
    i.uom,
    i.opening_qty,
    ROUND(i.opening_qty + COALESCE(SUM(CASE m.type WHEN 'ISSUE' THEN -m.qty ELSE m.qty END), 0), 2) AS tally_qty,
    ROUND(i.opening_qty + COALESCE(SUM(CASE m.type WHEN 'ISSUE' THEN -m.qty ELSE m.qty END), 0), 2) AS stock,
    COALESCE(SUM(CASE m.type WHEN 'RECEIVE' THEN m.qty ELSE 0 END), 0) AS total_received,
    COALESCE(SUM(CASE m.type WHEN 'ISSUE' THEN m.qty ELSE 0 END), 0) AS total_issued,
    i.cartons,
    i.boxes,
    i.pieces,
    i.physical_count,
    i.amperes,
    COALESCE(i.created_at, datetime('now', '-45 days', 'localtime')) AS created_at,
    CAST(ROUND(julianday('now', 'localtime') - julianday(COALESCE(i.created_at, '2020-01-01'))) AS INTEGER) AS days_old
  FROM items i 
  LEFT JOIN movements m ON m.item_id = i.id
"""

def extract_amperes(desc: str, sku: str):
    text = f"{desc or ''} {sku or ''}"
    m = re.search(r'(?:^|[\s\-_/])(\d+(?:\.\d+)?)\s*(?:A|AMP|AMPS)(?:$|[\s\-_/])', text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    m2 = re.search(r'(\d+(?:\.\d+)?)\s*A\b', text, re.IGNORECASE)
    if m2:
        return float(m2.group(1))
    return None

PRODUCT_TYPE_SHORTCUTS = {
    'Fuse Link': 'FL',
    'HRC Fuse': 'FL',
    'Fuse': 'FL',
    'Fuse Holder': 'FH',
    'HRC Fuse Base': 'FB',
    'Kit Kat Fuse': 'KK',
    'SFU (Switch Fuse Unit)': 'SFU',
    'MCB': 'MCB',
    'MCCB': 'MCCB',
    'RCCB': 'RCCB',
    'MCCB Accessory': 'ACC',
    'Contactor': 'CON',
    'Air Break Contactor': 'ABC',
    'Add-on Block': 'AB',
    'Delay Timer': 'TMR',
    'Undervoltage Relay': 'UVR',
    'Thermostat': 'THM',
    'Copper Flexible Cable': 'CBL',
    'Cable Gland': 'GLD',
    'Insulation Tape': 'IT',
    'Terminal Block': 'TB',
    'Neutral Link': 'NL',
    'Spider Link': 'SL',
    'Ammeter': 'AMM',
    'Voltmeter': 'VOL',
    'Multifunction Meter': 'MFM',
    'Prepaid Meter': 'PPM',
    'Switch Socket Combined': 'SSC',
    'Toggle Switch': 'TS',
    'Changeover Switch': 'COS',
    'Isolator Switch': 'IS',
    'LED Strip': 'LST',
    'LED Driver': 'LDR',
    'LED Fixture': 'LFX',
    'Tube Light': 'TL'
}

def get_brand_code(brand: str) -> str:
    if not brand:
        return 'GEN'
    b = brand.strip().upper()
    if b in ('L&T', 'L & T', 'LT'):
        return 'LNT'
    if b in ('3M', 'GE', 'AE', 'TC'):
        return b
    if b in ('C&S', 'CNS'):
        return 'CNS'
    if b == 'MF GOLD':
        return 'MFG'
    if b in ('NO MAKE LISTED', 'GENERIC'):
        return 'GEN'
    clean = re.sub(r'[^A-Z0-9]', '', b)
    return clean[:3]

def get_product_type_shortcut(p_type: str, desc: str) -> str:
    if p_type and p_type in PRODUCT_TYPE_SHORTCUTS:
        return PRODUCT_TYPE_SHORTCUTS[p_type]
    d = desc or ''
    if re.search(r'\bFUSE\s+LINK\b', d, re.I):
        return 'FL'
    if re.search(r'\bFUSE\s+HOLDER\b', d, re.I):
        return 'FH'
    if re.search(r'\bKIT\s*KAT\b', d, re.I):
        return 'KK'
    if re.search(r'\bHRC\s+FUSE\b', d, re.I):
        return 'FL'
    if re.search(r'\bMCB\b', d, re.I):
        return 'MCB'
    if re.search(r'\bMCCB\b', d, re.I):
        return 'MCCB'
    if re.search(r'\bCABLE\b', d, re.I):
        return 'CBL'

    if not p_type:
        return 'PRD'
    pt = p_type.strip()
    if re.match(r'^[A-Z]{2,4}$', pt):
        return pt
    words = [w for w in re.split(r'[^a-zA-Z0-9]', pt) if w]
    if len(words) >= 2:
        return ''.join(w[0].upper() for w in words[:3])
    return re.sub(r'[^A-Za-z0-9]', '', pt)[:3].upper()

def generate_cat_code(make: str, p_type: str, desc: str, sku: str, amps: float = None) -> str:
    brand = get_brand_code(make)
    shortcut = get_product_type_shortcut(p_type, desc)
    amp_str = None
    if amps is not None and amps > 0:
        amp_str = f"{int(amps) if amps.is_integer() else amps}A"
    else:
        amp_val = extract_amperes(desc, sku)
        if amp_val is not None:
            amp_str = f"{int(amp_val) if amp_val.is_integer() else amp_val}A"

    if amp_str:
        return f"{brand} {shortcut} {amp_str}"

    sq_match = re.search(r'(\d+(?:\.\d+)?)\s*SQMM', desc or '', re.I)
    if sq_match:
        return f"{brand} {shortcut} {sq_match.group(1)}SQ"

    words = (desc or '').split()
    if len(words) > 2:
        last_tok = words[-2]
        if re.match(r'^[A-Z0-9\-]+$', last_tok, re.I) and last_tok.upper() != (make or '').upper():
            return f"{brand} {shortcut} {last_tok.upper()}"

    return f"{brand} {shortcut}".upper()

def generate_sku_code(make: str, p_type: str, desc: str, amps: float = None) -> str:
    prefix = 'ELEC'
    p_name = (p_type or '').strip().upper()
    if not p_name:
        d = desc or ''
        if re.search(r'\bFUSE\s+LINK\b', d, re.I):
            p_name = 'FUSE-LINK'
        elif re.search(r'\bFUSE\s+HOLDER\b', d, re.I):
            p_name = 'FUSE-HOLDER'
        elif re.search(r'\bKIT\s*KAT\b', d, re.I):
            p_name = 'KIT-KAT-FUSE'
        elif re.search(r'\bHRC\s+FUSE\b', d, re.I):
            p_name = 'FUSE-LINK'
        elif re.search(r'\bMCB\b', d, re.I):
            p_name = 'MCB'
        elif re.search(r'\bMCCB\b', d, re.I):
            p_name = 'MCCB'
        elif re.search(r'\bCONTACTOR\b', d, re.I):
            p_name = 'CONTACTOR'
        elif re.search(r'\bCABLE\b', d, re.I):
            p_name = 'CABLE'
        else:
            p_name = 'ITEM'
    else:
        p_name = '-'.join(re.findall(r'[A-Z0-9]+', p_name))

    p_name = re.sub(r'^ELEC-?', '', p_name, flags=re.I)

    amp_str = ''
    if amps is not None and amps > 0:
        amp_str = f"{int(amps) if amps.is_integer() else amps}A"
    else:
        amp_val = extract_amperes(desc, '')
        if amp_val is not None:
            amp_str = f"{int(amp_val) if amp_val.is_integer() else amp_val}A"

    if not amp_str:
        sq_match = re.search(r'(\d+(?:\.\d+)?)\s*SQMM', desc or '', re.I)
        if sq_match:
            amp_str = f"{sq_match.group(1)}SQMM"

    brand = (make or 'GENERIC').strip().upper()
    if brand in ('L&T', 'L & T', 'LT'):
        brand = 'LT'
    else:
        brand = '-'.join(re.findall(r'[A-Z0-9]+', brand))

    if amp_str and (p_name.endswith(f"-{amp_str}") or f"-{amp_str}-" in p_name):
        amp_str = ''
    if brand and (p_name.endswith(f"-{brand}") or f"-{brand}-" in p_name):
        brand = ''

    parts = [prefix, p_name]
    if amp_str:
        parts.append(amp_str)
    if brand:
        parts.append(brand)

    return re.sub(r'-+', '-', '-'.join(p for p in parts if p)).upper()

def get_one_item(item_id: int):
    db = get_db()
    cur = db.cursor()
    cur.execute(f"{STOCK_SELECT} WHERE i.id = ? GROUP BY i.id", (item_id,))
    row = cur.fetchone()
    return dict(row) if row else None

# ---------- Static File Routes ----------
@app.route('/')
def index():
    return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_public(filename):
    file_path = os.path.join(PUBLIC_DIR, filename)
    if os.path.exists(file_path):
        return send_from_directory(PUBLIC_DIR, filename)
    return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(UPLOADS_DIR, filename)

# ---------- API Endpoints ----------
@app.route('/api/items', methods=['GET'])
def list_items():
    q = request.args.get('q', '').strip()
    rack_filter = request.args.get('rack', '').strip()

    where_clauses = []
    params = []

    if rack_filter:
        where_clauses.append("i.rack = ?")
        params.append(rack_filter)

    words = [w for w in re.split(r'\s+', q) if w]
    for w in words:
        like_pattern = f"%{w}%"
        where_clauses.append(
            "(i.description LIKE ? OR i.sku LIKE ? OR i.cat_code LIKE ? OR i.make LIKE ? OR i.location LIKE ? OR i.category LIKE ? OR i.product_type LIKE ? OR CAST(i.id AS TEXT) LIKE ?)"
        )
        params.extend([like_pattern] * 8)

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    sql = f"""
    WITH item_summary AS (
      {STOCK_SELECT}
      {where_sql}
      GROUP BY i.id
    )
    SELECT 
      ROW_NUMBER() OVER (
        ORDER BY 
          COALESCE(location, '') ASC, 
          CASE WHEN rack = 'R04' OR category LIKE '%Fuse%' THEN make ELSE '' END ASC,
          CASE WHEN rack = 'R04' OR category LIKE '%Fuse%' THEN COALESCE(amperes, 999999) ELSE 0 END ASC,
          sku ASC, 
          id ASC
      ) AS serial_no,
      *,
      CASE 
        WHEN days_old <= {NEW_PRODUCT_RETENTION_DAYS} THEN 1 
        ELSE 0 
      END AS is_new,
      MAX(0, {NEW_PRODUCT_RETENTION_DAYS} - days_old) AS days_remaining
    FROM item_summary
    ORDER BY serial_no ASC;
    """

    db = get_db()
    cur = db.cursor()
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]

    for r in rows:
        phys = r.get('physical_count')
        tally = r.get('tally_qty', 0.0)
        r['variance'] = round(float(phys) - float(tally), 2) if phys is not None else None

    return jsonify(rows)

@app.route('/api/products/suggest-sku', methods=['POST'])
def suggest_sku():
    try:
        data = request.get_json(force=True, silent=True) or {}
        category = data.get('category', '').strip()
        prefix = data.get('prefix', '').strip()
        branch_parent_sku = data.get('branch_parent_sku', '').strip()

        db = get_db()
        cur = db.cursor()
        if category:
            cur.execute("SELECT sku FROM items WHERE category = ?", (category,))
        else:
            cur.execute("SELECT sku FROM items")
        existing_skus = [r['sku'] for r in cur.fetchall()]

        if branch_parent_sku:
            result = SkuPatternEngine.generate_sub_variant(branch_parent_sku, existing_skus)
        else:
            result = SkuPatternEngine.generate_next(existing_skus, prefix)

        make = data.get('make') or ''
        p_type = data.get('product_type') or ''
        desc = data.get('description') or ''
        suggested_sku = None
        if make or p_type or desc:
            base_sku = generate_sku_code(make, p_type, desc)
            candidate = base_sku
            counter = 1
            while candidate in existing_skus:
                candidate = f"{base_sku}-{counter}"
                counter += 1
            suggested_sku = candidate

        final_sku = (suggested_sku or result.get('sku', '')).upper()
        suggested_cat = generate_cat_code(make, p_type, desc, final_sku).upper()

        return jsonify({'ok': True, **result, 'sku': final_sku, 'cat_code': suggested_cat})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

@app.route('/api/products', methods=['POST'])
def onboard_product():
    try:
        data = request.get_json(force=True, silent=True) or {}
        desc = (data.get('description') or '').strip()
        raw_sku = (data.get('sku') or '').strip()
        cat_code = (data.get('cat_code') or '').strip() or None
        make = (data.get('make') or '').strip()
        p_type = (data.get('product_type') or '').strip()
        raw_rack = (data.get('rack') or '').strip()
        raw_loc = (data.get('location') or '').strip()
        raw_uom = (data.get('uom') or 'NOS').strip()
        opening_qty = float(data.get('opening_qty') or 0)

        if not desc or not raw_sku:
            raise ValueError('Description and SKU are required')

        clean_sku = re.sub(r'-+', '-', re.sub(r'\s+', '-', raw_sku.strip().upper()))
        if not clean_sku.startswith('ELEC-'):
            clean_sku = 'ELEC-' + re.sub(r'^ELEC-?', '', clean_sku, flags=re.I)
        db = get_db()
        cur = db.cursor()

        cur.execute("SELECT id FROM items WHERE UPPER(sku) = ?", (clean_sku,))
        if cur.fetchone():
            raise ValueError(f'SKU collision: "{clean_sku}" already exists in the catalog.')

        clean_loc = raw_loc.upper()
        clean_rack = (raw_rack or (clean_loc.split('-')[0] if '-' in clean_loc else 'R01')).upper()
        clean_section = clean_loc.split('-')[1] if '-' in clean_loc else ''
        category = RACK_CATEGORY_MAP.get(clean_rack, 'Miscellaneous')
        clean_uom = raw_uom.upper()

        req_amp = data.get('amperes') or (extract_amperes(data.get('rating') or '', '') if data.get('rating') else None)
        amperes = req_amp if req_amp is not None else extract_amperes(desc, clean_sku)
        clean_cat = str(cat_code).strip().upper() if cat_code else None
        final_cat = (clean_cat or generate_cat_code(make, p_type, desc, clean_sku, amperes)).upper()
        cur.execute("""
            INSERT INTO items (
                description, sku, cat_code, make, product_type, rack, location,
                section, category, uom, opening_qty, amperes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        """, (
            desc, clean_sku, final_cat, make, p_type, clean_rack, clean_loc,
            clean_section, category, clean_uom, opening_qty, amperes
        ))
        db.commit()

        cur.execute("SELECT * FROM items WHERE sku = ?", (clean_sku,))
        new_row = dict(cur.fetchone())
        new_row['is_new'] = 1
        new_row['days_old'] = 0
        new_row['days_remaining'] = NEW_PRODUCT_RETENTION_DAYS

        return jsonify({
            'ok': True,
            'message': f"Product {clean_sku} successfully onboarded!",
            'product': new_row
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

def delete_product_from_db(item_id: int):
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT id, description, sku, location FROM items WHERE id = ?", (item_id,))
    row = cur.fetchone()
    if not row:
        raise ValueError('Product not found in stock')
    item = dict(row)
    cur.execute("DELETE FROM movements WHERE item_id = ?", (item_id,))
    cur.execute("DELETE FROM items WHERE id = ?", (item_id,))
    db.commit()
    return item

@app.route('/api/products/<int:item_id>', methods=['DELETE'])
@app.route('/api/products/delete', methods=['POST'])
def delete_product_endpoint(item_id: int = None):
    try:
        if item_id is None:
            data = request.get_json(force=True, silent=True) or {}
            item_id = int(data.get('id') or 0)
        deleted = delete_product_from_db(item_id)
        return jsonify({
            'ok': True,
            'message': f'Product "{deleted["description"]}" ({deleted.get("sku") or "ID: " + str(item_id)}) successfully removed from stock.',
            'product': deleted
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

@app.route('/api/physical-count', methods=['POST'])
def update_physical_count():
    try:
        data = request.get_json(force=True, silent=True) or {}
        item_id = int(data.get('id', 0))
        if item_id <= 0:
            raise ValueError('Invalid item ID')

        def parse_float(val):
            if val in (None, ''):
                return None
            return float(val)

        count_val = parse_float(data.get('physical_count'))
        cartons_val = parse_float(data.get('cartons'))
        boxes_val = parse_float(data.get('boxes'))
        pieces_val = parse_float(data.get('pieces'))
        cat_code_val = data.get('cat_code')

        updates = []
        params = []
        if 'physical_count' in data:
            updates.append("physical_count = ?")
            params.append(count_val)
        if 'cartons' in data:
            updates.append("cartons = ?")
            params.append(cartons_val)
        if 'boxes' in data:
            updates.append("boxes = ?")
            params.append(boxes_val)
        if 'pieces' in data:
            updates.append("pieces = ?")
            params.append(pieces_val)
        if 'cat_code' in data:
            updates.append("cat_code = ?")
            params.append(cat_code_val.strip().upper() if cat_code_val else None)

        if updates:
            params.append(item_id)
            db = get_db()
            cur = db.cursor()
            cur.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()

        item = get_one_item(item_id)
        if not item:
            raise ValueError('Item not found')

        variance = None
        if item.get('physical_count') is not None:
            variance = round(float(item['physical_count']) - float(item['tally_qty']), 2)

        return jsonify({
            'ok': True,
            'id': item_id,
            'cat_code': item.get('cat_code'),
            'cartons': item.get('cartons'),
            'boxes': item.get('boxes'),
            'pieces': item.get('pieces'),
            'physical_count': item.get('physical_count'),
            'variance': variance
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

@app.route('/api/move', methods=['POST'])
def record_move():
    try:
        data = request.get_json(force=True, silent=True) or {}
        m_type = data.get('type')
        item_id = int(data.get('item_id', 0))
        raw_qty = data.get('qty')
        person = (data.get('person') or '').strip()[:50]
        note = (data.get('note') or '').strip()[:200]
        photo = data.get('photo')

        if m_type not in ('ISSUE', 'RECEIVE'):
            raise ValueError('Type must be ISSUE or RECEIVE')
        if not person:
            raise ValueError('Please enter your name')
        if raw_qty is None:
            raise ValueError('Please specify quantity')

        qty = float(raw_qty)
        if qty <= 0:
            raise ValueError('Quantity must be more than 0')

        item = get_one_item(item_id)
        if not item:
            raise ValueError('Item not found')

        if item['uom'] not in DECIMAL_UOMS and not qty.is_integer():
            raise ValueError(f"{item['uom']} must be a whole number")

        if m_type == 'ISSUE' and qty > float(item['stock']):
            raise ValueError(f"Only {item['stock']} {item['uom']} in stock — cannot issue {qty}.")

        photo_url = None
        if photo and isinstance(photo, str) and photo.startswith('data:image/'):
            match = re.match(r'^data:image/([a-zA-Z0-9+]+);base64,(.+)$', photo)
            if match:
                raw_ext = match.group(1).lower()
                ext = 'jpg' if raw_ext in ('jpeg', 'jpg') else ('png' if raw_ext == 'png' else 'webp')
                rand_id = ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))
                filename = f"{m_type.lower()}_{int(time.time()*1000)}_{rand_id}.{ext}"
                filepath = os.path.join(UPLOADS_DIR, filename)
                with open(filepath, 'wb') as img_f:
                    img_f.write(base64.b64decode(match.group(2)))
                photo_url = f"/uploads/{filename}"
        elif photo and isinstance(photo, str) and photo.startswith('/uploads/'):
            photo_url = photo

        db = get_db()
        cur = db.cursor()
        cur.execute("""
            INSERT INTO movements (item_id, type, qty, person, note, photo)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (item_id, m_type, qty, person, note or None, photo_url))
        db.commit()

        updated_item = get_one_item(item_id)
        return jsonify({'ok': True, 'item': updated_item, 'photo': photo_url})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

@app.route('/api/report', methods=['GET'])
def get_daily_report():
    date_str = request.args.get('date', '').strip()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        date_str = datetime.now().strftime('%Y-%m-%d')

    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT m.id, m.ts, m.type, i.location, i.description, i.sku, i.uom, m.qty, m.person, m.note, m.photo
        FROM movements m 
        JOIN items i ON i.id = m.item_id
        WHERE substr(m.ts, 1, 10) = ? 
        ORDER BY m.ts DESC, m.id DESC
    """, (date_str,))
    rows = [dict(r) for r in cur.fetchall()]
    return jsonify({'date': date_str, 'rows': rows})

@app.route('/api/report.csv', methods=['GET'])
def export_daily_report_csv():
    date_str = request.args.get('date', '').strip()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        date_str = datetime.now().strftime('%Y-%m-%d')

    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT m.id, m.ts, m.type, i.location, i.description, i.sku, i.uom, m.qty, m.person, m.note, m.photo
        FROM movements m 
        JOIN items i ON i.id = m.item_id
        WHERE substr(m.ts, 1, 10) = ? 
        ORDER BY m.ts DESC, m.id DESC
    """, (date_str,))
    rows = [dict(r) for r in cur.fetchall()]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Time', 'Type', 'Location', 'Description', 'SKU', 'UOM', 'Qty', 'Person', 'Note', 'Photo Proof URL'])

    host_url = request.host_url.rstrip('/')
    for r in rows:
        photo_link = f"{host_url}{r['photo']}" if r.get('photo') else ''
        writer.writerow([
            r['ts'], r['type'], r.get('location', ''), r.get('description', ''),
            r.get('sku', ''), r.get('uom', ''), r['qty'], r.get('person', ''),
            r.get('note', ''), photo_link
        ])

    csv_data = '\ufeff' + output.getvalue()
    return Response(
        csv_data,
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="stock-report-{date_str}.csv"'}
    )

@app.route('/api/stock.csv', methods=['GET'])
def export_stock_master_csv():
    db = get_db()
    cur = db.cursor()
    sql = f"""
    WITH item_summary AS (
      {STOCK_SELECT}
      GROUP BY i.id
    )
    SELECT 
      ROW_NUMBER() OVER (
        ORDER BY 
          COALESCE(location, '') ASC, 
          CASE WHEN rack = 'R04' OR category LIKE '%Fuse%' THEN make ELSE '' END ASC,
          CASE WHEN rack = 'R04' OR category LIKE '%Fuse%' THEN COALESCE(amperes, 999999) ELSE 0 END ASC,
          sku ASC, 
          id ASC
      ) AS dynamic_serial_no,
      id, description, sku, cat_code, make, product_type, rack, location,
      section, category, uom, opening_qty, tally_qty, cartons, boxes, pieces, physical_count
    FROM item_summary
    ORDER BY dynamic_serial_no ASC
    """
    cur.execute(sql)
    items = [dict(r) for r in cur.fetchall()]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'Serial No', 'Rack Location', 'Rack', 'Section',
        'Make', 'Product Type', 'S.No (orig.)', 'Description', 'SKU Code',
        'Readable Code / CAT Code', 'UOM', 'Tally Qty', 'Cartons', 'Boxes', 'Pieces',
        'Physical Count', 'Total Count'
    ])

    for idx, item in enumerate(items):
        row_num = idx + 2
        loc = item.get('location') or ''
        rack = item.get('rack') or (loc.split('-')[0] if '-' in loc else '')
        section = item.get('section') or (loc.split('-')[1] if '-' in loc else '')
        phys = item.get('physical_count')
        phys_str = phys if phys is not None else ''
        total_count_formula = f'=L{row_num}+IF(ISBLANK(P{row_num}),0,P{row_num})'

        writer.writerow([
            '=ROW()-1',
            loc,
            rack,
            section,
            item.get('make', ''),
            item.get('product_type', ''),
            item['id'],
            item.get('description', ''),
            item.get('sku', ''),
            item.get('cat_code') or '',
            item.get('uom', ''),
            item.get('tally_qty', 0),
            item.get('cartons') if item.get('cartons') is not None else '',
            item.get('boxes') if item.get('boxes') is not None else '',
            item.get('pieces') if item.get('pieces') is not None else '',
            phys_str,
            total_count_formula
        ])

    csv_data = '\ufeff' + output.getvalue()
    return Response(
        csv_data,
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename="stock-master.csv"'}
    )

@app.route('/api/sync-excel', methods=['POST'])
def sync_excel():
    try:
        data = request.get_json(force=True, silent=True) or {}
        csv_content = data.get('csvContent')
        base64_data = data.get('base64Data')

        rows = []
        if csv_content:
            rows = parse_csv_stock_master(csv_content)
        elif base64_data:
            temp_path = os.path.join(BASE_DIR, f'.temp_upload_{int(time.time()*1000)}.xlsx')
            with open(temp_path, 'wb') as temp_f:
                temp_f.write(base64.b64decode(base64_data))
            try:
                rows = parse_xlsx_stock_master(temp_path)
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass
        else:
            xlsx_path = os.path.join(DATA_DIR, 'Srinivasa_Stock_Rack_Plan.xlsx')
            if not os.path.exists(xlsx_path):
                xlsx_path = os.path.join(BASE_DIR, 'Srinivasa_Stock_Rack_Plan.xlsx')
            if not os.path.exists(xlsx_path):
                raise ValueError('Srinivasa_Stock_Rack_Plan.xlsx not found in project.')
            rows = parse_xlsx_stock_master(xlsx_path)

        if not rows:
            raise ValueError('No valid stock items found in Excel/CSV file.')

        db = get_db()
        cur = db.cursor()
        sync_result = sync_rows_to_db(cur, rows)
        db.commit()

        return jsonify({
            'ok': True,
            'message': f"Successfully synchronized {sync_result['updatedCount']} items with Tally counts from Excel!",
            **sync_result
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

# WSGI Application reference for PythonAnywhere
application = app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f"\nStock app (Python / Flask) is running.")
    print(f"  Access locally: http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
