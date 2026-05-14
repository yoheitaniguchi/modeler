/* ============================================================
 * Modeler — マスター・ディテール画面サンプル ロジック
 *
 * これは確認用の静的画面サンプルです。ダミーデータを使って
 * 「上下分割マスター・ディテール画面」の挙動を再現します。
 *
 * 想定モデル:
 *   - orders (ヘッダー)
 *     fields: id, customer (reference→customers), orderDate, total (計算)
 *     ui.layout = 'masterDetail'
 *   - orderLines (明細)
 *     fields: id, order (reference→orders, parent.via), product (reference→products),
 *             quantity (number), unitPrice (number), subtotal (計算)
 *     parent: { model: 'orders', via: 'order' }
 *   - customers, products (補助マスター)
 * ============================================================ */

// ---------- ダミーデータ ----------
const customers = [
  { id: 'c1', name: '山田商店' },
  { id: 'c2', name: '鈴木物産' },
  { id: 'c3', name: '田中工業' },
  { id: 'c4', name: '佐藤食品' },
];

const products = [
  { id: 'p1', name: 'りんご', defaultPrice: 100 },
  { id: 'p2', name: 'みかん', defaultPrice: 80 },
  { id: 'p3', name: 'バナナ', defaultPrice: 120 },
  { id: 'p4', name: 'いちご', defaultPrice: 300 },
  { id: 'p5', name: 'メロン', defaultPrice: 1500 },
  { id: 'p6', name: 'パイナップル', defaultPrice: 500 },
  { id: 'p7', name: 'ぶどう', defaultPrice: 800 },
];

const headers = [
  { id: 'ord1', customer: 'c1', orderDate: '2026-05-12' },
  { id: 'ord2', customer: 'c2', orderDate: '2026-05-13' },
  { id: 'ord3', customer: 'c1', orderDate: '2026-05-13' },
];

const lines = [
  // ord1
  { id: 'l1', order: 'ord1', product: 'p1', quantity: 2, unitPrice: 100 },
  { id: 'l2', order: 'ord1', product: 'p2', quantity: 5, unitPrice: 80 },
  // ord2
  { id: 'l3', order: 'ord2', product: 'p3', quantity: 1, unitPrice: 120 },
  { id: 'l4', order: 'ord2', product: 'p4', quantity: 2, unitPrice: 300 },
  { id: 'l5', order: 'ord2', product: 'p5', quantity: 1, unitPrice: 1500 },
  // ord3
  { id: 'l6', order: 'ord3', product: 'p7', quantity: 3, unitPrice: 800 },
];

// ---------- 状態 ----------
let selectedHeaderId = null;
/** 編集中のヘッダーフォーム値 (selectedHeaderId のシャドウ) */
let headerForm = null;
/** 編集中の明細グリッド (selectedHeaderId に対応する lines のシャドウ) */
let lineDraft = [];
let lineSeq = 100;

