const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'stock.db');
const db = new DatabaseSync(dbPath);

// 1. Add amperes column if not exists
try {
  db.exec('ALTER TABLE items ADD COLUMN amperes REAL');
  console.log('Added amperes column to items table.');
} catch (e) {
  // column already exists
}

function extractAmperes(desc, sku) {
  const text = `${desc || ''} ${sku || ''}`;
  // Match patterns like "63A", "630A", "630AMP", "FL20-4A"
  const m = text.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?)\s*(?:A|AMP|AMPS)(?:$|[\s\-_/])/i);
  if (m) return parseFloat(m[1]);
  const m2 = text.match(/(\d+(?:\.\d+)?)\s*A/i);
  if (m2) return parseFloat(m2[1]);
  return null;
}

// 2. Fix locations for items 338-341 in R04 so their section matches company
// S01 = CNS, S02 = FTC, S03 = GE, S04 = Havells, S05 = L&T
db.exec(`
  UPDATE items SET location = 'R04-S04', section = 'S04' WHERE id = 338;
  UPDATE items SET location = 'R04-S02', section = 'S02' WHERE id IN (339, 340, 341);
`);
console.log('Updated locations for items 338 (Havells -> R04-S04) and 339-341 (FTC -> R04-S02).');

// 3. Extract and update amperes for all items
const items = db.prepare('SELECT id, description, sku FROM items').all();
const updateAmp = db.prepare('UPDATE items SET amperes = ? WHERE id = ?');

let updatedCount = 0;
items.forEach(item => {
  const amp = extractAmperes(item.description, item.sku);
  if (amp !== null) {
    updateAmp.run(amp, item.id);
    updatedCount++;
  }
});
console.log(`Updated amperes for ${updatedCount} items.`);

// 4. Verify R04 items
const r04 = db.prepare(`
  SELECT id, location, section, make, amperes, description 
  FROM items 
  WHERE rack = 'R04' 
  ORDER BY 
    COALESCE(location, '') ASC, 
    make ASC, 
    COALESCE(amperes, 999999) ASC, 
    description ASC
`).all();

console.log('\n--- R04 Fuses in Order ---');
r04.forEach(i => {
  console.log(`${i.location.padEnd(8)} | ${i.make.padEnd(8)} | ${String(i.amperes + 'A').padStart(6)} | ${i.description} (#${i.id})`);
});
