import os
import tempfile
import unittest
from pathlib import Path

from app import config
from app import env as envmod


class TestEnv(unittest.TestCase):
    def test_membaca_pasangan(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".env"
            p.write_text('CDN_API_KEY=abc\n# komentar\nKOSONG=\n', encoding="utf-8")
            got = envmod.load_env(p)
        self.assertEqual(got["CDN_API_KEY"], "abc")
        self.assertEqual(got["KOSONG"], "")

    def test_berkas_tidak_ada_mengembalikan_kosong(self):
        got = envmod.load_env(Path("tidak-ada.env"))
        self.assertEqual(got, {})

    def test_get_prioritas_berkas_lalu_lingkungan(self):
        os.environ["UJI_X"] = "dari-env"
        self.assertEqual(envmod.get({"UJI_X": "dari-berkas"}, "UJI_X"), "dari-berkas")
        self.assertEqual(envmod.get({}, "UJI_X"), "dari-env")
        with self.assertRaises(KeyError):
            envmod.get({}, "TIDAK_ADA_SAMA_SEKALI")


class TestCekTanpaBocor(unittest.TestCase):
    def test_cek_tidak_memuat_nilai(self):
        sumber = {"JAGOAI_ROUTER_KEY": "rahasia-panjang-sekali", "JAGOAI_CDN_API_KEY": ""}
        baris = envmod.cek(sumber)
        kunci = {b["nama"]: b for b in baris}
        self.assertTrue(kunci["JAGOAI_ROUTER_KEY"]["ada"])
        self.assertEqual(kunci["JAGOAI_ROUTER_KEY"]["panjang"], len("rahasia-panjang-sekali"))
        self.assertFalse(kunci["JAGOAI_CDN_API_KEY"]["ada"])
        for b in baris:
            self.assertNotIn("nilai", b)
            self.assertNotIn("rahasia", str(b))


class TestPemisahanRahasiaDanAlamat(unittest.TestCase):
    def test_env_hanya_rahasia(self):
        for nama in envmod.WAJIB + envmod.OPSIONAL:
            self.assertFalse(
                nama.endswith(("_URL", "_NAME", "_PROYEK", "_PROJECT")),
                "alamat atau nama tidak boleh masuk .env: %s" % nama,
            )

    def test_office_toml_memuat_alamat(self):
        cfg = config.load("jagoai")
        self.assertTrue(cfg["gerbang"]["base_url"].startswith("https://"))
        self.assertIn("cdn_url", cfg["bahan"])
        self.assertIn("cdn_proyek", cfg["bahan"])
        self.assertEqual(cfg["bahan"]["cdn_kunci_env"], "JAGOAI_CDN_API_KEY")

    def test_template_hanya_rahasia(self):
        d = envmod.load_env(".env.example")
        for nama in d:
            self.assertFalse(nama.endswith(("_URL", "_NAME", "_PROYEK", "_PROJECT")), nama)


if __name__ == "__main__":
    unittest.main()
