// app.js — runs in the browser (phone or laptop). It talks to server.js using fetch().
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

let mode = 'ISSUE';      // ISSUE or RECEIVE
let chosen = null;       // the item currently selected
let currentPhotoBase64 = null; // visual proof photo for issue/receive

// Client-side image compression: converts camera photos to crisp, light JPEGs (~150KB)
function compressImage(file, maxDimension = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image for compression'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function resetPhotoField() {
  currentPhotoBase64 = null;
  if ($('photoInput')) $('photoInput').value = '';
  if ($('photoPreview')) $('photoPreview').src = '';
  if ($('photoPreviewContainer')) $('photoPreviewContainer').classList.add('hidden');
  if ($('photoPlaceholder')) $('photoPlaceholder').classList.remove('hidden');
}

function setPhotoPreview(dataUrl) {
  currentPhotoBase64 = dataUrl;
  if ($('photoPreview')) $('photoPreview').src = dataUrl;
  if ($('photoPlaceholder')) $('photoPlaceholder').classList.add('hidden');
  if ($('photoPreviewContainer')) $('photoPreviewContainer').classList.remove('hidden');
}

// Standard rack categories matching Srinivasa_Stock_Rack_Plan.xlsx
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

const RACK_SHORT_NAMES = {
  'R01': 'Cables',
  'R02': 'Accessories',
  'R03': 'Contactors',
  'R04': 'Fuses',
  'R05': 'Lighting',
  'R06': 'MCB / RCCB',
  'R07': 'Meters',
  'R08': 'Switches',
  'R09': 'Tapes & RM'
};

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
    return `${brandCode} ${typeCode} ${amp}`.toUpperCase();
  }

  const sqmmMatch = (item.description || '').match(/(\d+(?:\.\d+)?)\s*SQMM/i);
  if (sqmmMatch) {
    return `${brandCode} ${typeCode} ${sqmmMatch[1]}SQ`.toUpperCase();
  }

  const words = (item.description || '').split(/\s+/).filter(Boolean);
  const lastToken = words.length > 2 ? words[words.length - 2] : '';
  if (lastToken && /^[A-Z0-9\-]+$/i.test(lastToken) && lastToken.toUpperCase() !== item.make?.toUpperCase()) {
    return `${brandCode} ${typeCode} ${lastToken.toUpperCase()}`.toUpperCase();
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

// ----- Tabs -----
function switchTab(tabName) {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tabName));
  ['move', 'stock', 'report', 'onboard'].forEach(t => {
    if ($('tab-' + t)) $('tab-' + t).classList.toggle('hidden', t !== tabName);
  });
  if (tabName === 'move') loadNewProductsShelf();
  if (tabName === 'stock') loadStock();
  if (tabName === 'report') loadReport();
  if (tabName === 'onboard') suggestSku();
}

document.querySelectorAll('nav button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
loadNewProductsShelf();

// ----- Issue / Receive -----
$('person').value = localStorage.getItem('person') || '';   // remember the name on this phone

function setMode(m) {
  mode = m;
  $('mode-issue').classList.toggle('active', m === 'ISSUE');
  $('mode-receive').classList.toggle('active', m === 'RECEIVE');
  $('save').textContent = m === 'ISSUE' ? 'Save — take OUT of stock' : 'Save — ADD to stock';
  $('save').style.background = m === 'ISSUE' ? 'var(--out)' : 'var(--in)';

  // Visual cues for photo proof field
  if ($('photoFieldLabel') && $('photoBadge')) {
    if (m === 'ISSUE') {
      $('photoFieldLabel').textContent = '5. Take / Attach Photo (visual proof of quantity)';
      $('photoBadge').textContent = 'Recommended for Issue';
      $('photoBadge').style.background = 'var(--power-orange-tint)';
      $('photoBadge').style.color = 'var(--power-orange)';
    } else {
      $('photoFieldLabel').textContent = '5. Attach Photo (optional receipt / delivery proof)';
      $('photoBadge').textContent = 'Optional for Receive';
      $('photoBadge').style.background = '#f3f4f6';
      $('photoBadge').style.color = '#4b5563';
    }
  }
}
$('mode-issue').onclick = () => setMode('ISSUE');
$('mode-receive').onclick = () => setMode('RECEIVE');
setMode('ISSUE');

// Photo drop/click and file input handlers
if ($('photoDropArea')) {
  $('photoDropArea').onclick = (e) => {
    if (e.target.id === 'retakePhotoBtn' || e.target.id === 'removePhotoBtn' || e.target.closest('.photo-preview-actions')) {
      return;
    }
    if ($('photoInput')) $('photoInput').click();
  };
}

if ($('photoInput')) {
  $('photoInput').onchange = async () => {
    const file = $('photoInput').files[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setPhotoPreview(compressed);
    } catch (err) {
      alert('Could not process photo: ' + err.message);
    }
  };
}

if ($('retakePhotoBtn')) {
  $('retakePhotoBtn').onclick = (e) => {
    e.stopPropagation();
    if ($('photoInput')) $('photoInput').click();
  };
}

if ($('removePhotoBtn')) {
  $('removePhotoBtn').onclick = (e) => {
    e.stopPropagation();
    resetPhotoField();
  };
}

let timer;
$('q').oninput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };   // wait until typing pauses

let allNewProducts = [];
async function loadNewProductsShelf() {
  if (!$('newProductsShelf')) return;
  try {
    const items = await (await fetch('/api/items')).json();
    allNewProducts = items.filter(i => i.is_new === 1);
    renderNewProductsShelf();
  } catch (err) {
    console.error('Error loading new products shelf:', err);
  }
}

function renderNewProductsShelf() {
  const shelf = $('newProductsShelf');
  if (!shelf) return;
  const q = $('q').value.trim();
  if (q || allNewProducts.length === 0) {
    shelf.innerHTML = '';
    shelf.classList.add('hidden');
    return;
  }

  shelf.classList.remove('hidden');
  shelf.innerHTML = `
    <div class="new-products-shelf">
      <div style="font-size:13px; font-weight:bold; color:var(--brand-dark); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
        <span style="display:flex; align-items:center; gap:6px;">
          <span class="badge badge-new" style="font-size:11px;">NEW</span> Recently Onboarded Products (${allNewProducts.length}):
        </span>
        <span class="muted" style="font-size:11px; font-weight:normal;">Tap any item to select for Issue/Receive</span>
      </div>
      <div class="new-products-scroll">
        ${allNewProducts.map(i => `
          <div class="new-product-chip" data-id="${i.id}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
              <div style="font-size:13px; font-weight:700; color:var(--ink); line-height:1.35;">
                ${i.serial_no ? `<span class="badge font-mono" style="background:#ffedd5; color:#9a3412; font-size:11px; margin-right:4px;">#${i.serial_no}</span>` : ''}
                ${esc(i.description)}
              </div>
              <div style="display:flex; gap:4px; flex-shrink:0;">
                <span class="badge badge-new" style="font-size:10px; padding:2px 6px;">NEW • ${i.days_remaining}d left</span>
                <span class="badge loc" style="font-size:10px; padding:2px 6px;">${esc(i.location)}</span>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; font-size:12px;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="sku-tag font-mono" style="font-size:11px;">${esc(i.sku)}</span>
                ${i.cat_code ? `<span class="font-mono" style="font-size:11px; font-weight:600; background:#eff6ff; color:#1d4ed8; padding:2px 6px; border-radius:4px; border:1px solid #bfdbfe;">CAT: ${esc(i.cat_code)}</span>` : ''}
                ${i.make ? `<span class="muted" style="font-size:11px;">Make: <b>${esc(i.make)}</b></span>` : ''}
              </div>
              <div>
                <span class="muted">Tally:</span> <b style="color:var(--brand-dark);">${num(i.tally_qty)} ${esc(i.uom)}</b>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  shelf.querySelectorAll('.new-product-chip').forEach(el => {
    el.onclick = () => choose(allNewProducts.find(i => i.id == el.dataset.id));
  });
}

