import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app import papan, tugas

SLOT = {"tanggal": "2026-11-%02d", "kanal": "instagram", "format": "carousel", "topik": "cara mulai"}
SEKARANG = datetime(2026, 11, 3, 8, 0).astimezone()


def jadwal_sah():
    return [dict(SLOT, tanggal="2026-11-1%d" % i, topik="topik %d" % i) for i in range(4)]


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        t = self.root / "tenant" / "uji"
        (t / "brief-karyawan").mkdir(parents=True)
        (t / "office.toml").write_text("\n".join([
            'slug = "uji"',
            '[merek]',
            'bidang = "kelas website tanpa coding"',
            'kata_kunci = ["topik", "website"]',
            '[gerbang]',
            'base_url = "http://127.0.0.1:9/v1"',
            'kunci_env = "UJI"',
            '[karyawan.rian]', 'model = "uji/m"', 'jabatan = "Perencana"',
            '[karyawan.nadia]', 'model = "uji/m"', 'jabatan = "Penulis"',
            '']), encoding="utf-8")
        (t / "brief-karyawan" / "rian.md").write_text("# b", encoding="utf-8")
        (t / "brief-karyawan" / "nadia.md").write_text("# b", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()


class TestLarikJson(unittest.TestCase):
    def test_polos(self):
        self.assertEqual(tugas.larik_json('[{"a": 1}]'), [{"a": 1}])

    def test_berpagar(self):
        teks = "```json\n[{\"a\": 1}]\n```"
        self.assertEqual(tugas.larik_json(teks), [{"a": 1}])

    def test_ada_pembuka(self):
        teks = "Berikut jadwalnya:\n[{\"a\": 1}]\nSemoga membantu."
        self.assertEqual(tugas.larik_json(teks), [{"a": 1}])

    def test_bukan_json(self):
        self.assertIsNone(tugas.larik_json("maaf saya tidak bisa"))
        self.assertIsNone(tugas.larik_json(''))


class TestRian(Dasar):
    def test_jadwal_sah_ditulis(self):
        def palsu(t):
            return {"teks": json.dumps(jadwal_sah()), "shift_id": "shf_a", "tokens_in": 10, "tokens_out": 50}

        hasil = tugas.rian(self.root, "uji", "2026-11-09", sekarang=SEKARANG, eksekusi=palsu)
        self.assertTrue(Path(hasil["berkas"]).exists())
        self.assertEqual(len(papan.muat_jadwal(self.root, "uji", "2026-11-09")), 4)
        self.assertEqual(hasil["tokens"], 60)

    def test_topik_luar_bidang(self):
        luar = tugas.topik_luar_bidang(jadwal_sah(), ["website"])
        self.assertEqual(len(luar), 4)
        data = [{"topik": "cara bikin website"}, {"topik": "lipat baju"}]
        self.assertEqual(tugas.topik_luar_bidang(data, ["website"]), ["lipat baju"])

    def test_topik_luar_bidang_diulang(self):
        luar = [dict(SLOT, tanggal="2026-11-1%d" % i, topik="lipat baju %d" % i) for i in range(4)]
        dalam = jadwal_sah()
        dipanggil = []

        def palsu(t):
            dipanggil.append(t)
            data = luar if len(dipanggil) == 1 else dalam
            return {"teks": json.dumps(data), "shift_id": "shf_g", "tokens_in": 1, "tokens_out": 1}

        hasil = tugas.rian(self.root, "uji", "2026-11-09", sekarang=SEKARANG, eksekusi=palsu)
        self.assertEqual(len(dipanggil), 2)
        self.assertIn("keluar dari bidang", dipanggil[1])
        self.assertTrue(Path(hasil["berkas"]).exists())

    def test_topik_luar_bidang_dua_kali_berhenti(self):
        luar = [dict(SLOT, tanggal="2026-11-1%d" % i, topik="lipat baju %d" % i) for i in range(4)]

        def palsu(t):
            return {"teks": json.dumps(luar), "shift_id": "shf_h", "tokens_in": 1, "tokens_out": 1}

        with self.assertRaises(tugas.TugasGagal) as ctx:
            tugas.rian(self.root, "uji", "2026-11-09", sekarang=SEKARANG, eksekusi=palsu)
        self.assertIn("keluar dari bidang", ctx.exception.kesalahan[0])
        self.assertFalse(papan.path_jadwal(self.root, "uji", "2026-11-09").exists())

    def test_jadwal_cacat_diulang_lalu_berhasil(self):
        dipanggil = []

        def palsu(t):
            dipanggil.append(t)
            if len(dipanggil) == 1:
                return {"teks": "maaf, ini bukan json", "shift_id": "shf_a", "tokens_in": 1, "tokens_out": 1}
            return {"teks": json.dumps(jadwal_sah()), "shift_id": "shf_b", "tokens_in": 1, "tokens_out": 1}

        hasil = tugas.rian(self.root, "uji", "2026-11-09", sekarang=SEKARANG, eksekusi=palsu)
        self.assertEqual(len(dipanggil), 2)
        self.assertIn("Perbaiki kesalahan", dipanggil[1])
        self.assertTrue(Path(hasil["berkas"]).exists())

    def test_dua_kali_cacat_tidak_menulis_berkas(self):
        def palsu(t):
            return {"teks": "bukan json", "shift_id": "shf_a", "tokens_in": 1, "tokens_out": 1}

        with self.assertRaises(tugas.TugasGagal) as ctx:
            tugas.rian(self.root, "uji", "2026-11-09", sekarang=SEKARANG, eksekusi=palsu)
        self.assertIn("bukan larik JSON", ctx.exception.kesalahan[0])
        self.assertFalse(papan.path_jadwal(self.root, "uji", "2026-11-09").exists())


class TestNadia(Dasar):
    NASKAH = "\n".join(["## Hook", "1. satu", "2. dua", "3. tiga", "",
                        "## Naskah", "isi naskah", "", "## Caption", "caption", "",
                        "## Catatan", "bahan yang dibutuhkan"])

    def test_naskah_ditulis(self):
        def palsu(t):
            return {"teks": self.NASKAH, "shift_id": "shf_c", "tokens_in": 5, "tokens_out": 5}

        hasil = tugas.nadia(self.root, "uji", "2026-11-09", "2026-11-10", "cara mulai",
                            sekarang=SEKARANG, eksekusi=palsu)
        b = papan.baca_naskah(hasil["berkas"])
        self.assertEqual(b["kepala"]["status"], "draf")
        self.assertEqual(b["kepala"]["topik"] if "topik" in b["kepala"] else "cara mulai", "cara mulai")
        self.assertIn("## Hook", b["isi"])

    def test_bagian_kurang_diulang(self):
        dipanggil = []

        def palsu(t):
            dipanggil.append(t)
            if len(dipanggil) == 1:
                return {"teks": "## Hook\nsatu", "shift_id": "shf_d", "tokens_in": 1, "tokens_out": 1}
            return {"teks": self.NASKAH, "shift_id": "shf_e", "tokens_in": 1, "tokens_out": 1}

        tugas.nadia(self.root, "uji", "2026-11-09", "2026-11-10", "cara mulai",
                    sekarang=SEKARANG, eksekusi=palsu)
        self.assertIn("Bagian yang kurang", dipanggil[1])

    def test_dua_kali_kurang_berhenti(self):
        def palsu(t):
            return {"teks": "## Hook\nsatu", "shift_id": "shf_f", "tokens_in": 1, "tokens_out": 1}

        with self.assertRaises(tugas.TugasGagal):
            tugas.nadia(self.root, "uji", "2026-11-09", "2026-11-10", "cara mulai",
                        sekarang=SEKARANG, eksekusi=palsu)


if __name__ == "__main__":
    unittest.main()
