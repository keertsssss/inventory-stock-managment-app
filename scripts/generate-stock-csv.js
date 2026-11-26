const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = fs.existsSync(path.join(__dirname, '..', 'data', 'stock.db'))
  ? path.join(__dirname, '..', 'data', 'stock.db')
  : path.join(__dirname, '..', 'stock.db');
const db = new DatabaseSync(dbPath);

const rackMap = {
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

const items = db.prepare(`
  SELECT * FROM items 
  ORDER BY 
    COALESCE(location, '') ASC,
    CASE WHEN rack = 'R04' OR category LIKE '%Fuse%' THEN make ELSE '' END ASC,
    CASE WHEN rack = 'R04' OR category LIKE '%Fuse%' THEN COALESCE(amperes, 999999) ELSE 0 END ASC,
    sku ASC, 
    id ASC
`).all();

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
  const rowNum = idx + 2; // header is row 1, data starts on row 2
  const [rack, section] = item.location ? item.location.split('-') : ['', ''];
  const phys = item.physical_count != null ? item.physical_count : '';
  
  // Excel formula for automatic serial numbering: =ROW()-1
  const autoSerialFormula = `=ROW()-1`;
  
  // Excel formula for Total Count: L (Tally Qty) + P (Physical Count)
  const totalCountFormula = `=L${rowNum}+IF(ISBLANK(P${rowNum}),0,P${rowNum})`;
  
  lines.push([
    autoSerialFormula,
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
    item.opening_qty,
    item.cartons != null ? item.cartons : '',
    item.boxes != null ? item.boxes : '',
    item.pieces != null ? item.pieces : '',
    phys,
    totalCountFormula
  ].map(esc).join(','));
});

const outputPath = path.join(__dirname, '..', 'data', 'stock-master.csv');
fs.writeFileSync(outputPath, '\ufeff' + lines.join('\r\n'), 'utf8');
console.log(`Successfully generated ${outputPath} with 17 columns including CAT code, Cartons, Boxes, Pieces, Total Count.`);
