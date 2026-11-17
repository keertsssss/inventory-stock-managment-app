// app.js — runs in the browser (phone or laptop). It talks to server.js using fetch().
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

let mode = 'ISSUE';      // ISSUE or RECEIVE
let chosen = null;       // the item currently selected

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
}
$('mode-issue').onclick = () => setMode('ISSUE');
$('mode-receive').onclick = () => setMode('RECEIVE');
setMode('ISSUE');

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
      <div style="font-size:13px; font-weight:bold; color:var(--brand-dark); margin-bottom:8px; display:flex; align-items:center; gap:6px;">
        <span class="badge badge-new" style="font-size:11px;">NEW</span> Recently Onboarded Products (≤ 30d):
      </div>
      <div class="new-products-scroll">
        ${allNewProducts.map(i => `
          <div class="new-product-chip" data-id="${i.id}">
            <div style="display:flex; justify-content:space-between; gap:6px; margin-bottom:4px;">
              <span class="badge badge-new" style="font-size:10px; padding:2px 6px;">NEW • ${i.days_remaining}d left</span>
              <span class="badge loc" style="font-size:10px; padding:2px 6px;">${esc(i.location)}</span>
            </div>
            <b>${esc(i.description.slice(0, 36))}${i.description.length > 36 ? '…' : ''}</b><br>
            <small class="muted font-mono">${esc(i.sku)}</small> · <small>Tally: <b>${num(i.tally_qty)} ${esc(i.uom)}</b></small>
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
      body: JSON.stringify({ type: mode, item_id: chosen.id, qty: $('qty').value, person, note: $('note').value })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);

    const verb = mode === 'RECEIVE' ? 'Added / Received +' : 'Issued -';
    const notif = $('moveNotification');
    if (notif) {
      notif.classList.remove('hidden');
      notif.innerHTML = `
        <div class="msg ok" style="font-size:14px; padding:12px 16px; margin:0 0 14px 0; border-left:4px solid #16a34a; background:#f0fdf4; color:#166534; display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:0 1px 3px rgba(0,0,0,0.06); border-radius:6px;">
          <div>
            <div style="font-size:16px; font-weight:bold; color:#15803d; margin-bottom:2px;">&#10003; Done, thank you!</div>
            <div style="font-size:13px; color:#166534;">
              ${verb}${num(qtyVal)} ${esc(data.item.uom)} of <b>${esc(data.item.description)}</b> (${esc(data.item.location)}). Updated Tally Count: <b>${num(data.item.tally_qty)} ${esc(data.item.uom)}</b>.
            </div>
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
    $('form').classList.add('hidden');
    $('form').classList.remove('card-new-product');
    loadNewProductsShelf();
    renderNewProductsShelf();
    $('q').focus();
  };
}

