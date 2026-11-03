"""Desain feed: naskah menjadi slide yang bisa diukur, bukan dikira-kira.

Setiap slide digambar pada ukuran kanvas sebenarnya, lalu diperiksa dari piksel
hasilnya: margin aman, zona bawah, dan kontras teks terhadap latar. Kalau ada
yang melanggar, laporan menyebut angkanya dan berkas tidak ditandai lulus.
"""
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

UKURAN = {
    "carousel": (1080, 1350),
    "post": (1080, 1350),
    "infografis": (1080, 1350),
    "cerita": (1080, 1920),
    "video": (1080, 1920),
}
MARGIN = 64
ZONA_BAWAH = 120
TEKS_MIN = 32
KONTRAS_MIN = 4.5

PALET = {
    "latar": "#0F1B2D",
    "teks": "#F5F7FA",
    "aksen": "#FFB020",
    "redup": "#93A2B8",
}

FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_BIASA = "C:/Windows/Fonts/segoeui.ttf"


def _rgb(warna):
    w = (warna or "").lstrip("#")
    return tuple(int(w[i:i + 2], 16) for i in (0, 2, 4))


def luminansi(warna):
    def satu(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (satu(x) for x in _rgb(warna))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def kontras(warna1, warna2):
    a, b = luminansi(warna1), luminansi(warna2)
    terang, gelap = max(a, b), min(a, b)
    return round((terang + 0.05) / (gelap + 0.05), 2)


def periksa_palet(palet):
    salah = []
    for nama in ("teks", "aksen", "redup"):
        rasio = kontras(palet[nama], palet["latar"])
        if rasio < KONTRAS_MIN:
            salah.append("%s terhadap latar hanya %.2f:1, minimal %.1f:1"
                         % (nama, rasio, KONTRAS_MIN))
    return salah


def _font(path, ukuran):
    return ImageFont.truetype(path, ukuran)


def bungkus(teks, font, lebar):
    kata = (teks or "").split()
    baris, kini = [], ""
    for k in kata:
        coba = (kini + " " + k).strip()
        if font.getlength(coba) <= lebar or not kini:
            kini = coba
        else:
            baris.append(kini)
            kini = k
    if kini:
        baris.append(kini)
    return baris


def render(judul, tubuh, nomor, total, ukuran_kanvas=(1080, 1350), palet=None, footer="jagoai"):
    palet = palet or PALET
    w, h = ukuran_kanvas
    img = Image.new("RGB", (w, h), _rgb(palet["latar"]))
    d = ImageDraw.Draw(img)

    f_judul = _font(FONT_BOLD, 62)
    f_tubuh = _font(FONT_BIASA, 44)
    f_kecil = _font(FONT_BIASA, 30)

    # huruf punya overhang beberapa piksel, jadi teks digambar sedikit ke dalam
    x = MARGIN + 8
    lebar = w - 2 * MARGIN - 16
    d.rectangle([MARGIN, MARGIN, MARGIN + 96, MARGIN + 10], fill=_rgb(palet["aksen"]))

    y = MARGIN + 44
    for baris in bungkus(judul, f_judul, lebar):
        d.text((x, y), baris, font=f_judul, fill=_rgb(palet["teks"]))
        y += 76

    y += 26
    batas_isi = h - ZONA_BAWAH
    for baris in bungkus(tubuh, f_tubuh, lebar):
        if y + 60 > batas_isi:
            break
        d.text((x, y), baris, font=f_tubuh, fill=_rgb(palet["teks"]))
        y += 60

    kaki = "%s · %d/%d" % (footer, nomor, total)
    d.text((x, batas_isi - 46), kaki, font=f_kecil, fill=_rgb(palet["redup"]))
    return img


def periksa_gambar(img, palet=None):
    """Ukur margin dan zona bawah dari piksel hasil gambar."""
    palet = palet or PALET
    latar = np.array(_rgb(palet["latar"]), dtype=int)
    arr = np.array(img.convert("RGB"), dtype=int)
    h, w, _ = arr.shape
    beda = np.abs(arr - latar).sum(axis=2) > 24
    ys, xs = np.where(beda)
    if len(xs) == 0:
        return {"kiri": None, "kanan": None, "atas": None, "bawah": None,
                "pelanggaran": ["gambar kosong"]}
    kiri = int(xs.min())
    kanan = int(w - 1 - xs.max())
    atas = int(ys.min())
    bawah = int(h - 1 - ys.max())
    langgar = []
    if kiri < MARGIN:
        langgar.append("margin kiri %d piksel, minimal %d" % (kiri, MARGIN))
    if kanan < MARGIN:
        langgar.append("margin kanan %d piksel, minimal %d" % (kanan, MARGIN))
    if atas < MARGIN:
        langgar.append("margin atas %d piksel, minimal %d" % (atas, MARGIN))
    if bawah < ZONA_BAWAH:
        langgar.append("zona bawah %d piksel, minimal %d" % (bawah, ZONA_BAWAH))
    return {"kiri": kiri, "kanan": kanan, "atas": atas, "bawah": bawah,
            "pelanggaran": langgar}


POLA_SLIDE = re.compile(r"^\*\*Slide\s+(\d+)\s*(\([^)]*\))?\s*\*\*\s*$", re.MULTILINE)


def baca_slide(isi):
    """Ambil daftar slide dari bagian Naskah pada berkas naskah."""
    potong = re.search(r"^##\s+Naskah\s*$", isi or "", re.MULTILINE)
    if not potong:
        return []
    teks = isi[potong.end():]
    akhir = re.search(r"^##\s+", teks, re.MULTILINE)
    if akhir:
        teks = teks[:akhir.start()]
    bagian = list(POLA_SLIDE.finditer(teks))
    hasil = []
    for i, m in enumerate(bagian):
        mulai = m.end()
        selesai = bagian[i + 1].start() if i + 1 < len(bagian) else len(teks)
        blok = teks[mulai:selesai]
        judul = ("Slide %s %s" % (m.group(1), (m.group(2) or "").strip("() "))).strip()
        isi_slide = []
        for baris in blok.splitlines():
            b = baris.strip()
            if not b:
                continue
            if b.lower().startswith("teks:"):
                b = b.split(":", 1)[1].strip()
            elif b.lower().startswith("visual:"):
                continue
            isi_slide.append(b.strip('"'))
        hasil.append({"nomor": int(m.group(1)), "label": judul, "teks": " ".join(isi_slide)})
    return hasil


def catat_canva(root, tenant, tanggal, file_id, berkas_pdf=""):
    """Catat aset Canva hasil unggahan supaya bisa dilacak dari berkas."""
    from datetime import datetime

    folder = Path(root) / "tenant" / tenant / "keluaran" / "desain" / tanggal
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / "canva.json"
    data = {}
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
    data.setdefault("aset", []).append({
        "file_id": file_id,
        "pdf": berkas_pdf,
        "diunggah": datetime.now().astimezone().isoformat(timespec="seconds"),
    })
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return p


def buat(root, tenant, tanggal, naskah_path, format_="carousel", palet=None, footer="jagoai"):
    from app import papan

    naskah = papan.baca_naskah(naskah_path)
    slide = baca_slide(naskah["isi"])
    if not slide:
        raise ValueError("naskah tidak memuat bagian Naskah dengan slide bernomor")
    palet = palet or PALET
    ukuran = UKURAN.get(format_, UKURAN["carousel"])

    salah = periksa_palet(palet)
    folder = Path(root) / "tenant" / tenant / "keluaran" / "desain" / tanggal
    folder.mkdir(parents=True, exist_ok=True)

    catatan = []
    for s in slide:
        judul = s["teks"].split(".")[0][:70] if s["teks"] else s["label"]
        img = render(judul, s["teks"], s["nomor"], len(slide), ukuran, palet, footer)
        berkas = folder / ("slide-%02d.png" % s["nomor"])
        img.save(berkas)
        ukur = periksa_gambar(img, palet)
        catatan.append({
            "nomor": s["nomor"],
            "berkas": str(berkas),
            "judul": judul,
            "margin": {k: ukur[k] for k in ("kiri", "kanan", "atas", "bawah")},
            "pelanggaran": ukur["pelanggaran"],
        })

    laporan = {
        "tanggal": tanggal,
        "format": format_,
        "kanvas": list(ukuran),
        "margin_min": MARGIN,
        "zona_bawah_min": ZONA_BAWAH,
        "kontras": {n: kontras(palet[n], palet["latar"]) for n in ("teks", "aksen", "redup")},
        "palet_salah": salah,
        "slide": catatan,
        "lulus": not salah and all(not c["pelanggaran"] for c in catatan),
    }
    (folder / "laporan.json").write_text(json.dumps(laporan, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
    return laporan
