const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'stock.db');
const db = new DatabaseSync(dbPath);

const PRODUCT_TYPE_SHORTCUTS = {
  // Fuses & Accessories
  'Fuse Link': 'FL',
  'HRC Fuse': 'FL',
  'Fuse': 'FL',
  'Fuse Holder': 'FH',
  'HRC Fuse Base': 'FB',
  'Kit Kat Fuse': 'KK',
  'SFU (Switch Fuse Unit)': 'SFU',

  // Circuit Breakers
  'MCB': 'MCB',
  'MCCB': 'MCCB',
  'RCCB': 'RCCB',
  'MCCB Accessory': 'ACC',

  // Contactors & Relays
  'Contactor': 'CON',
  'Air Break Contactor': 'ABC',
  'Add-on Block': 'AB',
  'Delay Timer': 'TMR',
  'Undervoltage Relay': 'UVR',
  'Thermostat': 'THM',

  // Cables & Wiring
  'Copper Flexible Cable': 'CBL',
  'Cable Gland': 'GLD',
  'Insulation Tape': 'IT',
  'Terminal Block': 'TB',
  'Neutral Link': 'NL',
  'Spider Link': 'SL',
  'Open Terminal': 'OT',
  'Open Type Connector': 'OTC',
  'CST Connector': 'CST',
  'Busbar Support Insulator': 'BSI',
  'Insulator': 'INS',
  'Endplate': 'EP',
  'Ferrule Printing Tube': 'FPT',
  'TB Markers': 'TBM',
  'Tube Printer Consumables': 'TPC',
  'Cable Bunching Stickers': 'CBS',

  // Meters & Instruments
  'Ammeter': 'AMM',
  'Voltmeter': 'VOL',
  'Multifunction Meter': 'MFM',
  'Prepaid Meter': 'PPM',
  'Demand Controller': 'DMC',
  'Analog / Energy Meter': 'AEM',
  'Ammeter Selector Switch': 'ASS',
  'Voltmeter Selector Switch': 'VSS',
  'Shunt': 'SHT',
  'Transformer': 'TRF',
  'Gateway': 'GTW',

  // Switches & Sockets
  'Switch Socket Combined': 'SSC',
  'Toggle Switch': 'TS',
  'Changeover Switch': 'COS',
  'Isolator Switch': 'IS',
  'Panel Door Switch': 'PDS',

  // Lighting
  'LED Strip': 'LST',
  'LED Driver': 'LDR',
  'LED Fixture': 'LFX',
  'LED Trim Panel Light': 'LPL',
  'LED Mounting Profile': 'LMP',
  'Tube Light': 'TL',
  'Rope Light': 'RL',
  'Batten Holder': 'BH',
  'Indication Lamp': 'IL',
  'Panel Heater & Thermostat': 'PHT'
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

function extractAmperes(desc, sku, itemAmp) {
  if (itemAmp != null && !isNaN(itemAmp) && itemAmp > 0) {
    return `${itemAmp}A`;
  }
  const text = `${desc || ''} ${sku || ''}`;
  const m = text.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?)\s*(?:A|AMP|AMPS)(?:$|[\s\-_/])/i);
  if (m) return `${parseFloat(m[1])}A`;
  const m2 = text.match(/(\d+(?:\.\d+)?)\s*A\b/i);
  if (m2) return `${parseFloat(m2[1])}A`;
  return null;
}

function generateCatCode(item) {
  const brandCode = getBrandCode(item.make);
  const typeCode = getProductTypeShortcut(item.product_type, item.description);
  const amp = extractAmperes(item.description, item.sku, item.amperes);

  if (amp) {
    return `${brandCode} ${typeCode} ${amp}`;
  }

  // Cable specification (e.g. 1.5SQ)
  const sqmmMatch = (item.description || '').match(/(\d+(?:\.\d+)?)\s*SQMM/i);
  if (sqmmMatch) {
    return `${brandCode} ${typeCode} ${sqmmMatch[1]}SQ`;
  }

  // Model/rating specifier
  const words = (item.description || '').split(/\s+/).filter(Boolean);
  const lastToken = words.length > 2 ? words[words.length - 2] : '';
  if (lastToken && /^[A-Z0-9\-]+$/i.test(lastToken) && lastToken.toUpperCase() !== item.make?.toUpperCase()) {
    return `${brandCode} ${typeCode} ${lastToken.toUpperCase()}`;
  }

  return `${brandCode} ${typeCode}`;
}

const items = db.prepare('SELECT id, make, product_type, description, sku, amperes, cat_code FROM items').all();
const updateStmt = db.prepare('UPDATE items SET cat_code = ? WHERE id = ?');

let updated = 0;
items.forEach(item => {
  const code = generateCatCode(item);
  updateStmt.run(code, item.id);
  updated++;
});

console.log(`Successfully generated and saved CAT codes for ${updated} items in database!`);