// ---------- ユーティリティ ----------
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === false || v === null || v === undefined) continue;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}
function labelOf(arr, id, key = 'name') {
  return (arr.find((x) => x.id === id) || {})[key] ?? '(未選択)';
}
function totalOf(lineList) {
  return lineList.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

// ---------- ヘッダーテーブル描画 ----------
function renderHeaderTable() {
  const tbody = $('#header-tbody');
  tbody.innerHTML = '';
  headers.forEach((h) => {
    const tr = el('tr', {
      class: h.id === selectedHeaderId ? 'is-selected' : '',
      'data-id': h.id,
      onClick: () => selectHeader(h.id),
    });
    tr.appendChild(el('td', { class: 'col-select' }, h.id === selectedHeaderId ? '●' : ''));
    tr.appendChild(el('td', {}, h.id));
    tr.appendChild(el('td', {}, labelOf(customers, h.customer)));
    tr.appendChild(el('td', {}, h.orderDate || ''));
    const sub = lines.filter((l) => l.order === h.id);
    tr.appendChild(el('td', {}, '¥' + totalOf(sub).toLocaleString()));
    tbody.appendChild(tr);
  });
}

// ---------- ヘッダー詳細フォーム ----------
function renderHeaderForm() {
  const wrap = $('#header-form');
  wrap.innerHTML = '';
  if (!selectedHeaderId) {
    wrap.appendChild(el('p', { class: 'muted' }, '上のテーブルからヘッダーを選択してください。'));
    return;
  }
  const h = headerForm;
  const customerField = el('div', { class: 'field' },
    el('label', {}, '顧客 (reference)'),
    (() => {
      const sel = el('select');
      sel.appendChild(el('option', { value: '' }, '-- 選択してください --'));
      customers.forEach((c) => {
        const opt = el('option', { value: c.id }, c.name);
        if (c.id === h.customer) opt.setAttribute('selected', '');
        sel.appendChild(opt);
      });
      sel.addEventListener('change', (e) => { h.customer = e.target.value; });
      return sel;
    })(),
  );
  const dateField = el('div', { class: 'field' },
    el('label', {}, '受注日'),
    (() => {
      const i = el('input', { type: 'date', value: h.orderDate || '' });
      i.addEventListener('change', (e) => { h.orderDate = e.target.value; });
      return i;
    })(),
  );
  const actions = el('div', { class: 'actions' },
    el('button', { class: 'ghost', onClick: () => { Object.assign(headerForm, headers.find((x) => x.id === selectedHeaderId)); renderHeaderForm(); } }, '元に戻す'),
    el('button', { class: 'primary', onClick: () => {
      const idx = headers.findIndex((x) => x.id === selectedHeaderId);
      if (idx >= 0) headers[idx] = { ...headers[idx], ...headerForm };
      renderHeaderTable();
      flash('ヘッダーを更新しました');
    }}, 'ヘッダーを更新'),
  );
  wrap.appendChild(customerField);
  wrap.appendChild(dateField);
  wrap.appendChild(actions);
}

// ---------- 明細グリッド ----------
function renderLineTable() {
  const tbody = $('#line-tbody');
  tbody.innerHTML = '';
  $('#empty-state').hidden = !!selectedHeaderId;
  $('#line-grid-wrap').hidden = !selectedHeaderId;
  if (!selectedHeaderId) return;

  lineDraft.forEach((l, idx) => {
    const tr = el('tr', { 'data-line-id': l.id });
    tr.appendChild(el('td', { class: 'col-no' }, String(idx + 1)));

    // product 列 (reference + 検索可能ドロップダウン)
    const productCell = el('td');
    const refDisplay = el('input', {
      type: 'text',
      readonly: true,
      value: labelOf(products, l.product),
      'data-role': 'ref-trigger',
    });
    refDisplay.addEventListener('click', (ev) => openRefPopover(refDisplay, products, (picked) => {
      l.product = picked.id;
      // 単価デフォルトもコピー
      if (!l.unitPrice && picked.defaultPrice) l.unitPrice = picked.defaultPrice;
      renderLineTable();
    }));
    productCell.appendChild(refDisplay);
    tr.appendChild(productCell);

    // quantity
    tr.appendChild(el('td', {},
      (() => {
        const i = el('input', { type: 'number', min: 0, value: String(l.quantity ?? '') });
        i.addEventListener('input', (e) => { l.quantity = Number(e.target.value); refreshLineFooter(); recomputeRowSubtotal(tr, l); });
        return i;
      })(),
    ));
    // unitPrice
    tr.appendChild(el('td', {},
      (() => {
        const i = el('input', { type: 'number', min: 0, value: String(l.unitPrice ?? '') });
        i.addEventListener('input', (e) => { l.unitPrice = Number(e.target.value); refreshLineFooter(); recomputeRowSubtotal(tr, l); });
        return i;
      })(),
    ));
    // subtotal (read only)
    const sub = el('td', { 'data-role': 'subtotal' }, '¥' + ((l.quantity || 0) * (l.unitPrice || 0)).toLocaleString());
    tr.appendChild(sub);

    // 削除
    tr.appendChild(el('td', { class: 'col-actions' },
      el('button', { class: 'row-delete', onClick: () => {
        lineDraft.splice(idx, 1);
        renderLineTable();
      }}, '削除'),
    ));

    tbody.appendChild(tr);
  });
  refreshLineFooter();
}
function recomputeRowSubtotal(tr, l) {
  const cell = tr.querySelector('[data-role="subtotal"]');
  if (cell) cell.textContent = '¥' + ((l.quantity || 0) * (l.unitPrice || 0)).toLocaleString();
}
function refreshLineFooter() {
  $('#line-total').textContent = '¥' + totalOf(lineDraft).toLocaleString();
}

// ---------- 選択切り替え ----------
function selectHeader(id) {
  selectedHeaderId = id;
  const h = headers.find((x) => x.id === id);
  headerForm = h ? { ...h } : null;
  lineDraft = lines.filter((l) => l.order === id).map((l) => ({ ...l }));
  renderHeaderTable();
  renderHeaderForm();
  renderLineTable();
}

// ---------- 行追加 / 既存からコピー ----------
function addEmptyLine() {
  if (!selectedHeaderId) { alert('ヘッダーを選択してください'); return; }
  lineDraft.push({ id: 'tmp-' + (++lineSeq), order: selectedHeaderId, product: '', quantity: 1, unitPrice: 0 });
  renderLineTable();
}

function saveLines() {
  if (!selectedHeaderId) return;
  // 旧明細を削除して draft に置き換え (新規IDは確定)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].order === selectedHeaderId) lines.splice(i, 1);
  }
  lineDraft.forEach((l) => {
    if (String(l.id).startsWith('tmp-')) l.id = 'l' + (++lineSeq);
    lines.push({ ...l, order: selectedHeaderId });
  });
  // draftも更新後の id で同期
  lineDraft = lines.filter((l) => l.order === selectedHeaderId).map((l) => ({ ...l }));
  renderHeaderTable();
  renderLineTable();
  flash(`明細 ${lineDraft.length} 行を保存しました`);
}

