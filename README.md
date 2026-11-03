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

## Persetujuan dan antrean unggah

```bash
python -m app.cli mira    --tanggal 2026-11-09                    # apa yang menunggu dan apa yang tertahan
python -m app.cli mira    --tanggal 2026-11-09 --setujui --oleh salman
python -m app.cli antrean --tanggal 2026-11-09
```

| Aturan | Siapa yang menegakkan |
|---|---|
| Mira tidak menyetujui apa pun, hanya menyiapkan paket | `app/mira.py` |
| Konten berstatus tolak atau manual tidak bisa disetujui | `mira.setujui_konten` menolak dengan `ValueError` |
| Persetujuan wajib menyebut nama | `oleh` kosong ditolak |
| Antrean hanya menerima yang sudah disetujui | `app/antrean.py` |
| Tinjauan tolak tidak masuk antrean walau ada berkas persetujuan | diperiksa ulang di antrean |
| Batas 20 balasan sehari | dihitung di antrean |
| Tanpa token kanal, status `siap_unggah_manual` | bukan disembunyikan |

Persetujuan disimpan di `tenant/jagoai/keluaran/persetujuan/<tanggal>.json`, antrean di `keluaran/antrean/<tanggal>.json`.
## Jalur percakapan

```bash
python -m app.cli percakapan --kanal threads
python -m app.cli percakapan --setujui sampel-1 --oleh salman
```

Sumber percakapan yang jalan sekarang adalah berkas yang diisi manusia: `tenant/jagoai/masuk/percakapan.jsonl`, satu objek JSON per baris dengan `id`, `akun`, `kanal`, `teks`, `tautan`.

| Penyaring Bayu | Alasan ditolak |
|---|---|
| kanal tidak aktif | hanya kanal yang diminta yang diproses |
| teks kurang dari 12 huruf | tidak cukup untuk dinilai |
| di luar bidang | tidak menyentuh kata kunci `[merek]` |
| tanpa tautan asal | tidak bisa dilacak kembali |
| akun sudah dibalas dalam 7 hari | mencegah mengejar orang yang sama |

| Aturan Sinta | Angka |
|---|---|
| Balasan per hari | 20 |
| Jeda antar balasan | 3 menit |
| Kemiripan antar draf | di atas 85 persen ditolak |
| Penjaga keluaran | identitas, tahun, angka, larangan brief |

Draf disimpan di `tenant/jagoai/keluaran/percakapan/<tanggal>.json` dengan status `menunggu_persetujuan`. Tidak ada pengiriman di tahap ini. Persetujuan mengubah status menjadi `disetujui` dan mencatat `disetujui_oleh`.

Sumber API sudah ada pintunya, tetapi menolak jalan tanpa `JAGOAI_THREADS_TOKEN`. Pesannya jelas, bukan diam-diam kosong.

Berkas `masuk/percakapan.jsonl` yang ada sekarang berisi enam baris **sampel** bertanda `sumber: sampel`, dipakai untuk menguji pipa. Itu bukan percakapan Threads yang sungguhan.
## Tinjauan mutu

```bash
python -m app.cli tinjau --tanggal 2026-11-09 --pekan 2026-11-09
```

Dua lapis, dan keduanya harus lewat:

| Lapis | Isi | Sifat |
|---|---|---|
| Teknis | video ada, resolusi sesuai rasio, durasi 15 sampai 60 detik, h264, faststart, laporan desain lulus, subjudul ada | dipastikan |
| Isi | model menilai klaim tanpa dasar, larangan brief, dan kelayakan tayang, wajib menjawab JSON | dinilai |

Aturan yang tidak boleh dilunakkan:

- Putusan yang bentuknya tidak sah tidak pernah menjadi lulus. Statusnya `manual`.
- `lulus: true` dari model tetap ditolak kalau ada temuan bertingkat `tolak`.
- Angka berunit di naskah yang tidak ada di brief dicatat sebagai `angka_tanpa_dasar`, termasuk angka yang ditulis dengan kata seperti `tiga site`.

Hasil disimpan di `tenant/jagoai/keluaran/tinjauan/<tanggal>.json` dan event `review_pass` atau `review_fail` masuk `events.jsonl`.