async function search() {
  const q = $('q').value.trim();
  renderNewProductsShelf();
  if (!q) { $('results').innerHTML = ''; return; }
  const items = await (await fetch('/api/items?q=' + encodeURIComponent(q))).json();
  $('results').innerHTML = items.slice(0, 15).map((i, idx) => {
    const serialNum = i.serial_no || (idx + 1);
    const newBadge = i.is_new ? `<span class="badge badge-new" style="margin-left:6px; font-size:11px;">NEW • ${i.days_remaining}d left</span>` : '';
    const pickClass = i.is_new ? 'pick pick-new-product' : 'pick';
    return `<div class="${pickClass}" data-id="${i.id}">
      <span class="badge font-mono" style="background:#ffedd5; color:#9a3412; font-size:11px; margin-right:4px;">Serial #${serialNum}</span>
      <b>${esc(i.description)}</b>${newBadge}<br>
      <small>${esc(i.location)} · SKU: <span class="font-mono">${esc(i.sku)}</span> · Tally Count: <b style="color:var(--brand-dark);">${num(i.tally_qty)} ${esc(i.uom)}</b>${(i.total_received > 0 || i.total_issued > 0) ? ` <span style="color:#6b7280;">(Op: ${num(i.opening_qty)}${i.total_received > 0 ? `, +${num(i.total_received)}` : ''}${i.total_issued > 0 ? `, -${num(i.total_issued)}` : ''})</span>` : ''}</small>
    </div>`;
  }).join('') || '<div class="muted">No match.</div>';
  document.querySelectorAll('.pick').forEach(el => el.onclick = () => choose(items.find(i => i.id == el.dataset.id)));
}

function choose(item) {
  chosen = item;
  $('form').classList.remove('hidden');
  const newBanner = item.is_new 
    ? `<div style="margin-bottom:8px;"><span class="badge badge-new" style="font-size:12px; padding:3px 8px;">★ NEW PRODUCT ONBOARDED • ${item.days_remaining} days left</span></div>` 
    : '';
  const serialNum = item.serial_no || item.id;
  const moveDetails = (item.total_received > 0 || item.total_issued > 0)
    ? ` <small class="muted" style="margin-left:4px;">(Opening: ${num(item.opening_qty)}${item.total_received > 0 ? `, +Rec: ${num(item.total_received)}` : ''}${item.total_issued > 0 ? `, -Iss: ${num(item.total_issued)}` : ''})</small>`
    : '';
  $('chosen').innerHTML = `
    ${newBanner}
    <div style="margin-bottom:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
      <span class="badge font-mono" style="background:#ffedd5; color:#9a3412; font-weight:bold; font-size:12px;">Serial No: #${serialNum}</span>
      <span class="badge loc">${esc(item.location)}</span>
      <span class="font-mono sku-tag">${esc(item.sku)}</span>
    </div>
    <b style="font-size:16px;">${esc(item.description)}</b><br>
    <span class="muted">Tally Count: <b style="color:var(--brand-dark); font-size:15px;">${num(item.tally_qty)} ${esc(item.uom)}</b>${moveDetails} · Make: ${esc(item.make)}</span>
  `;
  if (item.is_new) {
    $('form').classList.add('card-new-product');
  } else {
    $('form').classList.remove('card-new-product');
  }
  $('uomLabel').textContent = `(${item.uom})`;
  $('qty').value = ''; $('note').value = ''; $('msg').innerHTML = '';
  $('results').innerHTML = '';
  resetPhotoField();
  $('qty').focus();
}

$('save').onclick = async () => {
  const person = $('person').value.trim();
  localStorage.setItem('person', person);
  $('save').disabled = true;
  try {
    const qtyVal = Number($('qty').value);
    const r = await fetch('/api/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: mode,
        item_id: chosen.id,
        qty: $('qty').value,
        person,
        note: $('note').value,
        photo: currentPhotoBase64
      })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);

    const verb = mode === 'RECEIVE' ? 'Added / Received +' : 'Issued -';
    const notif = $('moveNotification');
    if (notif) {
      notif.classList.remove('hidden');
      const photoBadgeHtml = data.photo 
        ? `<div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
             <img src="${esc(data.photo)}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; border:1px solid #15803d; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
             <span style="font-size:12px; font-weight:600; color:#15803d;">📷 Visual proof photo attached & logged in Daily Report</span>
           </div>` 
        : '';
      notif.innerHTML = `
        <div class="msg ok" style="font-size:14px; padding:12px 16px; margin:0 0 14px 0; border-left:4px solid #16a34a; background:#f0fdf4; color:#166534; display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:0 1px 3px rgba(0,0,0,0.06); border-radius:6px;">
          <div>
            <div style="font-size:16px; font-weight:bold; color:#15803d; margin-bottom:2px;">&#10003; Done, thank you!</div>
            <div style="font-size:13px; color:#166534;">
              ${verb}${num(qtyVal)} ${esc(data.item.uom)} of <b>${esc(data.item.description)}</b> (${esc(data.item.location)}). Updated Tally Count: <b>${num(data.item.tally_qty)} ${esc(data.item.uom)}</b>.
            </div>
            ${photoBadgeHtml}
          </div>
          <button type="button" onclick="$('moveNotification').classList.add('hidden')" style="background:none; border:none; font-size:20px; line-height:1; color:#166534; cursor:pointer; padding:4px;" title="Dismiss">&times;</button>
        </div>
      `;
      // Auto-hide after 5 seconds if undisturbed
      setTimeout(() => {
        if (notif) notif.classList.add('hidden');
      }, 5000);
    }

    // Refresh back to original clean state
    chosen = null;
    $('qty').value = '';
    $('note').value = '';
    $('msg').innerHTML = '';
    $('q').value = '';
    $('results').innerHTML = '';
    resetPhotoField();
    $('form').classList.add('hidden');
    $('form').classList.remove('card-new-product');
    
    // Refresh new products shelf and focus search
    loadNewProductsShelf();
    renderNewProductsShelf();
    $('q').focus();

  } catch (e) {
    $('msg').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
  $('save').disabled = false;
};

if ($('cancelMove')) {
  $('cancelMove').onclick = () => {
    chosen = null;
    $('qty').value = '';
    $('note').value = '';
    $('msg').innerHTML = '';
    $('q').value = '';
    $('results').innerHTML = '';
    resetPhotoField();
    $('form').classList.add('hidden');
    $('form').classList.remove('card-new-product');
    loadNewProductsShelf();
    renderNewProductsShelf();
    $('q').focus();
  };
}

// ----- Stock list -----
let currentStockItems = [];

function formatVariance(v) {
  if (v === null || v === undefined || v === '') return '<span class="var-badge var-none">—</span>';
  const n = Number(v);
  if (n > 0) return `<span class="var-badge var-pos">+${num(n)}</span>`;
  if (n < 0) return `<span class="var-badge var-neg">${num(n)}</span>`;
  return `<span class="var-badge var-zero">0</span>`;
}

