import json
import threading
import unittest
import urllib.request
from datetime import datetime, timedelta

from app import server


def _pekan():
    hari = datetime.now().date()
    return (hari - timedelta(days=hari.weekday())).isoformat()

class TestServer(unittest.TestCase):
    def setUp(self):
        self.srv = server.buat(tenant="jagoai", host="127.0.0.1", port=0)
        self.port = self.srv.server_address[1]
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()
        self.base = "http://127.0.0.1:%d" % self.port

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def _get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=10) as r:
            return r.status, r.read().decode()

    def test_health(self):
        kode, isi = self._get("/api/health")
        self.assertEqual(kode, 200)
        self.assertTrue(json.loads(isi)["ok"])

    def test_state_berisi_karyawan(self):
        kode, isi = self._get("/api/state")
        data = json.loads(isi)
        self.assertEqual(kode, 200)
        self.assertEqual(data["tenant"], "jagoai")
        nama = [k["nama"].lower() for k in data["karyawan"]]
        from app import config
        cfg = config.load("jagoai")
        self.assertEqual(len(nama), len(cfg["karyawan"]))
        for slug in cfg["karyawan"]:
            self.assertIn(slug, nama)
        for k in data["karyawan"]:
            self.assertIn(k["state"], server.state.PRIORITAS)
            self.assertIsInstance(k["events"], list)

    def test_halaman_kanvas(self):
        kode, isi = self._get("/")
        self.assertEqual(kode, 200)
        self.assertIn("kanvas", isi.lower())

    def test_halaman_data_dan_kontrol(self):
        for alamat in ("/data", "/kontrol"):
            kode, isi = self._get(alamat)
            self.assertEqual(kode, 200)
            self.assertIn("<html", isi.lower())

    def test_tabel_data(self):
        kode, badan = self._get("/api/data/ringkasan?pekan=%s" % _pekan())
        self.assertEqual(kode, 200)
        d = json.loads(badan)
        self.assertEqual(d["tabel"], "ringkasan")
        self.assertEqual(len(d["baris"]), 7)

    def test_tabel_tidak_dikenal(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._get("/api/data/karangan?pekan=%s" % _pekan())
        self.assertEqual(ctx.exception.code, 404)

    def test_ekspor_csv_dari_server(self):
        kode, badan = self._get("/api/data/biaya?pekan=%s&format=csv" % _pekan())
        self.assertEqual(kode, 200)
        self.assertTrue(badan.splitlines()[0].startswith("karyawan"))

    def test_cocokkan_nol(self):
        kode, badan = self._get("/api/cocokkan?pekan=%s" % _pekan())
        self.assertEqual(kode, 200)
        d = json.loads(badan)
        self.assertTrue(d["lulus"], d["selisih"])

    def test_kontrol(self):
        kode, badan = self._get("/api/kontrol?pekan=%s" % _pekan())
        self.assertEqual(kode, 200)
        d = json.loads(badan)
        self.assertTrue(any(t["tenant"] == "jagoai" for t in d["tenant"]))
    def test_alamat_tidak_dikenal(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._get("/tidak-ada")
        self.assertEqual(ctx.exception.code, 404)


class TestSnapshot(unittest.TestCase):
    def test_snapshot_pada_waktu_tetap(self):
        waktu = datetime(2026, 11, 3, 12, 0, 0).astimezone()
        data = server.snapshot("jagoai", sekarang=waktu)
        self.assertEqual(data["tanggal"], "2026-11-03")
        self.assertGreaterEqual(data["total_event"], 0)
        for k in data["karyawan"]:
            self.assertIsNotNone(k["rencana_token"])

if __name__ == "__main__":
    unittest.main()
