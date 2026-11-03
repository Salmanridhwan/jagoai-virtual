"""Kiki: antrean unggah. Hanya yang sudah disetujui manusia yang boleh masuk.

Tidak ada jalur lain masuk antrean. Kalau token kanal belum ada, barang tetap
masuk antrean tetapi berstatus `siap_unggah_manual`, karena menyembunyikannya
hanya membuat pekerjaan yang selesai terlihat gagal.
"""
import json
import os
from datetime import datetime
from pathlib import Path

from app import env, mira

BATAS_BALASAN_HARIAN = 20


def _token_ada(root, tenant, kanal, cfg):
    nama = (cfg.get("kanal") or {}).get("%s_env" % kanal)
    if not nama:
        return False
    sumber = env.load_env(Path(root) / "tenant" / tenant / ".env")
    return bool(sumber.get(nama) or os.environ.get(nama))


def susun(root, tenant, tanggal, cfg=None, sekarang=None):
    from app import config

    sekarang = sekarang or datetime.now().astimezone()
    root = Path(root)
    cfg = cfg or config.load(tenant, root=str(root))

    masuk, ditolak = [], []

    tinjau_p = root / "tenant" / tenant / "keluaran" / "tinjauan" / (tanggal + ".json")
    if tinjau_p.exists():
        tinjau = json.loads(tinjau_p.read_text(encoding="utf-8"))
        video = tinjau.get("berkas", {}).get("video", "")
        if tinjau.get("status") != "lulus":
            ditolak.append({"jenis": "konten", "alasan": "status tinjauan %s" % tinjau.get("status")})
        elif not mira.sudah_disetujui(root, tenant, tanggal):
            ditolak.append({"jenis": "konten", "alasan": "belum ada persetujuan manusia"})
        elif not video:
            ditolak.append({"jenis": "konten", "alasan": "berkas video tidak tercatat"})
        else:
            kanal = "instagram"
            ada = _token_ada(root, tenant, kanal, cfg)
            masuk.append({
                "jenis": "konten", "tanggal": tanggal, "kanal": kanal, "berkas": video,
                "status": "siap_unggah" if ada else "siap_unggah_manual",
                "alasan": "" if ada else "token %s belum ada" % kanal,
            })

    p = root / "tenant" / tenant / "keluaran" / "percakapan" / (tanggal + ".json")
    percak = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"draf": []}

    jumlah_balasan = 0
    for d in percak.get("draf", []):
        if d.get("status") != "disetujui":
            ditolak.append({"jenis": "balasan", "id": d.get("id"),
                            "alasan": "status %s, bukan disetujui" % d.get("status")})
            continue
        if jumlah_balasan >= BATAS_BALASAN_HARIAN:
            ditolak.append({"jenis": "balasan", "id": d.get("id"),
                            "alasan": "batas %d balasan sehari" % BATAS_BALASAN_HARIAN})
            continue
        kanal = d.get("kanal") or "threads"
        ada = _token_ada(root, tenant, kanal, cfg)
        masuk.append({
            "jenis": "balasan", "id": d.get("id"), "akun": d.get("akun"), "kanal": kanal,
            "teks": d.get("draf"), "tautan": d.get("tautan", ""),
            "rencana_kirim": d.get("rencana_kirim", ""),
            "disetujui_oleh": d.get("disetujui_oleh", ""),
            "status": "siap_unggah" if ada else "siap_unggah_manual",
            "alasan": "" if ada else "token %s belum ada" % kanal,
        })
        jumlah_balasan += 1

    hasil = {
        "tanggal": tanggal,
        "disusun": sekarang.isoformat(timespec="seconds"),
        "masuk": masuk,
        "ditolak": ditolak,
        "jumlah": {"masuk": len(masuk), "ditolak": len(ditolak),
                   "manual": len([m for m in masuk if m["status"] == "siap_unggah_manual"])},
    }
    folder = root / "tenant" / tenant / "keluaran" / "antrean"
    folder.mkdir(parents=True, exist_ok=True)
    berkas = folder / (tanggal + ".json")
    berkas.write_text(json.dumps(hasil, ensure_ascii=False, indent=1), encoding="utf-8")
    hasil["berkas"] = str(berkas)
    return hasil