async function loadStock() {
  const q = $('sq').value.trim();
  const rack = $('rackFilter') ? $('rackFilter').value : '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (rack) params.set('rack', rack);

  let items = await (await fetch('/api/items?' + params.toString())).json();
  currentStockItems = items;

  if ($('onlyZero').checked) items = items.filter(i => Number(i.stock) <= 0);
  if ($('onlyVariance') && $('onlyVariance').checked) items = items.filter(i => i.variance !== null && i.variance !== 0);
  if ($('onlyUncounted').checked) items = items.filter(i => i.physical_count === null || i.physical_count === undefined || i.physical_count === '');
  if ($('onlyNewProducts') && $('onlyNewProducts').checked) items = items.filter(i => i.is_new === 1);

  const totalTally = items.reduce((s, i) => s + (Number(i.tally_qty) || 0), 0);
  const grandTotal = items.reduce((s, i) => s + (Number(i.tally_qty) || 0) + (Number(i.physical_count) || 0), 0);
  const countedCount = items.filter(i => i.physical_count != null && i.physical_count !== '').length;
  const newCount = items.filter(i => i.is_new === 1).length;

  $('stockSummary').innerHTML = `Showing <b>${items.length}</b> items · Counted: <b>${countedCount}/${items.length}</b> · <span class="badge badge-new" style="font-size:11px;">NEW</span> (≤30d): <b>${newCount}</b> · Total Tally: <b>${num(totalTally)}</b> · Total Count: <b style="color:var(--power-orange);">${num(grandTotal)}</b>`;

  // Quick navigation pills matching Excel racks
  if ($('rackQuickNav')) {
    const activeRack = $('rackFilter') ? $('rackFilter').value : '';
    const rackCounts = {};
    items.forEach(item => {
      const rk = item.rack || (item.location ? item.location.split('-')[0] : 'OTHER');
      rackCounts[rk] = (rackCounts[rk] || 0) + 1;
    });

    const rackKeys = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09'];
    $('rackQuickNav').innerHTML = `
      <span class="quick-nav-label">Racks:</span>
      <button type="button" class="rack-nav-btn ${!activeRack ? 'active' : ''}" data-rack="">All (${items.length})</button>
      ${rackKeys.map(rk => {
        const cnt = rackCounts[rk] || 0;
        if (!cnt && activeRack !== rk) return '';
        return `<button type="button" class="rack-nav-btn ${activeRack === rk ? 'active' : ''}" data-rack="${rk}">
          <b>${rk}</b> ${RACK_SHORT_NAMES[rk] || ''} <span style="opacity:0.8;">(${cnt})</span>
        </button>`;
      }).join('')}
    `;

    $('rackQuickNav').querySelectorAll('.rack-nav-btn').forEach(btn => {
      btn.onclick = () => {
        const rk = btn.dataset.rack;
        if ($('rackFilter')) $('rackFilter').value = rk;
        loadStock();
      };
    });
  }

  const thead = `<tr>
    <th>Serial No</th>
    <th>Rack Location</th>
    <th>Rack</th>
    <th>Section</th>
    <th>Make</th>
    <th>Product Type</th>
    <th>S.No (Orig.)</th>
    <th>Description</th>
    <th>SKU Code</th>
    <th>Readable Code / CAT Code</th>
    <th>UOM</th>
    <th>Tally Qty</th>
    <th style="min-width:65px;">Cartons</th>
    <th style="min-width:65px;">Boxes</th>
    <th style="min-width:65px;">Pieces</th>
    <th style="min-width:85px;">Physical Count</th>
    <th style="min-width:95px; background:var(--power-orange); color:#fff;">Total Count</th>
  </tr>`;

  // Group and divide items by Rack with prominent category headings
  let lastRack = null;
  let lastCompany = null;
  const rows = [];

  items.forEach((i, index) => {
    const currentRack = i.rack || (i.location ? i.location.split('-')[0] : 'OTHER');
    const isFuse = currentRack === 'R04' || (i.category && i.category.toLowerCase().includes('fuse'));

    // Section Divider Heading when rack changes
    if (currentRack !== lastRack) {
      lastRack = currentRack;
      lastCompany = null;
      const rackItems = items.filter(item => (item.rack || (item.location ? item.location.split('-')[0] : 'OTHER')) === currentRack);
      const rackTally = rackItems.reduce((sum, item) => sum + (Number(item.tally_qty) || 0), 0);
      const distinctShelves = new Set(rackItems.map(item => item.location || item.section)).size;
      const distinctMakes = [...new Set(rackItems.map(item => item.make).filter(Boolean))];
      const categoryName = i.category || RACK_CATEGORY_MAP[currentRack] || 'Miscellaneous';
      const makesPreview = distinctMakes.slice(0, 4).join(', ') + (distinctMakes.length > 4 ? ` +${distinctMakes.length - 4} more` : '');

      rows.push(`
        <tr class="rack-divider-row" id="section-${currentRack}">
          <td colspan="17">
            <div class="rack-divider-wrap">
              <div class="rack-divider-main">
                <span class="rack-divider-tag">${esc(currentRack)}</span>
                <span class="rack-divider-heading">${esc(categoryName)}</span>
                <span class="rack-divider-makes" title="${esc(distinctMakes.join(', '))}">(${esc(makesPreview)})</span>
              </div>
              <div class="rack-divider-meta">
                <span class="badge" style="background:#ffedd5; color:#9a3412; font-weight:bold;">${rackItems.length} SKUs</span>
                <span>Total Tally: <b style="color:var(--brand-dark);">${num(rackTally)}</b></span>
                <span class="text-muted">${distinctShelves} Shelves</span>
              </div>
            </div>
          </td>
        </tr>
      `);
    }

    // Company sub-divider for Fuses (grouped by Company, sorted least A to high amperes)
    if (isFuse && i.make && i.make !== lastCompany) {
      lastCompany = i.make;
      const compItems = items.filter(item => (item.rack === currentRack || (item.category && item.category.toLowerCase().includes('fuse'))) && item.make === i.make);
      const compTally = compItems.reduce((sum, item) => sum + (Number(item.tally_qty) || 0), 0);
      const ampsList = compItems.map(x => Number(x.amperes)).filter(x => !isNaN(x) && x > 0);
      const minA = ampsList.length ? Math.min(...ampsList) : null;
      const maxA = ampsList.length ? Math.max(...ampsList) : null;
      const rangeText = minA !== null && maxA !== null ? `${minA}A → ${maxA}A` : '';

      rows.push(`
        <tr class="company-divider-row">
          <td colspan="17">
            <div class="company-divider-wrap">
              <span class="company-divider-tag">
                Company: <b>${esc(i.make)}</b>
                ${rangeText ? `<span class="badge" style="background:#f1f5f9; color:#0369a1; font-weight:bold; font-size:11px; margin-left:6px;">${rangeText}</span>` : ''}
              </span>
              <span class="company-divider-info">
                Shelf: <b>${esc(i.section || (i.location ? i.location.split('-')[1] : ''))}</b> (${esc(i.location)}) · 
                <b>${compItems.length}</b> SKUs · 
                Tally: <b>${num(compTally)}</b> · 
                <span style="color:#16a34a; font-weight:600;">Least to High Amperes</span>
              </span>
            </div>
          </td>
        </tr>
      `);
    }

    const serialNo = i.serial_no || (index + 1);
    const catCodeVal = i.cat_code || generateCatCode(i);
    const cartonVal = i.cartons != null ? i.cartons : '';
    const boxVal = i.boxes != null ? i.boxes : '';
    const pieceVal = i.pieces != null ? i.pieces : '';
    const physVal = i.physical_count != null ? i.physical_count : '';
    const totalCountVal = Number(i.tally_qty || 0) + Number(i.physical_count || 0);
    const newBadge = i.is_new ? `<span class="badge badge-new" title="Added on ${esc(i.created_at)} (${i.days_old} days ago)" style="margin-left:6px;">NEW • ${i.days_remaining}d left</span>` : '';
    const ampBadge = i.amperes != null ? `<span class="amp-tag" title="${i.amperes} Amperes">${i.amperes}A</span>` : '';
    const rowClass = i.is_new ? 'row-new-product' : '';

    rows.push(`<tr class="${rowClass}">
      <td class="text-center font-mono" style="font-size:14px; font-weight:bold; color:var(--brand-dark);">
        ${serialNo}
      </td>
      <td><span class="badge loc">${esc(i.location)}</span></td>
      <td class="text-center">${esc(i.rack)}</td>
      <td class="text-center">${esc(i.section || (i.location ? i.location.split('-')[1] : ''))}</td>
      <td><b>${esc(i.make)}</b></td>
      <td><small>${esc(i.product_type)}</small></td>
      <td class="text-center font-mono text-muted">#${esc(i.id)}</td>
      <td>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div>
            <b id="desc-text-${i.id}">${esc(i.description)}</b>
            <div style="margin-top:2px;">${ampBadge}${newBadge}</div>
          </div>
          <button type="button" class="btn-edit-desc" data-id="${i.id}" title="Edit Product Description" style="background:#f1f5f9; border:1px solid #cbd5e1; cursor:pointer; font-size:11px; padding:3px 7px; border-radius:4px; color:#475569; flex-shrink:0;">✏️ Edit</button>
        </div>
      </td>
      <td>
        <span class="font-mono sku-tag">${esc(i.sku)}</span>
      </td>
      <td>
        <input type="text" class="cat-input" data-id="${i.id}" value="${esc(catCodeVal)}" placeholder="CAT Code…">
      </td>
      <td class="text-center">${esc(i.uom)}</td>
      <td class="text-right font-mono">
        <b style="font-size:14px;">${num(i.tally_qty)}</b>
        ${(i.total_received > 0 || i.total_issued > 0) ? `
          <div style="font-size:10px; color:#6b7280; margin-top:2px;" title="Opening: ${num(i.opening_qty)}, Received: +${num(i.total_received)}, Issued: -${num(i.total_issued)}">
            <span style="opacity:0.8;">Op:${num(i.opening_qty)}</span>${i.total_received > 0 ? ` <span style="color:#16a34a; font-weight:bold;">+${num(i.total_received)}</span>` : ''}${i.total_issued > 0 ? ` <span style="color:#dc2626; font-weight:bold;">-${num(i.total_issued)}</span>` : ''}
          </div>` : ''}
      </td>
      <td>
        <input type="number" step="any" min="0" class="count-input carton-input" data-id="${i.id}" value="${cartonVal}" placeholder="Ctn">
      </td>
      <td>
        <input type="number" step="any" min="0" class="count-input box-input" data-id="${i.id}" value="${boxVal}" placeholder="Box">
      </td>
      <td>
        <input type="number" step="any" min="0" class="count-input piece-input" data-id="${i.id}" value="${pieceVal}" placeholder="Pcs">
      </td>
      <td>
        <input type="number" step="any" min="0" class="count-input total-input phys-input" data-id="${i.id}" data-tally="${i.tally_qty}" value="${physVal}" placeholder="Count…">
      </td>
      <td class="text-right font-mono" id="total-cell-${i.id}">
        <b style="font-size:14px; color:var(--power-orange);">${num(totalCountVal)}</b>
      </td>
    </tr>`);
  });

  $('stockTable').innerHTML = thead + rows.join('');

  // Save changes to Cat Code, Cartons, Boxes, Pieces, or Physical Count
  async function saveStockAuditRow(id) {
    const catInput = document.querySelector(`.cat-input[data-id="${id}"]`);
    const cartonInput = document.querySelector(`.carton-input[data-id="${id}"]`);
    const boxInput = document.querySelector(`.box-input[data-id="${id}"]`);
    const pieceInput = document.querySelector(`.piece-input[data-id="${id}"]`);
    const totalInput = document.querySelector(`.total-input[data-id="${id}"]`);
    const totalCell = $(`total-cell-${id}`);
    if (!totalInput) return;

    const tally = Number(totalInput.dataset.tally || 0);

    const catCode = catInput ? catInput.value.trim().toUpperCase() : null;
    if (catInput && catCode) catInput.value = catCode;
    const cartons = cartonInput && cartonInput.value.trim() !== '' ? Number(cartonInput.value) : null;
    const boxes = boxInput && boxInput.value.trim() !== '' ? Number(boxInput.value) : null;
    const pieces = pieceInput && pieceInput.value.trim() !== '' ? Number(pieceInput.value) : null;
    let totalVal = totalInput.value.trim() !== '' ? Number(totalInput.value) : null;

    // Dynamically update Total Count cell: Tally Qty + Physical Count
    if (totalCell) {
      const combinedTotal = tally + (totalVal !== null ? totalVal : 0);
      totalCell.innerHTML = `<b style="font-size:14px; color:var(--power-orange);">${num(combinedTotal)}</b>`;
    }

    const rowInputs = [catInput, cartonInput, boxInput, pieceInput, totalInput].filter(Boolean);
    rowInputs.forEach(inp => inp.classList.add('saving'));

    try {
      const res = await fetch('/api/physical-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          cat_code: catCode,
          cartons,
          boxes,
          pieces,
          physical_count: totalVal
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      rowInputs.forEach(inp => {
        inp.classList.remove('saving');
        inp.classList.add('saved');
        setTimeout(() => inp.classList.remove('saved'), 1200);
      });
    } catch (err) {
      rowInputs.forEach(inp => {
        inp.classList.remove('saving');
        inp.classList.add('save-err');
      });
      alert('Failed to save count: ' + err.message);
    }
  }

  // Attach change listeners to all audit inputs
  document.querySelectorAll('.cat-input, .carton-input, .box-input, .piece-input, .total-input').forEach(input => {
    input.addEventListener('change', () => {
      saveStockAuditRow(Number(input.dataset.id));
    });
  });

  // Automatically enforce uppercase on CAT code table inputs
  document.querySelectorAll('.cat-input').forEach(input => {
    input.addEventListener('input', () => {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const oldVal = input.value;
      const newVal = oldVal.toUpperCase();
      if (oldVal !== newVal) {
        input.value = newVal;
        input.setSelectionRange(start, end);
      }
    });
  });

  // Attach click handler for Edit Description buttons in Stock table
  document.querySelectorAll('.btn-edit-desc').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      const item = currentStockItems.find(x => x.id === id);
      if (item) openEditDescModal(item);
    };
  });
}

