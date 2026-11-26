const path = require('path');
const fs = require('fs');

// Use node:sqlite or better-sqlite3
let Database;
try {
  const { DatabaseSync } = require('node:sqlite');
  Database = class {
    constructor(file) { this._db = new DatabaseSync(file); }
    exec(sql) { return this._db.exec(sql); }
    prepare(sql) { return this._db.prepare(sql); }
  };
} catch {
  Database = require('better-sqlite3');
}

const dbPath = path.join(__dirname, '..', 'data', 'stock.db');
const db = new Database(dbPath);

console.log('Resetting stock database...');

// 1. Reset items table
db.exec('BEGIN IMMEDIATE');
db.exec('UPDATE items SET opening_qty = 0, physical_count = NULL');
db.exec('DELETE FROM movements');
try {
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'movements'");
} catch (_) {}
db.exec('COMMIT');

const stats = db.prepare('SELECT COUNT(*) as cnt, SUM(opening_qty) as total_qty FROM items').get();
const movs = db.prepare('SELECT COUNT(*) as cnt FROM movements').get();
console.log(`Database reset: ${stats.cnt} items, total opening qty = ${stats.total_qty || 0}, movements count = ${movs.cnt}`);

// 2. Also reset data/items.json so future reseeds start at 0
const jsonPath = path.join(__dirname, '..', 'data', 'items.json');
if (fs.existsSync(jsonPath)) {
  const items = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const updatedItems = items.map(item => ({ ...item, qty: 0 }));
  fs.writeFileSync(jsonPath, JSON.stringify(updatedItems, null, 2), 'utf8');
  console.log(`Updated ${updatedItems.length} items in data/items.json to 0 qty.`);
}

// 3. Clean test images in data/uploads/
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  let removedCount = 0;
  for (const f of files) {
    if (f !== '.gitkeep') {
      try {
        fs.unlinkSync(path.join(uploadsDir, f));
        removedCount++;
      } catch (_) {}
    }
  }
  console.log(`Cleaned ${removedCount} uploaded test photos.`);
}

console.log('Everything successfully reset to 0 with clean slate!');
