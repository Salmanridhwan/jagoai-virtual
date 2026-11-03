"""Pembaca dan pemeriksa brief karyawan.

Aturan kutipan: kata terlarang boleh ditulis di bagian Larangan asal dikurung
backtick, misalnya `dijamin`. Penjaga memeriksa teks di luar kutipan untuk kata,
tetapi tetap memeriksa seluruh teks untuk kredensial, karena kunci API berbahaya
di mana pun ia berada.
"""
import hashlib
import re
from pathlib import Path

WAJIB = ["agent_id", "versi", "diubah_oleh", "tanggal", "status"]

POLA_KREDENSIAL = [
    (re.compile(r"sk-[A-Za-z0-9_-]{8,}"), "kunci API"),
    (re.compile(r"ghp_[A-Za-z0-9]{8,}"), "token GitHub"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]{8,}"), "token bearer"),
]

POLA_KATA = [
    (re.compile(r"(?i)\b(?:rp\.?\s?\d|idr\s?\d|\d+\s?(?:rb|ribu|juta)\b)"), "harga"),
    (re.compile(r"(?i)\b(dijamin|pasti untung|terbaik di dunia)\b"), "klaim"),
]

_KUTIP = re.compile(r"`[^`\n]*`")
_PAGAR = re.compile(r"```.*?```", re.S)


class BriefError(ValueError):
    pass


def tanpa_kutipan(teks):
    return _KUTIP.sub(" ", _PAGAR.sub(" ", teks))


def parse(teks):
    header = {}
    bagian = {}
    sedang = None
    for baris in teks.splitlines():
        if baris.startswith("## "):
            sedang = baris[3:].strip()
            bagian[sedang] = []
            continue
        if sedang is None:
            if ":" in baris and not baris.startswith("#"):
                k, v = baris.split(":", 1)
                header[k.strip()] = v.strip()
        else:
            bagian[sedang].append(baris)

    for nama in WAJIB:
        if not header.get(nama):
            raise BriefError("bidang wajib kosong: %s" % nama)
    try:
        header["versi"] = int(header["versi"])
    except ValueError:
        raise BriefError("versi harus angka")

    for pola, alasan in POLA_KREDENSIAL:
        if pola.search(teks):
            raise BriefError("brief memuat %s yang dilarang" % alasan)

    bersih = tanpa_kutipan(teks)
    for pola, alasan in POLA_KATA:
        if pola.search(bersih):
            raise BriefError("brief memuat %s yang dilarang di luar kutipan" % alasan)

    teks_bagian = {k: "\n".join(v).strip() for k, v in bagian.items()}
    if not teks_bagian.get("Riwayat"):
        raise BriefError("bagian Riwayat kosong")

    return {
        "agent_id": header["agent_id"],
        "versi": header["versi"],
        "diubah_oleh": header["diubah_oleh"],
        "tanggal": header["tanggal"],
        "status": header["status"],
        "bagian": teks_bagian,
        "teks": teks,
        "hash": hashlib.sha256(teks.encode()).hexdigest()[:16],
    }


def muat(path):
    return parse(Path(path).read_text(encoding="utf-8"))
