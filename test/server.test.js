const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const { createMockFetch } = require('../lib/mock');
const { validate } = require('../lib/kripicard');

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

const call = (action, body, headers = {}) =>
  fetch(`${BASE}/api/cards/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VCG': '1', ...headers },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, data: await r.json() }));

before(async () => {
  server = createApp({ apiKey: 'test', fetchImpl: createMockFetch(), mock: true, port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});
after(() => server.close());

test('validasi create', () => {
  assert.match(validate('create', { bin: '111111', amount: 10, name_on_card: 'Ab' }), /BIN/);
  assert.match(validate('create', { bin: '539502', amount: 5, name_on_card: 'Ab' }), /minimal/);
  assert.match(validate('create', { bin: '539502', amount: 10, name_on_card: 'A' }), /2 karakter/);
  assert.match(validate('create', { bin: '537872', amount: 10, name_on_card: 'Ab' }), /dateOfBirth/);
  assert.equal(validate('create', { bin: '537872', amount: 10, name_on_card: 'Ab', dateOfBirth: '1990-01-15' }), null);
  assert.equal(validate('create', { bin: '539502', amount: '20', name_on_card: 'Ab' }), null);
});

test('alur lengkap: create, list, fund, details, freeze, transactions, delete', async () => {
  const c = await call('create', { bin: '539502', amount: 20, name_on_card: 'John Alex' });
  assert.equal(c.data.success, true);
  assert.equal(c.data.total_charged, 21.8);
  const id = c.data.card_id;

  let l = await call('list');
  assert.equal(l.data.total, 1);

  const f = await call('fund', { card_id: id, amount: 50 });
  assert.equal(f.data.data.fee, 3);

  const d = await call('details', { card_id: id });
  assert.equal(d.data.balance, 70);

  await call('freeze', { card_id: id, action: 'freeze' });
  l = await call('list');
  assert.equal(l.data.data[0].status, 'frozen');

  const t = await call('transactions', { card_id: id });
  assert.equal(t.data.success, true);

  const del = await call('delete', { card_id: id });
  assert.equal(del.data.refunded, 68);
  l = await call('list');
  assert.equal(l.data.total, 0);
});

test('input tidak valid ditolak sebelum ke API', async () => {
  const r = await call('fund', { card_id: 'x', amount: 1 });
  assert.equal(r.status, 400);
});

test('request tanpa header X-VCG ditolak', async () => {
  const r = await fetch(`${BASE}/api/cards/list`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('Origin asing ditolak', async () => {
  const r = await call('list', {}, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('api_key dari browser tidak bisa menimpa key server', async () => {
  let sent;
  const spyServer = createApp({
    apiKey: 'server-key',
    port: PORT + 1,
    fetchImpl: async (url, opts) => {
      sent = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async () => '{"success":true,"data":[]}' };
    },
  });
  await new Promise((r) => spyServer.listen(PORT + 1, '127.0.0.1', r));
  await fetch(`http://127.0.0.1:${PORT + 1}/api/cards/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VCG': '1' },
    body: JSON.stringify({ api_key: 'injected' }),
  });
  spyServer.close();
  assert.equal(sent.api_key, 'server-key');
});
