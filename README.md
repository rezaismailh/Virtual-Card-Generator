# Virtual Card Generator

Dashboard lokal untuk membuat dan mengelola virtual Mastercard di akun KripiCard sendiri, lewat [API KripiCard](https://www.kripicard.com/api-docs).

Fitur: buat kartu, top-up, lihat detail (nomor/expiry/CVV), freeze/unfreeze, riwayat transaksi, hapus kartu.

## Menjalankan

Butuh Node.js 22 ke atas. Tidak ada dependency yang perlu di-install.

1. Salin `.env.example` menjadi `.env`, lalu isi `KRIPICARD_API_KEY` dengan API key dari Settings di kripicard.com.
2. Jalankan `start.bat` (atau `npm start`), lalu buka http://localhost:3000.

Mode demo dengan data palsu, tanpa API key dan tanpa uang sungguhan:

```
start.bat demo
```

atau `npm run demo`.

## Keamanan

- API key hanya dibaca server dari `.env` dan tidak pernah dikirim ke browser. `.env` tidak ikut ke-commit.
- Server hanya mendengarkan di `127.0.0.1`, jadi tidak bisa diakses dari perangkat lain.
- Request dari situs lain ke localhost ditolak (cek Host, Origin, dan header khusus `X-VCG`).
- Detail kartu (nomor dan CVV) hanya diambil saat diminta, tampil 30 detik, dan tidak dicatat di log.
- Buat kartu, top-up, dan hapus kartu selalu minta konfirmasi dulu, karena memotong saldo wallet.

## Biaya (menurut docs KripiCard)

- Top-up: $1.00 + 4%. Biaya pembuatan kartu di contoh docs juga mengikuti rumus ini, jadi angka di dashboard hanya perkiraan. Angka pastinya tetap dari respons API.
- Hapus kartu: sisa saldo dikembalikan dikurangi $2.00.

## Test

```
npm test
```
