"""Mira: paket persetujuan untuk pemilik, dan catatan keputusannya.

Mira tidak menyetujui apa pun. Dia mengumpulkan yang siap diputuskan, yang
tertahan beserta alasannya, dan mengurutkan mana yang paling mendesak. Tanda
setuju hanya boleh datang dari manusia, dan dicatat siapa yang memberi.
"""
import json
from datetime import datetime
from pathlib import Path

P = chr(10)


def jalur_persetujuan(root, tenant, tanggal):
    return Path(root) / "tenant" / tenant / "keluaran" / "persetujuan" / (tanggal + ".json")


def muat_persetujuan(root, tenant, tanggal):
    p = jalur_persetujuan(root, tenant, tanggal)
    if not p.exists():
        return {"tanggal": tanggal, "konten": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"tanggal": tanggal, "konten": []}


def _tinjauan(root, tenant, tanggal):
    p = Path(root) / "tenant" / tenant / "keluaran" / "tinjauan" / (tanggal + ".json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _percakapan(root, tenant, tanggal):
    p = Path(root) / "tenant" / tenant / "keluaran" / "percakapan" / (tanggal + ".json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def paket(root, tenant, tanggal):
    """Ringkas apa yang menunggu keputusan pemilik, dan apa yang tertahan."""
    tinjau = _tinjauan(root, tenant, tanggal)
    percak = _percakapan(root, tenant, tanggal)
    setuju = muat_persetujuan(root, tenant, tanggal)
    sudah = {s.get("tanggal") for s in setuju.get("konten", [])}

    siap, tertahan = [], []

    if tinjau is None:
        tertahan.append({"jenis": "konten", "alasan": "belum ditinjau Omar"})
    elif tinjau.get("status") == "tolak":
        tertahan.append({
            "jenis": "konten",
            "alasan": "Omar menolak",
            "temuan": [t.get("alasan") for t in tinjau.get("temuan_isi", [])
                       if t.get("tingkat") == "tolak"],
            "angka_tanpa_dasar": tinjau.get("angka_tanpa_dasar", []),
        })
    elif tinjau.get("status") == "manual":
        tertahan.append({"jenis": "konten", "alasan": "Omar tidak bisa menilai, perlu dibaca manusia"})
    else:
        siap.append({
            "jenis": "konten",
            "tanggal": tanggal,
            "status": "sudah disetujui" if tanggal in sudah else "menunggu persetujuan",
            "berkas": tinjau.get("berkas", {}).get("video", ""),
        })

    for d in (percak or {}).get("draf", []):
        if d.get("status") == "disetujui":
            siap.append({"jenis": "balasan", "id": d.get("id"), "akun": d.get("akun"),
                         "teks": d.get("draf", ""), "status": "sudah disetujui"})
        elif d.get("status") == "menunggu_persetujuan":
            siap.append({"jenis": "balasan", "id": d.get("id"), "akun": d.get("akun"),
                         "teks": d.get("draf", ""), "status": "menunggu persetujuan"})
    for d in (percak or {}).get("ditolak", []):
        tertahan.append({"jenis": "balasan", "id": d.get("id"), "alasan": d.get("alasan")})

    return {"tanggal": tanggal, "siap": siap, "tertahan": tertahan,
            "menunggu_keputusan": len([s for s in siap if s["status"] != "sudah disetujui"])}


def setujui_konten(root, tenant, tanggal, oleh, catatan="", sekarang=None, peran="pengguna"):
    from app import peran as peran_mod

    peran_mod.wajib(peran, "setujui_konten")
    sekarang = sekarang or datetime.now().astimezone()
    tinjau = _tinjauan(root, tenant, tanggal)
    if tinjau is None:
        raise ValueError("konten %s belum ditinjau, tidak ada yang bisa disetujui" % tanggal)
    if tinjau.get("status") != "lulus":
        raise ValueError("konten %s berstatus %s, bukan lulus" % (tanggal, tinjau.get("status")))
    if not str(oleh or "").strip():
        raise ValueError("persetujuan wajib menyebut siapa yang menyetujui")

    data = muat_persetujuan(root, tenant, tanggal)
    data.setdefault("konten", []).append({
        "tanggal": tanggal,
        "oleh": oleh.strip(),
        "pada": sekarang.isoformat(timespec="seconds"),
        "catatan": catatan,
        "video": tinjau.get("berkas", {}).get("video", ""),
    })
    p = jalur_persetujuan(root, tenant, tanggal)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data["konten"][-1]


def sudah_disetujui(root, tenant, tanggal):
    return any(c.get("tanggal") == tanggal and c.get("oleh")
               for c in muat_persetujuan(root, tenant, tanggal).get("konten", []))
