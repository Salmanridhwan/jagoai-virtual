"""Penjadwal: menjalankan slot harian yang jatuh tempo.

Satu proses, satu tenant. Slot yang sudah jalan dicatat di
tenant/<slug>/state/jadwal.json, jadi menjalankan ulang proses tidak
mengulang shift. Slot yang terlewat lebih dari toleransi ditandai terlewat,
tidak dikejar.
"""
import time
from datetime import datetime
from pathlib import Path

from app import brief, config, env, jadwal, runtime


def eksekusi_default(root, tenant, cfg, slot, sekarang, kunci=None):
    slug = slot["agent"]
    k = cfg["karyawan"][slug]
    b = brief.muat(Path(root) / "tenant" / tenant / "brief-karyawan" / (slug + ".md"))
    if kunci is None:
        kunci = env.get(env.load_env(Path(root) / "tenant" / tenant / ".env"),
                        cfg["gerbang"]["kunci_env"])
    return runtime.jalankan(
        base_url=cfg["gerbang"]["base_url"],
        kunci=kunci,
        model=k["model"],
        agent_id="%s:%s" % (tenant, slug),
        tugas=slot["tugas"],
        brief=b["teks"],
        log_path=Path(root) / "tenant" / tenant / "events.jsonl",
        batas_tenant=int(cfg["gerbang"].get("batas_harian_tenant") or 0) or None,
        batas_shift=int(k.get("batas_shift", 20000)),
        max_tokens=int(k.get("maks_token", 400)),
        nama=slug.capitalize(),
        jabatan=k.get("jabatan", "karyawan"),
        tahun=sekarang.year,
    )


def sekali(root, tenant, sekarang, eksekusi=None, toleransi_menit=jadwal.TOLERANSI_MENIT, kunci=None):
    """Jalankan semua slot yang jatuh tempo pada waktu tertentu."""
    root = Path(root)
    cfg = config.load(tenant, root=str(root))
    daftar = jadwal.muat(root / "tenant" / tenant / "jadwal.toml")
    if eksekusi is None:
        def eksekusi(s):
            return eksekusi_default(root, tenant, cfg, s, sekarang, kunci)

    catatan = jadwal.sudah_jalan(root, tenant)
    hasil = []
    for s in sorted(daftar, key=lambda x: x["jam"]):
        status = jadwal.status_slot(s, sekarang, catatan, toleransi_menit)
        if status == "terlewat":
            catatan = jadwal.tandai(root, tenant, jadwal.kunci(s, sekarang), {"status": "terlewat"})
            hasil.append({"slot": s, "status": "terlewat"})
            continue
        if status != "jatuh_tempo":
            continue

        k = jadwal.kunci(s, sekarang)
        try:
            r = eksekusi(s)
            catatan = jadwal.tandai(root, tenant, k, {
                "status": "selesai",
                "shift_id": r.get("shift_id"),
                "tokens": int(r.get("tokens_in", 0)) + int(r.get("tokens_out", 0)),
            })
            hasil.append({"slot": s, "status": "selesai", "hasil": r})
        except runtime.ShiftDitunda as e:
            catatan = jadwal.tandai(root, tenant, k, {"status": "ditunda", "alasan": e.alasan})
            hasil.append({"slot": s, "status": "ditunda", "alasan": e.alasan})
        except Exception as e:
            catatan = jadwal.tandai(root, tenant, k, {"status": "gagal", "galat": str(e)[:200]})
            hasil.append({"slot": s, "status": "gagal", "galat": str(e)[:200]})
    return hasil


def cetak(hasil):
    for h in hasil:
        s = h["slot"]
        if h["status"] == "selesai":
            r = h["hasil"]
            print("%s %-6s selesai  token=%d+%d %s" % (
                s["jam"], s["agent"], r.get("tokens_in", 0), r.get("tokens_out", 0),
                ("catatan=%s" % ",".join(r["pelanggaran"])) if r.get("pelanggaran") else ""))
        else:
            print("%s %-6s %s %s" % (s["jam"], s["agent"], h["status"], h.get("alasan") or h.get("galat") or ""))


def putar(root, tenant, jeda=60, eksekusi=None, sekarang=None):
    """Putaran tanpa henti. Ctrl+C untuk berhenti."""
    while True:
        kini = sekarang() if callable(sekarang) else datetime.now().astimezone()
        hasil = sekali(root, tenant, kini, eksekusi=eksekusi)
        if hasil:
            print("[%s] %d slot" % (kini.strftime("%H:%M:%S"), len(hasil)))
            cetak(hasil)
        time.sleep(jeda)
