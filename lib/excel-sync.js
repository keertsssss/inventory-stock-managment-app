// lib/excel-sync.js
// Utility to parse Excel sheets (.xlsx and .csv) and sync Tally count and physical counts into stock.db
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Parse an .xlsx file using built-in Windows .NET Zip decompression and XML extraction
 */
function parseXlsxStockMaster(xlsxPath) {
  const tempExtractDir = path.join(__dirname, '..', '.temp_xlsx_extract_' + Date.now());
  try {
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });

    // Use PowerShell's built-in .NET System.IO.Compression (no extra npm packages required)
    const psScript = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem;
      [System.IO.Compression.ZipFile]::ExtractToDirectory('${xlsxPath.split('\\').join('/')}', '${tempExtractDir.split('\\').join('/')}')
    `;
    execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, ' ')}"`);

    // Look for workbook to find the sheetId for "Stock Master"
    const workbookPath = path.join(tempExtractDir, 'xl', 'workbook.xml');
    let sheetFileName = 'sheet2.xml'; // default fallback

    if (fs.existsSync(workbookPath)) {
      const wbXml = fs.readFileSync(workbookPath, 'utf8');
      const sheetMatch = wbXml.match(/<sheet[^>]+name="([^"]+)"[^>]+sheetId="(\d+)"[^>]*r:id="([^"]+)"/g);
      if (sheetMatch) {
        for (const s of sheetMatch) {
          const nameM = s.match(/name="([^"]+)"/);
          const rIdM = s.match(/r:id="([^"]+)"/);
          if (nameM && nameM[1].toLowerCase().includes('stock master') && rIdM) {
            // Find target in workbook.xml.rels
            const relsPath = path.join(tempExtractDir, 'xl', '_rels', 'workbook.xml.rels');
            if (fs.existsSync(relsPath)) {
              const relsXml = fs.readFileSync(relsPath, 'utf8');
              const relMatch = new RegExp(`Id="${rIdM[1]}"[^>]+Target="([^"]+)"`).exec(relsXml);
              if (relMatch) {
                sheetFileName = path.basename(relMatch[1]);
              }
            }
          }
        }
      }
    }

    const sheetPath = path.join(tempExtractDir, 'xl', 'worksheets', sheetFileName);
    if (!fs.existsSync(sheetPath)) {
      throw new Error(`Could not locate worksheet file ${sheetFileName} inside XLSX`);
    }

    const sheetXml = fs.readFileSync(sheetPath, 'utf8');

    // Parse shared strings if present
    const sharedStrings = [];
    const sharedStringsPath = path.join(tempExtractDir, 'xl', 'sharedStrings.xml');
    if (fs.existsSync(sharedStringsPath)) {
      const ssXml = fs.readFileSync(sharedStringsPath, 'utf8');
      const siMatches = ssXml.match(/<si>(.*?)<\/si>/gs) || [];
      for (const si of siMatches) {
        const tMatches = si.match(/<t[^>]*>(.*?)<\/t>/gs) || [];
        const str = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
        sharedStrings.push(str);
      }
    }

    // Parse rows from sheetXml
    const rows = [];
    const rowRegex = /<row r="(\d+)"[^>]*>(.*?)<\/row>/gs;
    let rMatch;

    // Detect column letters for headers
    const headerColMap = {};

    while ((rMatch = rowRegex.exec(sheetXml)) !== null) {
      const rowNum = parseInt(rMatch[1]);
      const rowContent = rMatch[2];

      const cellRegex = /<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]+)")?[^>]*>(?:<f>.*?<\/f>)?(?:<is><t>([\s\S]*?)<\/t><\/is>)?(?:<v>([\s\S]*?)<\/v>)?<\/c>/g;
      let cMatch;
      const cells = {};

      while ((cMatch = cellRegex.exec(rowContent)) !== null) {
        const colLetter = cMatch[1];
        const cellType = cMatch[2];
        const inlineText = cMatch[3];
        const valText = cMatch[4];

        let cellValue = '';
        if (inlineText !== undefined) {
          cellValue = inlineText;
        } else if (cellType === 's' && valText !== undefined) {
          const sIdx = parseInt(valText);
          cellValue = sharedStrings[sIdx] || '';
        } else if (valText !== undefined) {
          cellValue = valText;
        }
        cells[colLetter] = cellValue.trim();
      }

      if (rowNum === 1) {
        // Read header mapping
        for (const [col, val] of Object.entries(cells)) {
          const lower = val.toLowerCase();
          if (lower.includes('variance')) {
            headerColMap.variance = col;
          } else if (lower.includes('sku')) {
            headerColMap.sku = col;
          } else if (lower.includes('tally')) {
            headerColMap.tally = col;
          } else if (lower.includes('physical')) {
            headerColMap.physical = col;
          } else if (lower.includes('s.no') || lower.includes('orig')) {
            headerColMap.sno = col;
          } else if (lower.includes('description')) {
            headerColMap.desc = col;
          } else if (lower.includes('uom')) {
            headerColMap.uom = col;
          } else if (lower.includes('location')) {
            headerColMap.location = col;
          }
        }
        // Fallbacks based on standard format
        if (!headerColMap.sku) headerColMap.sku = 'H';
        if (!headerColMap.tally) headerColMap.tally = 'J';
        if (!headerColMap.physical) headerColMap.physical = 'K';
        if (!headerColMap.sno) headerColMap.sno = 'F';
      } else {
        const sku = cells[headerColMap.sku] || '';
        const origSno = cells[headerColMap.sno] ? parseInt(cells[headerColMap.sno]) : null;
        const tallyRaw = cells[headerColMap.tally];
        const tallyVal = (tallyRaw !== undefined && tallyRaw !== '') ? parseFloat(tallyRaw) : 0;
        const physRaw = cells[headerColMap.physical];
        const physVal = (physRaw !== undefined && physRaw !== '') ? parseFloat(physRaw) : null;

        if (sku || origSno) {
          rows.push({
            rowNum,
            sku,
            orig_sno: origSno,
            tally_qty: isNaN(tallyVal) ? 0 : tallyVal,
            physical_count: isNaN(physVal) ? null : physVal,
            location: cells[headerColMap.location || 'A'] || '',
            description: cells[headerColMap.desc || 'G'] || ''
          });
        }
      }
    }

    return rows;
  } finally {
    try {
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

/**
 * Parse a CSV file (e.g. stock-master.csv)
 */
function parseCsvStockMaster(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  function parseCsvLine(line) {
    const entries = [];
    let insideQuotes = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          entry += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        entries.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    entries.push(entry.trim());
    return entries;
  }

  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, '').toLowerCase());
  const skuIdx = headers.findIndex(h => h.includes('sku'));
  const tallyIdx = headers.findIndex(h => h.includes('tally') && !h.includes('variance'));
  const physIdx = headers.findIndex(h => h.includes('physical') && !h.includes('variance'));
  const snoIdx = headers.findIndex(h => h.includes('orig') || h.includes('s.no'));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const sku = skuIdx >= 0 ? cols[skuIdx] : '';
    const origSno = snoIdx >= 0 && cols[snoIdx] ? parseInt(cols[snoIdx]) : null;
    const tallyRaw = tallyIdx >= 0 ? cols[tallyIdx] : '';
    const tallyVal = (tallyRaw !== undefined && tallyRaw !== '') ? parseFloat(tallyRaw) : 0;
    const physRaw = physIdx >= 0 ? cols[physIdx] : '';
    const physVal = (physRaw !== undefined && physRaw !== '') ? parseFloat(physRaw) : null;

    if (sku || origSno) {
      rows.push({
        rowNum: i + 1,
        sku,
        orig_sno: origSno,
        tally_qty: isNaN(tallyVal) ? 0 : tallyVal,
        physical_count: isNaN(physVal) ? null : physVal
      });
    }
  }
  return rows;
}

