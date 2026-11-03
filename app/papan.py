"""Papan kerja: jadwal pekan dan naskah sebagai berkas nyata.

Berkas adalah satu-satunya kebenaran. Kalau naskah tidak ada di folder, ia
dianggap belum ditulis, walaupun model pernah membicarakannya di percakapan.

Susunan:
  keluaran/jadwal/<pekan>.json
  keluaran/naskah/<pekan>/<tanggal>-<slug>.md
"""
import json
import re
from pathlib import Path

FORMAT = ("carousel", "post", "infografis", "video", "cerita")
KANAL = ("instagram", "threads", "tiktok")
WAJIB_BAGIAN = ("Hook", "Naskah", "Caption", "Catatan")


def folder(root, tenant):
    return Path(root) / "tenant" / tenant / "keluaran"


def path_jadwal(root, tenant, pekan):
    return folder(root, tenant) / "jadwal" / (pekan + ".json")


def path_naskah(root, tenant, pekan, tanggal, slug):
    return folder(root, tenant) / "naskah" / pekan / ("%s-%s.md" % (tanggal, slug))


def slug(teks):
    bersih = re.sub(r"[^a-z0-9]+", "-", (teks or "").lower()).strip("-")
    return bersih or "tanpa-topik"


def validasi_jadwal(data):
    """Kembalikan daftar kesalahan. Kosong berarti sah."""
    salah = []
    if not isinstance(data, list):
        return ["jadwal harus berupa daftar"]
    if len(data) < 3:
        salah.append("jadwal minimal tiga slot")
    tanggal_terpakai = set()
    for i, s in enumerate(data):
        nomor = i + 1
        if not isinstance(s, dict):
            salah.append("slot %d bukan objek" % nomor)
            continue
        t = s.get("tanggal")
        if not isinstance(t, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", t or ""):
            salah.append("slot %d tanpa tanggal YYYY-MM-DD" % nomor)
        elif t in tanggal_terpakai and s.get("kanal") != "threads":
            salah.append("slot %d tanggal %s dobel" % (nomor, t))
        else:
            tanggal_terpakai.add(t)
        if s.get("format") not in FORMAT:
            salah.append("slot %d format tidak dikenal" % nomor)
        if not (s.get("topik") or "").strip():
            salah.append("slot %d tanpa topik" % nomor)
        if s.get("kanal") and s["kanal"] not in KANAL:
            salah.append("slot %d kanal tidak dikenal" % nomor)
    return salah


def simpan_jadwal(root, tenant, pekan, data):
    p = path_jadwal(root, tenant, pekan)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"pekan": pekan, "slot": data}, f, ensure_ascii=False, indent=1)
    return p


def muat_jadwal(root, tenant, pekan):
    p = path_jadwal(root, tenant, pekan)
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("slot", [])


def tulis_naskah(root, tenant, pekan, tanggal, topik, isi, kanal="instagram",
                 format_="carousel", sumber=""):
    p = path_naskah(root, tenant, pekan, tanggal, slug(topik))
    p.parent.mkdir(parents=True, exist_ok=True)
    kepala = [
        "---",
        "tanggal: %s" % tanggal,
        "pekan: %s" % pekan,
        "kanal: %s" % kanal,
        "format: %s" % format_,
        "status: draf",
        "sumber: %s" % (sumber or "brief pekan"),
        "disetujui_oleh:",
        "---",
        "",
    ]
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(kepala) + isi.strip() + "\n")
    return p


def baca_naskah(p):
    teks = Path(p).read_text(encoding="utf-8")
    kepala = {}
    isi = teks
    if teks.startswith("---"):
        bagian = teks.split("---", 2)
        if len(bagian) >= 3:
            for baris in bagian[1].strip().splitlines():
                if ":" in baris:
                    k, v = baris.split(":", 1)
                    kepala[k.strip()] = v.strip()
            isi = bagian[2]
    return {"kepala": kepala, "isi": isi.strip(), "teks": teks}


def bagian_hilang(isi):
    ada = {b.lower() for b in re.findall(r"^##\s+(.+)$", isi or "", re.MULTILINE)}
    return [b for b in WAJIB_BAGIAN if b.lower() not in ada]


def kolom(root, tenant, pekan):
    """Kelompokkan slot ke kolom papan: belum, draf, siap."""
    slot = muat_jadwal(root, tenant, pekan) or []
    hasil = {"belum": [], "draf": [], "siap": []}
    for s in slot:
        t = s.get("tanggal", "")
        topik = s.get("topik", "")
        p = path_naskah(root, tenant, pekan, t, slug(topik))
        kartu = {
            "tanggal": t,
            "topik": topik,
            "format": s.get("format"),
            "kanal": s.get("kanal", ""),
            "berkas": str(p) if p.exists() else "",
        }
        if not p.exists():
            hasil["belum"].append(kartu)
            continue
        kepala = baca_naskah(p)["kepala"]
        kartu["status"] = kepala.get("status", "draf")
        if kartu["status"] in ("siap", "disetujui"):
            hasil["siap"].append(kartu)
        else:
            hasil["draf"].append(kartu)
    return hasil