let t2;
$('sq').oninput = () => { clearTimeout(t2); t2 = setTimeout(loadStock, 250); };
if ($('rackFilter')) $('rackFilter').onchange = loadStock;
$('onlyZero').onchange = loadStock;
if ($('onlyVariance')) $('onlyVariance').onchange = loadStock;
if ($('onlyUncounted')) $('onlyUncounted').onchange = loadStock;

// ----- Daily report -----
const d = new Date();
$('date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
$('date').onchange = loadReport;

function openPhotoModal({ photo, desc, qty, person, time, type, note }) {
  if (!$('photoModal')) return;
  $('photoModalImg').src = photo;
  $('photoModalTitle').textContent = `${type === 'ISSUE' ? 'Issue Quantity Proof' : 'Receipt Proof'} — ${qty}`;
  $('photoModalSubtitle').textContent = desc;
  $('photoModalMeta').textContent = `Logged by ${person} on ${time}${note ? ` • Note: ${note}` : ''}`;
  $('photoModalDownload').href = photo;
  $('photoModal').classList.remove('hidden');
}

function closePhotoModal() {
  if ($('photoModal')) {
    $('photoModal').classList.add('hidden');
    $('photoModalImg').src = '';
  }
}

if ($('closePhotoModal')) $('closePhotoModal').onclick = closePhotoModal;
if ($('photoModal')) {
  $('photoModal').onclick = (e) => {
    if (e.target.id === 'photoModal') closePhotoModal();
  };
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('photoModal') && !$('photoModal').classList.contains('hidden')) {
    closePhotoModal();
  }
});

