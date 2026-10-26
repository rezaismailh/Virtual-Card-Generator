// Dashboard: semua panggilan lewat server lokal (/api/cards/*), bukan langsung ke KripiCard.

const $ = (sel) => document.querySelector(sel);
const money = (n) => (n === undefined || n === null || n === '' ? '-' : `$${Number(n).toFixed(2)}`);
// Perkiraan biaya: $1 + 4% (sesuai docs fund; contoh create di docs juga cocok).
const estFee = (amount) => Math.round((1 + amount * 0.04) * 100) / 100;
const DETAIL_HIDE_MS = 30_000;

let config = { binsNeedDob: [], minAmount: 10 };

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
    if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 7000 : 4000);
}

// Dialog generik. buttons: [{ label, value, primary, danger }]. Resolve dengan value tombol.
function openDialog(title, content, buttons = [{ label: 'Tutup', value: 'close' }]) {
  const dlg = $('#dialog');
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

// ---------- Buat kartu ----------

function updateCreateForm() {
  const bin = $('#bin').value;
  const needDob = config.binsNeedDob.includes(bin);
  $('#dob-field').classList.toggle('hidden', !needDob);
  $('#dob-field input').required = needDob;
  const amount = Number($('#create-amount').value) || 0;
  $('#create-fee').textContent =
    amount >= config.minAmount
      ? `Perkiraan biaya ${money(estFee(amount))}, total dipotong dari wallet ± ${money(amount + estFee(amount))}`
      : `Minimal ${money(config.minAmount)}`;
}

async function onCreate(e) {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  body.amount = Number(body.amount);
  if (!config.binsNeedDob.includes(body.bin)) delete body.dateOfBirth;

  const ok = await confirmDialog(
    'Buat kartu baru?',
    [
      `BIN ${body.bin}, atas nama ${body.name_on_card}.`,
      `Saldo awal ${money(body.amount)} + perkiraan biaya ${money(estFee(body.amount))} akan dipotong dari wallet KripiCard.`,
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
    form.reset();
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

function cardView(c) {
  const frozen = c.status && c.status !== 'active';
  return el(
    'article',
    { class: `vcard ${frozen ? 'frozen' : ''}` },
    el(
      'div',
      { class: 'vcard-face' },
      el('div', { class: 'vcard-top' }, el('span', { class: 'brand' }, c.card_brand || c.card_type || 'Card'), el('span', { class: 'status' }, c.status || '-')),
      el('div', { class: 'pan' }, `•••• •••• •••• ${c.last4 || '????'}`),
      el('div', { class: 'vcard-bottom' }, el('span', {}, c.name_on_card || ''), el('span', { class: 'bal' }, money(c.balance)))
    ),
    el(
      'div',
      { class: 'vcard-actions' },
      el('button', { class: 'btn small', type: 'button', onclick: () => showDetails(c) }, 'Detail'),
      el('button', { class: 'btn small', type: 'button', onclick: () => fundCard(c) }, 'Top-up'),
      el('button', { class: 'btn small', type: 'button', onclick: () => showTransactions(c) }, 'Transaksi'),
      el('button', { class: 'btn small', type: 'button', onclick: () => toggleFreeze(c) }, frozen ? 'Unfreeze' : 'Freeze'),
      el('button', { class: 'btn small danger', type: 'button', onclick: () => deleteCard(c) }, 'Hapus')
    ),
    el('div', { class: 'vcard-meta muted' }, `${c.card_id} · ${c.created_at ? new Date(c.created_at).toLocaleString('id-ID') : ''}`)
  );
}

async function loadCards() {
  const box = $('#cards');
  box.replaceChildren(el('p', { class: 'muted' }, 'Memuat...'));
  try {
    const r = await api('list');
    const list = r.data || [];
    $('#card-count').textContent = `(${list.length})`;
    $('#empty').classList.toggle('hidden', list.length > 0);
    box.replaceChildren(...list.map(cardView));
  } catch (err) {
    box.replaceChildren(el('p', { class: 'error-text' }, `Gagal memuat kartu: ${err.message}`));
  }
}

// ---------- Aksi per kartu ----------

function copyBtn(value, label) {
  return el(
    'button',
    {
      class: 'btn small ghost',
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast(`${label} disalin`);
        } catch {
          toast('Gagal menyalin', true);
        }
      },
    },
    'Salin'
  );
}

async function showDetails(c) {
  const ok = await confirmDialog('Tampilkan detail kartu?', ['Nomor kartu lengkap dan CVV akan tampil di layar selama 30 detik.'], 'Tampilkan');
  if (!ok) return;
  try {
    const d = await api('details', { card_id: c.card_id });
    const pan = String(d.card_number || '').replace(/(\d{4})(?=\d)/g, '$1 ');
    const row = (k, v, raw) => el('div', { class: 'detail-row' }, el('span', { class: 'muted' }, k), el('code', {}, v), raw ? copyBtn(raw, k) : null);
    const content = el(
      'div',
      { class: 'details' },
      row('Nomor', pan, d.card_number),
      row('Expiry', d.expiry, d.expiry),
      row('CVV', d.cvv, d.cvv),
      row('Saldo', money(d.balance)),
      row('Status', d.status)
    );
    const dlg = $('#dialog');
    const timer = setTimeout(() => dlg.open && dlg.close('timeout'), DETAIL_HIDE_MS);
    await openDialog(`Kartu •••• ${c.last4}`, content);
    clearTimeout(timer);
    $('#dialog-content').replaceChildren();
  } catch (err) {
    toast(err.message, true);
  }
}

async function fundCard(c) {
  const input = el('input', { type: 'number', min: String(config.minAmount), step: '0.01', value: String(config.minAmount), required: '' });
  const feeLine = el('p', { class: 'fee' });
  const update = () => {
    const a = Number(input.value) || 0;
    feeLine.textContent = a >= config.minAmount ? `Biaya ${money(estFee(a))} ($1 + 4%), total ${money(a + estFee(a))}` : `Minimal ${money(config.minAmount)}`;
  };
  input.addEventListener('input', update);
  update();

  const v = await openDialog(`Top-up •••• ${c.last4}`, el('div', {}, el('label', {}, 'Jumlah (USD)', input), feeLine), [
    { label: 'Batal', value: 'cancel' },
    { label: 'Top-up', value: 'ok', primary: true },
  ]);
  if (v !== 'ok') return;
  const amount = Number(input.value);
  if (!(amount >= config.minAmount)) return toast(`Minimal ${money(config.minAmount)}`, true);

  try {
    const r = await api('fund', { card_id: c.card_id, amount });
    toast(`Top-up berhasil. Total dipotong ${money(r.data?.total_debited)}.`);
    loadCards();
  } catch (err) {
    toast(err.message, true);
  }
}

async function toggleFreeze(c) {
  const action = c.status === 'active' ? 'freeze' : 'unfreeze';
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
      'Kartu dihapus permanen dan tidak bisa dikembalikan.',
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
    const content = txs.length
      ? el(
          'div',
          { class: 'table-wrap' },
          el(
            'table',
            {},
            el('thead', {}, el('tr', {}, ['Tanggal', 'Tipe', 'Merchant', 'Jumlah', 'Status'].map((h) => el('th', {}, h)))),
            el(
              'tbody',
              {},
              txs.map((t) =>
                el(
                  'tr',
                  { title: t.reason || '' },
                  el('td', {}, t.date),
                  el('td', {}, t.type),
                  el('td', {}, t.merchant),
                  el('td', { class: 'num' }, `${Number(t.amount).toFixed(2)} ${t.currency || ''}`),
                  el('td', { class: t.status === 'success' ? 'ok-text' : 'error-text' }, t.status)
                )
              )
            )
          )
        )
      : el('p', { class: 'muted' }, 'Belum ada transaksi.');
    await openDialog(`Transaksi •••• ${c.last4} · saldo ${money(r.data?.balance)}`, content);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Init ----------

async function init() {
  config = await fetch('/api/config').then((r) => r.json());
  $('#mode-badge').classList.toggle('hidden', !config.mock);
  $('#no-key').classList.toggle('hidden', config.hasKey);

  $('#bin').replaceChildren(
    ...config.bins.map((b) => el('option', { value: b }, config.binsNeedDob.includes(b) ? `${b} (perlu tanggal lahir)` : b))
  );
  $('#create-amount').min = String(config.minAmount);
  $('#bin').addEventListener('change', updateCreateForm);
  $('#create-amount').addEventListener('input', updateCreateForm);
  $('#create-form').addEventListener('submit', onCreate);
  $('#refresh').addEventListener('click', loadCards);
  updateCreateForm();
  if (config.hasKey) loadCards();
}

init();
