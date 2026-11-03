import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app import antrean, mira

SEKARANG = datetime(2026, 11, 3, 18, 0).astimezone()
TANGGAL = "2026-11-09"


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        t = self.root / "tenant" / "uji"
        (t / "keluaran" / "tinjauan").mkdir(parents=True)
        (t / "keluaran" / "percakapan").mkdir(parents=True)
        (t / "office.toml").write_text("\n".join([
            'slug = "uji"',
            '[kanal]', 'instagram_env = "UJI_IG"', 'threads_env = "UJI_TH"',
            '[gerbang]', 'base_url = "http://127.0.0.1:9/v1"', 'kunci_env = "UJI"', '']),
            encoding="utf-8")
        (t / ".env").write_text("", encoding="utf-8")
        self.tenant = t

    def tearDown(self):
        self.tmp.cleanup()

    def tulis_tinjauan(self, status="lulus", video="video-9x16.mp4", temuan=None):
        (self.tenant / "keluaran" / "tinjauan" / (TANGGAL + ".json")).write_text(json.dumps({
            "tanggal": TANGGAL, "status": status,
            "temuan_isi": temuan or [], "angka_tanpa_dasar": [],
            "berkas": {"video": video},
        }), encoding="utf-8")

    def tulis_percakapan(self, draf):
        (self.tenant / "keluaran" / "percakapan" / ("2026-11-03.json")).write_text(
            json.dumps({"tanggal": "2026-11-03", "draf": draf, "ditolak": []}), encoding="utf-8")


class TestPaketMira(Dasar):
    def test_belum_ditinjau(self):
        paket = mira.paket(self.root, "uji", TANGGAL)
        self.assertEqual(paket["siap"], [])
        self.assertEqual(paket["tertahan"][0]["alasan"], "belum ditinjau Omar")

    def test_ditolak_omar_masuk_tertahan(self):
        self.tulis_tinjauan("tolak", temuan=[{"tingkat": "tolak", "alasan": "klaim tanpa dasar"}])
        paket = mira.paket(self.root, "uji", TANGGAL)
        self.assertEqual(paket["siap"], [])
        self.assertEqual(paket["tertahan"][0]["alasan"], "Omar menolak")
        self.assertEqual(paket["tertahan"][0]["temuan"], ["klaim tanpa dasar"])

    def test_manual_masuk_tertahan(self):
        self.tulis_tinjauan("manual")
        paket = mira.paket(self.root, "uji", TANGGAL)
        self.assertIn("tidak bisa menilai", paket["tertahan"][0]["alasan"])

    def test_lulus_siap_diputuskan(self):
        self.tulis_tinjauan("lulus")
        paket = mira.paket(self.root, "uji", TANGGAL)
        self.assertEqual(paket["siap"][0]["status"], "menunggu persetujuan")
        self.assertEqual(paket["menunggu_keputusan"], 1)

    def test_draf_balasan_masuk_paket(self):
        self.tulis_percakapan([{"id": "p1", "akun": "a", "status": "menunggu_persetujuan", "draf": "halo"}])
        paket = mira.paket(self.root, "uji", "2026-11-03")
        self.assertEqual(paket["siap"][0]["jenis"], "balasan")


class TestSetujuiMira(Dasar):
    def test_wajib_lulus(self):
        self.tulis_tinjauan("tolak")
        with self.assertRaises(ValueError):
            mira.setujui_konten(self.root, "uji", TANGGAL, "salman")

    def test_wajib_nama(self):
        self.tulis_tinjauan("lulus")
        with self.assertRaises(ValueError):
            mira.setujui_konten(self.root, "uji", TANGGAL, "  ")

    def test_mencatat_siapa(self):
        self.tulis_tinjauan("lulus")
        data = mira.setujui_konten(self.root, "uji", TANGGAL, "salman", "ok", SEKARANG)
        self.assertEqual(data["oleh"], "salman")
        self.assertTrue(mira.sudah_disetujui(self.root, "uji", TANGGAL))


