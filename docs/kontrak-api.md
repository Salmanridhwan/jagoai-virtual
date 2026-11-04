# Kontrak API kantor

Dokumen ini adalah batas antara dua pekerjaan yang berjalan bersamaan:

- **backend** mengurus proses, data, agen, dan penyimpanan, lalu menyajikan JSON di alamat di bawah.
- **visual 3D** hanya membaca JSON itu dan menggambar kantor. Visual tidak pernah menulis berkas tenant.

Aturan yang membuat keduanya bisa berjalan tanpa saling menunggu:

1. Bentuk JSON di halaman ini adalah janji. Kolom boleh ditambah, tidak boleh dihapus atau diganti nama tanpa memperbarui dokumen ini lebih dulu.
2. Visual tidak memanggil berkas di dalam `tenant/` secara langsung. Semua lewat HTTP.
3. Kalau data kosong, server tetap membalas 200 dengan larik kosong. Visual wajib menangani keadaan kosong, bukan menunggu data ada.
4. Semua alamat di bawah ini tanpa awalan tambahan. Server kantor berjalan di `127.0.0.1:4500` saat lokal, dan di `office:4500` di dalam tumpukan Docker.

## GET /api/health

```json
{"ok": true, "tenant": "jagoai"}
```

## GET /api/state

Keadaan kantor sekarang, dipakai visual untuk menggambar karakter.

```json
{
  "tenant": "jagoai",
  "tanggal": "2026-11-04",
  "sekarang": "2026-11-04T11:43:25+0700",
  "total_event": 86,
  "token_tenant_hari_ini": 0,
  "batas_tenant": 4200000,
  "karyawan": [
    {
      "agent_id": "jagoai:mira",
      "nama": "Mira",
      "jabatan": "Kepala Studio",
      "meja": "ruang:brief",
      "model": "cbai/glm-5.2",
      "state": "idle",
      "sebab": "shift_end",
      "umur_detik": 53483.5,
      "token_hari_ini": 0,
      "rencana_token": 400000,
      "events": [
        {"kind": "llm_call", "ts": "2026-11-03T20:40:14+0700", "summary": "..."}
      ]
    }
  ]
}
```

Makna kolom yang dipakai visual:

| Kolom | Arti |
|---|---|
| `state` | keadaan yang harus digambar: `idle`, `walk`, `sit`, `think`, `type`, `review`, `ship`, `error`, `coffee` |
| `meja` | posisi meja. `tetap:<n>` artinya meja bernomor, `ruang:<nama>` artinya ruangan khusus |
| `umur_detik` | sudah berapa lama keadaan ini berjalan, untuk animasi |
| `token_hari_ini` | angka hari ini, bukan total |
| `events` | jejak terakhir, dipakai untuk balon percakapan |

## GET /api/rekam/tanggal

```json
{"tenant": "jagoai", "tanggal": ["2026-11-03"]}
```

## GET /api/rekam?tanggal=2026-11-03&mode=peristiwa&langkah=10

Pemutaran ulang hari kerja. `mode` berisi `peristiwa` atau `jam`. Bentuk setiap bingkai sama dengan `/api/state`.

## GET /api/papan?pekan=2026-11-02

```json
{"tenant": "jagoai", "pekan": "2026-11-02", "belum": [], "draf": [], "siap": []}
```

## GET /api/kontrol?pekan=2026-11-02

Ringkasan semua tenant, dipakai halaman Tenants.

```json
{
  "pekan": "2026-11-02",
  "tenant": [
    {
      "tenant": "jagoai",
      "token": 15998,
      "naskah": 0,
      "video": 0,
      "galat": 0,
      "studio": {
        "siap": false,
        "workspace": "",
        "nama": "",
        "akun": 0,
        "draf": 0,
        "terjadwal": 0,
        "tayang": 0,
        "galat": "belum diisi: JAGOAI_OPENPOST_TOKEN, openpost.ruang_kerja di office.toml"
      }
    }
  ]
}
```

## GET /api/data/<tabel>?pekan=2026-11-02&format=json

Tabel yang tersedia: `ringkasan`, `karyawan`, `keluaran`, `percakapan`, `biaya`. `format=csv` mengunduh berkas.

## Pembagian berkas

| Area | Pemilik | Berkas |
|---|---|---|
| backend | kamu | `app/*.py`, `tenant/`, `tests/` |
| visual 3D | terpisah | `visual/` |
| visual 2D lama | dibekukan | `web/` |
| tumpukan | bersama | `compose.jagoai.yml`, `deploy/` |

Yang tidak boleh disentuh dua-duanya tanpa bicara dulu: `app/server.py` bagian rute, dan `compose.jagoai.yml`.

## Kalau backend belum siap

Visual membawa cadangan `visual/data/contoh-state.json` hasil rekaman nyata. Kalau `/api/state` tidak menjawab, visual memakai berkas itu, jadi pekerjaan visual tidak pernah tertahan oleh backend.
