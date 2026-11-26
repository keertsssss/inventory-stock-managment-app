"""
Excel / CSV Stock Master Synchronization Module (Python Edition)
Parses Srinivasa Stock Rack Plan (.xlsx or .csv) and synchronizes Tally counts and physical audit counts into SQLite.
"""
import os
import csv
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional

RACK_CATEGORY_MAP = {
    'R01': 'Cables',
    'R02': 'Cable Accessories, Connectors & Terminals',
    'R03': 'Contactors, Relays & Controllers',
    'R04': 'Fuses',
    'R05': 'Lighting',
    'R06': 'MCB / MCCB / RCCB',
    'R07': 'Meters & Measuring Instruments',
    'R08': 'Switches & Sockets',
    'R09': 'Tapes & Miscellaneous (incl. Raw Material)'
}

def parse_csv_stock_master(csv_content: str) -> List[Dict[str, Any]]:
    """Parse CSV text into list of standardized stock item rows."""
    reader = csv.reader(io.StringIO(csv_content.strip()))
    raw_rows = list(reader)
    if not raw_rows:
        return []

    # Find header row
    header_idx = -1
    col_map = {}
    for idx, row in enumerate(raw_rows):
        joined = ' '.join(c.lower() for c in row)
        if ('sku' in joined or 'description' in joined) and ('tally' in joined or 'qty' in joined or 'rack' in joined):
            header_idx = idx
            for c_idx, col in enumerate(row):
                val = col.strip().lower()
                if 'variance' in val:
                    col_map['variance'] = c_idx
                elif 'physical' in val or 'audit' in val or 'count' in val:
                    col_map['physical'] = c_idx
                elif 'tally' in val or 'qty' in val or 'balance' in val:
                    col_map['tally'] = c_idx
                elif 'sku' in val or 'item code' in val:
                    col_map['sku'] = c_idx
                elif 'desc' in val or 'item name' in val or 'material' in val:
                    col_map['description'] = c_idx
                elif 'location' in val:
                    col_map['location'] = c_idx
                elif val == 'rack':
                    col_map['rack'] = c_idx
                elif 'section' in val:
                    col_map['section'] = c_idx
                elif 'category' in val:
                    col_map['category'] = c_idx
                elif 'make' in val or 'brand' in val:
                    col_map['make'] = c_idx
                elif 'type' in val:
                    col_map['product_type'] = c_idx
                elif 'uom' in val or 'unit' in val:
                    col_map['uom'] = c_idx
                elif 'serial' in val or val.startswith('s.no') or val == 'sno':
                    col_map['serial_no'] = c_idx
            break

    if header_idx == -1 or 'sku' not in col_map:
        return []

    items = []
    for row in raw_rows[header_idx + 1:]:
        if not row:
            continue
        sku = row[col_map['sku']].strip() if 'sku' in col_map and col_map['sku'] < len(row) else ''
        desc = row[col_map['description']].strip() if 'description' in col_map and col_map['description'] < len(row) else ''
        if not sku and not desc:
            continue

        def get_val(key, default=''):
            if key in col_map and col_map[key] < len(row):
                return row[col_map[key]].strip()
            return default

        tally_str = re.sub(r'[^0-9.-]', '', get_val('tally', '0'))
        phys_str = re.sub(r'[^0-9.-]', '', get_val('physical', ''))

        loc = get_val('location')
        rack = get_val('rack')
        section = get_val('section')
        if not rack and loc and '-' in loc:
            rack = loc.split('-')[0]
        if not section and loc and '-' in loc:
            section = loc.split('-')[1]

        items.append({
            'sku': sku,
            'description': desc,
            'serial_no': get_val('serial_no'),
            'location': loc or f"{rack}-{section}".strip('-'),
            'rack': rack,
            'section': section,
            'category': get_val('category') or RACK_CATEGORY_MAP.get(rack, 'Miscellaneous'),
            'make': get_val('make'),
            'product_type': get_val('product_type'),
            'uom': get_val('uom', 'NOS').upper() or 'NOS',
            'tally_qty': float(tally_str) if tally_str else 0.0,
            'physical_count': float(phys_str) if phys_str else None
        })
    return items