async function loadReport() {
  const date = $('date').value;
  $('csv').href = '/api/report.csv?date=' + date;
  const { rows } = await (await fetch('/api/report?date=' + date)).json();
  const out = rows.filter(r => r.type === 'ISSUE').length, inn = rows.filter(r => r.type === 'RECEIVE').length;
  const withPhoto = rows.filter(r => r.photo).length;
  $('summary').innerHTML = `<b>${rows.length}</b> movements on ${esc(date)} — <b>${out}</b> issued, <b>${inn}</b> received · 📷 <b>${withPhoto}</b> with proof photo`;

  const thead = `<tr>
    <th class="text-center" style="width:50px;">S.No</th>
    <th>Time</th>
    <th>Type</th>
    <th>Item Description</th>
    <th>Quantity</th>
    <th>By</th>
    <th>Note</th>
    <th class="text-center" style="width:90px;">Photo Proof</th>
  </tr>`;

  if (rows.length === 0) {
    $('reportTable').innerHTML = thead + `<tr><td colspan="8" class="text-center muted" style="padding:28px 14px;">No stock movements recorded on ${esc(date)}.</td></tr>`;
    return;
  }

  const tbody = rows.map((r, idx) => {
    const photoCell = r.photo
      ? `<button type="button" class="btn-view-photo" data-photo="${esc(r.photo)}" data-desc="${esc(r.description)}" data-qty="${num(r.qty)} ${esc(r.uom)}" data-person="${esc(r.person)}" data-time="${esc(r.ts)}" data-type="${esc(r.type)}" data-note="${esc(r.note || '')}" title="Click to view full photo">
          <img src="${esc(r.photo)}" alt="Proof Thumbnail" class="report-photo-thumb">
          <span class="report-photo-badge">&#128269; View</span>
        </button>`
      : `<span class="muted font-mono" style="opacity:0.4;">—</span>`;

    return `<tr>
      <td class="text-center font-mono" style="font-weight:bold; color:var(--brand-dark);">${idx + 1}</td>
      <td class="font-mono">${esc(r.ts.slice(11, 16))}</td>
      <td class="t-${r.type}"><span class="badge" style="background:${r.type === 'ISSUE' ? '#fee2e2' : '#dcfce7'}; color:${r.type === 'ISSUE' ? '#b91c1c' : '#15803d'}; font-size:11px;">${r.type}</span></td>
      <td>
        <b>${esc(r.description)}</b>
        <div style="font-size:11px; color:#6b7280; margin-top:2px;" class="font-mono">
          <span class="badge loc" style="font-size:10px; padding:1px 5px;">${esc(r.location)}</span>
          <span class="sku-tag" style="font-size:10px; padding:1px 5px;">${esc(r.sku)}</span>
        </div>
      </td>
      <td class="font-mono" style="font-size:14px;"><b>${num(r.qty)}</b> <small>${esc(r.uom)}</small></td>
      <td><b>${esc(r.person)}</b></td>
      <td>${esc(r.note || '—')}</td>
      <td class="text-center">${photoCell}</td>
    </tr>`;
  }).join('');

  $('reportTable').innerHTML = thead + tbody;

  // Wire up photo modal clicks on report thumbnails
  $('reportTable').querySelectorAll('.btn-view-photo').forEach(btn => {
    btn.onclick = () => {
      openPhotoModal({
        photo: btn.dataset.photo,
        desc: btn.dataset.desc,
        qty: btn.dataset.qty,
        person: btn.dataset.person,
        time: btn.dataset.time,
        type: btn.dataset.type,
        note: btn.dataset.note
      });
    };
  });
}

// ----- Product Onboarding & Dynamic SKU Generator -----
if ($('onlyNewProducts')) $('onlyNewProducts').onchange = loadStock;

if ($('openOnboardModal')) {
  $('openOnboardModal').onclick = () => switchTab('onboard');
}

async function suggestSku() {
  const catRack = $('newCatSelect').value;
  const branchParent = $('newBranchParent').value.trim();
  const make = $('newMake') ? $('newMake').value.trim() : '';
  const product_type = $('newProductType') ? $('newProductType').value.trim() : '';
  const description = $('newDesc') ? $('newDesc').value.trim() : '';
  const rackCategoryNames = {
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
  const category = rackCategoryNames[catRack] || '';

  try {
    const res = await fetch('/api/products/suggest-sku', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, branch_parent_sku: branchParent || null, make, product_type, description })
    });
    const data = await res.json();
    if (data.ok && data.sku) {
      $('newSku').value = data.sku;
      $('skuPatternHint').textContent = branchParent
        ? `Branch variant created from ${branchParent}`
        : `Pattern matched: ${data.pattern?.prefix || ''} (Seq: ${data.pattern?.sequence || 'next'})`;
      if (data.cat_code && $('newCatCode') && !$('newCatCode').value) {
        $('newCatCode').value = data.cat_code;
      }
    }
  } catch (err) {
    console.error('Error suggesting SKU:', err);
  }
}

let isSkuManuallyEdited = false;
let isDescManuallyEdited = false;

function generateDescription({ make, product_type, initials }) {
  let p = (product_type || '').trim();
  let m = (make || '').trim();
  let init = (initials || '').trim();

  // If initials not explicitly provided, see if p contains rating (e.g. 63A, 10SQMM)
  if (!init && p) {
    const ampMatch = p.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?\s*(?:A|AMP|AMPS|SQMM|V|KV|W|HP|POLE|P|WAY))(?:$|[\s\-_/])/i);
    if (ampMatch) {
      init = ampMatch[1].trim();
      p = p.replace(ampMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }

  const parts = [];
  if (p) parts.push(p.toUpperCase());
  if (init) parts.push(init.toUpperCase());
  if (m) parts.push(m.toUpperCase());

  return parts.join(' ');
}

function autoUpdateDescSkuAndCat() {
  const make = $('newMake') ? $('newMake').value.trim() : '';
  const pType = $('newProductType') ? $('newProductType').value.trim() : '';
  const initials = $('newRating') ? $('newRating').value.trim() : '';

  // 1. Auto-generate Product Description: [Product Type] [Electrical Initials] [Company Name]
  if (!isDescManuallyEdited && $('newDesc') && (make || pType || initials)) {
    $('newDesc').value = generateDescription({ make, product_type: pType, initials });
  }

  const currentDesc = $('newDesc') ? $('newDesc').value.trim() : '';

  // 2. Auto-generate SKU Code: ELEC-[PRODUCT]-[AMP]-[BRAND]
  if (!isSkuManuallyEdited && (make || pType || currentDesc) && $('newSku')) {
    const sku = generateSkuCode({ make, product_type: pType, description: currentDesc });
    $('newSku').value = sku;
  }

  // 3. Auto-generate CAT Code: [BRAND] [TYPE] [AMP]
  if ($('newCatCode')) {
    const currentSku = $('newSku') ? $('newSku').value.trim() : '';
    if (make || pType || currentDesc) {
      const code = generateCatCode({ make, product_type: pType, description: currentDesc, sku: currentSku });
      $('newCatCode').value = code.toUpperCase();
    }
  }
}

