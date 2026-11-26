// server.js — the "brain" of the app. It stores data and answers requests from phones/laptops.
const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const seedItems = fs.existsSync(path.join(__dirname, 'data', 'items.json'))
  ? require('./data/items.json')
  : require('./items.json');   // your 335 SKUs with opening (tally) quantities
const SkuPatternEngine = require('./lib/sku-generator');
const excelSync = require('./lib/excel-sync');

// Use Node 22+ built-in node:sqlite (zero native compilation / build tools required),
// with fallback to better-sqlite3 for older Node versions.
let Database;
try {
  const { DatabaseSync } = require('node:sqlite');
  Database = class {
    constructor(file) {
      this._db = new DatabaseSync(file);
    }
    pragma(str) {
      try { this._db.exec(`PRAGMA ${str}`); } catch (_) {}
    }
    exec(sql) {
      return this._db.exec(sql);
    }
    prepare(sql) {
      return this._db.prepare(sql);
    }
    transaction(fn) {
      return (...args) => {
        this._db.exec('BEGIN IMMEDIATE');
        try {
          const res = fn(...args);
          this._db.exec('COMMIT');
          return res;
        } catch (err) {
          this._db.exec('ROLLBACK');
          throw err;
        }
      };
    }
  };
} catch {
  Database = require('better-sqlite3');
}

const PORT = process.env.PORT || 3000;
// Only these units may have decimals (e.g. 12.5 KGS). Everything else must be whole numbers.
const DECIMAL_UOMS = ['KGS', 'MTR', 'LTR'];

// Configurable Retention window for "NEW" product status (15 to 30 days)
const NEW_PRODUCT_RETENTION_DAYS = 30;

// Mapping of rack to category
const RACK_CATEGORY_MAP = {
  'R01': 'Cables',
  'R02': 'Cable Accessories, Connectors & Terminals',
  'R03': 'Contactors, Relays & Controllers',
  'R04': 'Fuses',
  'R05': 'Lighting',
  'R06': 'MCB / MCCB / RCCB',
  'R07': 'Meters & Measuring Instruments',
  'R08': 'Switches & Sockets',
  'R09': 'Tapes & Miscellaneous (incl. Raw Material)'
};