// ---------- 「既存から」モーダル ----------
let copySelected = new Set();
function openCopyModal() {
  if (!selectedHeaderId) { alert('ヘッダーを選択してください'); return; }
  copySelected = new Set();
  renderCopyList('');
  $('#copy-modal').hidden = false;
}
function closeCopyModal() {
  $('#copy-modal').hidden = true;
}
function renderCopyList(filter) {
  const tbody = $('#copy-tbody');
  tbody.innerHTML = '';
  const q = (filter || '').toLowerCase();
  lines.forEach((l) => {
    const productName = labelOf(products, l.product);
    if (q && !productName.toLowerCase().includes(q)) return;
    const tr = el('tr');
    const cb = el('input', { type: 'checkbox' });
    cb.addEventListener('change', (e) => {
      if (e.target.checked) copySelected.add(l.id);
      else copySelected.delete(l.id);
    });
    tr.appendChild(el('td', {}, cb));
    tr.appendChild(el('td', {}, l.order));
    tr.appendChild(el('td', {}, productName));
    tr.appendChild(el('td', {}, String(l.quantity)));
    tr.appendChild(el('td', {}, '¥' + Number(l.unitPrice).toLocaleString()));
    tbody.appendChild(tr);
  });
}
function applyCopy() {
  if (copySelected.size === 0) { closeCopyModal(); return; }
  lines.filter((l) => copySelected.has(l.id)).forEach((src) => {
    // parent.via (= order) は現在のヘッダーで上書き、idは新規採番、その他はコピー
    const copy = { ...src, id: 'tmp-' + (++lineSeq), order: selectedHeaderId };
    lineDraft.push(copy);
  });
  closeCopyModal();
  renderLineTable();
  flash(`${copySelected.size} 行をコピーしました (未保存)`);
}

