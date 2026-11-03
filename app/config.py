"""Pembaca konfigurasi per tenant."""
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def tenant_dir(slug, root=None):
    return Path(root or ROOT) / "tenant" / slug


def load(slug, root=None):
    root = Path(root or ROOT)
    p = tenant_dir(slug, root) / "office.toml"
    if not p.exists():
        raise FileNotFoundError("konfigurasi tenant %s tidak ada: %s" % (slug, p))
    with p.open("rb") as f:
        cfg = tomllib.load(f)
    cfg["_tenant"] = slug
    cfg["_root"] = str(root)
    cfg["_path"] = str(p)
    return cfg


def karyawan(cfg, agent_id):
    nama = agent_id.split(":", 1)[1]
    daftar = cfg.get("karyawan", {})
    if nama not in daftar:
        raise KeyError("karyawan %s tidak terdaftar di %s" % (agent_id, cfg["_path"]))
    data = dict(daftar[nama])
    data["agent_id"] = agent_id
    return data
