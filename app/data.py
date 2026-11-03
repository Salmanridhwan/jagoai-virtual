"""Mode 2, layar data: lima tabel dari berkas yang sama dengan laporan Vera.

Aturan yang menentukan bentuk modul ini: angka di sini wajib sama dengan angka
laporan Vera. Karena itu ada fungsi `cocokkan` yang membandingkan keduanya dan
mengembalikan selisih. Selisih bukan tafsir, itu cacat.
"""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from app import budget, events, vera

TABEL = ("ringkasan", "karyawan", "keluaran", "percakapan", "biaya")


def _baca(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _log(root, tenant):
    return events.read_all(Path(root) / "tenant" / tenant / "events.jsonl")


def ringkasan(root, tenant, pekan):
    hari = vera.rentang(pekan)
    kunci = Path(root) / "tenant" / tenant / "keluaran"
    log = _log(root, tenant)
    baris = []
    for h in hari:
        naskah = len(list((kunci / "naskah" / h).glob("*.md")))
        lap = _baca(kunci / "desain" / h / "laporan.json") or {}
        tinjau = _baca(kunci / "tinjauan" / (h + ".json")) or {}
        setuju = _baca(kunci / "persetujuan" / (h + ".json")) or {}
        antre = _baca(kunci / "antrean" / (h + ".json")) or {}
        baris.append({
            "tanggal": h,
            "naskah": naskah,
            "desain_lulus": 1 if lap.get("lulus") else 0,
            "video": len(list((kunci / "video" / h).glob("*.mp4"))),
            "tinjauan": tinjau.get("status") or "",
            "disetujui": len(setuju.get("konten", [])),
            "antrean_masuk": len(antre.get("masuk", [])),
            "token": budget.terpakai_tenant(log, h),
        })
    return baris


def karyawan(root, tenant, pekan):
    hari = vera.rentang(pekan)
    log = _log(root, tenant)
    akun = defaultdict(lambda: {"shift": 0, "panggilan": 0, "ditolak": 0, "token": 0, "versi": ""})
    for e in log:
        ts = str(e.get("ts") or "")
        if ts[:10] not in hari:
            continue
        nama = str(e.get("agent_id") or "").split(":")[-1]
        if not nama:
            continue
        a = akun[(nama, ts[:10])]
        if e.get("kind") == "shift_start":
            a["shift"] += 1
        elif e.get("kind") == "llm_call":
            a["panggilan"] += 1
            a["token"] += int(e.get("tokens_in") or 0) + int(e.get("tokens_out") or 0)
        elif e.get("kind") == "keluaran_ditolak":
            a["ditolak"] += 1
        if e.get("brief_versi"):
            a["versi"] = str(e["brief_versi"])
    baris = []
    for (nama, tanggal), a in sorted(akun.items()):
        baris.append({"karyawan": nama, "tanggal": tanggal, **a})
    return baris


def keluaran(root, tenant, pekan):
    hari = vera.rentang(pekan)
    kunci = Path(root) / "tenant" / tenant / "keluaran"
    baris = []
    for h in hari:
        jadwal = _baca(kunci / "jadwal" / (h + ".json")) or {}
        for slot in jadwal.get("slot", []):
            tgl = slot.get("tanggal") or h
            naskah = sorted((kunci / "naskah" / tgl).glob(tgl + "-*.md"))
            lap = _baca(kunci / "desain" / tgl / "laporan.json") or {}
            tinjau = _baca(kunci / "tinjauan" / (tgl + ".json")) or {}
            antre = _baca(kunci / "antrean" / (tgl + ".json")) or {}
            nama_antre = [m.get("status") for m in antre.get("masuk", [])
                          if m.get("jenis") == "konten"]
            baris.append({
                "tanggal": tgl,
                "kanal": slot.get("kanal", ""),
                "format": slot.get("format", ""),
                "topik": slot.get("topik", ""),
                "naskah": str(naskah[0]) if naskah else "",
                "desain": lap.get("lulus") if lap else "",
                "video": len(list((kunci / "video" / tgl).glob("*.mp4"))),
                "tinjauan": tinjau.get("status") or "",
                "antrean": nama_antre[0] if nama_antre else "",
            })
    return baris


def percakapan(root, tenant, pekan):
    hari = vera.rentang(pekan)
    kunci = Path(root) / "tenant" / tenant / "keluaran" / "percakapan"
    baris = []
    for h in hari:
        data = _baca(kunci / (h + ".json")) or {}
        for d in data.get("draf", []):
            baris.append({
                "tanggal": h, "id": d.get("id"), "akun": d.get("akun"),
                "kanal": d.get("kanal"), "status": d.get("status"),
                "disetujui_oleh": d.get("disetujui_oleh", ""),
                "rencana_kirim": d.get("rencana_kirim", ""),
                "draf": d.get("draf", ""), "tautan": d.get("tautan", ""),
            })
        for d in data.get("ditolak", []):
            baris.append({"tanggal": h, "id": d.get("id"), "akun": "", "kanal": "",
                          "status": "ditolak", "disetujui_oleh": "",
                          "rencana_kirim": "", "draf": "", "tautan": "",
                          "alasan": d.get("alasan")})
    return baris


def biaya(root, tenant, pekan):
    hari = vera.rentang(pekan)
    log = _log(root, tenant)
    per = defaultdict(lambda: Counter())
    for e in log:
        ts = str(e.get("ts") or "")
        if ts[:10] not in hari:
            continue
        nama = str(e.get("agent_id") or "").split(":")[-1] or "tanpa nama"
        k = e.get("kind")
        per[(nama, ts[:10])][k] += 1
        if k == "llm_call":
            per[(nama, ts[:10])]["token"] += int(e.get("tokens_in") or 0) + int(e.get("tokens_out") or 0)
    baris = []
    for (nama, tanggal), c in sorted(per.items()):
        baris.append({
            "karyawan": nama, "tanggal": tanggal,
            "panggilan": c.get("llm_call", 0),
            "gagal": c.get("tool_error", 0) + c.get("keluaran_ditolak", 0),
            "ditunda": c.get("shift_tertunda", 0),
            "token": c.get("token", 0),
        })
    return baris


PEMBUAT = {"ringkasan": ringkasan, "karyawan": karyawan, "keluaran": keluaran,
           "percakapan": percakapan, "biaya": biaya}


def tabel(nama, root, tenant, pekan):
    if nama not in PEMBUAT:
        raise ValueError("tabel %s tidak dikenal, pilihan: %s" % (nama, ", ".join(TABEL)))
    return PEMBUAT[nama](root, tenant, pekan)


def cocokkan(root, tenant, pekan):
    """Bandingkan angka tabel dengan laporan Vera. Selisih wajib nol."""
    v = vera.kumpulkan(root, tenant, pekan)
    selisih = []

    def cek(label, a, b):
        if a != b:
            selisih.append({"angka": label, "tabel": a, "vera": b})

    cek("token", sum(b["token"] for b in biaya(root, tenant, pekan)), v["token_total"])
    cek("naskah", len([b for b in keluaran(root, tenant, pekan) if b["naskah"]]), v["isi"]["naskah"])
    cek("video", sum(b["video"] for b in ringkasan(root, tenant, pekan)), v["isi"]["video"])
    cek("desain lulus", sum(b["desain_lulus"] for b in ringkasan(root, tenant, pekan)),
        v["isi"]["desain_lulus"])
    cek("antrean masuk", sum(b["antrean_masuk"] for b in ringkasan(root, tenant, pekan)),
        v["isi"]["antrean_masuk"])
    cek("tinjauan tolak", len([b for b in ringkasan(root, tenant, pekan) if b["tinjauan"] == "tolak"]),
        v["isi"]["tinjauan"]["tolak"])
    cek("percakapan draf", len(percakapan(root, tenant, pekan)), 
        v["isi"]["percakapan"]["draf"] + v["isi"]["percakapan"]["ditolak"])
    return selisih


def ekspor(root, tenant, nama, pekan, format_="csv"):
    baris = tabel(nama, root, tenant, pekan)
    folder = Path(root) / "tenant" / tenant / "keluaran" / "ekspor"
    folder.mkdir(parents=True, exist_ok=True)
    berkas = folder / ("%s-%s.%s" % (nama, pekan, format_))
    if format_ == "json":
        berkas.write_text(json.dumps(baris, ensure_ascii=False, indent=1), encoding="utf-8")
    else:
        kolom = list(baris[0].keys()) if baris else ["kosong"]
        with open(berkas, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=kolom, extrasaction="ignore")
            w.writeheader()
            for b in baris:
                w.writerow(b)
    return str(berkas), len(baris)