// ----- Stock list -----
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

  if ($('onlyZero').checked) items = items.filter(i => Number(i.stock) <= 0);
  if ($('onlyVariance').checked) items = items.filter(i => i.variance !== null && i.variance !== 0);
  if ($('onlyUncounted').checked) items = items.filter(i => i.physical_count === null || i.physical_count === undefined || i.physical_count === '');
  if ($('onlyNewProducts') && $('onlyNewProducts').checked) items = items.filter(i => i.is_new === 1);

  const totalTally = items.reduce((s, i) => s + (Number(i.tally_qty) || 0), 0);
  const countedCount = items.filter(i => i.physical_count != null && i.physical_count !== '').length;
  const varianceCount = items.filter(i => i.variance !== null && i.variance !== 0).length;
  const newCount = items.filter(i => i.is_new === 1).length;

  $('stockSummary').innerHTML = `Showing <b>${items.length}</b> items · Counted: <b>${countedCount}/${items.length}</b> · With variance: <b>${varianceCount}</b> · <span class="badge badge-new" style="font-size:11px;">NEW</span> (≤30d): <b>${newCount}</b> · Total Tally Count: <b>${num(totalTally)}</b>`;

  const thead = `<tr>
    <th>Serial No</th>
    <th>Rack Location</th>
    <th>Rack</th>
    <th>Section</th>
    <th>Category</th>
    <th>Make</th>
    <th>Product Type</th>
    <th>S.No (Orig.)</th>
    <th>Description</th>
    <th>SKU Code</th>
    <th>UOM</th>
    <th>Tally Qty</th>
    <th>Physical Count</th>
    <th>Variance (Physical − Tally)</th>
  </tr>`;

  $('stockTable').innerHTML = thead + items.map((i, index) => {
    const serialNo = i.serial_no || (index + 1);
    const physVal = i.physical_count != null ? i.physical_count : '';
    const newBadge = i.is_new ? `<span class="badge badge-new" title="Added on ${esc(i.created_at)} (${i.days_old} days ago)" style="margin-left:6px;">NEW • ${i.days_remaining}d left</span>` : '';
    const rowClass = i.is_new ? 'row-new-product' : '';

    return `<tr class="${rowClass}">
      <td class="text-center font-mono" style="font-size:14px; font-weight:bold; color:var(--brand-dark);">
        ${serialNo}
      </td>
      <td><span class="badge loc">${esc(i.location)}</span></td>
      <td class="text-center">${esc(i.rack)}</td>
      <td class="text-center">${esc(i.section || (i.location ? i.location.split('-')[1] : ''))}</td>
      <td><small>${esc(i.category)}</small></td>
      <td>${esc(i.make)}</td>
      <td><small>${esc(i.product_type)}</small></td>
      <td class="text-center font-mono text-muted">#${esc(i.id)}</td>
      <td><b>${esc(i.description)}</b>${newBadge}</td>
      <td>
        <span class="font-mono sku-tag">${esc(i.sku)}</span>
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
        <input type="number" step="any" min="0" class="phys-input" data-id="${i.id}" data-tally="${i.tally_qty}" value="${physVal}" placeholder="Count…">
      </td>
      <td class="text-center" id="var-cell-${i.id}">${formatVariance(i.variance)}</td>
    </tr>`;
  }).join('');

  // Attach event handlers to physical count inputs
  document.querySelectorAll('.phys-input').forEach(input => {
    input.addEventListener('change', async () => {
      const id = Number(input.dataset.id);
      const tally = Number(input.dataset.tally);
      const val = input.value.trim();
      const countVal = val === '' ? null : Number(val);
      const cell = $(`var-cell-${id}`);

      // Optimistic UI update for variance
      if (countVal === null) {
        cell.innerHTML = formatVariance(null);
      } else {
        const v = Math.round((countVal - tally) * 100) / 100;
        cell.innerHTML = formatVariance(v);
      }

      input.classList.add('saving');
      try {
        const res = await fetch('/api/physical-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, physical_count: countVal })
        });
        const data = await res.json();
        if (data.ok) {
          input.classList.remove('saving');
          input.classList.add('saved');
          setTimeout(() => input.classList.remove('saved'), 1200);
        } else {
          throw new Error(data.error);
        }
      } catch (err) {
        input.classList.remove('saving');
        input.classList.add('save-err');
        alert('Failed to save physical count: ' + err.message);
      }
    });
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

async function loadReport() {
  const date = $('date').value;
  $('csv').href = '/api/report.csv?date=' + date;
  const { rows } = await (await fetch('/api/report?date=' + date)).json();
  const out = rows.filter(r => r.type === 'ISSUE').length, inn = rows.filter(r => r.type === 'RECEIVE').length;
  $('summary').textContent = `${rows.length} entries — ${out} issued, ${inn} received`;
  $('reportTable').innerHTML = '<tr><th>Serial No</th><th>Time</th><th>Type</th><th>Item</th><th>Qty</th><th>By</th><th>Note</th></tr>' +
    rows.map((r, idx) => `<tr>
      <td class="text-center font-mono"><b>${idx + 1}</b></td>
      <td>${esc(r.ts.slice(11, 16))}</td><td class="t-${r.type}">${r.type}</td>
      <td>${esc(r.description)}<br><small class="muted">${esc(r.location)}</small></td>
      <td>${num(r.qty)} ${esc(r.uom)}</td><td>${esc(r.person)}</td><td>${esc(r.note)}</td></tr>`).join('');
}

// ----- Product Onboarding & Dynamic SKU Generator -----
if ($('onlyNewProducts')) $('onlyNewProducts').onchange = loadStock;

if ($('openOnboardModal')) {
  $('openOnboardModal').onclick = () => switchTab('onboard');
}

async function suggestSku() {
  const catRack = $('newCatSelect').value;
  const branchParent = $('newBranchParent').value.trim();
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
      body: JSON.stringify({ category, branch_parent_sku: branchParent || null })
    });
    const data = await res.json();
    if (data.ok && data.sku) {
      $('newSku').value = data.sku;
      $('skuPatternHint').textContent = branchParent
        ? `Branch variant created from ${branchParent}`
        : `Pattern matched: ${data.pattern?.prefix || ''} (Seq: ${data.pattern?.sequence || 'next'})`;
    }
  } catch (err) {
    console.error('Error suggesting SKU:', err);
  }
}

if ($('btnAutoSku')) $('btnAutoSku').onclick = suggestSku;
if ($('newCatSelect')) $('newCatSelect').onchange = () => {
  $('newLocation').value = $('newCatSelect').value + '-S01';
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
      sku: $('newSku').value.trim(),
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