def parse_xlsx_stock_master(xlsx_path: str) -> List[Dict[str, Any]]:
    """Parse XLSX file using openpyxl or built-in zipfile/xml fallback."""
    # Attempt 1: openpyxl if installed
    try:
        import openpyxl
        wb = openpyxl.load_workbook(xlsx_path, data_only=True)
        # Look for sheet named "Stock Master" or use active/second sheet
        sheet = None
        for name in wb.sheetnames:
            if 'stock master' in name.lower():
                sheet = wb[name]
                break
        if sheet is None:
            sheet = wb.active

        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        for row in sheet.iter_rows(values_only=True):
            writer.writerow([str(c) if c is not None else '' for c in row])
        return parse_csv_stock_master(csv_buffer.getvalue())
    except ImportError:
        pass

    # Attempt 2: Built-in zipfile + XML extraction (zero external dependencies)
    with zipfile.ZipFile(xlsx_path, 'r') as z:
        # Load shared strings
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in ss_tree.findall('.//x:si', ns):
                text_parts = [t.text or '' for t in si.findall('.//x:t', ns)]
                shared_strings.append(''.join(text_parts))

        # Look for sheet target in workbook
        sheet_file = 'xl/worksheets/sheet2.xml'
        if sheet_file not in z.namelist():
            for name in z.namelist():
                if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                    sheet_file = name
                    break

        sheet_tree = ET.fromstring(z.read(sheet_file))
        ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)

        for row_el in sheet_tree.findall('.//x:row', ns):
            row_cells = {}
            max_col = 0
            for c_el in row_el.findall('x:c', ns):
                r_attr = c_el.get('r', '')
                col_letters = re.match(r'([A-Z]+)', r_attr)
                if not col_letters:
                    continue
                col_str = col_letters.group(1)
                # Convert Excel col letter to 0-based index (e.g. A->0, B->1, AA->26)
                col_num = 0
                for ch in col_str:
                    col_num = col_num * 26 + (ord(ch) - ord('A') + 1)
                col_idx = col_num - 1

                val_el = c_el.find('x:v', ns)
                val = val_el.text if val_el is not None else ''
                t_attr = c_el.get('t')

                if t_attr == 's' and val.isdigit():
                    val = shared_strings[int(val)] if int(val) < len(shared_strings) else val

                row_cells[col_idx] = val
                if col_idx > max_col:
                    max_col = col_idx

            row_list = [row_cells.get(i, '') for i in range(max_col + 1)]
            writer.writerow(row_list)

        return parse_csv_stock_master(csv_buffer.getvalue())

def sync_rows_to_db(cursor, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Sync parsed Excel rows into the SQLite database."""
    updated_count = 0
    inserted_count = 0

    for r in rows:
        sku = r.get('sku', '').strip()
        desc = r.get('description', '').strip()
        tally_qty = r.get('tally_qty', 0.0)
        phys = r.get('physical_count')

        # Check existing by SKU
        cursor.execute('SELECT id, opening_qty FROM items WHERE UPPER(sku) = UPPER(?)', (sku,))
        existing = cursor.fetchone()

        if existing:
            item_id = existing[0] if isinstance(existing, tuple) else existing['id']
            cursor.execute('''
                UPDATE items 
                SET opening_qty = ?, physical_count = COALESCE(?, physical_count)
                WHERE id = ?
            ''', (tally_qty, phys, item_id))
            updated_count += 1
        else:
            rack = r.get('rack') or (r.get('location', '').split('-')[0] if '-' in r.get('location', '') else 'R01')
            section = r.get('section') or (r.get('location', '').split('-')[1] if '-' in r.get('location', '') else '')
            cat = r.get('category') or RACK_CATEGORY_MAP.get(rack, 'Miscellaneous')

            cursor.execute('''
                INSERT INTO items (description, sku, make, product_type, rack, location, section, category, uom, opening_qty, physical_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-45 days', 'localtime'))
            ''', (
                desc, sku, r.get('make', ''), r.get('product_type', ''), rack,
                r.get('location') or f"{rack}-{section}".strip('-'), section, cat,
                r.get('uom', 'NOS'), tally_qty, phys
            ))
            inserted_count += 1

    return {
        'updatedCount': updated_count,
        'insertedCount': inserted_count,
        'totalProcessed': len(rows)
    }
