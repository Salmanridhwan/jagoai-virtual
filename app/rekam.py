"""Memutar ulang kantor dari events.jsonl.

Rekaman bukan animasi karangan. Setiap bingkai dihitung dari event yang benar
benar tercatat sampai detik itu, memakai fungsi `state.ringkas` yang sama dengan
kanvas langsung. Bingkai tanpa event tetap ditampilkan apa adanya sebagai tidur,
bukan diisi gerak supaya terlihat ramai.
"""
from datetime import datetime, timedelta
from pathlib import Path

from app import budget, config, events, state

FRAME_MAKS = 240
LANGKAH_MENIT = 10
PAD_MENIT = 15


def _waktu(teks):
    for pola in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z",
                 "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(teks, pola)
        except (TypeError, ValueError):
            continue
    return None


def hari_itu(root, tenant, tanggal):
    log = Path(root) / "tenant" / tenant / "events.jsonl"
    semua = events.read_all(log)
    hasil = [e for e in semua if str(e.get("ts") or "")[:10] == tanggal]
    hasil.sort(key=lambda e: str(e.get("ts")))
    return hasil


def bingkai(root, tenant, tanggal, langkah_menit=LANGKAH_MENIT, cfg=None, batas=FRAME_MAKS,
           mode="jam"):
    cfg = cfg or config.load(tenant, root=str(root))
    daftar = {}
    izin = {}
    for nama, k in cfg.get("karyawan", {}).items():
        aid = "%s:%s" % (tenant, nama)
        daftar[nama] = aid
        izin[aid] = bool(k.get("izin_ambient", True))

    isi = hari_itu(root, tenant, tanggal)
    waktu = [(e, _waktu(str(e.get("ts")))) for e in isi]
    waktu = [(e, w) for e, w in waktu if w is not None]

    if not waktu:
        return {"tanggal": tanggal, "mode": mode, "langkah_menit": langkah_menit, "kosong": True,
                "bingkai": [], "kegiatan": [], "jumlah_event": 0}


    if mode == "peristiwa":
        # satu bingkai per event: rekaman mengikuti pekerjaan, bukan jam dinding
        hasil = []
        for i, (e, w) in enumerate(waktu):
            if len(hasil) >= batas:
                break
            t = w + timedelta(seconds=0.5)
            sampai = [x for x, wx in waktu[:i + 1]]
            keadaan = state.ringkas(sampai, list(daftar.values()), sekarang=t, izin_ambient=izin)
            hasil.append({
                "jam": t.strftime("%H:%M:%S"),
                "iso": t.isoformat(timespec="seconds"),
                "karyawan": {nama: keadaan[aid]["state"] for nama, aid in daftar.items()},
                "sebab": {nama: keadaan[aid]["sebab"] for nama, aid in daftar.items()},
                "kegiatan": [{"jam": str(e.get("ts"))[11:19],
                              "agent": str(e.get("agent_id") or "").split(":")[-1],
                              "kind": e.get("kind")}],
            })
        return {
            "tanggal": tanggal,
            "mode": "peristiwa",
            "langkah_menit": 0,
            "kosong": False,
            "jumlah_event": len(waktu),
            "bingkai": hasil,
            "kegiatan": [{"jam": str(e.get("ts"))[11:19],
                          "agent": str(e.get("agent_id") or "").split(":")[-1],
                          "kind": e.get("kind")} for e, _ in waktu],
        }
    mulai = waktu[0][1] - timedelta(minutes=PAD_MENIT)
    akhir = waktu[-1][1] + timedelta(minutes=PAD_MENIT)
    langkah = timedelta(minutes=langkah_menit)
    if (akhir - mulai) / langkah > batas:
        langkah = (akhir - mulai) / batas

    hasil = []
    t = mulai
    while t <= akhir and len(hasil) < batas:
        sampai = [e for e, w in waktu if w <= t]
        keadaan = state.ringkas(sampai, list(daftar.values()), sekarang=t, izin_ambient=izin)
        sebelumnya = t - langkah
        keg = [{"jam": str(e.get("ts"))[11:19],
                "agent": str(e.get("agent_id") or "").split(":")[-1],
                "kind": e.get("kind")}
               for e, w in waktu if sebelumnya < w <= t]
        hasil.append({
            "jam": t.strftime("%H:%M"),
            "iso": t.isoformat(timespec="seconds"),
            "karyawan": {nama: keadaan[aid]["state"] for nama, aid in daftar.items()},
            "sebab": {nama: keadaan[aid]["sebab"] for nama, aid in daftar.items()},
            "kegiatan": keg,
        })
        t += langkah

    return {
        "tanggal": tanggal,
        "mode": "jam",
        "langkah_menit": round(langkah.total_seconds() / 60, 1),
        "kosong": False,
        "jumlah_event": len(waktu),
        "bingkai": hasil,
        "kegiatan": [{"jam": str(e.get("ts"))[11:19],
                      "agent": str(e.get("agent_id") or "").split(":")[-1],
                      "kind": e.get("kind")} for e, _ in waktu],
    }


def daftar_tanggal(root, tenant):
    log = Path(root) / "tenant" / tenant / "events.jsonl"
    tanggal = sorted({str(e.get("ts") or "")[:10] for e in events.read_all(log)})
    return [t for t in tanggal if t]


def token_hari(root, tenant, tanggal):
    log = Path(root) / "tenant" / tenant / "events.jsonl"
    semua = events.read_all(log)
    return budget.terpakai_tenant(semua, tanggal)
