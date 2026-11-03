# jagoai-virtual

Kantor virtual untuk tim sosial media berbasis agent AI. Fase 0 berisi mesinnya saja: klien gerbang model, pembaca brief karyawan, meteran token, dan pencatat event.

Dokumen rancangan lengkap ada di vault Obsidian `Proyek/jagoai-virtual/`.

## Menjalankan uji

```bash
python -m unittest discover -s tests -t . -v
```

Semua uji memakai gateway tiruan di `tests/fake_gateway.py`. Tidak butuh internet dan tidak butuh kunci.

## Mengisi kunci

Template lengkap ada di `.env.example`, sudah berkomentar per bagian.

```bash
cp .env.example tenant/jagoai/.env
```

Isi `JAGOAI_ROUTER_KEY` dengan kunci gerbang. Berkas `.env` tidak masuk git.

Periksa tanpa membuka nilainya:

```bash
python -m app.cli env-check
```

Keluaran berisi nama, wajib atau opsional, ada atau kosong, dan panjang nilai. Tidak ada nilai yang dicetak. Kode keluar 0 kalau semua wajib terisi, 7 kalau ada yang kurang.

Aturannya satu: `.env` hanya berisi rahasia, `office.toml` berisi alamat dan nama.

| Variabel | Wajib | Dipakai |
|---|---|---|
| `JAGOAI_ROUTER_KEY` | ya, sekarang | `models` dan `run` |
| `JAGOAI_CDN_API_KEY` | tidak | Fase 2, unggah bahan |
| `JAGOAI_CDN_JWT_TOKEN` | tidak | Fase 2, unduh bahan berotorisasi |
| `JAGOAI_THREADS_TOKEN` | tidak | Fase 4, unggah dan balasan |
| `JAGOAI_INSTAGRAM_TOKEN` | tidak | Fase 4 |
| `JAGOAI_TIKTOK_TOKEN` | tidak | Fase 4 |

Alamat dan nama ada di `tenant/jagoai/office.toml`, bukan di `.env`:

| Bidang | Isi |
|---|---|
| `gerbang.base_url` | `https://9router.jagoai.dev/v1` |
| `gerbang.kunci_env` | nama variabel kunci gerbang |
| `bahan.cdn_url` | `https://cdn.kroombox.com` |
| `bahan.cdn_proyek` | `jagoai-sosmed` |
| `bahan.cdn_kunci_env`, `bahan.cdn_jwt_env` | nama variabel kredensial CDN |
| `kanal.threads_env`, `kanal.instagram_env`, `kanal.tiktok_env` | nama variabel token kanal |

## Melihat daftar model

```bash
python -m app.cli models
```

Daftar disimpan di `tenant/jagoai/state/models.json`. Salin id yang dipakai ke `model` pada `tenant/jagoai/office.toml`.

## Menjalankan satu shift

```bash
python -m app.cli run --agent jagoai:nadia --tugas "tulis tiga varian hook untuk slot 2026-11-05-ig-01"
```

Keluaran: teks balasan, lalu `shift=... token=masuk+keluar`. Setiap shift menulis tiga event ke `tenant/jagoai/events.jsonl`: `shift_start`, `llm_call`, `shift_end`.

## Penjadwal

```bash
python -m app.cli jadwal --sekali                 # sekali jalan, untuk yang sudah jatuh tempo
python -m app.cli jadwal                          # berputar tiap 60 detik
python -m app.cli jadwal --sekarang 2026-11-04T09:05 --sekali   # uji waktu
```

Slot ada di `tenant/jagoai/jadwal.toml`. Setiap slot punya `jam`, `agent`, dan `tugas`.

| Aturan | Alasannya |
|---|---|
| Slot yang sudah jalan dicatat di `tenant/jagoai/state/jadwal.json` | menjalankan ulang proses tidak mengulang shift |
| Slot yang lewat lebih dari 180 menit ditandai `terlewat`, tidak dijalankan | pekerjaan kemarin bukan pekerjaan hari ini |
| Catatan dikunci per tanggal, agen, dan jam | hari berikutnya tidak terhalang catatan kemarin |
| Satu slot gagal tidak menghentikan slot lain | satu kegagalan tidak membekukan kantor |

Penjadwal tidak melewati penjaga: batas tenant, gelembung panggilan, dan batas shift tetap berlaku. Kalau ditunda, slot dicatat `ditunda` beserta alasannya.
## Penjaga keluaran

Setiap balasan diperiksa sebelum dicatat, tiga hal saja:

| Jenis | Contoh yang ditolak |
|---|---|
| identitas | menyebut CodeBuddy, ChatGPT, atau menyebut diri asisten AI |
| tahun | menyebut tahun yang tidak ada di brief dan bukan tahun berjalan |
| angka | persentase atau jumlah orang yang tidak ada di brief |
| larangan_brief | memakai kata yang dikurung backtick di bagian Larangan khusus |
| topik | balasan tidak menyentuh satu kata kunci pun dari tugas |

Empat yang pertama menghentikan dan memicu satu kali perbaikan. `topik` hanya peringatan, karena ia menebak dari kata kunci dan bisa salah; hasilnya dicatat dengan catatan `topik` dan perlu ditinjau manusia atau Omar.

Kalau melanggar, shift mencoba sekali lagi dengan pesan perbaikan. Kalau masih melanggar, hasil dicatat apa adanya dengan catatan `keluaran_ditolak`, tidak dibuang dan tidak disembunyikan.

Penjaga ini bukan penilai mutu. Omar tetap penentu lulus atau tolak.
## Melihat kantor

```bash
python -m app.server --port 4500
```

Buka `http://127.0.0.1:4500`. Halaman menyegarkan diri tiap 2 detik dari `tenant/jagoai/events.jsonl`.

| Alamat | Isi |
|---|---|
| `/` | kanvas kantor, meja, karakter, dan kartu karyawan |
| `/api/state` | keadaan tiap karyawan, token hari ini, lima event terakhir |
| `/api/health` | tanda hidup |

State berasal dari event nyata. Kalau tidak ada event sama sekali, karyawan digambar tidur, bukan pura-pura bekerja.

Seni masih sementara: kotak warna, bukan sprite. Peta meja mengikuti `Peta Kantor jagoai-virtual` di vault, nomor meja diambil dari `meja = "tetap:N"`.
## Aturan

- Kunci hanya dibaca dari `.env` lewat nama variabel, tidak pernah ditulis ke event, log, atau layar.
- Brief karyawan menolak kredensial, harga, dan klaim. Kata terlarang boleh dikutip dengan backtick.
- Tiga penjaga biaya, dan hanya dua yang menghentikan sebelum panggilan:
  - `batas_tenant` (`batas_harian_tenant` di office.toml), keras, menyangkut tagihan organisasi
  - gelembung panggilan, keras, lebih dari 12 panggilan dalam 10 menit per karyawan
  - `batas_shift` per karyawan, keras tetapi diperiksa setelah panggilan, menangkap konteks membengkak
- `rencana_token_harian` per karyawan hanya untuk laporan, tidak menghentikan apa pun.
- Kalau shift tertunda, ada event `shift_tertunda` dengan alasan, dan slot bisa dijalankan ulang.
- Semua uji berjalan berurutan karena gateway tiruan memakai kelas handler bersama.