Kode keluar: 0 lulus, 6 tolak, 7 manual.
## Video

```bash
python -m app.cli video --tanggal 2026-11-09 --pekan 2026-11-09
python -m app.cli video --tanggal 2026-11-09 --pekan 2026-11-09 --ukuran 1x1
```

Menyusun mp4 dari slide yang sudah lulus periksa desain, lalu mengukurnya dengan ffprobe.

| Periksa | Angka |
|---|---|
| Resolusi | 1080x1920 untuk 9:16, 1080x1080 untuk 1:1 |
| Durasi | 15 sampai 60 detik |
| Kodek | h264, piksel `yuv420p` |
| Faststart | atom `moov` harus sebelum `mdat` |
| Audio | harus ada aliran audio |
| Kenyaringan | dilaporkan hanya kalau ada isinya. Audio kosong ditulis kosong, tidak disebut -14 LUFS |

Keluaran di `tenant/jagoai/keluaran/video/<tanggal>/`: berkas mp4 dan `subjudul.srt`.

Catatan jujur: video masih berupa slide diam berdurasi empat detik per slide, tanpa rekaman produk dan tanpa suara. Yang dibuktikan di sini adalah pipa render dan pemeriksaannya, bukan mutu tayang.
## Desain feed

```bash
python -m app.cli desain --pekan 2026-11-09 --tanggal 2026-11-09 --format carousel
```

Membaca naskah Nadia, menggambar satu PNG per slide, lalu mengukur hasilnya dari piksel:

| Aturan | Angka | Diukur dari |
|---|---|---|
| Margin aman | 64 piksel di kiri, kanan, atas | kotak batas piksel yang berbeda dari latar |
| Zona bawah | 120 piksel kosong | jarak piksel terbawah ke tepi |
| Kontras teks | 4,5:1 | rumus luminansi WCAG pada palet |
| Ukuran huruf | judul 62, tubuh 44, kaki 30 piksel | ditetapkan saat menggambar |

Keluaran: `tenant/jagoai/keluaran/desain/<tanggal>/slide-01.png` sampai slide terakhir, ditambah `laporan.json` berisi margin tiap slide, rasio kontras, dan `lulus` benar atau salah.

Kode keluar 0 berarti lulus, 6 berarti ada pelanggaran. Laporan menyebut angka pelanggarannya, bukan hanya gagal.

Catatan jujur: palet masih sementara, diambil dari `PALET` di `app/desain.py`, karena warna brand kit Canva belum bisa dibaca lewat MCP. Unggahan ke Canva menghasilkan aset PDF di pustaka, bukan desain yang bisa disunting per elemen.
## Papan kerja dan tugas berkas

```bash
python -m app.cli tugas --agent rian  --pekan 2026-11-09
python -m app.cli tugas --agent nadia --pekan 2026-11-09 --tanggal 2026-11-09 --topik "..."
python -m app.server --port 4500     # lalu buka http://127.0.0.1:4500/papan
```

| Berkas | Isi |
|---|---|
| `tenant/jagoai/keluaran/jadwal/<pekan>.json` | empat slot, tiap slot tanggal, kanal, format, topik, alasan |
| `tenant/jagoai/keluaran/naskah/<pekan>/<tanggal>-<slug>.md` | naskah dengan kepala `status: draf` dan `disetujui_oleh` kosong |

Aturan yang ditegakkan sebelum berkas ditulis:

| Periksa | Kalau gagal |
|---|---|
| Balasan harus larik JSON yang sah | diulang sekali, lalu berhenti dengan kode 9 |
| Minimal tiga slot, tanggal `YYYY-MM-DD`, tidak dobel, format dan kanal dikenal | diulang sekali dengan daftar kesalahan |
| Lebih dari separuh topik harus menyentuh kata kunci bidang di `[merek]` | diulang sekali, supaya jadwal tidak keluar dari bidang produk |
| Naskah wajib punya bagian Hook, Naskah, Caption, Catatan | diulang sekali dengan daftar bagian yang kurang |

Tidak ada berkas setengah jadi. Kalau dua percobaan gagal, tidak ada yang ditulis dan pesan kesalahannya jelas.
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
