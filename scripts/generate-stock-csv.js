const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'stock.db');
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

const items = db.prepare('SELECT * FROM items ORDER BY location, id').all();

const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

const headers = [
  'Serial No',
  'Rack Location',
  'Rack',
  'Section',
  'Category',
  'Make',
  'Product Type',
  'S.No (orig.)',
  'Description',
  'SKU Code',
  'UOM',
  'Tally Qty',
  'Physical Count',
  'Variance (Physical − Tally)'
];

const lines = [headers.map(esc).join(',')];

items.forEach((item, idx) => {
  const rowNum = idx + 2; // header is row 1, data starts on row 2
  const [rack, section] = item.location ? item.location.split('-') : ['', ''];
  const category = item.category || rackMap[rack] || '';
  const phys = item.physical_count != null ? item.physical_count : '';
  
  // Excel formula for automatic serial numbering: =ROW()-1
  // If row moves or changes in Excel, serial number updates automatically!
  const autoSerialFormula = `=ROW()-1`;
  
  // Excel formula for Variance: =IF(ISBLANK(M2),"",M2-L2)
  const varianceFormula = phys !== '' ? (Number(phys) - Number(item.opening_qty)) : `=IF(ISBLANK(M${rowNum}),"",M${rowNum}-L${rowNum})`;
  
  lines.push([
    autoSerialFormula,
    item.location || '',
    rack || '',
    section || '',
    category,
    item.make || '',
    item.product_type || '',
    item.id,
    item.description || '',
    item.sku || '',
    item.uom || '',
    item.opening_qty,
    phys,
    varianceFormula
  ].map(esc).join(','));
});

const outputPath = path.join(__dirname, '..', 'data', 'stock-master.csv');
fs.writeFileSync(outputPath, '\ufeff' + lines.join('\r\n'), 'utf8');
const rootCopy = path.join(__dirname, '..', 'stock-master.csv');
fs.writeFileSync(rootCopy, '\ufeff' + lines.join('\r\n'), 'utf8');
console.log(`Successfully generated ${outputPath} with dynamic Excel formulas for Serial No and Variance.`);
