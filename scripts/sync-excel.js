// scripts/sync-excel.js
// CLI utility to manually synchronize Tally counts from Excel sheet into stock.db
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const excelSync = require('../lib/excel-sync');

const xlsxCandidates = [
  path.join(__dirname, '..', 'data', 'Srinivasa_Stock_Rack_Plan.xlsx'),
  path.join(__dirname, '..', 'Srinivasa_Stock_Rack_Plan.xlsx'),
  path.join('c:', 'Users', 'Keerthi', 'Downloads', 'Srinivasa_Stock_Rack_Plan.xlsx')
];

const xlsxPath = xlsxCandidates.find(p => fs.existsSync(p));
if (!xlsxPath) {
  console.error('Error: Srinivasa_Stock_Rack_Plan.xlsx not found.');
  process.exit(1);
}

console.log(`Reading Excel stock master from: ${xlsxPath}`);
const rows = excelSync.parseXlsxStockMaster(xlsxPath);
console.log(`Parsed ${rows.length} rows from Excel sheet.`);

const dbPath = fs.existsSync(path.join(__dirname, '..', 'data', 'stock.db'))
  ? path.join(__dirname, '..', 'data', 'stock.db')
  : path.join(__dirname, '..', 'stock.db');
const db = new DatabaseSync(dbPath);
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const res = fn(...args);
    db.exec('COMMIT');
    return res;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

const result = excelSync.syncRowsToDb(db, rows);
console.log(`Sync completed!`);
console.log(`- Updated Tally items: ${result.tallyUpdated}`);
console.log(`- Updated Physical counts: ${result.physUpdated}`);
