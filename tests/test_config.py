import tempfile
import unittest
from pathlib import Path

from app import config

TOML = """
[tenant]
slug = "uji"
nama = "Uji"
paket = "dasar"

[gerbang]
base_url = "https://contoh.invalid/v1"
kunci_env = "UJI_KEY"
batas_harian_tenant = 100000

[karyawan.nadia]
jabatan = "Penulis Naskah"
meja = "tetap:3"
model_kelas = "standar"
anggaran_token_harian = 500000
izin_ambient = true
"""


class TestConfig(unittest.TestCase):
    def test_membaca_tenant(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "tenant" / "uji").mkdir(parents=True)
            (root / "tenant" / "uji" / "office.toml").write_text(TOML, encoding="utf-8")
            cfg = config.load("uji", root=root)
        self.assertEqual(cfg["tenant"]["slug"], "uji")
        self.assertEqual(cfg["karyawan"]["nadia"]["meja"], "tetap:3")
        self.assertEqual(cfg["_tenant"], "uji")

    def test_tenant_tidak_ada(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):
                config.load("hilang", root=Path(d))

    def test_karyawan_tidak_terdaftar(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "tenant" / "uji").mkdir(parents=True)
            (root / "tenant" / "uji" / "office.toml").write_text(TOML, encoding="utf-8")
            cfg = config.load("uji", root=root)
            with self.assertRaises(KeyError):
                config.karyawan(cfg, "uji:hilang")


if __name__ == "__main__":
    unittest.main()
