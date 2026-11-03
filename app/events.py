"""Pencatat event append-only, satu baris satu event."""
import json
import os
import time
import uuid
from pathlib import Path


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def new_id():
    return "evt_" + uuid.uuid4().hex[:12]


def append(path, rec):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = dict(rec)
    rec.setdefault("id", new_id())
    rec.setdefault("ts", now_iso())
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())
    return rec


def read_all(path):
    path = Path(path)
    if not path.exists():
        return []
    hasil = []
    for baris in path.read_text(encoding="utf-8").splitlines():
        baris = baris.strip()
        if not baris:
            continue
        try:
            hasil.append(json.loads(baris))
        except json.JSONDecodeError:
            continue
    return hasil