class TestAntreanKiki(Dasar):
    def test_konten_tanpa_persetujuan_ditolak(self):
        self.tulis_tinjauan("lulus")
        hasil = antrean.susun(self.root, "uji", TANGGAL, sekarang=SEKARANG)
        self.assertEqual(hasil["masuk"], [])
        self.assertIn("belum ada persetujuan manusia", hasil["ditolak"][0]["alasan"])

    def test_konten_lulus_dan_disetujui_masuk_manual(self):
        self.tulis_tinjauan("lulus")
        mira.setujui_konten(self.root, "uji", TANGGAL, "salman", sekarang=SEKARANG)
        hasil = antrean.susun(self.root, "uji", TANGGAL, sekarang=SEKARANG)
        self.assertEqual(len(hasil["masuk"]), 1)
        self.assertEqual(hasil["masuk"][0]["status"], "siap_unggah_manual")
        self.assertIn("token instagram belum ada", hasil["masuk"][0]["alasan"])

    def test_tinjauan_tolak_tidak_masuk(self):
        self.tulis_tinjauan("tolak")
        folder = self.tenant / "keluaran" / "persetujuan"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / (TANGGAL + ".json")).write_text(json.dumps(
            {"tanggal": TANGGAL, "konten": [{"tanggal": TANGGAL, "oleh": "salman"}]}),
            encoding="utf-8")
        hasil = antrean.susun(self.root, "uji", TANGGAL, sekarang=SEKARANG)
        self.assertEqual(hasil["masuk"], [])
        self.assertIn("status tinjauan tolak", hasil["ditolak"][0]["alasan"])

    def test_balasan_belum_disetujui_ditolak(self):
        self.tulis_percakapan([{"id": "p1", "akun": "a", "status": "menunggu_persetujuan",
                                "draf": "halo", "kanal": "threads"}])
        hasil = antrean.susun(self.root, "uji", "2026-11-03", sekarang=SEKARANG)
        self.assertEqual(hasil["masuk"], [])
        self.assertIn("bukan disetujui", hasil["ditolak"][0]["alasan"])

    def test_balasan_disetujui_masuk(self):
        self.tulis_percakapan([{"id": "p1", "akun": "a", "status": "disetujui",
                                "disetujui_oleh": "salman", "draf": "halo", "kanal": "threads"}])
        hasil = antrean.susun(self.root, "uji", "2026-11-03", sekarang=SEKARANG)
        self.assertEqual(len(hasil["masuk"]), 1)
        self.assertEqual(hasil["masuk"][0]["disetujui_oleh"], "salman")

    def test_batas_balasan_harian(self):
        draf = [{"id": "p%d" % i, "akun": "a%d" % i, "status": "disetujui",
                 "disetujui_oleh": "salman", "draf": "halo %d" % i, "kanal": "threads"}
                for i in range(23)]
        self.tulis_percakapan(draf)
        hasil = antrean.susun(self.root, "uji", "2026-11-03", sekarang=SEKARANG)
        self.assertEqual(len(hasil["masuk"]), 20)
        self.assertEqual(len([d for d in hasil["ditolak"] if "batas" in d["alasan"]]), 3)

    def test_token_ada_berarti_siap_unggah(self):
        self.tulis_percakapan([{"id": "p1", "akun": "a", "status": "disetujui",
                                "disetujui_oleh": "salman", "draf": "halo", "kanal": "threads"}])
        (self.tenant / ".env").write_text("UJI_TH=token-panjang\n", encoding="utf-8")
        hasil = antrean.susun(self.root, "uji", "2026-11-03", sekarang=SEKARANG)
        self.assertEqual(hasil["masuk"][0]["status"], "siap_unggah")

    def test_berkas_antrean_ditulis(self):
        hasil = antrean.susun(self.root, "uji", TANGGAL, sekarang=SEKARANG)
        self.assertTrue(Path(hasil["berkas"]).exists())
        isi = json.loads(Path(hasil["berkas"]).read_text(encoding="utf-8"))
        self.assertEqual(isi["tanggal"], TANGGAL)


if __name__ == "__main__":
    unittest.main()
