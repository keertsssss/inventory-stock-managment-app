/**
 * SKU Pattern Engine & Generator
 * Principal Full-Stack Architecture - Inventory Subsystem
 *
 * Capabilities:
 * 1. Automatic pattern detection (prefix, delimiter, padding, sequencing)
 * 2. Next-in-sequence generation (e.g. MOT-045 -> MOT-046)
 * 3. In-between sub-variant branching (e.g. MOT-012 -> MOT-012A, MOT-012B)
 * 4. Collision prevention and strict uniqueness validation
 */

class SkuPatternEngine {
  /**
   * Common delimiters supported in enterprise SKU architectures
   */
  static DELIMITERS = ['-', '/', '_', '.'];

  /**
   * Parse an individual SKU into structural tokens:
   * - prefix: string
   * - delimiter: string
   * - number: integer
   * - padding: integer (number of digits, e.g. 3 for "045")
   * - branch: optional alphabet suffix (e.g. "A", "B")
   */
  static parseSku(sku) {
    if (!sku || typeof sku !== 'string') return null;
    const clean = sku.trim();

    // Match patterns like:
    // "MOT-045", "ELEC-CABLE-001", "RM/FASTENER/012A", "ITEM_100", "ABC-99"
    // Regex splits: (Prefix and delimiters)(digits)(optional trailing letters)
    const match = clean.match(/^(.*?[-\/_.]?)(\d+)([A-Za-z]?)$/);

    if (match) {
      const fullPrefix = match[1];
      const numStr = match[2];
      const branch = match[3] ? match[3].toUpperCase() : null;

      // Extract delimiter if present at the end of prefix
      let delimiter = '-';
      let cleanPrefix = fullPrefix;
      for (const d of this.DELIMITERS) {
        if (fullPrefix.endsWith(d)) {
          delimiter = d;
          cleanPrefix = fullPrefix.slice(0, -1);
          break;
        }
      }

      return {
        original: clean,
        prefix: cleanPrefix,
        delimiter,
        sequence: parseInt(numStr, 10),
        padding: numStr.length,
        branch
      };
    }

    // Fallback for non-numeric or purely semantic SKUs (e.g. ELEC-CABLE-1SQMM-POLYCAB)
    return {
      original: clean,
      prefix: clean,
      delimiter: clean.includes('-') ? '-' : '/',
      sequence: null,
      padding: 0,
      branch: null
    };
  }

  /**
   * Detects the prevailing pattern from an array of existing SKUs
   */
  static detectPattern(existingSkus, requestedPrefix = '') {
    if (!Array.isArray(existingSkus) || existingSkus.length === 0) {
      // Default fallback pattern if no existing SKUs in category
      const prefix = requestedPrefix ? requestedPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '') : 'PROD';
      return {
        prefix,
        delimiter: '-',
        padding: 3,
        highestSeq: 0,
        count: 0
      };
    }

    const parsedList = existingSkus
      .map(s => this.parseSku(typeof s === 'string' ? s : s?.sku))
      .filter(p => p !== null);

    // Group by prefix to find matching family
    const prefixCounts = {};
    const paddingCounts = {};
    const delimiterCounts = {};
    let highestSeq = 0;

    for (const p of parsedList) {
      if (p.sequence !== null) {
        prefixCounts[p.prefix] = (prefixCounts[p.prefix] || 0) + 1;
        paddingCounts[p.padding] = (paddingCounts[p.padding] || 0) + 1;
        delimiterCounts[p.delimiter] = (delimiterCounts[p.delimiter] || 0) + 1;
        if (p.sequence > highestSeq) highestSeq = p.sequence;
      }
    }

    // Determine the most common prefix or use requested
    let dominantPrefix = requestedPrefix;
    if (!dominantPrefix) {
      dominantPrefix = Object.keys(prefixCounts).sort((a, b) => prefixCounts[b] - prefixCounts[a])[0] || 'SKU';
    }

