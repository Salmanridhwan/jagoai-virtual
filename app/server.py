"""Server kantor, satu berkas, tanpa dependensi.

Menyajikan satu halaman dan dua alamat data:
  GET /            kanvas kantor
  GET /api/state   keadaan karyawan sekarang, dari events.jsonl
  GET /api/health  tanda hidup
"""
import argparse
import json
import urllib.parse
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from app import budget, config, events, papan, state

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


class Kantor(BaseHTTPRequestHandler):
    tenant = "jagoai"
    def _json(self, data, kode=200):
        isi = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(kode)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(isi)))
        self.end_headers()
        self.wfile.write(isi)

    def _berkas(self, path, jenis):
        if not path.exists():
            self.send_error(404)
            return
        isi = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", jenis)
        self.send_header("Content-Length", str(len(isi)))
        self.end_headers()
        self.wfile.write(isi)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ("/", "/index.html"):
            return self._berkas(WEB / "index.html", "text/html; charset=utf-8")
        if u.path == "/api/health":
            return self._json({"ok": True, "tenant": self.tenant})
        if u.path == "/api/state":
            try:
                return self._json(snapshot(self.tenant))
            except FileNotFoundError as e:
                return self._json({"error": str(e)}, 404)
        if u.path == "/api/papan":
            pekan = (urllib.parse.parse_qs(u.query).get("pekan") or [""])[0] or pekan_berjalan()
            data = papan.kolom(ROOT, self.tenant, pekan)
            return self._json({"tenant": self.tenant, "pekan": pekan, **data})
        if u.path in ("/papan", "/papan.html"):
            return self._berkas(WEB / "papan.html", "text/html; charset=utf-8")
        return self._json({"error": "alamat tidak dikenal"}, 404)

    def log_message(self, *args):
        pass


def pekan_berjalan(sekarang=None):
    """Tanggal Senin pekan ini, bentuk YYYY-MM-DD."""
    hari = (sekarang or datetime.now().astimezone()).date()
    return (hari - timedelta(days=hari.weekday())).isoformat()


def snapshot(tenant, sekarang=None):
    cfg = config.load(tenant)
    root = Path(cfg["_root"])
    log = root / "tenant" / tenant / "events.jsonl"
    semua = events.read_all(log)
    if sekarang is None:
        tanggal = events.now_iso()[:10]
        sekarang_iso = events.now_iso()
    else:
        tanggal = str(getattr(sekarang, "isoformat", lambda: sekarang)())[:10]
        sekarang_iso = str(getattr(sekarang, "isoformat", lambda: sekarang)())

    daftar = {}
    izin = {}
    for nama, k in cfg.get("karyawan", {}).items():
        aid = "%s:%s" % (tenant, nama)
        daftar[nama] = aid
        izin[aid] = bool(k.get("izin_ambient", True))

    keadaan = state.ringkas(semua, list(daftar.values()), sekarang=sekarang, izin_ambient=izin)

    karyawan = []
    for nama, k in cfg.get("karyawan", {}).items():
        aid = daftar[nama]
        s = keadaan[aid]
        karyawan.append({
            "agent_id": aid,
            "nama": nama.capitalize(),
            "jabatan": k.get("jabatan", ""),
            "meja": k.get("meja", ""),
            "model": k.get("model", ""),
            "state": s["state"],
            "sebab": s["sebab"],
            "umur_detik": s["umur_detik"],
            "token_hari_ini": budget.terpakai(semua, aid, tanggal),
            "rencana_token": k.get("rencana_token_harian"),
            "events": [
                {"kind": e.get("kind"), "ts": e.get("ts"), "summary": e.get("summary", "")}
                for e in state.ambil_terakhir(semua, aid, 5)
            ],
        })

    return {
        "tenant": tenant,
        "tanggal": tanggal,
        "sekarang": sekarang_iso,
        "total_event": len(semua),
        "token_tenant_hari_ini": budget.terpakai_tenant(semua, tanggal),
        "batas_tenant": cfg["gerbang"].get("batas_harian_tenant"),
        "karyawan": karyawan,
    }


def buat(tenant="jagoai", host="127.0.0.1", port=4500):
    Kantor.tenant = tenant
    return ThreadingHTTPServer((host, port), Kantor)


def main(argv=None):
    p = argparse.ArgumentParser(prog="kantor")
    p.add_argument("--tenant", default="jagoai")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=4500)
    a = p.parse_args(argv)
    srv = buat(a.tenant, a.host, a.port)
    print("kantor siap: http://%s:%d" % (a.host, a.port))
    print("tekan Ctrl+C untuk berhenti")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("berhenti")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
