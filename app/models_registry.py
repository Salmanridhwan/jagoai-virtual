"""Daftar model dari gerbang, dengan cache di berkas."""
import json
from pathlib import Path

from app import events, gateway


def sync(base_url, kunci, cache_path):
    data = gateway.list_models(base_url, kunci)
    cache_path = Path(cache_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps({"diambil": events.now_iso(), "data": data}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return data


def load_cache(cache_path):
    p = Path(cache_path)
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("data", [])


def model_ada(data, model_id):
    return any(m.get("id") == model_id for m in data)
