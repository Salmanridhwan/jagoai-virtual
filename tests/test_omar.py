import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app import events, omar, papan

SEKARANG = datetime(2026, 11, 3, 16, 0).astimezone()

NASKAH = "\n".join([
    "## Hook", "1. satu", "",
    "## Naskah", "**Slide 1**", "Teks: \"Carrd gratis hingga tiga site\"", "",
    "## Caption", "caption dengan klaim 30% lebih cepat", "",
    "## Catatan", "catatan",
])

INFO_BAIK = {"lebar": 1080, "tinggi": 1920, "kodek_video": "h264", "kodek_audio": "aac",
             "durasi": 28.0, "faststart": True}
LAPORAN_BAIK = {"lulus": True}


class TestBentukPutusan(unittest.TestCase):
    def test_sah(self):
        self.assertEqual(omar.sahkan_putusan({"lulus": True, "temuan": []}), [])

    def test_lulus_harus_bool(self):
        salah = omar.sahkan_putusan({"lulus": "ya", "temuan": []})
        self.assertTrue(any("lulus" in s for s in salah))

    def test_temuan_harus_larik(self):
        self.assertIn("temuan harus larik", omar.sahkan_putusan({"lulus": True, "temuan": {}}))

    def test_tingkat_harus_dikenal(self):
        salah = omar.sahkan_putusan({"lulus": False, "temuan": [{"tingkat": "mungkin", "alasan": "x"}]})
        self.assertTrue(any("tingkat" in s for s in salah))

    def test_alasan_wajib(self):
        salah = omar.sahkan_putusan({"lulus": False, "temuan": [{"tingkat": "tolak", "alasan": " "}]})
        self.assertTrue(any("alasan" in s for s in salah))

    def test_objek_json_berpagar(self):
        self.assertEqual(omar.objek_json("```json\n{\"lulus\": true}\n```"), {"lulus": True})

    def test_objek_json_cacat(self):
        self.assertIsNone(omar.objek_json("maaf saya tidak bisa"))
        self.assertIsNone(omar.objek_json(""))


class TestKlaimAngka(unittest.TestCase):
    def test_persen_tanpa_brief(self):
        self.assertEqual(omar.klaim_angka("caption dengan klaim 30% lebih cepat"), ["30%"])

    def test_angka_di_brief_boleh(self):
        self.assertEqual(omar.klaim_angka("30% lebih cepat", "sasaran 30%"), [])

    def test_unit_lain(self):
        hasil = omar.klaim_angka("gratis hingga 3 site, selesai 5 menit")
        self.assertEqual(sorted(hasil), ["3 site", "5 menit"])

    def test_kata_angka(self):
        self.assertEqual(omar.klaim_angka("gratis hingga tiga site"), ["tiga site"])


class TestLapisTeknis(unittest.TestCase):
    def test_lulus(self):
        self.assertEqual(omar.periksa_teknis(INFO_BAIK, LAPORAN_BAIK, True), [])

    def test_tanpa_video(self):
        self.assertIn("video belum ada", omar.periksa_teknis(None, LAPORAN_BAIK, True))

    def test_desain_tidak_lulus(self):
        salah = omar.periksa_teknis(INFO_BAIK, {"lulus": False}, True)
        self.assertIn("laporan desain tidak lulus", salah)

    def test_resolusi_salah(self):
        salah = omar.periksa_teknis(dict(INFO_BAIK, lebar=720), LAPORAN_BAIK, True)
        self.assertTrue(any("resolusi" in s for s in salah))

    def test_tanpa_subjudul(self):
        self.assertIn("subjudul belum ada", omar.periksa_teknis(INFO_BAIK, LAPORAN_BAIK, False))