// ---------- 1. Database (located in data/stock.db) ----------
const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const UPLOADS_DIR = path.join(DB_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const DB_PATH = fs.existsSync(path.join(DB_DIR, 'stock.db'))
  ? path.join(DB_DIR, 'stock.db')
  : (fs.existsSync(path.join(__dirname, 'stock.db')) ? path.join(__dirname, 'stock.db') : path.join(DB_DIR, 'stock.db'));
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- immutable primary key
  serial_no INTEGER,                    -- optional legacy serial number
  description TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  cat_code TEXT,                        -- readable code / CAT code
  make TEXT,
  product_type TEXT,
  rack TEXT,
  location TEXT,                        -- e.g. R06-S01
  section TEXT,                         -- e.g. S01
  category TEXT,                        -- e.g. Cables
  uom TEXT NOT NULL,
  opening_qty REAL NOT NULL DEFAULT 0,
  cartons REAL DEFAULT NULL,
  boxes REAL DEFAULT NULL,
  pieces REAL DEFAULT NULL,
  physical_count REAL DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS movements (   -- the ledger: every stock change is one row, never edited
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  item_id INTEGER NOT NULL REFERENCES items(id),
  type TEXT NOT NULL CHECK (type IN ('ISSUE','RECEIVE','ADJUST')),
  qty REAL NOT NULL,
  person TEXT NOT NULL,
  note TEXT,
  photo TEXT
);
CREATE INDEX IF NOT EXISTS idx_mov_ts ON movements(ts);
CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
CREATE INDEX IF NOT EXISTS idx_items_loc ON items(location);
`);

// Schema updates for existing databases
try { db.exec('ALTER TABLE items ADD COLUMN category TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN section TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN physical_count REAL'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN serial_no INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN created_at TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN cat_code TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN cartons REAL'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN boxes REAL'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN pieces REAL'); } catch (_) {}
try { db.exec('ALTER TABLE items ADD COLUMN amperes REAL'); } catch (_) {}
try { db.exec('ALTER TABLE movements ADD COLUMN photo TEXT'); } catch (_) {}

// Default older established items to 45 days ago if not set, so they act as mature products
db.exec("UPDATE items SET created_at = datetime('now', '-45 days', 'localtime') WHERE created_at IS NULL");

function extractAmperes(desc, sku) {
  const text = `${desc || ''} ${sku || ''}`;
  const m = text.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?)\s*(?:A|AMP|AMPS)(?:$|[\s\-_/])/i);
  if (m) return parseFloat(m[1]);
  const m2 = text.match(/(\d+(?:\.\d+)?)\s*A\b/i);
  if (m2) return parseFloat(m2[1]);
  return null;
}

const PRODUCT_TYPE_SHORTCUTS = {
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
};

function getBrandCode(brand) {
  if (!brand) return 'GEN';
  const b = brand.trim().toUpperCase();
  if (b === 'L&T' || b === 'L & T' || b === 'LT') return 'LNT';
  if (b === '3M') return '3M';
  if (b === 'GE') return 'GE';
  if (b === 'AE') return 'AE';
  if (b === 'TC') return 'TC';
  if (b === 'C&S' || b === 'CNS') return 'CNS';
  if (b === 'MF GOLD') return 'MFG';
  if (b === 'NO MAKE LISTED' || b === 'GENERIC') return 'GEN';
  const clean = b.replace(/[^A-Z0-9]/g, '');
  return clean.slice(0, 3);
}

function getProductTypeShortcut(pType, desc) {
  if (PRODUCT_TYPE_SHORTCUTS[pType]) return PRODUCT_TYPE_SHORTCUTS[pType];
  const d = desc || '';
  if (/\bFUSE\s+LINK\b/i.test(d)) return 'FL';
  if (/\bFUSE\s+HOLDER\b/i.test(d)) return 'FH';
  if (/\bKIT\s*KAT\b/i.test(d)) return 'KK';
  if (/\bHRC\s+FUSE\b/i.test(d)) return 'FL';
  if (/\bMCB\b/i.test(d)) return 'MCB';
  if (/\bMCCB\b/i.test(d)) return 'MCCB';
  if (/\bCABLE\b/i.test(d)) return 'CBL';

  if (!pType) return 'PRD';
  const pt = pType.trim();
  if (/^[A-Z]{2,4}$/.test(pt)) return pt;
  const words = pt.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
  }
  return pt.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

function generateCatCode({ make, product_type, description, sku, amperes }) {
  const brandCode = getBrandCode(make);
  const typeCode = getProductTypeShortcut(product_type, description);
  const amp = amperes != null ? `${amperes}A` : (extractAmperes(description, sku) ? `${extractAmperes(description, sku)}A` : null);

  if (amp) {
    return `${brandCode} ${typeCode} ${amp}`;
  }

  const sqmmMatch = (description || '').match(/(\d+(?:\.\d+)?)\s*SQMM/i);
  if (sqmmMatch) {
    return `${brandCode} ${typeCode} ${sqmmMatch[1]}SQ`;
  }

  const words = (description || '').split(/\s+/).filter(Boolean);
  const lastToken = words.length > 2 ? words[words.length - 2] : '';
  if (lastToken && /^[A-Z0-9\-]+$/i.test(lastToken) && lastToken.toUpperCase() !== make?.toUpperCase()) {
    return `${brandCode} ${typeCode} ${lastToken.toUpperCase()}`;
  }

  return `${brandCode} ${typeCode}`.toUpperCase();
}

function generateSkuCode({ make, product_type, description, amperes }) {
  const prefix = 'ELEC';
  let pName = (product_type || '').toUpperCase().trim();
  if (!pName) {
    if (/\bFUSE\s+LINK\b/i.test(description)) pName = 'FUSE-LINK';
    else if (/\bFUSE\s+HOLDER\b/i.test(description)) pName = 'FUSE-HOLDER';
    else if (/\bKIT\s*KAT\b/i.test(description)) pName = 'KIT-KAT-FUSE';
    else if (/\bHRC\s+FUSE\b/i.test(description)) pName = 'FUSE-LINK';
    else if (/\bMCB\b/i.test(description)) pName = 'MCB';
    else if (/\bMCCB\b/i.test(description)) pName = 'MCCB';
    else if (/\bCONTACTOR\b/i.test(description)) pName = 'CONTACTOR';
    else if (/\bCABLE\b/i.test(description)) pName = 'CABLE';
    else pName = 'ITEM';
  } else {
    pName = pName.replace(/[^A-Z0-9\s]/g, ' ').trim().split(/\s+/).join('-');
  }

  pName = pName.replace(/^ELEC-?/i, '');

  let ampStr = '';
  if (amperes != null && !isNaN(amperes) && Number(amperes) > 0) {
    ampStr = `${amperes}A`;
  } else {
    const text = description || '';
    const m = text.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?)\s*(?:A|AMP|AMPS)(?:$|[\s\-_/])/i);
    if (m) ampStr = `${parseFloat(m[1])}A`;
    else {
      const m2 = text.match(/(\d+(?:\.\d+)?)\s*A\b/i);
      if (m2) ampStr = `${parseFloat(m2[1])}A`;
    }
  }

  if (!ampStr) {
    const sqmm = (description || '').match(/(\d+(?:\.\d+)?)\s*SQMM/i);
    if (sqmm) ampStr = `${sqmm[1]}SQMM`;
  }

  let brand = (make || 'GENERIC').toUpperCase().trim();
  if (brand === 'L&T' || brand === 'L & T' || brand === 'LT') brand = 'LT';
  else brand = brand.replace(/[^A-Z0-9\s]/g, '').split(/\s+/).join('-');

  if (ampStr && (pName.endsWith(`-${ampStr}`) || pName.includes(`-${ampStr}-`))) {
    ampStr = '';
  }
  if (brand && (pName.endsWith(`-${brand}`) || pName.includes(`-${brand}-`))) {
    brand = '';
  }

  const parts = [prefix, pName];
  if (ampStr) parts.push(ampStr);
  if (brand) parts.push(brand);

  return parts.filter(Boolean).join('-').replace(/-+/g, '-').toUpperCase();
}

// First run only: load the items from items.json
if (db.prepare('SELECT COUNT(*) AS c FROM items').get().c === 0) {
  const ins = db.prepare(`INSERT INTO items (id, serial_no, description, sku, make, product_type, rack, location, section, category, uom, opening_qty, created_at)
                          VALUES (@id, @serial_no, @description, @sku, @make, @product_type, @rack, @location, @section, @category, @uom, @qty, datetime('now', '-45 days', 'localtime'))`);
  db.transaction(list => list.forEach((i, idx) => {
    const [rack, section] = i.location ? i.location.split('-') : [i.rack, ''];
    ins.run({
      ...i,
      serial_no: idx + 1,
      section: section || '',
      category: RACK_CATEGORY_MAP[i.rack] || ''
    });
  }))(seedItems);
  console.log('Loaded', seedItems.length, 'items into the database.');
}

// Live Tally count & stock balance = opening quantity + receipts - issues
const STOCK_SELECT = `
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
  LEFT JOIN movements m ON m.item_id = i.id`;

const getOne = db.prepare(STOCK_SELECT + ' WHERE i.id = ? GROUP BY i.id');
const insertMove = db.prepare('INSERT INTO movements (item_id, type, qty, person, note, photo) VALUES (?, ?, ?, ?, ?, ?)');

// Runs as one all-or-nothing step, so two people saving at once cannot break the stock.
const recordMove = db.transaction((type, itemId, qty, person, note, photo) => {
  const item = getOne.get(itemId);
  if (!item) throw new Error('Item not found');
  if (type === 'ISSUE' && qty > item.stock) {
    throw new Error(`Only ${item.stock} ${item.uom} in stock — cannot issue ${qty}.`);
  }
  insertMove.run(itemId, type, qty, person, note || null, photo || null);
  return getOne.get(itemId);
});

// ---------- 2. Web server ----------
const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));   // serves the page people see
app.use('/uploads', express.static(UPLOADS_DIR));          // serves uploaded visual proof photos

/**
 * Sync / Take Tally Count & Physical Count directly from Excel (.xlsx or .csv)
 */
app.post('/api/sync-excel', (req, res) => {
  try {
    let rows = [];
    const { base64Data, csvContent } = req.body || {};

    if (csvContent) {
      rows = excelSync.parseCsvStockMaster(csvContent);
    } else if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      const tempPath = path.join(__dirname, '.temp_upload_' + Date.now() + '.xlsx');
      fs.writeFileSync(tempPath, buffer);
      try {
        rows = excelSync.parseXlsxStockMaster(tempPath);
      } finally {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
    } else {
      // Default: Sync from existing Srinivasa_Stock_Rack_Plan.xlsx
      const xlsxFile = fs.existsSync(path.join(__dirname, 'data', 'Srinivasa_Stock_Rack_Plan.xlsx'))
        ? path.join(__dirname, 'data', 'Srinivasa_Stock_Rack_Plan.xlsx')
        : path.join(__dirname, 'Srinivasa_Stock_Rack_Plan.xlsx');
      if (!fs.existsSync(xlsxFile)) {
        throw new Error('Srinivasa_Stock_Rack_Plan.xlsx not found.');
      }
      rows = excelSync.parseXlsxStockMaster(xlsxFile);
    }

    if (!rows.length) {
      throw new Error('No valid stock items found in Excel/CSV file.');
    }

    const syncResult = excelSync.syncRowsToDb(db, rows);

    res.json({
      ok: true,
      message: `Successfully synchronized ${syncResult.updatedCount} items with Tally counts from Excel!`,
      ...syncResult
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * List items with:
 * 1. Dynamic Display Serial Number via ROW_NUMBER() OVER (...) without modifying primary keys
 * 2. Real-time product age & 15-30 day "NEW" status
 */
app.get('/api/items', (req, res) => {
  const words = String(req.query.q || '').trim().split(/\s+/).filter(Boolean);
  const rackFilter = String(req.query.rack || '').trim();
  const whereClauses = [];
  const params = [];

  if (rackFilter) {
    whereClauses.push('i.rack = ?');
    params.push(rackFilter);
  }

  if (words.length) {
    words.forEach(w => {
      whereClauses.push('(i.description LIKE ? OR i.sku LIKE ? OR i.cat_code LIKE ? OR i.make LIKE ? OR i.location LIKE ? OR i.category LIKE ? OR i.product_type LIKE ? OR CAST(i.id AS TEXT) LIKE ?)');
      params.push(`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`);
    });
  }

  const whereSql = whereClauses.length ? ' WHERE ' + whereClauses.join(' AND ') : '';

  // Dynamic ranking via SQL window function ROW_NUMBER() OVER (...)
  const sql = `
    WITH item_summary AS (
      ${STOCK_SELECT}
      ${whereSql}
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
        WHEN days_old <= ${NEW_PRODUCT_RETENTION_DAYS} THEN 1 
        ELSE 0 
      END AS is_new,
      MAX(0, ${NEW_PRODUCT_RETENTION_DAYS} - days_old) AS days_remaining
    FROM item_summary
    ORDER BY serial_no ASC;
  `;

  const rows = db.prepare(sql).all(...params);
  const items = rows.map(r => ({
    ...r,
    variance: r.physical_count !== null && r.physical_count !== undefined
      ? Math.round((Number(r.physical_count) - Number(r.tally_qty)) * 100) / 100
      : null
  }));
  res.json(items);
});

/**
 * Preview / Auto-generate matching SKU pattern for product onboarding
 */
app.post('/api/products/suggest-sku', (req, res) => {
  try {
    const { category, prefix, branch_parent_sku, make, product_type, description } = req.body;
    let query = 'SELECT sku FROM items';
    const params = [];
    if (category) {
      query += ' WHERE category = ?';
      params.push(category);
    }
    const existingSkus = db.prepare(query).all(...params).map(r => r.sku);

    let result;
    if (branch_parent_sku) {
      result = SkuPatternEngine.generateSubVariant({
        parentSku: branch_parent_sku,
        existingSkus
      });
    } else {
      result = SkuPatternEngine.generateNext({
        existingSkus,
        prefix: prefix || ''
      });
    }

    let suggestedSku = null;
    if (make || product_type || description) {
      const baseSku = generateSkuCode({ make, product_type, description });
      let candidate = baseSku;
      let counter = 1;
      while (existingSkus.includes(candidate)) {
        candidate = `${baseSku}-${counter++}`;
      }
      suggestedSku = candidate;
    }

    const finalSku = (suggestedSku || result.sku).toUpperCase();
    const suggestedCatCode = generateCatCode({
      make,
      product_type,
      description,
      sku: finalSku
    }).toUpperCase();

    res.json({ ok: true, ...result, sku: finalSku, cat_code: suggestedCatCode });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * Product Onboarding:
 * Onboard a new product with:
 * - Strict SKU uniqueness validation
 * - In-between positioning via dynamic ROW_NUMBER()
 * - Automatic created_at timestamp triggering the 15-30 day "NEW" badge
 */
app.post('/api/products', (req, res) => {
  try {
    const { description, sku, cat_code, make, product_type, rack, location, uom, opening_qty, rating } = req.body;
    if (!description || !sku) throw new Error('Description and SKU are required');

    let cleanSku = String(sku).trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
    if (!cleanSku.startsWith('ELEC-')) {
      cleanSku = 'ELEC-' + cleanSku.replace(/^ELEC-?/i, '');
    }

    // Strict Uniqueness check against collision
    const existing = db.prepare('SELECT id, sku FROM items WHERE UPPER(sku) = ?').get(cleanSku);
    if (existing) {
      throw new Error(`SKU collision: "${cleanSku}" already exists in the catalog.`);
    }

    const cleanLocation = String(location || '').trim().toUpperCase();
    const cleanRack = String(rack || (cleanLocation ? cleanLocation.split('-')[0] : 'R01')).trim().toUpperCase();
    const cleanSection = cleanLocation.includes('-') ? cleanLocation.split('-')[1] : '';
    const category = RACK_CATEGORY_MAP[cleanRack] || 'Miscellaneous';
    const cleanUom = String(uom || 'NOS').trim().toUpperCase();
    const qty = Number(opening_qty || 0);
    const cleanCatCode = String(cat_code || '').trim().toUpperCase() || null;

    const reqAmp = req.body.amperes != null ? Number(req.body.amperes) : (rating ? extractAmperes(String(rating), '') : null);
    const amperes = reqAmp && !isNaN(reqAmp) ? reqAmp : extractAmperes(description, cleanSku);
    const finalCatCode = cleanCatCode || generateCatCode({ make, product_type, description, sku: cleanSku, amperes });

    const ins = db.prepare(`
      INSERT INTO items (description, sku, cat_code, make, product_type, rack, location, section, category, uom, opening_qty, amperes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);

    ins.run(
      description.trim(),
      cleanSku,
      finalCatCode,
      (make || '').trim(),
      (product_type || '').trim(),
      cleanRack,
      cleanLocation,
      cleanSection,
      category,
      cleanUom,
      qty,
      amperes
    );

    const newlyAdded = db.prepare('SELECT * FROM items WHERE sku = ?').get(cleanSku);

    res.json({
      ok: true,
      message: `Product ${cleanSku} successfully onboarded!`,
      product: {
        ...newlyAdded,
        is_new: 1,
        days_old: 0,
        days_remaining: NEW_PRODUCT_RETENTION_DAYS
      }
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Update physical count, cartons, boxes, pieces, and CAT code for an item
app.post('/api/physical-count', (req, res) => {
  try {
    const id = Number(req.body.id);
    if (!Number.isInteger(id)) throw new Error('Invalid item ID');

    const parseNumOrNull = v => (v === '' || v === null || v === undefined) ? null : Number(v);

    const countVal = parseNumOrNull(req.body.physical_count);
    const cartonsVal = parseNumOrNull(req.body.cartons);
    const boxesVal = parseNumOrNull(req.body.boxes);
    const piecesVal = parseNumOrNull(req.body.pieces);
    const catCodeVal = req.body.cat_code !== undefined ? (String(req.body.cat_code || '').trim().toUpperCase() || null) : undefined;

    if (countVal !== null && !Number.isFinite(countVal)) throw new Error('Total quantity must be a valid number');
    if (cartonsVal !== null && !Number.isFinite(cartonsVal)) throw new Error('Cartons must be a valid number');
    if (boxesVal !== null && !Number.isFinite(boxesVal)) throw new Error('Boxes must be a valid number');
    if (piecesVal !== null && !Number.isFinite(piecesVal)) throw new Error('Pieces must be a valid number');

    const updates = [];
    const params = [];
    if (req.body.physical_count !== undefined) { updates.push('physical_count = ?'); params.push(countVal); }
    if (req.body.cartons !== undefined) { updates.push('cartons = ?'); params.push(cartonsVal); }
    if (req.body.boxes !== undefined) { updates.push('boxes = ?'); params.push(boxesVal); }
    if (req.body.pieces !== undefined) { updates.push('pieces = ?'); params.push(piecesVal); }
    if (catCodeVal !== undefined) { updates.push('cat_code = ?'); params.push(catCodeVal); }

    if (updates.length) {
      params.push(id);
      db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    const item = getOne.get(id);
    const variance = item.physical_count !== null && item.physical_count !== undefined
      ? Math.round((Number(item.physical_count) - Number(item.tally_qty)) * 100) / 100
      : null;

    res.json({
      ok: true,
      id,
      cat_code: item.cat_code,
      cartons: item.cartons,
      boxes: item.boxes,
      pieces: item.pieces,
      physical_count: item.physical_count,
      variance
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Issue (take out) or receive (add) stock
app.post('/api/move', (req, res) => {
  try {
    const { type, item_id, note, photo } = req.body;
    const qty = Number(req.body.qty);
    const person = String(req.body.person || '').trim().slice(0, 50);
    if (!['ISSUE', 'RECEIVE'].includes(type)) throw new Error('Type must be ISSUE or RECEIVE');
    if (!person) throw new Error('Please enter your name');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be more than 0');
    const item = getOne.get(item_id);
    if (!item) throw new Error('Item not found');
    if (!DECIMAL_UOMS.includes(item.uom) && !Number.isInteger(qty)) {
      throw new Error(`${item.uom} must be a whole number`);
    }

    // Process photo attachment if provided (e.g. proof of issued quantity)
    let photoUrl = null;
    if (photo && typeof photo === 'string' && photo.startsWith('data:image/')) {
      const match = photo.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const rawExt = match[1].toLowerCase();
        const ext = (rawExt === 'jpeg' || rawExt === 'jpg') ? 'jpg' : (rawExt === 'png' ? 'png' : 'webp');
        const filename = `${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const filepath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filepath, Buffer.from(match[2], 'base64'));
        photoUrl = `/uploads/${filename}`;
      }
    } else if (photo && typeof photo === 'string' && photo.startsWith('/uploads/')) {
      photoUrl = photo;
    }

    const updated = recordMove(type, item_id, qty, person, String(note || '').trim().slice(0, 200), photoUrl);
    res.json({ ok: true, item: updated, photo: photoUrl });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Stock Master CSV export in the requested format with live Tally balances
app.get('/api/stock.csv', (req, res) => {
  const sql = `
    WITH item_summary AS (
      ${STOCK_SELECT}
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
    ORDER BY dynamic_serial_no ASC`;
  const items = db.prepare(sql).all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Serial No',
    'Rack Location',
    'Rack',
    'Section',
    'Make',
    'Product Type',
    'S.No (orig.)',
    'Description',
    'SKU Code',
    'Readable Code / CAT Code',
    'UOM',
    'Tally Qty',
    'Cartons',
    'Boxes',
    'Pieces',
    'Physical Count',
    'Total Count'
  ];
  const lines = [headers.map(esc).join(',')];
  items.forEach((item, idx) => {
    const rowNum = idx + 2;
    const [rack, section] = item.location ? item.location.split('-') : ['', ''];
    const phys = item.physical_count != null ? item.physical_count : '';
    const totalCountFormula = `=L${rowNum}+IF(ISBLANK(P${rowNum}),0,P${rowNum})`;
    lines.push([
      `=ROW()-1`,
      item.location || '',
      rack || '',
      section || '',
      item.make || '',
      item.product_type || '',
      item.id,
      item.description || '',
      item.sku || '',
      item.cat_code || '',
      item.uom || '',
      item.tally_qty,
      item.cartons != null ? item.cartons : '',
      item.boxes != null ? item.boxes : '',
      item.pieces != null ? item.pieces : '',
      phys,
      totalCountFormula
    ].map(esc).join(','));
  });

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="stock-master.csv"'
  });
  res.send('\ufeff' + lines.join('\r\n'));
});

// Daily report: all movements on a date (default today)
function reportRows(date) {
  return db.prepare(`
    SELECT m.id, m.ts, m.type, i.location, i.description, i.sku, i.uom, m.qty, m.person, m.note, m.photo
    FROM movements m JOIN items i ON i.id = m.item_id
    WHERE substr(m.ts, 1, 10) = ? ORDER BY m.ts DESC, m.id DESC`).all(date);
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
app.get('/api/report', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : today();
  res.json({ date, rows: reportRows(date) });
});
app.get('/api/report.csv', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : today();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Time', 'Type', 'Location', 'Description', 'SKU', 'UOM', 'Qty', 'Person', 'Note', 'Photo Proof URL'];
  const lines = [head.map(esc).join(',')];
  reportRows(date).forEach(r => {
    const photoUrl = r.photo ? `${req.protocol}://${req.get('host')}${r.photo}` : '';
    lines.push([r.ts, r.type, r.location, r.description, r.sku, r.uom, r.qty, r.person, r.note, photoUrl].map(esc).join(','));
  });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stock-report-${date}.csv"` });
  res.send('\ufeff' + lines.join('\r\n'));   // \ufeff helps Excel read it correctly
});

// '0.0.0.0' = accept connections from other devices on the Wi-Fi, not just this computer
app.listen(PORT, '0.0.0.0', () => {
  console.log('\nStock app is running.');
  console.log(`  On this computer : http://localhost:${PORT}`);
  Object.values(os.networkInterfaces()).flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .forEach(n => console.log(`  On phones/laptops: http://${n.address}:${PORT}   (same Wi-Fi)`));
});