/**
 * Apply parsed rows to SQLite database:
 * Updates opening_qty (Tally Count) and physical_count where provided.
 */
function syncRowsToDb(db, rows) {
  let updatedCount = 0;
  let tallyUpdated = 0;
  let physUpdated = 0;

  const updateStmt = db.prepare(`
    UPDATE items 
    SET opening_qty = @tally_qty,
        physical_count = CASE WHEN @has_phys = 1 THEN @physical_count ELSE physical_count END
    WHERE (sku = @sku AND @sku != '') OR (id = @id AND @id IS NOT NULL)
  `);

  const runSync = db.transaction(items => {
    for (const r of items) {
      const hasPhys = r.physical_count !== null && !isNaN(r.physical_count);
      const res = updateStmt.run({
        tally_qty: r.tally_qty,
        has_phys: hasPhys ? 1 : 0,
        physical_count: r.physical_count,
        sku: r.sku || '',
        id: r.orig_sno
      });
      if (res && res.changes > 0) {
        updatedCount++;
        tallyUpdated++;
        if (hasPhys) physUpdated++;
      }
    }
  });

  runSync(rows);
  return { updatedCount, tallyUpdated, physUpdated };
}

module.exports = {
  parseXlsxStockMaster,
  parseCsvStockMaster,
  syncRowsToDb
};
