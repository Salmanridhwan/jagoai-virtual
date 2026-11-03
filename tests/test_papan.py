import json
import tempfile
import unittest
from pathlib import Path

from app import papan

SLOT = {"tanggal": "2026-11-10", "kanal": "instagram", "format": "carousel", "topik": "cara mulai tanpa coding"}


class TestPapan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_slug(self):
        self.assertEqual(papan.slug("Cara Mulai Tanpa Coding!"), "cara-mulai-tanpa-coding")
        self.assertEqual(papan.slug(""), "tanpa-topik")

    def test_validasi_sah(self):
        data = [dict(SLOT, tanggal="2026-11-%02d" % (10 + i)) for i in range(3)]
        self.assertEqual(papan.validasi_jadwal(data), [])

    def test_validasi_bukan_daftar(self):
        self.assertEqual(papan.validasi_jadwal({"slot": []}), ["jadwal harus berupa daftar"])

    def test_validasi_kurang_tiga(self):
        salah = papan.validasi_jadwal([SLOT])
        self.assertIn("jadwal minimal tiga slot", salah)

    def test_validasi_tanggal_salah(self):
        data = [dict(SLOT, tanggal="10-11-2026") for _ in range(3)]
        salah = papan.validasi_jadwal(data)
        self.assertTrue(any("tanpa tanggal" in s for s in salah))

    def test_validasi_tanggal_dobel(self):
        data = [dict(SLOT) for _ in range(3)]
        salah = papan.validasi_jadwal(data)
        self.assertTrue(any("dobel" in s for s in salah))

    def test_validasi_format_kanal_topik(self):
        data = [dict(SLOT, tanggal="2026-11-1%d" % i, format="reels", kanal="facebook", topik="  ")
                for i in range(3)]
        salah = papan.validasi_jadwal(data)
        self.assertTrue(any("format" in s for s in salah))
        self.assertTrue(any("kanal" in s for s in salah))
        self.assertTrue(any("topik" in s for s in salah))

    def test_simpan_dan_muat(self):
        data = [dict(SLOT, tanggal="2026-11-1%d" % i) for i in range(3)]
        p = papan.simpan_jadwal(self.root, "uji", "2026-11-09", data)
        self.assertTrue(p.exists())
        self.assertEqual(papan.muat_jadwal(self.root, "uji", "2026-11-09"), data)
        self.assertIsNone(papan.muat_jadwal(self.root, "uji", "2026-12-01"))
        isi = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(isi["pekan"], "2026-11-09")

    def test_tulis_naskah_dan_baca(self):
        isi = "## Hook\n1. satu\n## Naskah\nisi\n## Caption\ncap\n## Catatan\ncatatan"
        p = papan.tulis_naskah(self.root, "uji", "2026-11-09", "2026-11-10",
                               "cara mulai", isi)
        self.assertTrue(p.exists())
        b = papan.baca_naskah(p)
        self.assertEqual(b["kepala"]["status"], "draf")
        self.assertEqual(b["kepala"]["tanggal"], "2026-11-10")
        self.assertEqual(b["kepala"]["disetujui_oleh"], "")
        self.assertIn("## Hook", b["isi"])

    def test_bagian_hilang(self):
        kurang = papan.bagian_hilang("## Hook\nsatu\n## Caption\ncap")
        self.assertEqual(kurang, ["Naskah", "Catatan"])
        self.assertEqual(papan.bagian_hilang("## Hook\n## Naskah\n## Caption\n## Catatan"), [])

    def test_kolom_papan(self):
        data = [dict(SLOT, tanggal="2026-11-%02d" % (10 + i), topik="topik %d" % i) for i in range(3)]
        papan.simpan_jadwal(self.root, "uji", "2026-11-09", data)
        kolom = papan.kolom(self.root, "uji", "2026-11-09")
        self.assertEqual(len(kolom["belum"]), 3)
        self.assertEqual(kolom["draf"], [])

        isi = "## Hook\n## Naskah\n## Caption\n## Catatan"
        papan.tulis_naskah(self.root, "uji", "2026-11-09", "2026-11-10", "topik 0", isi)
        kolom = papan.kolom(self.root, "uji", "2026-11-09")
        self.assertEqual(len(kolom["belum"]), 2)
        self.assertEqual(len(kolom["draf"]), 1)
        self.assertEqual(len(kolom["siap"]), 0)

        p = papan.path_naskah(self.root, "uji", "2026-11-09", "2026-11-10", "topik-0")
        teks = p.read_text(encoding="utf-8").replace("status: draf", "status: siap")
        p.write_text(teks, encoding="utf-8")
        kolom = papan.kolom(self.root, "uji", "2026-11-09")
        self.assertEqual(len(kolom["siap"]), 1)


if __name__ == "__main__":
    unittest.main()
