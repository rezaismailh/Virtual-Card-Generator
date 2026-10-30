// fetch palsu yang meniru API KripiCard, untuk mode demo (MOCK=1) dan test.
// Tidak ada uang sungguhan dan tidak ada request keluar.

const { ENDPOINTS } = require('./kripicard');

const fee = (amount) => Math.round((1 + amount * 0.04) * 100) / 100;

function createMockFetch() {
  const cards = new Map();
  let seq = 0;
  const byPath = Object.fromEntries(Object.entries(ENDPOINTS).map(([k, v]) => [v, k]));

  const find = (b) =>
    cards.get(b.card_id) || [...cards.values()].find((c) => b.last4 && c.last4 === b.last4);

  const handlers = {
    create(b) {
      seq += 1;
      const last4 = String(1000 + seq).slice(-4);
      const card = {
        card_id: `MR_MOCK${String(seq).padStart(10, '0')}`,
        name_on_card: b.name_on_card,
        last4,
        card_brand: String(b.bin).startsWith('4') ? 'Visa' : 'MasterCard',
        card_type: 'VIRTUAL',
        status: 'active',
        balance: b.amount,
        created_at: new Date().toISOString(),
        bin: b.bin,
        transactions: [],
      };
      cards.set(card.card_id, card);
      const f = fee(b.amount);
      return {
        success: true,
        message: 'Card created successfully',
        card_id: card.card_id,
        last_4: last4,
        bin: b.bin,
        amount: b.amount,
        fee: f,
        total_charged: Math.round((b.amount + f) * 100) / 100,
      };
    },
    fund(b) {
      const c = find(b);
      if (!c) return { success: false, message: 'Card not found' };
      c.balance += b.amount;
      const f = fee(b.amount);
      return {
        success: true,
        message: 'Card funded successfully',
        data: { card_id: c.card_id, amount: b.amount, fee: f, total_debited: b.amount + f },
      };
    },
    details(b) {
      const c = find(b);
      if (!c) return { success: false, message: 'Card not found' };
      return {
        success: true,
        card_number: `${c.bin}`.padEnd(12, '0') + c.last4,
        expiry: '12/29',
        cvv: '000',
        balance: c.balance,
        status: c.status,
      };
    },
    freeze(b) {
      const c = find(b);
      if (!c) return { success: false, message: 'Card not found' };
      c.status = b.action === 'freeze' ? 'frozen' : 'active';
      return { success: true, message: `Card ${b.action}d successfully` };
    },
    delete(b) {
      const c = find(b);
      if (!c) return { success: false, message: 'Card not found' };
      cards.delete(c.card_id);
      const kept = Math.min(2, c.balance);
      const refunded = Math.round((c.balance - kept) * 100) / 100;
      return {
        success: true,
        message: `Card deleted. $${refunded.toFixed(2)} refunded to your wallet (after a $${kept.toFixed(2)} deletion fee).`,
        refunded,
        fee: kept,
      };
    },
    list() {
      const data = [...cards.values()].map(({ transactions, bin, ...c }) => c);
      return { success: true, total: data.length, data };
    },
    transactions(b) {
      const c = find(b);
      if (!c) return { success: false, message: 'Card not found' };
      return {
        success: true,
        data: {
          card_id: c.card_id,
          balance: c.balance,
          total_transactions: c.transactions.length,
          transactions: c.transactions,
        },
      };
    },
  };

  async function mockFetch(url, opts) {
    const action = byPath[new URL(url).pathname];
    const body = JSON.parse(opts.body);
    const data = handlers[action] ? handlers[action](body) : { success: false, message: 'Not found' };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    };
  }

  // Khusus demo: catat transaksi di kartu. Kalau saldo tidak cukup, transaksi ditolak
  // dengan format yang sama seperti contoh di docs KripiCard.
  mockFetch.charge = (cardId, merchant, amount) => {
    const c = cards.get(cardId);
    if (!c) return false;
    const ok = c.status === 'active' && c.balance >= amount;
    if (ok) c.balance = Math.round((c.balance - amount) * 100) / 100;
    c.transactions.unshift({
      date: new Date().toISOString().replace('T', ' ').slice(0, 19),
      type: 'Authorize',
      merchant,
      amount,
      currency: 'USD',
      status: ok ? 'success' : 'failed',
      reason: ok ? 'Approved or completed successfully' : c.status !== 'active' ? 'Card frozen' : 'Balance insufficient',
      reason_code: ok ? 'approved' : c.status !== 'active' ? 'card_frozen' : 'insufficient_funds',
      reason_source: 'provider',
    });
    return true;
  };

  return mockFetch;
}

module.exports = { createMockFetch };