// Typing listener for #newDesc:
// - Converts all text to UPPERCASE
// - Preserves user manual editing
// - If cleared, resumes auto-generation
const newDescInput = $('newDesc');
if (newDescInput) {
  newDescInput.addEventListener('input', () => {
    isDescManuallyEdited = true;
    const start = newDescInput.selectionStart;
    const end = newDescInput.selectionEnd;
    const oldVal = newDescInput.value;
    const newVal = oldVal.toUpperCase();
    if (oldVal !== newVal) {
      newDescInput.value = newVal;
      newDescInput.setSelectionRange(start, end);
    }
    // Update SKU and CAT code if SKU wasn't manually edited
    if (!isSkuManuallyEdited && $('newSku')) {
      const make = $('newMake') ? $('newMake').value.trim() : '';
      const pType = $('newProductType') ? $('newProductType').value.trim() : '';
      $('newSku').value = generateSkuCode({ make, product_type: pType, description: newVal });
    }
    if ($('newCatCode')) {
      const make = $('newMake') ? $('newMake').value.trim() : '';
      const pType = $('newProductType') ? $('newProductType').value.trim() : '';
      const currentSku = $('newSku') ? $('newSku').value.trim() : '';
      $('newCatCode').value = generateCatCode({ make, product_type: pType, description: newVal, sku: currentSku }).toUpperCase();
    }
  });

  newDescInput.addEventListener('change', () => {
    if (!newDescInput.value.trim()) {
      isDescManuallyEdited = false;
      autoUpdateDescSkuAndCat();
    }
  });
}

// Typing listener for #newSku:
// - Space automatically produces hyphen '-'
// - Forces all characters to UPPERCASE
// - Prevents duplicate hyphens '--'
// - Pre-fills 'ELEC-' on focus if empty
const newSkuInput = $('newSku');
if (newSkuInput) {
  newSkuInput.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      const start = newSkuInput.selectionStart;
      const end = newSkuInput.selectionEnd;
      const val = newSkuInput.value;
      const before = val.slice(0, start);
      const after = val.slice(end);
      const charToInsert = before.endsWith('-') ? '' : '-';
      const newVal = (before + charToInsert + after).toUpperCase();
      newSkuInput.value = newVal;
      const newPos = start + charToInsert.length;
      newSkuInput.setSelectionRange(newPos, newPos);
      isSkuManuallyEdited = true;
      newSkuInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  newSkuInput.addEventListener('input', () => {
    isSkuManuallyEdited = true;
    const start = newSkuInput.selectionStart;
    const end = newSkuInput.selectionEnd;
    const oldVal = newSkuInput.value;
    let newVal = oldVal.toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
    if (oldVal !== newVal) {
      newSkuInput.value = newVal;
      const diff = newVal.length - oldVal.length;
      const targetPos = Math.max(0, Math.min(newVal.length, (start || 0) + diff));
      newSkuInput.setSelectionRange(targetPos, targetPos);
    }
  });

  newSkuInput.addEventListener('focus', () => {
    if (!newSkuInput.value.trim()) {
      newSkuInput.value = 'ELEC-';
      newSkuInput.setSelectionRange(5, 5);
    }
  });

  newSkuInput.addEventListener('blur', () => {
    let v = newSkuInput.value.trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
    if (v && v !== 'ELEC-' && !v.startsWith('ELEC-')) {
      v = 'ELEC-' + v.replace(/^ELEC-?/i, '');
    }
    newSkuInput.value = v;
  });
}

// Typing listener for #newCatCode: capitalizes all characters
const newCatInput = $('newCatCode');
if (newCatInput) {
  newCatInput.addEventListener('input', () => {
    const start = newCatInput.selectionStart;
    const end = newCatInput.selectionEnd;
    const oldVal = newCatInput.value;
    const newVal = oldVal.toUpperCase();
    if (oldVal !== newVal) {
      newCatInput.value = newVal;
      newCatInput.setSelectionRange(start, end);
    }
  });
}

['newMake', 'newProductType', 'newRating'].forEach(id => {
  if ($(id)) {
    $(id).addEventListener('input', autoUpdateDescSkuAndCat);
    $(id).addEventListener('change', autoUpdateDescSkuAndCat);
  }
});

if ($('btnAutoSku')) {
  $('btnAutoSku').onclick = () => {
    isSkuManuallyEdited = false;
    isDescManuallyEdited = false;
    autoUpdateDescSkuAndCat();
    suggestSku();
  };
}
if ($('newCatSelect')) $('newCatSelect').onchange = () => {
  $('newLocation').value = $('newCatSelect').value + '-S01';
  isSkuManuallyEdited = false;
  suggestSku();
};
if ($('newBranchParent')) $('newBranchParent').oninput = suggestSku;