// ---------- reference 検索可能ドロップダウン ----------
let refPopState = null;
function openRefPopover(anchor, items, onPick) {
  closeRefPopover();
  const pop = $('#ref-popover');
  pop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  pop.style.left = (window.scrollX + rect.left) + 'px';
  pop.style.top = (window.scrollY + rect.bottom + 4) + 'px';
  const search = $('#ref-search');
  search.value = '';
  refPopState = { items, onPick, filter: '' };
  renderRefOptions();
  setTimeout(() => search.focus(), 0);
}
function closeRefPopover() {
  $('#ref-popover').hidden = true;
  refPopState = null;
}
function renderRefOptions() {
  if (!refPopState) return;
  const ul = $('#ref-options');
  ul.innerHTML = '';
  const q = refPopState.filter.toLowerCase();
  const filtered = refPopState.items.filter((it) => !q || it.name.toLowerCase().includes(q));
  if (filtered.length === 0) {
    ul.appendChild(el('li', { class: 'empty' }, '該当なし'));
    return;
  }
  filtered.forEach((it) => {
    const li = el('li', { 'data-id': it.id, onClick: () => { refPopState.onPick(it); closeRefPopover(); } }, it.name);
    ul.appendChild(li);
  });
}

// ---------- 通知 ----------
let flashTimer = null;
function flash(msg) {
  let n = $('#flash');
  if (!n) {
    n = el('div', { id: 'flash' });
    Object.assign(n.style, { position: 'fixed', bottom: '24px', right: '24px', background: '#0f172a', color: '#fff', padding: '10px 16px', borderRadius: '6px', zIndex: 1000, boxShadow: '0 6px 20px rgba(0,0,0,0.2)', fontSize: '13px' });
    document.body.appendChild(n);
  }
  n.textContent = msg;
  n.style.opacity = '1';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { n.style.transition = 'opacity .4s'; n.style.opacity = '0'; }, 1800);
}

// ---------- 初期化 ----------
window.addEventListener('DOMContentLoaded', () => {
  $('#header-create').addEventListener('click', () => {
    const newId = 'ord' + (headers.length + 1) + '-' + Date.now().toString(36).slice(-3);
    headers.push({ id: newId, customer: '', orderDate: new Date().toISOString().slice(0, 10) });
    selectHeader(newId);
    flash('新規ヘッダーを追加しました');
  });

  $('#line-add').addEventListener('click', addEmptyLine);
  $('#line-save').addEventListener('click', saveLines);
  $('#line-copy-from-existing').addEventListener('click', openCopyModal);

  $('#copy-close').addEventListener('click', closeCopyModal);
  $('#copy-cancel').addEventListener('click', closeCopyModal);
  $('#copy-apply').addEventListener('click', applyCopy);
  $('#copy-search').addEventListener('input', (e) => renderCopyList(e.target.value));

  // 背景クリックで閉じる
  $('#copy-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCopyModal();
  });

  // Escキーでモーダル / refポップオーバーを閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#copy-modal').hidden) { closeCopyModal(); return; }
    if (refPopState) { closeRefPopover(); return; }
  });

  $('#ref-search').addEventListener('input', (e) => {
    if (refPopState) { refPopState.filter = e.target.value; renderRefOptions(); }
  });
  document.addEventListener('click', (e) => {
    if (!refPopState) return;
    const pop = $('#ref-popover');
    if (pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target.matches('[data-role="ref-trigger"]')) return;
    closeRefPopover();
  });

  // レイアウト切替 (デモ用)
  $$('input[name="layout"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      if (e.target.value === 'standard') {
        alert('ui.layout = "standard" — 従来のCRUD画面に切り替わるイメージです (本サンプルでは未表現)');
        e.target.checked = false;
        $('input[name="layout"][value="masterDetail"]').checked = true;
      }
    });
  });

  selectHeader(headers[0].id);
  renderHeaderTable();
});
