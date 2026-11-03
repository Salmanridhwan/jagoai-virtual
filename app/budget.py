"""Meteran token, penjaga gelembung panggilan, dan rekap per tenant."""
from datetime import datetime, timedelta

FORMAT = ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S")


def waktu(event):
    teks = str(event.get("ts", ""))
    for pola in FORMAT:
        try:
            return datetime.strptime(teks, pola)
        except ValueError:
            continue
    return None


def _tanggal(event):
    return str(event.get("ts", ""))[:10]


def terpakai(events, agent_id, tanggal):
    total = 0
    for e in events:
        if e.get("kind") != "llm_call":
            continue
        if e.get("agent_id") != agent_id:
            continue
        if _tanggal(e) != tanggal:
            continue
        total += int(e.get("tokens_in", 0)) + int(e.get("tokens_out", 0))
    return total


def boleh(events, agent_id, tanggal, batas, butuh=0):
    return terpakai(events, agent_id, tanggal) + butuh <= batas


def terpakai_tenant(events, tanggal):
    total = 0
    for e in events:
        if e.get("kind") != "llm_call":
            continue
        if _tanggal(e) != tanggal:
            continue
        total += int(e.get("tokens_in", 0)) + int(e.get("tokens_out", 0))
    return total


def panggilan_dalam_jendela(events, agent_id, menit=10, sekarang=None):
    sekarang = sekarang or datetime.now().astimezone()
    batas = sekarang - timedelta(minutes=menit)
    hitung = 0
    for e in events:
        if e.get("kind") != "llm_call" or e.get("agent_id") != agent_id:
            continue
        w = waktu(e)
        if w is None:
            continue
        if w.tzinfo is None:
            w = w.replace(tzinfo=sekarang.tzinfo)
        if w >= batas:
            hitung += 1
    return hitung


def gelembung(events, agent_id, menit=10, batas=12, sekarang=None):
    return panggilan_dalam_jendela(events, agent_id, menit, sekarang) >= batas
