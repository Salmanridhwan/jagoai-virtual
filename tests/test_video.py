import shutil
import tempfile
import unittest
from pathlib import Path

from app import video


class TestSrt(unittest.TestCase):
    def test_satu_cue_per_slide(self):
        teks = video.srt([{"teks": "satu"}, {"teks": "dua"}], 4)
        baris = teks.strip().splitlines()
        self.assertEqual(baris[0], "1")
        self.assertEqual(baris[1], "00:00:00,000 --> 00:00:04,000")
        self.assertEqual(baris[2], "satu")
        self.assertEqual(baris[4], "2")
        self.assertEqual(baris[5], "00:00:04,000 --> 00:00:08,000")

    def test_slide_kosong_dilewati(self):
        teks = video.srt([{"teks": "satu"}, {"teks": ""}], 4)
        self.assertEqual(teks.count("-->"), 1)


class TestPeriksa(unittest.TestCase):
    BAIK = {"lebar": 1080, "tinggi": 1920, "kodek_video": "h264",
            "kodek_audio": "aac", "durasi": 28.0, "faststart": True}

    def test_lulus(self):
        self.assertEqual(video.periksa(dict(self.BAIK)), [])

    def test_resolusi_salah(self):
        salah = video.periksa(dict(self.BAIK, lebar=720, tinggi=1280))
        self.assertTrue(any("resolusi" in s for s in salah))

    def test_durasi_terlalu_pendek(self):
        salah = video.periksa(dict(self.BAIK, durasi=9.5))
        self.assertTrue(any("durasi" in s for s in salah))

    def test_durasi_terlalu_panjang(self):
        salah = video.periksa(dict(self.BAIK, durasi=61))
        self.assertTrue(any("durasi" in s for s in salah))

    def test_kodek_salah(self):
        salah = video.periksa(dict(self.BAIK, kodek_video="hevc"))
        self.assertTrue(any("kodek" in s for s in salah))

    def test_tanpa_audio(self):
        salah = video.periksa(dict(self.BAIK, kodek_audio=None))
        self.assertTrue(any("audio" in s for s in salah))

    def test_tanpa_faststart(self):
        salah = video.periksa(dict(self.BAIK, faststart=False))
        self.assertTrue(any("faststart" in s for s in salah))


class TestPerintah(unittest.TestCase):
    def test_perintah_memuat_crf_dan_faststart(self):
        p = video.perintah_susun("folder", "keluar.mp4")
        teks = " ".join(p)
        self.assertIn("-crf 20", teks)
        self.assertIn("+faststart", teks)
        self.assertIn("libx264", teks)
        self.assertIn("pad=1080:1920", teks)

    def test_ukuran_persegi(self):
        p = video.perintah_susun("folder", "keluar.mp4", ukuran=(1080, 1080))
        self.assertIn("pad=1080:1080", " ".join(p))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg tidak ada")
class TestNyata(unittest.TestCase):
    def test_membuat_dan_mengukur_video_kecil(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            folder = root / "tenant" / "uji" / "keluaran" / "desain" / "2026-11-09"
            folder.mkdir(parents=True)
            for i in range(1, 5):
                Image.new("RGB", (108, 135), (15, 27, 45)).save(folder / ("slide-%02d.png" % i))

            hasil = video.susun(root, "uji", "2026-11-09", folder,
                                teks_slide=[{"teks": "satu"}], ukuran=(108, 192),
                                durasi_per_slide=4)
            info = video.ukur(hasil["berkas"])
            self.assertEqual((info["lebar"], info["tinggi"]), (108, 192))
            self.assertEqual(info["kodek_video"], "h264")
            self.assertTrue(info["faststart"])
            self.assertGreater(info["durasi"], 10)
            self.assertTrue(Path(hasil["subjudul"]).exists())

            suara = video.analisis_audio(hasil["berkas"])
            self.assertTrue(suara["terbaca"])
            self.assertTrue(suara["audio_kosong"])


if __name__ == "__main__":
    unittest.main()
