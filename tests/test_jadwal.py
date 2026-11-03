import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app import jadwal, penjadwal

JADWAL = [
    {"jam": "07:00", "agent": "vera", "tugas": "ringkas", "_jam": 7, "_menit": 0},
    {"jam": "09:00", "agent": "rian", "tugas": "jadwal", "_jam": 9, "_menit": 0},
]


class TestJadwal(unittest.TestCase):
    def test_jadwal_tenant_terbaca(self):
        daftar = jadwal.muat("tenant/jagoai/jadwal.toml")
        self.assertEqual(len(daftar), 8)
        jam = [s["jam"] for s in daftar]
        self.assertEqual(jam, sorted(jam))
        for s in daftar:
            self.assertGreaterEqual(s["_jam"], 0)

    def test_sebelum_jam_menunggu(self):
        kini = datetime(2026, 11, 3, 6, 30)
        self.assertEqual(jadwal.status_slot(JADWAL[0], kini, {}), "menunggu")

    def test_sesudah_jam_jatuh_tempo(self):
        kini = datetime(2026, 11, 3, 7, 5)
        self.assertEqual(jadwal.status_slot(JADWAL[0], kini, {}), "jatuh_tempo")

    def test_sudah_dicatat(self):
        kini = datetime(2026, 11, 3, 7, 5)
        catatan = {jadwal.kunci(JADWAL[0], kini): {"status": "selesai"}}
        self.assertEqual(jadwal.status_slot(JADWAL[0], kini, catatan), "sudah")

    def test_terlewat_tidak_dikejar(self):
        kini = datetime(2026, 11, 3, 11, 30)
        self.assertEqual(jadwal.status_slot(JADWAL[0], kini, {}), "terlewat")

    def test_hari_berikut_tidak_terhalang_catatan_kemarin(self):
        kemarin = datetime(2026, 11, 2, 7, 5)
        catatan = {jadwal.kunci(JADWAL[0], kemarin): {"status": "selesai"}}
        kini = datetime(2026, 11, 3, 7, 5)
        self.assertEqual(jadwal.status_slot(JADWAL[0], kini, catatan), "jatuh_tempo")

    def test_ringkasan_hari_urut(self):
        kini = datetime(2026, 11, 3, 11, 35)
        baris = jadwal.hari_ini(JADWAL, kini, {})
        self.assertEqual([b["jam"] for b in baris], ["07:00", "09:00"])
        self.assertEqual(baris[0]["status"], "terlewat")
        self.assertEqual(baris[1]["status"], "jatuh_tempo")


class TestPenjadwal(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        tujuan = self.root / "tenant" / "jagoai"
        (tujuan / "brief-karyawan").mkdir(parents=True)
        (tujuan / "jadwal.toml").write_text(
            "\n".join(['[[slot]]', 'jam = "07:00"', 'agent = "vera"', 'tugas = "ringkas"', '',
                      '[[slot]]', 'jam = "09:00"', 'agent = "rian"', 'tugas = "jadwal"', '']),
            encoding="utf-8")
        (tujuan / "office.toml").write_text("\n".join([
            'slug = "jagoai"',
            '[gerbang]',
            'base_url = "http://127.0.0.1:9/v1"',
            'kunci_env = "UJI"',
            '[karyawan.vera]',
            'jabatan = "Analis"',
            'model = "uji/model"',
            '[karyawan.rian]',
            'jabatan = "Perencana"',
            'model = "uji/model"',
            '']), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_hanya_slot_jatuh_tempo_yang_jalan(self):
        dijalankan = []

        def palsu(slot):
            dijalankan.append(slot["agent"])
            return {"shift_id": "shf_x", "tokens_in": 10, "tokens_out": 20}

        kini = datetime(2026, 11, 3, 11, 35)
        hasil = penjadwal.sekali(self.root, "jagoai", kini, eksekusi=palsu)
        self.assertEqual(dijalankan, ["rian"])
        self.assertEqual([h["status"] for h in hasil], ["terlewat", "selesai"])

        lagi = penjadwal.sekali(self.root, "jagoai", kini, eksekusi=palsu)
        self.assertEqual(dijalankan, ["rian"])
        self.assertEqual(lagi, [])

    def test_shift_ditunda_dicatat(self):
        from app import runtime

        def palsu(slot):
            raise runtime.ShiftDitunda("batas_tenant", "penuh")

        kini = datetime(2026, 11, 3, 9, 5)
        hasil = penjadwal.sekali(self.root, "jagoai", kini, eksekusi=palsu)
        self.assertEqual(hasil[-1]["status"], "ditunda")
        catatan = jadwal.sudah_jalan(self.root, "jagoai")
        nilai = list(catatan.values())[-1]
        self.assertEqual(nilai["alasan"], "batas_tenant")

    def test_galat_dicatat_tanpa_menghentikan_lain(self):
        def palsu(slot):
            if slot["agent"] == "vera":
                raise ValueError("gerbang menolak")
            return {"shift_id": "shf_y", "tokens_in": 1, "tokens_out": 2}

        kini = datetime(2026, 11, 3, 9, 5, 0)
        hasil = penjadwal.sekali(self.root, "jagoai", kini - timedelta(0), eksekusi=palsu)
        status = {h["slot"]["agent"]: h["status"] for h in hasil}
        self.assertEqual(status["rian"], "selesai")


if __name__ == "__main__":
    unittest.main()
