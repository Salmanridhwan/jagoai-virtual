"""Pembaca berkas .env sederhana, tanpa dependensi."""
import os
from pathlib import Path


def load_env(path):
    hasil = {}
    p = Path(path)
    if not p.exists():
        return hasil
    for baris in p.read_text(encoding="utf-8").splitlines():
        baris = baris.strip()
        if not baris or baris.startswith("#") or "=" not in baris:
            continue
        kunci, nilai = baris.split("=", 1)
        nilai = nilai.strip().strip('"').strip("'")
        hasil[kunci.strip()] = nilai
    return hasil


def get(sumber, nama):
    if nama in sumber:
        return sumber[nama]
    if nama in os.environ:
        return os.environ[nama]
    raise KeyError("variabel %s tidak ada di .env maupun lingkungan" % nama)


WAJIB = ["JAGOAI_ROUTER_KEY"]

OPSIONAL = [
    "JAGOAI_CDN_API_KEY",
    "JAGOAI_CDN_JWT_TOKEN",
    "JAGOAI_THREADS_TOKEN",
    "JAGOAI_INSTAGRAM_TOKEN",
    "JAGOAI_TIKTOK_TOKEN",
    "JAGOAI_OPENPOST_TOKEN",
]


def cek(sumber):
    """Periksa keberadaan variabel tanpa pernah menampilkan nilainya."""
    hasil = []
    for nama in WAJIB + OPSIONAL:
        nilai = sumber.get(nama) or os.environ.get(nama) or ""
        hasil.append({
            "nama": nama,
            "wajib": nama in WAJIB,
            "ada": bool(nilai),
            "panjang": len(nilai),
        })
    return hasil
