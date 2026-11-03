"""Jadwal harian: membaca slot, menentukan mana yang jatuh tempo, mencatatnya.

Catatan disimpan di state/jadwal.json supaya proses yang dijalankan ulang tidak
mengulang shift yang sudah berjalan hari itu. Slot yang terlewat lebih dari
toleransi tidak dikejar, karena menjalankan pekerjaan kemarin bukan hal yang
benar.
"""
import json
import tomllib
from datetime import datetime, timedelta
from pathlib import Path

TOLERANSI_MENIT = 180


def muat(path):
    with open(path, "rb") as f:
        data = tomllib.load(f)
    slot = data.get("slot", [])
    for s in slot:
        jam, menit = s["jam"].split(":")
        s["_jam"] = int(jam)
        s["_menit"] = int(menit)
    return slot


def _berkas_state(root, tenant):
    return Path(root) / "tenant" / tenant / "state" / "jadwal.json"


def sudah_jalan(root, tenant):
    p = _berkas_state(root, tenant)
    if not p.exists():
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def kunci(slot, sekarang):
    return "%s|%s|%s" % (sekarang.date().isoformat(), slot["agent"], slot["jam"])


def target(slot, sekarang):
    return sekarang.replace(hour=slot["_jam"], minute=slot["_menit"], second=0, microsecond=0)


def status_slot(slot, sekarang, catatan, toleransi_menit=TOLERANSI_MENIT):
    """Kembalikan menunggu, jatuh_tempo, atau terlewat."""
    if kunci(slot, sekarang) in catatan:
        return "sudah"
    t = target(slot, sekarang)
    if sekarang < t:
        return "menunggu"
    if sekarang - t > timedelta(minutes=toleransi_menit):
        return "terlewat"
    return "jatuh_tempo"


def tandai(root, tenant, kunci_slot, isi):
    p = _berkas_state(root, tenant)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = sudah_jalan(root, tenant)
    data[kunci_slot] = isi
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    return data


def hari_ini(jadwal, sekarang, catatan, toleransi_menit=TOLERANSI_MENIT):
    """Ringkasan seluruh slot untuk satu hari, urut jam."""
    hasil = []
    for s in sorted(jadwal, key=lambda x: x["jam"]):
        hasil.append({
            "jam": s["jam"],
            "agent": s["agent"],
            "status": status_slot(s, sekarang, catatan, toleransi_menit),
        })
    return hasil
