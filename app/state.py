"""Memetakan event menjadi state karyawan untuk kanvas kantor.

Aturan yang dipegang:
- state berasal dari event nyata, tidak ada yang dikarang
- durasi minimum menahan state pendek supaya tidak berkedip
- blocked hanya lepas kalau ada event persetujuan, bukan oleh waktu
- setelah sepuluh menit tanpa event, state turun ke ambient, dan ambient
  hanya boleh diam atau istirahat, tidak boleh terlihat bekerja
"""
from datetime import datetime

from app import budget

PETA = {
    "shift_start": "walk",
    "llm_call": "think",
    "file_write": "type",
    "edit_file": "type",
    "read_file": "read",
    "web_search": "read",
    "web_extract": "read",
    "render": "render",
    "review_pass": "review",
    "review_fail": "review",
    "present": "present",
    "package_ready": "ship",
    "published": "ship",
    "report_ready": "ship",
    "tool_error": "error",
    "shift_tertunda": "blocked",
    "budget_stop": "blocked",
    "persetujuan": "type",
    "shift_end": "sit",
}

PRIORITAS = {
    "blocked": 6,
    "error": 5,
    "ship": 4,
    "present": 3,
    "type": 3,
    "render": 3,
    "review": 3,
    "read": 2,
    "think": 2,
    "walk": 2,
    "sit": 1,
    "coffee": 1,
    "idle": 1,
    "sleep": 0,
}

DURASI_MIN = {"error": 6, "ship": 5, "present": 3, "review": 4, "type": 1.5}

AMBIENT_DETIK = 90


def state_dari_kind(kind):
    return PETA.get(kind, "sit")


def _umur(event, sekarang):
    w = budget.waktu(event)
    if w is None:
        return None
    if w.tzinfo is None:
        w = w.replace(tzinfo=sekarang.tzinfo)
    return (sekarang - w).total_seconds()


def ringkas(events, daftar_agent, sekarang=None, ambient_detik=AMBIENT_DETIK, izin_ambient=None,
            maks_coffee=3):
    """Kembalikan state terakhir tiap karyawan beserta sebabnya."""
    sekarang = sekarang or datetime.now().astimezone()
    hasil = {}
    for agent_id in daftar_agent:
        milik = [e for e in events if e.get("agent_id") == agent_id]
        boleh_ambient = True
        if isinstance(izin_ambient, dict):
            boleh_ambient = bool(izin_ambient.get(agent_id, True))
        if not milik:
            hasil[agent_id] = {
                "state": "sleep",
                "sebab": "belum ada event",
                "umur_detik": None,
                "shift_id": None,
            }
            continue

        terakhir = milik[-1]
        state = state_dari_kind(terakhir.get("kind"))
        umur = _umur(terakhir, sekarang)

        if state == "blocked":
            pass
        elif umur is None:
            pass
        elif state in DURASI_MIN and umur < DURASI_MIN[state]:
            pass
        elif umur > ambient_detik:
            state = "coffee" if boleh_ambient else "idle"
        elif state in DURASI_MIN:
            state = "sit"

        hasil[agent_id] = {
            "state": state,
            "sebab": terakhir.get("kind"),
            "umur_detik": None if umur is None else round(umur, 1),
            "shift_id": terakhir.get("shift_id"),
        }

    # orang tidak ngopi bersamaan: hanya beberapa yang paling lama diam
    calon = [a for a, v in hasil.items() if v["state"] == "coffee"]
    calon.sort(key=lambda a: hasil[a]["umur_detik"] or 0, reverse=True)
    for a in calon[maks_coffee:]:
        hasil[a]["state"] = "idle"

    return hasil


def ambil_terakhir(events, agent_id, jumlah=5):
    milik = [e for e in events if e.get("agent_id") == agent_id]
    return milik[-jumlah:]
