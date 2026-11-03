import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app import desain, papan

NASKAH = "\n".join([
    "## Hook",
    "1. satu",
    "## Naskah",
    "**Slide 1 (Cover)**",
    "Visual: teks besar",
    "Teks: \"5 Platform No-Code Gratis\"",
    "",
    "**Slide 2**",
    "Visual: logo",
    "Teks: \"Framer, desain sekaligus publish tanpa coding\"",
    "",
    "**Slide 3 (CTA)**",
    "Teks: \"Mulai dari satu project, publish, iterasi\"",
    "",
    "## Caption",
    "caption",
])


class TestKontras(unittest.TestCase):
    def test_kontras_putih_terhadap_gelap(self):
        self.assertGreater(desain.kontras("#FFFFFF", "#000000"), 20)

    def test_kontras_sama(self):
        self.assertEqual(desain.kontras("#123456", "#123456"), 1.0)

    def test_palet_bawaan_lulus(self):
        self.assertEqual(desain.periksa_palet(desain.PALET), [])

    def test_palet_buruk_ditolak(self):
        salah = desain.periksa_palet({"latar": "#111111", "teks": "#222222",
                                      "aksen": "#333333", "redup": "#2a2a2a"})
        self.assertEqual(len(salah), 3)


class TestBungkus(unittest.TestCase):
    def test_membungkus(self):
        f = desain._font(desain.FONT_BIASA, 44)
        baris = desain.bungkus("kata " * 60, f, 400)
        self.assertGreater(len(baris), 1)
        for b in baris:
            self.assertLessEqual(f.getlength(b), 400.5)


class TestBacaSlide(unittest.TestCase):
    def test_tiga_slide(self):
        slide = desain.baca_slide(NASKAH)
        self.assertEqual([s["nomor"] for s in slide], [1, 2, 3])
        self.assertEqual(slide[0]["teks"], "5 Platform No-Code Gratis")
        self.assertIn("Framer", slide[1]["teks"])
        self.assertIn("Cover", slide[0]["label"])

    def test_tanpa_bagian_naskah(self):
        self.assertEqual(desain.baca_slide("## Hook\nsatu"), [])


class TestPeriksaGambar(unittest.TestCase):
    def test_gambar_aman_lulus(self):
        img = desain.render("Judul", "Isi slide yang pendek.", 1, 3)
        hasil = desain.periksa_gambar(img)
        self.assertEqual(hasil["pelanggaran"], [])
        self.assertGreaterEqual(hasil["kiri"], desain.MARGIN)
        self.assertGreaterEqual(hasil["bawah"], desain.ZONA_BAWAH)

    def test_teks_menempel_tepi_ditolak(self):
        img = Image.new("RGB", (1080, 1350), desain._rgb(desain.PALET["latar"]))
        img.putpixel((3, 3), (255, 255, 255))
        hasil = desain.periksa_gambar(img)
        self.assertTrue(any("margin kiri" in p for p in hasil["pelanggaran"]))
        self.assertTrue(any("margin atas" in p for p in hasil["pelanggaran"]))

    def test_isi_masuk_zona_bawah_ditolak(self):
        img = Image.new("RGB", (1080, 1350), desain._rgb(desain.PALET["latar"]))
        img.putpixel((500, 1340), (255, 255, 255))
        hasil = desain.periksa_gambar(img)
        self.assertTrue(any("zona bawah" in p for p in hasil["pelanggaran"]))

    def test_gambar_kosong(self):
        img = Image.new("RGB", (1080, 1350), desain._rgb(desain.PALET["latar"]))
        self.assertEqual(desain.periksa_gambar(img)["pelanggaran"], ["gambar kosong"])


class TestBuat(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.naskah = papan.tulis_naskah(self.root, "uji", "2026-11-09", "2026-11-09",
                                         "cara mulai", NASKAH)

    def tearDown(self):
        self.tmp.cleanup()

    def test_menghasilkan_tiga_slide_dan_laporan(self):
        laporan = desain.buat(self.root, "uji", "2026-11-09", self.naskah)
        self.assertTrue(laporan["lulus"])
        self.assertEqual(len(laporan["slide"]), 3)
        for s in laporan["slide"]:
            self.assertTrue(Path(s["berkas"]).exists())
            self.assertEqual(s["pelanggaran"], [])
        berkas_laporan = Path(laporan["slide"][0]["berkas"]).parent / "laporan.json"
        self.assertTrue(berkas_laporan.exists())
        isi = json.loads(berkas_laporan.read_text(encoding="utf-8"))
        self.assertEqual(isi["kanvas"], [1080, 1350])

    def test_ukuran_kanvas_cerita(self):
        laporan = desain.buat(self.root, "uji", "2026-11-10", self.naskah, format_="cerita")
        self.assertEqual(laporan["kanvas"], [1080, 1920])

    def test_naskah_tanpa_slide_ditolak(self):
        p = papan.tulis_naskah(self.root, "uji", "2026-11-09", "2026-11-11", "kosong",
                               "## Hook\nsatu\n## Caption\ncap")
        with self.assertRaises(ValueError):
            desain.buat(self.root, "uji", "2026-11-11", p)


if __name__ == "__main__":
    unittest.main()
