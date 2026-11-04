# Visual Kantor JagoAI

Folder ini milik Darren. Isinya hanya visual tiga dimensi kantor. Tidak ada backend di sini,
dan tidak ada berkas tenant. Semua data masuk lewat HTTP.

## Menjalankan

```bash
cd visual
npm install
npm run dev
```

Buka `http://localhost:4600`. Jangan pakai `127.0.0.1:4600`, server pembangunan hanya
mendengar di IPv6.

Data diambil dari `/api/state` lewat proxy ke server kantor di `127.0.0.1:4500`. Kalau server
itu tidak hidup, halaman otomatis memakai `public/data/contoh-state.json`, rekaman nyata dari
kantor yang sudah berjalan. Jadi visual bisa dikerjakan tanpa menunggu backend siap.

Kalau ingin melihat hasil build:

```bash
npm run build
npx vite preview --port 4600
```

## Isi folder

```
index.html            kerangka halaman dan HUD
src/main.js           adegan three.js, meja, karakter, animasi
public/data/          rekaman contoh, dipakai kalau API tidak menjawab
vite.config.js        port 4600 dan proxy /api ke 4500
```

## Aturan yang menjaga dua pekerjaan tidak bertabrakan

1. Hanya membaca. Visual tidak menulis apa pun ke server dan tidak membuka berkas di `tenant/`.
2. Bentuk data mengikuti `docs/kontrak-api.md`. Kalau butuh kolom baru, minta ditambahkan ke
   backend lewat dokumen itu, jangan menebak nama kolom.
3. Data kosong tetap digambar sebagai kantor kosong, bukan layar galat.
4. Semua teks di layar memakai bahasa Indonesia.
5. Berkas backend (`app/`, `tests/`, `tenant/`) tidak diubah dari sini. Kalau ada yang perlu
   diubah di sana, catat di `docs/kontrak-api.md` bagian usulan.

## Keadaan sekarang

Sepuluh karakter digambar di meja masing-masing, posisi dibaca dari kolom `meja`
(`tetap:7` jadi meja bernomor, `ruang:brief` jadi ruangan tersendiri). Warna badan mengikuti
keadaan: `type` jingga, `think` biru, `review` ungu, `ship` hijau, `error` merah. Kamera bisa
digeser dan berputar sendiri saat diam.

## Arah berikutnya

- ruangan lebih hidup: tanaman, jendela, lampu per meja, papan tulis dinding
- animasi kerja lebih jelas: mengetik, rapat di ruang brief, bawa kopi
- papan besar di dinding yang menampilkan `/api/papan`
- balon percakapan dari `events` terakhir tiap karyawan