if ($('onboardForm')) {
  $('onboardForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('submitOnboard');
    btn.disabled = true;
    $('onboardMsg').innerHTML = '<div class="msg">Onboarding product...</div>';

    const payload = {
      rack: $('newCatSelect').value,
      location: $('newLocation').value.trim(),
      make: $('newMake').value.trim(),
      product_type: $('newProductType').value.trim(),
      description: $('newDesc').value.trim(),
      rating: $('newRating') ? $('newRating').value.trim() : '',
      sku: $('newSku').value.trim(),
      cat_code: $('newCatCode') ? $('newCatCode').value.trim() : '',
      uom: $('newUom').value,
      opening_qty: Number($('newQty').value) || 0
    };

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      $('onboardMsg').innerHTML = `<div class="msg ok" style="font-size:15px; padding:12px 16px;"><b>Done, thank you!</b> ${esc(data.message)} <br><small>Refreshed back to original state and opening Stock Master...</small></div>`;
      setTimeout(() => {
        $('onboardForm').reset();
        isSkuManuallyEdited = false;
        isDescManuallyEdited = false;
        $('onboardMsg').innerHTML = '';
        if ($('skuPatternHint')) $('skuPatternHint').textContent = '';
        switchTab('stock');
      }, 1500);
    } catch (err) {
      $('onboardMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
}

// ----- Reset Onboarding Form Button -----
if ($('btnResetOnboardForm')) {
  $('btnResetOnboardForm').onclick = () => {
    $('onboardForm').reset();
    isSkuManuallyEdited = false;
    isDescManuallyEdited = false;
    if ($('newLocation')) $('newLocation').value = $('newCatSelect').value + '-S01';
    if ($('newQty')) $('newQty').value = '0';
    if ($('skuPatternHint')) $('skuPatternHint').textContent = '';
    if ($('onboardMsg')) $('onboardMsg').innerHTML = '';
  };
}

// ----- Remove Product from Stock Feature -----
let selectedProductToRemove = null;
let removeSearchTimer = null;

const removeSearchInput = $('removeSearchInput');
if (removeSearchInput) {
  removeSearchInput.addEventListener('input', () => {
    clearTimeout(removeSearchTimer);
    removeSearchTimer = setTimeout(async () => {
      const q = removeSearchInput.value.trim();
      const resultsEl = $('removeSearchResults');
      if (!q) {
        resultsEl.innerHTML = '';
        return;
      }
      try {
        const items = await (await fetch('/api/items?q=' + encodeURIComponent(q))).json();
        if (!items || items.length === 0) {
          resultsEl.innerHTML = '<div class="muted" style="padding:10px; font-size:13px;">No matching products found in stock.</div>';
          return;
        }
        resultsEl.innerHTML = items.slice(0, 8).map(i => `
          <div class="remove-pick-item" data-id="${i.id}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <div style="font-weight:700; font-size:13px; color:var(--ink);">
                <span class="badge font-mono" style="background:#fee2e2; color:#991b1b; font-size:10px; margin-right:4px;">#${i.serial_no || i.id}</span>
                ${esc(i.description)}
              </div>
              <span class="badge loc" style="font-size:10px;">${esc(i.location)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-top:4px;">
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <span class="sku-tag font-mono" style="font-size:10px;">${esc(i.sku)}</span>
                ${i.cat_code ? `<span class="font-mono" style="font-size:10px; background:#eff6ff; color:#1d4ed8; padding:1px 5px; border-radius:3px;">CAT: ${esc(i.cat_code)}</span>` : ''}
                ${i.make ? `<span class="muted" style="font-size:11px;">Make: ${esc(i.make)}</span>` : ''}
              </div>
              <div>
                <span class="muted">Tally:</span> <b style="color:#b91c1c;">${num(i.tally_qty)} ${esc(i.uom)}</b>
              </div>
            </div>
          </div>
        `).join('');

        resultsEl.querySelectorAll('.remove-pick-item').forEach(el => {
          el.onclick = () => {
            const item = items.find(x => x.id == el.dataset.id);
            if (item) selectProductToRemove(item);
          };
        });
      } catch (err) {
        resultsEl.innerHTML = `<div class="msg err" style="font-size:12px;">Search failed: ${esc(err.message)}</div>`;
      }
    }, 200);
  });
}

function selectProductToRemove(item) {
  selectedProductToRemove = item;
  $('removeSearchResults').innerHTML = '';
  $('removeSearchInput').value = '';
  $('removeSelectedCard').classList.remove('hidden');
  $('removeSelectedTitle').textContent = item.description;
  $('removeSelectedMeta').innerHTML = `
    <span class="sku-tag font-mono" style="font-size:11px;">${esc(item.sku)}</span>
    ${item.cat_code ? `<span class="font-mono" style="font-size:11px; background:#eff6ff; color:#1d4ed8; padding:2px 6px; border-radius:4px;">CAT: ${esc(item.cat_code)}</span>` : ''}
    <span class="badge loc" style="font-size:11px;">${esc(item.location)}</span>
    <span class="muted">Current Tally Stock: <b style="color:var(--brand-dark);">${num(item.tally_qty)} ${esc(item.uom)}</b></span>
    ${item.make ? `<span class="muted">Make: <b>${esc(item.make)}</b></span>` : ''}
  `;
  $('removeProductMsg').innerHTML = '';
}

if ($('btnCancelRemoveSelection')) {
  $('btnCancelRemoveSelection').onclick = () => {
    selectedProductToRemove = null;
    $('removeSelectedCard').classList.add('hidden');
    $('removeProductMsg').innerHTML = '';
  };
}

if ($('btnConfirmDeleteProduct')) {
  $('btnConfirmDeleteProduct').onclick = async () => {
    if (!selectedProductToRemove) return;
    const desc = selectedProductToRemove.description;
    const sku = selectedProductToRemove.sku || `ID #${selectedProductToRemove.id}`;
    const confirmed = confirm(`Are you sure you want to permanently remove "${desc}" (${sku}) from stock?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    const btn = $('btnConfirmDeleteProduct');
    btn.disabled = true;
    btn.textContent = 'Removing...';
    try {
      const res = await fetch('/api/products/' + selectedProductToRemove.id, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      $('removeSelectedCard').classList.add('hidden');
      selectedProductToRemove = null;
      $('removeProductMsg').innerHTML = `
        <div class="msg ok" style="font-size:14px; padding:12px 16px;">
          <b>Product Removed!</b> ${esc(data.message)}
        </div>
      `;

      // Refresh stock view and new products shelf
      loadStock();
      loadNewProductsShelf();

      setTimeout(() => {
        if ($('removeProductMsg')) $('removeProductMsg').innerHTML = '';
      }, 5000);
    } catch (err) {
      $('removeProductMsg').innerHTML = `<div class="msg err">Failed to remove product: ${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '🗑️ Permanently Remove from Stock';
    }
  };
}

// ==========================================
// ----- Edit Product Description Modal -----
// ==========================================
let currentEditingItem = null;

function openEditDescModal(item) {
  currentEditingItem = item;
  $('editModalItemId').value = item.id;
  $('editModalDescInput').value = item.description || '';
  $('editModalProductMeta').textContent = `S.No #${item.serial_no || item.id} · Location: ${item.location || ''} · Make: ${item.make || ''} (${item.product_type || ''}) · Tally: ${num(item.tally_qty)} ${item.uom || ''}`;

  updateEditModalSkuPreview();
  $('editModalMsg').innerHTML = '';
  $('editDescModal').classList.remove('hidden');
  $('editModalDescInput').focus();
  $('editModalDescInput').select();
}

function updateEditModalSkuPreview() {
  if (!currentEditingItem) return;
  const desc = $('editModalDescInput') ? $('editModalDescInput').value.trim() : '';
  const autoSync = $('editModalAutoUpdateSku') ? $('editModalAutoUpdateSku').checked : true;

  if (autoSync && desc) {
    const newSku = generateSkuCode({
      make: currentEditingItem.make,
      product_type: currentEditingItem.product_type,
      description: desc
    });
    const newCat = generateCatCode({
      make: currentEditingItem.make,
      product_type: currentEditingItem.product_type,
      description: desc,
      sku: newSku
    });
    if ($('editModalSkuVal')) $('editModalSkuVal').textContent = newSku;
    if ($('editModalCatVal')) $('editModalCatVal').textContent = newCat;
  } else {
    if ($('editModalSkuVal')) $('editModalSkuVal').textContent = currentEditingItem.sku || '—';
    if ($('editModalCatVal')) $('editModalCatVal').textContent = currentEditingItem.cat_code || '—';
  }
}

if ($('closeEditDescModal')) {
  $('closeEditDescModal').onclick = () => $('editDescModal').classList.add('hidden');
}
if ($('btnCancelEditModal')) {
  $('btnCancelEditModal').onclick = () => $('editDescModal').classList.add('hidden');
}

if ($('editModalDescInput')) {
  $('editModalDescInput').addEventListener('input', () => {
    const input = $('editModalDescInput');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(start, end);
    updateEditModalSkuPreview();
  });
}

if ($('editModalAutoUpdateSku')) {
  $('editModalAutoUpdateSku').onchange = updateEditModalSkuPreview;
}

if ($('editDescForm')) {
  $('editDescForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentEditingItem) return;

    const desc = $('editModalDescInput').value.trim().toUpperCase();
    if (!desc) {
      $('editModalMsg').innerHTML = '<div class="msg err">Product description cannot be empty.</div>';
      return;
    }

    const autoSync = $('editModalAutoUpdateSku') ? $('editModalAutoUpdateSku').checked : true;
    const btn = $('btnSaveEditModal');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    $('editModalMsg').innerHTML = '';

    const payload = {
      id: currentEditingItem.id,
      description: desc
    };

    if (autoSync && $('editModalSkuVal')) {
      payload.sku = $('editModalSkuVal').textContent.trim();
      payload.cat_code = $('editModalCatVal') ? $('editModalCatVal').textContent.trim() : '';
    }

    try {
      const res = await fetch(`/api/products/${currentEditingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      $('editModalMsg').innerHTML = `<div class="msg ok"><b>Saved!</b> ${esc(data.message)}</div>`;

      // Refresh stock view and new products shelf
      loadStock();
      loadNewProductsShelf();

      setTimeout(() => {
        $('editDescModal').classList.add('hidden');
        $('editModalMsg').innerHTML = '';
      }, 700);
    } catch (err) {
      $('editModalMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Description';
    }
  };
}

// =============================================================
// ----- Edit Product Description Section on Onboard Tab -----
// =============================================================
let selectedProductToEdit = null;
let editSearchTimer = null;

const editSearchInput = $('editSearchInput');
if (editSearchInput) {
  editSearchInput.addEventListener('input', () => {
    clearTimeout(editSearchTimer);
    editSearchTimer = setTimeout(async () => {
      const q = editSearchInput.value.trim();
      const resultsEl = $('editSearchResults');
      if (!q) {
        resultsEl.innerHTML = '';
        return;
      }
      try {
        const items = await (await fetch('/api/items?q=' + encodeURIComponent(q))).json();
        if (!items || items.length === 0) {
          resultsEl.innerHTML = '<div class="muted" style="padding:10px; font-size:13px;">No matching products found in stock.</div>';
          return;
        }
        resultsEl.innerHTML = items.slice(0, 8).map(i => `
          <div class="edit-pick-item" data-id="${i.id}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <div style="font-weight:700; font-size:13px; color:var(--ink);">
                <span class="badge font-mono" style="background:#e0f2fe; color:#0369a1; font-size:10px; margin-right:4px;">#${i.serial_no || i.id}</span>
                ${esc(i.description)}
              </div>
              <span class="badge loc" style="font-size:10px;">${esc(i.location)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-top:4px;">
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <span class="sku-tag font-mono" style="font-size:10px;">${esc(i.sku)}</span>
                ${i.cat_code ? `<span class="font-mono" style="font-size:10px; background:#eff6ff; color:#1d4ed8; padding:1px 5px; border-radius:3px;">CAT: ${esc(i.cat_code)}</span>` : ''}
                ${i.make ? `<span class="muted" style="font-size:11px;">Make: ${esc(i.make)}</span>` : ''}
              </div>
              <div>
                <span class="muted">Tally:</span> <b style="color:var(--brand-dark);">${num(i.tally_qty)} ${esc(i.uom)}</b>
              </div>
            </div>
          </div>
        `).join('');

        resultsEl.querySelectorAll('.edit-pick-item').forEach(el => {
          el.onclick = () => {
            const item = items.find(x => x.id == el.dataset.id);
            if (item) selectProductToEdit(item);
          };
        });
      } catch (err) {
        resultsEl.innerHTML = `<div class="msg err" style="font-size:12px;">Search failed: ${esc(err.message)}</div>`;
      }
    }, 200);
  });
}

function selectProductToEdit(item) {
  selectedProductToEdit = item;
  $('editSearchResults').innerHTML = '';
  $('editSearchInput').value = '';
  $('editSelectedCard').classList.remove('hidden');
  $('editCardItemId').value = item.id;
  $('editCardDescInput').value = item.description || '';
  $('editCardSkuInput').value = item.sku || '';
  $('editCardCatInput').value = item.cat_code || '';
  $('editSelectedProductMeta').textContent = `S.No #${item.serial_no || item.id} · Location: ${item.location || ''} · Make: ${item.make || ''} (${item.product_type || ''}) · Tally: ${num(item.tally_qty)} ${item.uom || ''}`;
  $('editCardMsg').innerHTML = '';
  $('editCardDescInput').focus();
  $('editCardDescInput').select();
}

if ($('btnCancelEditCard')) {
  $('btnCancelEditCard').onclick = () => {
    selectedProductToEdit = null;
    $('editSelectedCard').classList.add('hidden');
    $('editCardMsg').innerHTML = '';
  };
}

function syncEditCardSkuCat() {
  if (!selectedProductToEdit) return;
  const autoSync = $('editCardAutoSync') ? $('editCardAutoSync').checked : true;
  if (!autoSync) return;
  const desc = $('editCardDescInput').value.trim();
  if (desc) {
    const newSku = generateSkuCode({
      make: selectedProductToEdit.make,
      product_type: selectedProductToEdit.product_type,
      description: desc
    });
    const newCat = generateCatCode({
      make: selectedProductToEdit.make,
      product_type: selectedProductToEdit.product_type,
      description: desc,
      sku: newSku
    });
    $('editCardSkuInput').value = newSku;
    $('editCardCatInput').value = newCat;
  }
}

if ($('editCardDescInput')) {
  $('editCardDescInput').addEventListener('input', () => {
    const input = $('editCardDescInput');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(start, end);
    syncEditCardSkuCat();
  });
}

if ($('editCardSkuInput')) {
  $('editCardSkuInput').addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      const input = $('editCardSkuInput');
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const val = input.value;
      const before = val.slice(0, start);
      const after = val.slice(end);
      const charToInsert = before.endsWith('-') ? '' : '-';
      input.value = (before + charToInsert + after).toUpperCase();
      const newPos = start + charToInsert.length;
      input.setSelectionRange(newPos, newPos);
    }
  });
  $('editCardSkuInput').addEventListener('input', () => {
    const input = $('editCardSkuInput');
    input.value = input.value.toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  });
}

if ($('editCardCatInput')) {
  $('editCardCatInput').addEventListener('input', () => {
    const input = $('editCardCatInput');
    input.value = input.value.toUpperCase();
  });
}

if ($('editCardAutoSync')) {
  $('editCardAutoSync').onchange = syncEditCardSkuCat;
}

if ($('editCardForm')) {
  $('editCardForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!selectedProductToEdit) return;

    const desc = $('editCardDescInput').value.trim().toUpperCase();
    if (!desc) {
      $('editCardMsg').innerHTML = '<div class="msg err">Product description cannot be empty.</div>';
      return;
    }

    const sku = $('editCardSkuInput').value.trim().toUpperCase();
    const catCode = $('editCardCatInput').value.trim().toUpperCase();

    const btn = $('btnSaveCardEdit');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    $('editCardMsg').innerHTML = '';

    try {
      const res = await fetch(`/api/products/${selectedProductToEdit.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedProductToEdit.id,
          description: desc,
          sku: sku || undefined,
          cat_code: catCode || undefined
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      $('editCardMsg').innerHTML = `
        <div class="msg ok" style="font-size:14px; padding:12px 16px;">
          <b>Saved!</b> ${esc(data.message)}
        </div>
      `;

      loadStock();
      loadNewProductsShelf();

      setTimeout(() => {
        if ($('editCardMsg')) $('editCardMsg').innerHTML = '';
      }, 4000);
    } catch (err) {
      $('editCardMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Save Updated Description';
    }
  };
}

// ----- Excel Sync & Upload Integration -----
if ($('syncExcelBtn')) {
  $('syncExcelBtn').onclick = async () => {
    const btn = $('syncExcelBtn');
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '&#8987; Syncing...';
    try {
      const res = await fetch('/api/sync-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      alert(data.message || 'Tally counts successfully synchronized from Excel sheet!');
      await loadStock();
    } catch (err) {
      alert('Error syncing from Excel: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  };
}

if ($('uploadExcelInput')) {
  $('uploadExcelInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isCsv = file.name.endsWith('.csv');
    const isXlsx = file.name.endsWith('.xlsx');
    if (!isCsv && !isXlsx) {
      alert('Please upload an .xlsx or .csv file');
      return;
    }

    const reader = new FileReader();
    if (isCsv) {
      reader.onload = async () => {
        try {
          const res = await fetch('/api/sync-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvContent: reader.result })
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);
          alert(data.message || 'Tally counts updated from CSV!');
          await loadStock();
        } catch (err) {
          alert('Error syncing CSV: ' + err.message);
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = async () => {
        try {
          const base64Data = String(reader.result).split(',')[1];
          const res = await fetch('/api/sync-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Data, fileName: file.name })
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);
          alert(data.message || 'Tally counts updated from Excel!');
          await loadStock();
        } catch (err) {
          alert('Error syncing Excel: ' + err.message);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };
}
