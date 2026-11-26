const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'stock.db');
const db = new DatabaseSync(dbPath);

// 1. Update specific items in R04 that had inconsistent SKUs
db.exec(`
  UPDATE items SET sku = 'ELEC-FUSE-LINK-63A-HAVELLS' WHERE id = 338;
  UPDATE items SET sku = 'ELEC-FUSE-LINK-25A-FTC' WHERE id = 339;
  UPDATE items SET sku = 'ELEC-FUSE-LINK-630A-TTM-FTC' WHERE id = 340;
  UPDATE items SET sku = 'ELEC-FUSE-LINK-63A-C2-FTC' WHERE id = 341;
  UPDATE items SET sku = 'ELEC-FUSE-LINK-63A-CTISE63-CNS' WHERE id = 80;
  UPDATE items SET sku = 'ELEC-KIT-KAT-FUSE-20A-FHB-FTC' WHERE id = 87;
`);

// 2. Ensure ALL SKUs and CAT codes in the catalog are in CAPITAL
db.exec(`
  UPDATE items SET sku = UPPER(sku);
  UPDATE items SET cat_code = UPPER(cat_code) WHERE cat_code IS NOT NULL;
`);

console.log('Updated SKUs and converted all SKUs and CAT codes to CAPITAL.');

// 3. Verify all R04 fuses
const r4 = db.prepare(`
  SELECT id, location, make, amperes, sku, cat_code, description 
  FROM items 
  WHERE rack = 'R04' 
  ORDER BY 
    COALESCE(location, '') ASC, 
    make ASC, 
    COALESCE(amperes, 999999) ASC, 
    sku ASC
`).all();

console.log('\n--- VERIFIED R04 FUSES (SKU & CAT CODE) ---');
r4.forEach(i => {
  console.log(`${String(i.id).padEnd(4)} | ${(i.make||'').padEnd(8)} | ${(i.cat_code||'').padEnd(14)} | ${(i.sku||'').padEnd(36)} | ${i.description}`);
});
