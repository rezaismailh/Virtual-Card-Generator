// Server lokal: menyajikan dashboard dan meneruskan request ke KripiCard.
// API key hanya ada di sini (dari .env), tidak pernah dikirim ke browser.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { callKripicard, ENDPOINTS, BINS, BINS_NEED_DOB, MIN_AMOUNT } = require('./lib/kripicard');
const { createMockFetch } = require('./lib/mock');

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const MAX_BODY = 16 * 1024;

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body terlalu besar'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Body bukan JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createApp({ apiKey, fetchImpl, mock = false, port }) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

  return http.createServer(async (req, res) => {
    // Tolak Host asing (DNS rebinding) dan Origin asing (situs lain menembak localhost).
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { success: false, message: 'Host ditolak' });
    const origin = req.headers.origin;
    if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) {
      return send(res, 403, { success: false, message: 'Origin ditolak' });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
      });
      return fs.createReadStream(path.join(PUBLIC_DIR, file)).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { mock, hasKey: Boolean(apiKey), bins: BINS, binsNeedDob: BINS_NEED_DOB, minAmount: MIN_AMOUNT });
    }

    const m = url.pathname.match(/^\/api\/cards\/([a-z]+)$/);
    if (req.method === 'POST' && m && ENDPOINTS[m[1]]) {
      // Header khusus + JSON memaksa preflight CORS, jadi halaman lain tidak bisa memanggil ini.
      if (req.headers['x-vcg'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) {
        return send(res, 403, { success: false, message: 'Request ditolak' });
      }
      if (!apiKey) return send(res, 500, { success: false, message: 'KRIPICARD_API_KEY belum diisi di .env' });

      try {
        const body = await readJson(req);
        const { status, data } = await callKripicard(m[1], body, { apiKey, fetchImpl });
        // Log tanpa isi respons: details berisi nomor kartu dan CVV.
        console.log(`[${new Date().toISOString()}] ${m[1]} -> ${status} ${data.success ? 'ok' : 'gagal'}`);
        return send(res, status, data);
      } catch (e) {
        const msg = e.name === 'TimeoutError' ? 'KripiCard tidak merespons (timeout)' : e.message;
        console.log(`[${new Date().toISOString()}] ${m[1]} -> error: ${msg}`);
        return send(res, 502, { success: false, message: msg });
      }
    }

    send(res, 404, { success: false, message: 'Tidak ditemukan' });
  });
}

if (require.main === module) {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch {
    // .env opsional di mode mock
  }
  const port = Number(process.env.PORT) || 3000;
  const mock = process.env.MOCK === '1' || process.argv.includes('--mock');
  const apiKey = mock ? 'mock-key' : process.env.KRIPICARD_API_KEY;
  const app = createApp({ apiKey, fetchImpl: mock ? createMockFetch() : fetch, mock, port });

  app.listen(port, '127.0.0.1', () => {
    console.log(`Virtual Card Generator jalan di http://localhost:${port}${mock ? '  (MODE DEMO: data palsu)' : ''}`);
    if (!apiKey) console.log('Peringatan: KRIPICARD_API_KEY belum diisi. Salin .env.example ke .env lalu isi.');
  });
}

module.exports = { createApp };
