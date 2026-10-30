// Dashboard: semua panggilan lewat server lokal (/api/cards/*), bukan langsung ke KripiCard.

const $ = (sel) => document.querySelector(sel);
const money = (n) => (n === undefined || n === null || n === '' ? '-' : `$${Number(n).toFixed(2)}`);
// Perkiraan biaya: $1 + 4% (sesuai docs fund; contoh create di docs juga cocok).
const estFee = (amount) => Math.round((1 + amount * 0.04) * 100) / 100;
const DETAIL_HIDE_MS = 30_000;
const QUICK_AMOUNTS = [50, 100, 250, 500];

// Wilayah BIN yang sudah diketahui; BIN lain belum ada keterangannya.
const BIN_REGIONS = { 493728: 'Hong Kong' };
const binLabel = (b) => (BIN_REGIONS[b] ? `${b} · ${BIN_REGIONS[b]}` : b);

let config = { bins: [], binsNeedDob: [], minAmount: 10 };
let allCards = [];
let statusFilter = 'all';

async function api(action, body = {}) {
  const res = await fetch(`/api/cards/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VCG': '1' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }));
  if (!data.success) throw new Error(data.message || 'Request gagal');
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

// Ikon garis 24x24; path dari set ikon sederhana buatan sendiri.
const ICONS = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  plus: 'M12 5v14 M5 12h14',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  snow: 'M12 2v20 M4.9 7l14.2 10 M4.9 17 19.1 7 M9 4l3 2 3-2 M9 20l3-2 3 2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v6 M14 11v6',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
    path.setAttribute(k, v);
  }
  svg.append(path);
  return svg;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.remove('hidden');
  // Ulang animasi masuk
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 7000 : 4000);
}

// Dialog generik. buttons: [{ label, value, primary, danger }]. Resolve dengan value tombol.
function openDialog(title, content, buttons = [{ label: 'Tutup', value: 'close' }], { wide = false } = {}) {
  const dlg = $('#dialog');
  dlg.classList.toggle('wide', wide);
  $('#dialog-title').textContent = title;
  $('#dialog-content').replaceChildren(content);
  $('#dialog-actions').replaceChildren(
    ...buttons.map((b) =>
      el('button', { class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, value: b.value }, b.label)
    )
  );
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
}

const confirmDialog = (title, lines, okLabel, danger = false) =>
  openDialog(title, el('div', {}, lines.map((l) => el('p', {}, l))), [
    { label: 'Batal', value: 'cancel' },
    { label: okLabel, value: 'ok', primary: !danger, danger },
  ]).then((v) => v === 'ok');

function feeSummary(amount, label = 'Saldo awal') {
  if (!(amount >= config.minAmount)) {
    return [el('dt', {}, `Minimal ${money(config.minAmount)}`), el('dd', {}, '')];
  }
  const fee = estFee(amount);
  return [
    el('dt', {}, label),
    el('dd', {}, money(amount)),
    el('dt', {}, 'Biaya ($1 + 4%)'),
    el('dd', {}, money(fee)),
    el('dt', { class: 'total' }, 'Dipotong dari wallet'),
    el('dd', { class: 'total' }, money(amount + fee)),
    el('p', { class: 'note' }, 'Perkiraan. Angka pasti mengikuti respons KripiCard.'),
  ];
}

// ---------- Buat kartu ----------

function updateCreateForm() {
  const bin = $('#bin').value;
  const needDob = config.binsNeedDob.includes(bin);
  $('#dob-field input').required = needDob;
  $('#dob-hint').textContent = needDob ? '· wajib untuk BIN ini' : '· opsional';
  const amount = Number($('#create-amount').value) || 0;
  $('#create-summary').replaceChildren(...feeSummary(amount));
  for (const chip of document.querySelectorAll('#amount-chips .chip')) {
    chip.classList.toggle('active', Number(chip.dataset.amount) === amount);
  }
}

async function onCreate(e) {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  body.amount = Number(body.amount);
  if (!body.dateOfBirth) delete body.dateOfBirth;

  const ok = await confirmDialog(
    'Buat kartu baru?',
    [
      el('span', {}, 'BIN ', el('strong', {}, binLabel(body.bin)), ' atas nama ', el('strong', {}, body.name_on_card), '.'),
      el('span', {}, 'Total ', el('strong', {}, money(body.amount + estFee(body.amount))), ` (saldo ${money(body.amount)} + perkiraan biaya ${money(estFee(body.amount))}) dipotong dari wallet KripiCard.`),
    ],
    'Ya, buat kartu'
  );
  if (!ok) return;

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  try {
    const r = await api('create', body);
    if (r.card_id) {
      toast(`Kartu •••• ${r.last_4 || ''} dibuat. Total dipotong ${money(r.total_charged)}.`);
    } else {
      toast(r.message || 'Kartu sedang diproses (pending). Muat ulang beberapa saat lagi.');
    }
    // Pertahankan BIN & nominal supaya membuat banyak kartu berturut-turut lebih cepat.
    form.elements.name_on_card.value = '';
    form.elements.email.value = '';
    form.elements.dateOfBirth.value = '';
    form.elements.name_on_card.focus();
    updateCreateForm();
    loadCards();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buat kartu';
  }
}

// ---------- Daftar kartu ----------

const isFrozen = (c) => Boolean(c.status) && c.status !== 'active';

// List KripiCard tidak menyertakan BIN, jadi warna kartu dipilih stabil dari card_id.
function toneOf(c) {
  const s = String(c.card_id || c.last4 || '');
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `tone-${h % 5}`;
}

const isVisa = (c) => /visa/i.test(c.card_brand || '') || String(c.bin || c.card_number || '').startsWith('4');

function cardFace(c, { pan, expiry } = {}) {
  const region = BIN_REGIONS[c.bin] || c.card_brand || c.card_type || 'Virtual';
  const binClass = c.bin ? `bin-${c.bin}` : toneOf(c);
  return el(
    'div',
    { class: `vcard-face ${binClass}` },
    el(
      'div',
      { class: 'face-top' },
      el('span', { class: 'face-region' }, region),
      el('span', { class: 'status-pill' }, isFrozen(c) ? 'Beku' : 'Aktif')
    ),
    el('div', { class: 'face-top' }, el('span', { class: 'chip-ic' }), c.balance !== undefined && c.balance !== null ? el('div', { class: 'face-balance' }, el('small', {}, 'Saldo'), el('strong', {}, money(c.balance))) : null),
    el('div', { class: 'face-pan' }, pan || `•••• •••• •••• ${c.last4 || '????'}`),
    el(
      'div',
      { class: 'face-bottom' },
      el('span', { class: 'face-name' }, expiry ? `${c.name_on_card || ''}  ·  ${expiry}` : c.name_on_card || ''),
      isVisa(c) ? el('span', { class: 'visa-logo' }, 'VISA') : el('span', { class: 'mc-logo' }, el('span'), el('span'))
    )
  );
}

function actionBtn(label, iconName, onclick, danger = false) {
  return el('button', { class: `action ${danger ? 'danger' : ''}`, type: 'button', onclick, title: label }, icon(iconName), label);
}

function cardView(c) {
  const frozen = isFrozen(c);
  const dec = lastDecline.get(c.card_id);
  return el(
    'article',
    { class: `vcard ${frozen ? 'frozen' : ''}` },
    cardFace(c),
    dec
      ? el(
          'div',
          { class: 'decline-strip', title: dec.reason || '' },
          icon('alert'),
          el('span', {}, `Ditolak: ${declineText(dec)} · ${dec.merchant} $${Number(dec.amount).toFixed(2)}`)
        )
      : null,
    el(
      'div',
      { class: 'vcard-info' },
      el('span', { class: 'id', title: c.card_id }, c.card_id),
      el('span', {}, c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
    ),
    el(
      'div',
      { class: 'vcard-actions' },
      actionBtn('Detail', 'eye', () => showDetails(c)),
      actionBtn('Top-up', 'plus', () => fundCard(c)),
      actionBtn('Riwayat', 'list', () => showTransactions(c)),
      actionBtn(frozen ? 'Aktifkan' : 'Bekukan', frozen ? 'sun' : 'snow', () => toggleFreeze(c)),
      actionBtn('Hapus', 'trash', () => deleteCard(c), true)
    )
  );
}

function skeletons(n = 3) {
  return Array.from({ length: n }, () =>
    el('article', { class: 'vcard skeleton' }, el('div', { class: 'vcard-face' }), el('div', { class: 'bar' }))
  );
}

function renderStats() {
  const active = allCards.filter((c) => !isFrozen(c)).length;
  const withBalance = allCards.filter((c) => typeof c.balance === 'number');
  $('#stat-total').textContent = allCards.length;
  $('#stat-active').textContent = active;
  $('#stat-frozen').textContent = allCards.length - active;
  // Sebagian tipe kartu tidak menyertakan saldo di list, jadi totalnya hanya dari yang ada.
  $('#stat-balance').textContent = withBalance.length ? money(withBalance.reduce((s, c) => s + c.balance, 0)) : '–';
}

function renderCards() {
  const q = $('#search').value.trim().toLowerCase();
  const list = allCards
    .filter((c) => statusFilter === 'all' || (statusFilter === 'frozen') === isFrozen(c))
    .filter((c) => !q || [c.name_on_card, c.last4, c.card_id].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const empty = list.length === 0;
  $('#empty').classList.toggle('hidden', !empty);
  if (empty) {
    const filtered = allCards.length > 0;
    $('#empty-title').textContent = filtered ? 'Tidak ada kartu yang cocok' : 'Belum ada kartu';
    $('#empty-text').textContent = filtered ? 'Coba kata kunci atau filter lain.' : 'Kartu yang kamu buat akan muncul di sini.';
  }
  $('#cards').replaceChildren(...list.map(cardView));
}

async function loadCards() {
  $('#empty').classList.add('hidden');
  $('#cards').replaceChildren(...skeletons());
  try {
    const r = await api('list');
    allCards = r.data || [];
    renderStats();
    renderCards();
    // Muat ulang sekaligus mengecek transaksi ditolak, tidak menunggu siklus berikutnya.
    runCycle();
  } catch (err) {
    $('#cards').replaceChildren(el('p', { class: 'load-error' }, `Gagal memuat kartu: ${err.message}`));
  }
}

// ---------- Aksi per kartu ----------

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    toast(`${label} disalin`);
  } catch {
    toast('Gagal menyalin', true);
  }
}

function copyBtn(value, label) {
  return el('button', { class: 'btn small ghost', type: 'button', onclick: () => copyText(value, label) }, icon('copy'), 'Salin');
}

async function showDetails(c) {
  const ok = await confirmDialog('Tampilkan detail kartu?', ['Nomor kartu lengkap dan CVV akan tampil di layar selama 30 detik.'], 'Tampilkan');
  if (!ok) return;
  try {
    const d = await api('details', { card_id: c.card_id });
    const pan = String(d.card_number || '').replace(/(\d{4})(?=\d)/g, '$1 ');
    const row = (k, v, raw) => el('div', { class: 'detail-row' }, el('span', { class: 'k' }, k), el('code', {}, v), raw ? copyBtn(raw, k) : el('span'));
    const allText = `${d.card_number}\n${d.expiry}\n${d.cvv}`;
    const content = el(
      'div',
      {},
      el('div', { class: 'detail-face' }, cardFace({ ...c, balance: d.balance, status: d.status }, { pan, expiry: d.expiry })),
      el(
        'div',
        { class: 'detail-list' },
        row('Nomor', pan, d.card_number),
        row('Expiry', d.expiry, d.expiry),
        row('CVV', d.cvv, d.cvv),
        row('Saldo', money(d.balance))
      ),
      el('div', { class: 'countdown' }, el('div')),
      el('p', { class: 'muted' }, 'Tertutup otomatis dalam 30 detik.')
    );
    const dlg = $('#dialog');
    const timer = setTimeout(() => dlg.open && dlg.close('timeout'), DETAIL_HIDE_MS);
    const done = openDialog(`Kartu •••• ${c.last4}`, content, [
      { label: 'Salin semua', value: 'copyall' },
      { label: 'Tutup', value: 'close', primary: true },
    ]);
    const v = await done;
    clearTimeout(timer);
    $('#dialog-content').replaceChildren();
    if (v === 'copyall') copyText(allText, 'Nomor, expiry, dan CVV');
  } catch (err) {
    toast(err.message, true);
  }
}

async function fundCard(c) {
  const input = el('input', { type: 'number', min: String(config.minAmount), step: '0.01', value: '250', required: '' });
  const summary = el('dl', { class: 'summary' });
  const chips = el('div', { class: 'chips' });
  const update = () => {
    const a = Number(input.value) || 0;
    summary.replaceChildren(...feeSummary(a, 'Top-up'));
    for (const ch of chips.children) ch.classList.toggle('active', Number(ch.dataset.amount) === a);
  };
  chips.append(
    ...QUICK_AMOUNTS.map((a) =>
      el('button', { type: 'button', class: 'chip', 'data-amount': String(a), onclick: () => { input.value = a; update(); } }, `$${a}`)
    )
  );
  input.addEventListener('input', update);
  update();

  const content = el(
    'div',
    {},
    el('p', {}, `Saldo sekarang: `, el('strong', {}, money(c.balance))),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Jumlah top-up (USD)'), el('div', { class: 'money-input' }, el('span', {}, '$'), input), chips),
    summary
  );
  const v = await openDialog(`Top-up •••• ${c.last4}`, content, [
    { label: 'Batal', value: 'cancel' },
    { label: 'Top-up', value: 'ok', primary: true },
  ]);
  if (v !== 'ok') return;
  const amount = Number(input.value);
  if (!(amount >= config.minAmount)) return toast(`Minimal ${money(config.minAmount)}`, true);

  try {
    const r = await api('fund', { card_id: c.card_id, amount });
    lastDecline.delete(c.card_id);
    toast(`Top-up berhasil. Total dipotong ${money(r.data?.total_debited)}.`);
    loadCards();
  } catch (err) {
    toast(err.message, true);
  }
}

async function toggleFreeze(c) {
  const action = isFrozen(c) ? 'unfreeze' : 'freeze';
  try {
    await api('freeze', { card_id: c.card_id, action });
    toast(action === 'freeze' ? 'Kartu dibekukan' : 'Kartu diaktifkan lagi');
    loadCards();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteCard(c) {
  const ok = await confirmDialog(
    `Hapus kartu •••• ${c.last4}?`,
    [
      el('span', {}, el('strong', {}, 'Kartu dihapus permanen'), ' dan tidak bisa dikembalikan.'),
      'Sisa saldo dikembalikan ke wallet dikurangi biaya $2.00 (saldo ≤ $2 tidak kembali apa-apa).',
    ],
    'Hapus permanen',
    true
  );
  if (!ok) return;
  try {
    const r = await api('delete', { card_id: c.card_id });
    toast(r.message || 'Kartu dihapus');
    loadCards();
  } catch (err) {
    toast(err.message, true);
  }
}

async function showTransactions(c) {
  try {
    const r = await api('transactions', { card_id: c.card_id });
    const txs = r.data?.transactions || [];
    const table = txs.length
      ? el(
          'div',
          { class: 'table-wrap' },
          el(
            'table',
            {},
            el('thead', {}, el('tr', {}, ['Tanggal', 'Merchant', 'Tipe', 'Jumlah', 'Status'].map((h) => el('th', {}, h)))),
            el(
              'tbody',
              {},
              txs.map((t) =>
                el(
                  'tr',
                  { title: t.reason || '' },
                  el('td', {}, t.date),
                  el('td', {}, t.merchant),
                  el('td', { class: 'muted' }, t.type),
                  el('td', { class: 'num' }, `${Number(t.amount).toFixed(2)} ${t.currency || ''}`),
                  el('td', {}, el('span', { class: `tag ${t.status === 'success' ? 'ok' : 'bad'}` }, t.status === 'success' ? 'Berhasil' : 'Gagal'))
                )
              )
            )
          )
        )
      : el('div', { class: 'empty' }, el('p', { class: 'empty-title' }, 'Belum ada transaksi'));
    const content = el(
      'div',
      {},
      el('div', { class: 'balance-head' }, el('span', { class: 'muted' }, 'Saldo'), el('strong', {}, money(r.data?.balance))),
      table
    );
    await openDialog(`Riwayat •••• ${c.last4}`, content, undefined, { wide: true });
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Notifikasi transaksi ditolak ----------
// Tidak ada notifikasi dari KripiCard tanpa server online (webhook), jadi dashboard
// mengecek riwayat transaksi sendiri. Hanya kartu aktif yang baru dibuat yang dipantau,
// satu per satu dan berjeda, supaya limit API standar tidak cepat habis.

const WATCH_DAYS = 2;
const CYCLE_MS = 5 * 60_000;
const GAP_MS = 1_500;
const MAX_BACKOFF_MS = 30 * 60_000;
const MAX_ALERTS = 200;
const MAX_SEEN = 3_000;

// localStorage hanya untuk kenyamanan; kalau gagal, notifikasi tetap jalan selama tab terbuka.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // abaikan
    }
  },
};

let alerts = store.get('vcg-alerts', []);
let seenTx = new Set(store.get('vcg-seen', []));
const scannedCards = new Set(store.get('vcg-scanned', []));
// Kartu yang sudah ada sebelum pemantauan pertama kali jalan: penolakan lamanya tidak dinotifikasi.
let baselineAt = store.get('vcg-baseline-at', null);
const lastDecline = new Map();
const monitor = { enabled: store.get('vcg-monitor', true), timer: null, running: false, delay: CYCLE_MS, lastRun: null, watching: 0, error: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txKey = (cardId, t) => [cardId, t.date, t.type, t.merchant, t.amount, t.status].join('|');
const declineText = (t) =>
  ({ insufficient_funds: 'Saldo kurang', card_frozen: 'Kartu dibekukan' })[t.reason_code] || t.reason || 'Ditolak';

function watchTargets() {
  const since = Date.now() - WATCH_DAYS * 86_400_000;
  return allCards.filter((c) => !isFrozen(c) && c.created_at && new Date(c.created_at).getTime() >= since);
}

// Mengembalikan true kalau label "ditolak" di kartu ini berubah.
async function scanCard(c) {
  const r = await api('transactions', { card_id: c.card_id });
  const txs = [...(r.data?.transactions || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const silent = !scannedCards.has(c.card_id) && new Date(c.created_at).getTime() < baselineAt;
  const fresh = [];
  for (const t of txs) {
    if (t.status !== 'failed') continue;
    const key = txKey(c.card_id, t);
    if (seenTx.has(key)) continue;
    seenTx.add(key);
    if (!silent) fresh.push({ ...t, key });
  }
  scannedCards.add(c.card_id);
  for (const t of fresh.reverse()) addAlert(c, t);

  const before = lastDecline.get(c.card_id);
  if (txs[0]?.status === 'failed') lastDecline.set(c.card_id, txs[0]);
  else lastDecline.delete(c.card_id);
  return txKey(c.card_id, before || {}) !== txKey(c.card_id, lastDecline.get(c.card_id) || {});
}

function addAlert(c, t) {
  const a = {
    key: t.key,
    card_id: c.card_id,
    last4: c.last4,
    name: c.name_on_card || '',
    merchant: t.merchant,
    amount: t.amount,
    currency: t.currency || 'USD',
    reason: declineText(t),
    date: t.date,
    read: false,
  };
  alerts = [a, ...alerts].slice(0, MAX_ALERTS);
  const msg = `Kartu •••• ${a.last4} ditolak: ${a.reason} (${a.merchant} $${Number(a.amount).toFixed(2)})`;
  toast(msg, true);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification('Transaksi ditolak', { body: msg, tag: a.key });
    } catch {
      // abaikan
    }
  }
}

function persistMonitor() {
  seenTx = new Set([...seenTx].slice(-MAX_SEEN));
  // Buang kartu yang sudah tidak ada di daftar.
  const ids = new Set(allCards.map((c) => c.card_id));
  for (const id of scannedCards) if (!ids.has(id)) scannedCards.delete(id);
  store.set('vcg-alerts', alerts);
  store.set('vcg-seen', [...seenTx]);
  store.set('vcg-scanned', [...scannedCards]);
}

async function runCycle() {
  clearTimeout(monitor.timer);
  monitor.timer = null;
  if (!monitor.enabled || !config.hasKey || monitor.running) return;
  if (baselineAt === null) {
    baselineAt = Date.now();
    store.set('vcg-baseline-at', baselineAt);
  }

  monitor.running = true;
  const targets = watchTargets();
  monitor.watching = targets.length;
  let changed = false;
  try {
    for (const [i, c] of targets.entries()) {
      if (!monitor.enabled) break;
      if (i > 0) await sleep(GAP_MS);
      if (await scanCard(c)) changed = true;
    }
    monitor.error = '';
    monitor.delay = CYCLE_MS;
  } catch (err) {
    // Kemungkinan kena limit API: perlambat sampai maksimal 30 menit.
    monitor.error = err.message;
    monitor.delay = Math.min(monitor.delay * 2, MAX_BACKOFF_MS);
  }
  monitor.running = false;
  monitor.lastRun = new Date();
  persistMonitor();
  if (changed) renderCards();
  updateBell();
  if (monitor.enabled) monitor.timer = setTimeout(runCycle, monitor.delay);
}

function updateBell() {
  const unread = alerts.filter((a) => !a.read).length;
  const badge = $('#bell-count');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
  document.title = unread ? `(${unread}) Virtual Card Generator` : 'Virtual Card Generator';
}

function monitorStatus() {
  if (!monitor.enabled) return 'Pemantauan dimatikan.';
  const mins = Math.round(monitor.delay / 60_000);
  if (monitor.error) return `Cek terakhir gagal: ${monitor.error}. Dicoba lagi dalam ${mins} menit.`;
  const last = monitor.lastRun ? monitor.lastRun.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'belum';
  return `Memantau ${monitor.watching} kartu aktif yang dibuat ${WATCH_DAYS} hari terakhir · cek tiap ${mins} menit · terakhir ${last}`;
}

async function openAlerts() {
  const toggle = el('input', { type: 'checkbox' });
  toggle.checked = monitor.enabled;
  const status = el('p', { class: 'monitor-status' }, monitorStatus());
  toggle.addEventListener('change', () => {
    monitor.enabled = toggle.checked;
    store.set('vcg-monitor', monitor.enabled);
    if (monitor.enabled) runCycle();
    else {
      clearTimeout(monitor.timer);
      monitor.timer = null;
    }
    status.textContent = monitorStatus();
  });

  let desktop = null;
  if ('Notification' in window && Notification.permission === 'default') {
    desktop = el(
      'button',
      {
        type: 'button',
        class: 'btn small',
        onclick: async () => {
          const p = await Notification.requestPermission();
          desktop.replaceWith(el('span', { class: 'muted' }, p === 'granted' ? 'Notifikasi desktop aktif' : 'Notifikasi desktop ditolak browser'));
        },
      },
      'Aktifkan notifikasi desktop'
    );
  } else if ('Notification' in window && Notification.permission === 'denied') {
    desktop = el('span', { class: 'muted' }, 'Notifikasi desktop diblokir di pengaturan browser');
  }

  const showCard = (cardId) => {
    const c = allCards.find((x) => x.card_id === cardId);
    if (!c) return toast('Kartu sudah tidak ada', true);
    $('#dialog').close('jump');
    setTimeout(() => showTransactions(c), 0);
  };

  const list = alerts.length
    ? el(
        'div',
        { class: 'alert-list' },
        alerts.map((a) =>
          el(
            'button',
            { type: 'button', class: `alert-item ${a.read ? '' : 'unread'}`, onclick: () => showCard(a.card_id), title: 'Lihat riwayat kartu ini' },
            el(
              'div',
              { class: 'alert-main' },
              el('strong', {}, `•••• ${a.last4} · ${a.name}`),
              el('span', { class: 'muted' }, `${a.merchant} · ${Number(a.amount).toFixed(2)} ${a.currency}`)
            ),
            el('div', { class: 'alert-side' }, el('span', { class: 'tag bad' }, a.reason), el('span', { class: 'muted' }, a.date))
          )
        )
      )
    : el('div', { class: 'empty' }, el('p', { class: 'empty-title' }, 'Belum ada transaksi ditolak'), el('p', { class: 'muted' }, 'Kalau ada kartu yang ditolak, notifikasinya muncul di sini.'));

  const content = el(
    'div',
    {},
    el('div', { class: 'monitor-bar' }, el('label', { class: 'switch' }, toggle, el('span', {}, 'Pantau transaksi ditolak')), desktop),
    status,
    list
  );
  const v = await openDialog('Notifikasi', content, alerts.length ? [{ label: 'Hapus semua', value: 'clear' }, { label: 'Tutup', value: 'close', primary: true }] : undefined, { wide: true });

  if (v === 'clear') alerts = [];
  else alerts = alerts.map((a) => ({ ...a, read: true }));
  store.set('vcg-alerts', alerts);
  updateBell();
}

// ---------- Init ----------

async function init() {
  config = await fetch('/api/config').then((r) => r.json());
  $('#mode-badge').classList.toggle('hidden', !config.mock);
  $('#no-key').classList.toggle('hidden', config.hasKey);

  $('#bin').replaceChildren(...config.bins.map((b) => el('option', { value: b }, binLabel(b))));
  $('#create-amount').min = String(config.minAmount);
  $('#amount-chips').replaceChildren(
    ...QUICK_AMOUNTS.map((a) =>
      el('button', {
        type: 'button',
        class: 'chip',
        'data-amount': String(a),
        onclick: () => {
          $('#create-amount').value = a;
          updateCreateForm();
        },
      }, `$${a}`)
    )
  );

  $('#bin').addEventListener('change', updateCreateForm);
  $('#create-amount').addEventListener('input', updateCreateForm);
  $('#create-form').addEventListener('submit', onCreate);
  $('#refresh').addEventListener('click', loadCards);
  $('#bell').addEventListener('click', openAlerts);
  updateBell();
  $('#search').addEventListener('input', renderCards);
  for (const b of document.querySelectorAll('#status-filter button')) {
    b.addEventListener('click', () => {
      statusFilter = b.dataset.filter;
      for (const x of document.querySelectorAll('#status-filter button')) x.classList.toggle('active', x === b);
      renderCards();
    });
  }
  updateCreateForm();
  if (config.hasKey) loadCards();
}

init();