class TestTinjau(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        t = self.root / "tenant" / "uji"
        (t / "brief-karyawan").mkdir(parents=True)
        (t / "brief-karyawan" / "omar.md").write_text(
            "\n".join(["# b", "agent_id: uji:omar", "versi: 1", "diubah_oleh: uji",
                       "tanggal: 2026-11-03", "status: aktif", "",
                       "## Larangan khusus", "- Jangan meluluskan tanpa memeriksa.", "",
                       "## Riwayat", "- v1"]), encoding="utf-8")
        (t / "office.toml").write_text("\n".join([
            'slug = "uji"', '[gerbang]', 'base_url = "http://127.0.0.1:9/v1"',
            'kunci_env = "UJI"', '[karyawan.omar]', 'model = "uji/m"',
            'jabatan = "Peninjau Mutu"', '']), encoding="utf-8")

        papan.tulis_naskah(self.root, "uji", "2026-11-09", "2026-11-09", "topik", NASKAH)
        folder_desain = t / "keluaran" / "desain" / "2026-11-09"
        folder_desain.mkdir(parents=True)
        (folder_desain / "laporan.json").write_text(json.dumps(LAPORAN_BAIK), encoding="utf-8")
        folder_video = t / "keluaran" / "video" / "2026-11-09"
        folder_video.mkdir(parents=True)
        (folder_video / "subjudul.srt").write_text("1", encoding="utf-8")

        self._info = omar.video.ukur
        omar.video.ukur = lambda berkas: dict(INFO_BAIK)
        (folder_video / "video-9x16.mp4").write_bytes(b"\x00" * 32)

    def tearDown(self):
        omar.video.ukur = self._info
        self.tmp.cleanup()

    def _tinjau(self, teks, kali=1):
        dipanggil = []

        def palsu(t):
            dipanggil.append(t)
            return {"teks": teks, "shift_id": "shf_o", "tokens_in": 10, "tokens_out": 10}

        hasil = omar.tinjau(self.root, "uji", "2026-11-09", pekan="2026-11-09",
                            sekarang=SEKARANG, eksekusi=palsu)
        return hasil, dipanggil

    def test_lulus_ditulis_dan_dicatat(self):
        hasil, _ = self._tinjau(json.dumps({"lulus": True, "temuan": []}))
        self.assertEqual(hasil["status"], "lulus")
        self.assertTrue(Path(hasil["berkas_tinjauan"]).exists())
        log = events.read_all(self.root / "tenant" / "uji" / "events.jsonl")
        self.assertEqual(log[-1]["kind"], "review_pass")

    def test_tolak_karena_temuan_isi(self):
        putusan = {"lulus": False, "temuan": [
            {"tingkat": "tolak", "bagian": "caption", "alasan": "klaim tanpa dasar", "kutipan": "30%"}]}
        hasil, _ = self._tinjau(json.dumps(putusan))
        self.assertEqual(hasil["status"], "tolak")
        self.assertEqual(len(hasil["temuan_isi"]), 1)

    def test_tolak_walau_model_bilang_lulus_tapi_ada_temuan_tolak(self):
        putusan = {"lulus": True, "temuan": [
            {"tingkat": "tolak", "bagian": "slide", "alasan": "angka karangan", "kutipan": "3 site"}]}
        hasil, _ = self._tinjau(json.dumps(putusan))
        self.assertEqual(hasil["status"], "tolak")

    def test_putusan_cacat_jadi_manual(self):
        hasil, dipanggil = self._tinjau("menurut saya bagus kok")
        self.assertEqual(hasil["status"], "manual")
        self.assertEqual(len(dipanggil), 2)

    def test_angka_tanpa_dasar_dicatat(self):
        hasil, _ = self._tinjau(json.dumps({"lulus": True, "temuan": []}))
        self.assertIn("30%", hasil["angka_tanpa_dasar"])
        self.assertIn("tiga site", hasil["angka_tanpa_dasar"])

    def test_memilih_berkas_sesuai_rasio(self):
        folder = self.root / 'tenant' / 'uji' / 'keluaran' / 'video' / '2026-11-09'
        (folder / 'video-1x1.mp4').write_bytes(bytes([0]))
        pilih = omar._pilih_video(folder, (1080, 1920))
        self.assertEqual(pilih.name, 'video-9x16.mp4')
        pilih = omar._pilih_video(folder, (1080, 1080))
        self.assertEqual(pilih.name, 'video-1x1.mp4')

if __name__ == "__main__":
    unittest.main()
