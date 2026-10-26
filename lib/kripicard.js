// Client tipis untuk API Virtual Cards KripiCard.
// Semua endpoint POST JSON, api_key ditaruh di body.

const BASE_URL = 'https://appapi.kripicard.com';

// action -> path endpoint
const ENDPOINTS = {
  create: '/api/external/cards/createcard',
  fund: '/api/external/cards/fundcard',
  details: '/api/external/cards/carddetails',
  freeze: '/api/external/premium/Freeze_Unfreeze',
  delete: '/api/external/cards/deletecard',
  list: '/api/external/cards/list',
  transactions: '/api/external/cards/transactions',
};

// Field yang boleh diteruskan dari browser per action (selain api_key).
const ALLOWED_FIELDS = {
  create: ['bin', 'amount', 'name_on_card', 'email', 'dateOfBirth'],
  fund: ['card_id', 'last4', 'amount'],
  details: ['card_id', 'last4'],
  freeze: ['card_id', 'action'],
  delete: ['card_id'],
  list: [],
  transactions: ['card_id'],
};

// BIN yang wajib dateOfBirth (US, Singapore, UK).
const BINS_NEED_DOB = ['537872', '533171', '246001'];
const BINS = ['539502', '525847', '537872', '533171', '246001'];
const MIN_AMOUNT = 10;

function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    const v = body[f];
    if (v !== undefined && v !== null && v !== '') out[f] = v;
  }
  return out;
}

// Validasi sebelum memanggil API, supaya tidak buang request (dan uang).
// Mengembalikan pesan error, atau null kalau valid.
function validate(action, p) {
  const needCard = () => (p.card_id ? null : 'card_id wajib diisi');
  const needAmount = () => {
    const n = Number(p.amount);
    if (!Number.isFinite(n) || n < MIN_AMOUNT) return `amount minimal $${MIN_AMOUNT}`;
    p.amount = n;
    return null;
  };

  switch (action) {
    case 'create': {
      if (!BINS.includes(String(p.bin))) return 'BIN tidak dikenal';
      const e = needAmount();
      if (e) return e;
      if (!p.name_on_card || String(p.name_on_card).trim().length < 2) {
        return 'name_on_card minimal 2 karakter';
      }
      if (BINS_NEED_DOB.includes(String(p.bin))) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth || '')) {
          return 'dateOfBirth (YYYY-MM-DD) wajib untuk BIN ini';
        }
      } else {
        delete p.dateOfBirth;
      }
      return null;
    }
    case 'fund':
      if (!p.card_id && !p.last4) return 'card_id atau last4 wajib diisi';
      return needAmount();
    case 'details':
      return p.card_id || p.last4 ? null : 'card_id atau last4 wajib diisi';
    case 'freeze':
      if (!['freeze', 'unfreeze'].includes(p.action)) return 'action harus freeze atau unfreeze';
      return needCard();
    case 'delete':
    case 'transactions':
      return needCard();
    case 'list':
      return null;
    default:
      return 'action tidak dikenal';
  }
}

async function callKripicard(action, body, { apiKey, baseUrl = BASE_URL, fetchImpl = fetch } = {}) {
  const params = pick(body || {}, ALLOWED_FIELDS[action] || []);
  const err = validate(action, params);
  if (err) return { status: 400, data: { success: false, message: err } };

  const res = await fetchImpl(baseUrl + ENDPOINTS[action], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ api_key: apiKey, ...params }),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, message: `Respons bukan JSON (HTTP ${res.status})` };
  }
  return { status: res.ok ? 200 : res.status, data };
}

module.exports = { ENDPOINTS, BINS, BINS_NEED_DOB, MIN_AMOUNT, validate, callKripicard };