    // Most common padding (e.g. 3 for 001)
    const dominantPadding = Object.keys(paddingCounts).sort((a, b) => paddingCounts[b] - paddingCounts[a])[0] || 3;
    const dominantDelimiter = Object.keys(delimiterCounts).sort((a, b) => delimiterCounts[b] - delimiterCounts[a])[0] || '-';

    return {
      prefix: dominantPrefix,
      delimiter: dominantDelimiter,
      padding: parseInt(dominantPadding, 10),
      highestSeq,
      totalAnalyzed: parsedList.length
    };
  }

  /**
   * Formats a sequence number into a padded string
   */
  static formatSeq(num, padding) {
    return String(num).padStart(padding, '0');
  }

  /**
   * Generates the next sequential SKU based on category/prefix patterns
   */
  static generateNext({ existingSkus = [], prefix = '', customPadding = null }) {
    const pattern = this.detectPattern(existingSkus, prefix);
    const padding = customPadding || pattern.padding || 3;
    const nextSeq = pattern.highestSeq + 1;

    let candidate = `${pattern.prefix}${pattern.delimiter}${this.formatSeq(nextSeq, padding)}`;

    // Validate strictly against any collisions in the existing list
    const existingSet = new Set(existingSkus.map(s => (typeof s === 'string' ? s : s?.sku)?.toUpperCase()));
    while (existingSet.has(candidate.toUpperCase())) {
      candidate = `${pattern.prefix}${pattern.delimiter}${this.formatSeq(++highestSeq, padding)}`;
    }

    return {
      sku: candidate,
      pattern: {
        prefix: pattern.prefix,
        delimiter: pattern.delimiter,
        sequence: nextSeq,
        padding
      }
    };
  }

  /**
   * Generates an in-between sub-variant branch SKU
   * e.g. Branching off "MOT-012" -> "MOT-012A", "MOT-012B", ...
   * Placed lexically between MOT-012 and MOT-013
   */
  static generateSubVariant({ parentSku, existingSkus = [] }) {
    const parsed = this.parseSku(parentSku);
    if (!parsed) {
      throw new Error(`Cannot branch from invalid parent SKU: ${parentSku}`);
    }

    const existingSet = new Set(existingSkus.map(s => (typeof s === 'string' ? s : s?.sku)?.toUpperCase()));

    // Base code: numeric sequence (e.g. "MOT-012" -> "MOT-012A") or semantic (e.g. "SKU" -> "SKU-A")
    let baseCode;
    if (parsed.sequence !== null) {
      const basePadded = this.formatSeq(parsed.sequence, parsed.padding);
      baseCode = `${parsed.prefix}${parsed.delimiter}${basePadded}`;
    } else {
      baseCode = parsed.original + '-';
    }

    // Find next available branch letter: 'A' through 'Z'
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < letters.length; i++) {
      const candidate = `${baseCode}${letters[i]}`;
      if (!existingSet.has(candidate.toUpperCase())) {
        return {
          sku: candidate,
          parentSku: parsed.original,
          branchLetter: letters[i],
          pattern: {
            prefix: parsed.prefix,
            sequence: parsed.sequence,
            branch: letters[i]
          }
        };
      }
    }

    // Fallback if A-Z exhausted: MOT-012A1, MOT-012A2
    return {
      sku: `${baseCode}A-${Date.now().toString().slice(-4)}`,
      parentSku: parsed.original,
      branchLetter: 'EXT'
    };
  }

  /**
   * Validates SKU uniqueness against an SQLite / SQL database connection
   */
  static validateUniqueInDb(db, sku) {
    const existing = db.prepare('SELECT id, sku FROM items WHERE UPPER(sku) = UPPER(?)').get(sku.trim());
    return {
      isValid: !existing,
      collidesWith: existing || null
    };
  }
}

module.exports = SkuPatternEngine;
