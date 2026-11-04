"""Gerbang terakhir: hanya yang disetujui manusia boleh keluar ke kanal.

Tiga pagar berlapis, dan ketiganya harus lolos sebelum satu permintaan keluar:

1. Barang harus ada di antrean dengan status `siap_unggah`. Status
   `siap_unggah_manual` berarti token kanal belum ada, jadi tidak ada yang dikirim.
2. Harus ada persetujuan manusia yang menyebut nama. Tanpa itu, tolak.
3. Peran admin tidak boleh mengirim. Yang menyetujui dan yang mengirim sama
   sama tercatat, dan admin tidak masuk daftar itu.

Tanpa pengirim sungguhan, modul ini hanya mencatat penolakan. Itu disengaja:
lebih baik tercatat tertahan daripada berpura-pura terkirim.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

from app import env, events, mira, papan, peran

BATAS_HARIAN = 20
JEDA_MENIT = 3


class KirimDitolak(RuntimeError):
    pass


def jalur_antrean(root, tenant, tanggal):
    return Path(root) / "tenant" / tenant / "keluaran" / "antrean" / (tanggal + ".json")


def muat_antrean(root, tenant, tanggal):
    p = jalur_antrean(root, tenant, tanggal)
    if not p.exists():
        return {"tanggal": tanggal, "masuk": [], "ditolak": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"tanggal": tanggal, "masuk": [], "ditolak": []}


def cari_item(antrean, jenis, kunci):
    for m in antrean.get("masuk", []):
        if m.get("jenis") != jenis:
            continue
        if jenis == "balasan" and m.get("id") == kunci:
            return m
        if jenis == "konten" and (m.get("tanggal") == kunci or m.get("berkas") == kunci):
            return m
    return None


def _catat(root, tenant, catatan):
    folder = Path(root) / "tenant" / tenant / "keluaran" / "kirim"
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / (catatan["tanggal"] + ".json")
    isi = {"tanggal": catatan["tanggal"], "percobaan": []}
    if p.exists():
        try:
            isi = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    isi.setdefault("percobaan", []).append(catatan)
    p.write_text(json.dumps(isi, ensure_ascii=False, indent=1), encoding="utf-8")
    return str(p)


def terkirim_hari(root, tenant, tanggal):
    p = Path(root) / "tenant" / tenant / "keluaran" / "kirim" / (tanggal + ".json")
    if not p.exists():
        return []
    try:
        isi = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [c for c in isi.get("percobaan", []) if c.get("status") == "terkirim"]


def _token_ada(root, tenant, kanal):
    sumber = env.load_env(Path(root) / "tenant" / tenant / ".env")
    nama = "JAGOAI_%s_TOKEN" % kanal.upper()
    return bool(sumber.get(nama))


def kirim(root, tenant, tanggal, jenis, kunci, oleh, peran_pengguna="pengguna",
          sekarang=None, pengirim=None):
    sekarang = sekarang or datetime.now().astimezone()
    peran.wajib(peran_pengguna, "setujui_konten" if jenis == "konten" else "setujui_balasan")
    if not str(oleh or "").strip():
        raise KirimDitolak("pengiriman wajib menyebut siapa yang menyetujui")

    antrean = muat_antrean(root, tenant, tanggal)
    item = cari_item(antrean, jenis, kunci)
    if item is None:
        raise KirimDitolak("%s %s tidak ada di antrean %s" % (jenis, kunci, tanggal))

    if item.get("status") != "siap_unggah":
        alasan = item.get("alasan") or "status %s" % item.get("status")
        _catat(root, tenant, {"tanggal": tanggal, "jenis": jenis, "kunci": kunci,
                              "oleh": oleh.strip(), "status": "tertahan",
                              "alasan": alasan, "pada": sekarang.isoformat(timespec="seconds")})
        raise KirimDitolak("barang belum siap dikirim: %s" % alasan)

    if jenis == "konten":
        if not mira.sudah_disetujui(root, tenant, tanggal):
            raise KirimDitolak("konten %s belum disetujui manusia" % tanggal)
        setuju = [s for s in mira.muat_persetujuan(root, tenant, tanggal).get("konten", [])
                  if s.get("oleh")]
        disetujui_oleh = setuju[-1]["oleh"] if setuju else ""
    else:
        disetujui_oleh = item.get("disetujui_oleh") or ""
        if not disetujui_oleh:
            raise KirimDitolak("balasan %s belum disetujui manusia" % kunci)

    terkirim = terkirim_hari(root, tenant, tanggal)
    if len(terkirim) >= BATAS_HARIAN:
        raise KirimDitolak("batas %d kiriman sehari sudah penuh" % BATAS_HARIAN)
    if terkirim:
        terakhir = datetime.fromisoformat(terkirim[-1]["pada"])
        if sekarang - terakhir < timedelta(minutes=JEDA_MENIT):
            raise KirimDitolak("jeda %d menit belum lewat sejak kiriman terakhir" % JEDA_MENIT)

    kanal = item.get("kanal") or "instagram"
    if pengirim is None:
        if not _token_ada(root, tenant, kanal):
            catatan = {"tanggal": tanggal, "jenis": jenis, "kunci": kunci,
                       "oleh": oleh.strip(), "kanal": kanal, "status": "tertahan",
                       "alasan": "token %s belum ada" % kanal,
                       "pada": sekarang.isoformat(timespec="seconds")}
            berkas = _catat(root, tenant, catatan)
            raise KirimDitolak("token %s belum ada, kiriman tidak dikirim. tercatat di %s"
                               % (kanal, berkas))
        raise KirimDitolak("pengirim kanal belum dibangun, hanya jalur manual")

    hasil = pengirim(item, kanal, sekarang)
    if not hasil or not hasil.get("ok"):
        catatan = {"tanggal": tanggal, "jenis": jenis, "kunci": kunci, "oleh": oleh.strip(),
                   "kanal": kanal, "status": "gagal",
                   "alasan": (hasil or {}).get("alasan", "pengirim tidak membalas apa pun"),
                   "pada": sekarang.isoformat(timespec="seconds")}
        _catat(root, tenant, catatan)
        raise KirimDitolak("pengiriman gagal: %s" % catatan["alasan"])

    catatan = {"tanggal": tanggal, "jenis": jenis, "kunci": kunci, "oleh": oleh.strip(),
               "kanal": kanal, "status": "terkirim", "disetujui_oleh": disetujui_oleh,
               "tautan": hasil.get("tautan", ""),
               "pada": sekarang.isoformat(timespec="seconds")}
    _catat(root, tenant, catatan)
    events.append(Path(root) / "tenant" / tenant / "events.jsonl", {
        "kind": "published", "agent_id": "%s:kiki" % tenant, "tanggal": tanggal,
        "jenis": jenis, "kanal": kanal, "disetujui_oleh": disetujui_oleh,
        "oleh": oleh.strip(), "tautan": hasil.get("tautan", ""),
    })
    return catatan
