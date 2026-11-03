import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app import percakapan

SEKARANG = datetime(2026, 11, 3, 10, 0).astimezone()
BIDANG = ["website", "coding", "pemula"]


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        t = self.root / "tenant" / "uji"
        (t / "brief-karyawan").mkdir(parents=True)
        (t / "masuk").mkdir(parents=True)
        (t / "brief-karyawan" / "sinta.md").write_text(
            "\n".join(["# b", "agent_id: uji:sinta", "versi: 1", "diubah_oleh: uji",
                       "tanggal: 2026-11-03", "status: aktif", "",
                       "## Larangan khusus", "- Jangan menjanjikan hasil.", "",
                       "## Riwayat", "- v1"]), encoding="utf-8")
        (t / "office.toml").write_text("\n".join([
            'slug = "uji"', '[merek]', 'kata_kunci = ["website", "coding", "pemula"]',
            '[gerbang]', 'base_url = "http://127.0.0.1:9/v1"', 'kunci_env = "UJI"',
            '[karyawan.sinta]', 'model = "uji/m"', 'jabatan = "Penyusun Balasan"', '']),
            encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def tulis_masuk(self, daftar):
        p = self.root / "tenant" / "uji" / "masuk" / "percakapan.jsonl"
        p.write_text("\n".join(json.dumps(d) for d in daftar), encoding="utf-8")
        return p


def percakapan_contoh(i=1, **ubah):
    data = {"id": "p%d" % i, "akun": "akun%d" % i, "kanal": "threads",
            "teks": "Halo, saya pemula mau belajar bikin website, mulai dari mana ya?",
            "tautan": "https://www.threads.net/@akun%d/post/1" % i}
    data.update(ubah)
    return data


class TestSaring(unittest.TestCase):
    def test_lolos(self):
        calon, ditarik = percakapan.saring([percakapan_contoh()], BIDANG, set())
        self.assertEqual(len(calon), 1)
        self.assertEqual(ditarik, [])

    def test_di_luar_bidang(self):
        calon, ditarik = percakapan.saring([percakapan_contoh(teks="jual kulkas bekas murah")], BIDANG, set())
        self.assertEqual(calon, [])
        self.assertEqual(ditarik[0]["alasan"], "di luar bidang")

    def test_terlalu_pendek(self):
        _, ditarik = percakapan.saring([percakapan_contoh(teks="p")], BIDANG, set())
        self.assertEqual(ditarik[0]["alasan"], "terlalu pendek untuk dinilai")

    def test_tanpa_tautan(self):
        _, ditarik = percakapan.saring([percakapan_contoh(tautan="")], BIDANG, set())
        self.assertEqual(ditarik[0]["alasan"], "tanpa tautan asal")

    def test_kanal_tidak_aktif(self):
        _, ditarik = percakapan.saring([percakapan_contoh(kanal="tiktok")], BIDANG, set(),
                                       kanal_aktif=("threads",))
        self.assertEqual(ditarik[0]["alasan"], "kanal tidak aktif")

    def test_akun_sudah_dibalas(self):
        _, ditarik = percakapan.saring([percakapan_contoh()], BIDANG, {"akun1"})
        self.assertIn("sudah dibalas", ditarik[0]["alasan"])


class TestKemiripan(unittest.TestCase):
    def test_sama_persis(self):
        self.assertEqual(percakapan.kemiripan("halo apa kabar", "halo apa kabar"), 1.0)

    def test_terlalu_mirip(self):
        a = "Untuk mulai belajar website, pilih satu alat lalu bikin satu halaman dulu ya."
        b = "Untuk mulai belajar website, pilih satu alat lalu bikin satu halaman dulu."
        self.assertIsNotNone(percakapan.terlalu_mirip(a, [b]))

    def test_cukup_beda(self):
        a = "Mulai dari satu halaman profil sederhana, lalu tambah satu bagian tiap pekan."
        b = "Coba alat gratis dulu, jangan langsung bayar sebelum sempat dipakai."
        self.assertIsNone(percakapan.terlalu_mirip(a, [b]))

    def test_daftar_kosong(self):
        self.assertIsNone(percakapan.terlalu_mirip("apa saja", []))


class TestKerjakan(Dasar):
    def test_menghasilkan_draf_menunggu_persetujuan(self):
        self.tulis_masuk([percakapan_contoh(1), percakapan_contoh(2, akun="lain")])

        balasan = [
            "Mulai dari satu halaman profil, lalu tambah bagian lain pekan depan.",
            "Coba alat gratis dulu, jangan langsung bayar sebelum sempat dipakai.",
        ]
        nomor = {"i": 0}

        def palsu(t):
            teks = balasan[nomor["i"] % len(balasan)]
            nomor["i"] += 1
            return {"teks": teks, "shift_id": "shf_s", "tokens_in": 5, "tokens_out": 20}

        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG, eksekusi=palsu)
        self.assertEqual(hasil["sumber"], "berkas")
        self.assertEqual(len(hasil["draf"]), 2)
        for d in hasil["draf"]:
            self.assertEqual(d["status"], "menunggu_persetujuan")
            self.assertEqual(d["disetujui_oleh"], "")
        self.assertTrue(Path(hasil["berkas"]).exists())

    def test_kemiripan_di_atas_85_ditolak(self):
        self.tulis_masuk([percakapan_contoh(1), percakapan_contoh(2, akun="lain")])
        teks = "Mulai dari satu halaman profil, lalu tambah bagian lain pekan depan."

        def palsu(t):
            return {"teks": teks, "shift_id": "shf_s", "tokens_in": 5, "tokens_out": 20}

        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG, eksekusi=palsu)
        self.assertEqual(len(hasil["draf"]), 1)
        self.assertIn("kemiripan", hasil["ditolak"][0]["alasan"])

    def test_penjaga_menolak_keluaran(self):
        self.tulis_masuk([percakapan_contoh()])

        def palsu(t):
            return {"teks": "Sebagai asisten AI, saya sarankan mulai dari sini.",
                    "shift_id": "shf_s", "tokens_in": 5, "tokens_out": 20}

        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG, eksekusi=palsu)
        self.assertEqual(hasil["draf"], [])
        self.assertIn("penjaga", hasil["ditolak"][0]["alasan"])

    def test_batas_harian(self):
        self.tulis_masuk([percakapan_contoh(i, akun="a%d" % i) for i in range(1, 4)])
        nomor = {"i": 0}

        def palsu(t):
            nomor["i"] += 1
            pilihan = [
                "Pilih satu alat gratis, bikin halaman profil, lalu tambah satu bagian tiap pekan.",
                "Kalau bingung, tiru contoh portofolio orang lain dulu, lalu ganti isinya.",
                "Jangan tunggu sempurna, publikasikan satu halaman dan perbaiki sambil jalan.",
            ]
            return {"teks": pilihan[(nomor["i"] - 1) % len(pilihan)],
                    "shift_id": "shf_s", "tokens_in": 5, "tokens_out": 20}

        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG, eksekusi=palsu,
                                    batas_harian=2)
        self.assertEqual(len(hasil["draf"]), 2)
        self.assertTrue(any("batas 2 balasan" in d["alasan"] for d in hasil["ditolak"]))

    def test_jeda_tiga_menit(self):
        self.tulis_masuk([percakapan_contoh(1), percakapan_contoh(2, akun="lain")])
        nomor = {"i": 0}

        def palsu(t):
            nomor["i"] += 1
            pilihan = [
                "Pilih satu alat gratis, bikin satu halaman profil, lalu ulangi besok.",
                "Tiru struktur portofolio orang lain, lalu ganti isi dan fotonya.",
            ]
            return {"teks": pilihan[(nomor["i"] - 1) % len(pilihan)],
                    "shift_id": "shf_s", "tokens_in": 5, "tokens_out": 20}

        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG, eksekusi=palsu)
        pertama = datetime.fromisoformat(hasil["draf"][0]["rencana_kirim"])
        kedua = datetime.fromisoformat(hasil["draf"][1]["rencana_kirim"])
        self.assertEqual((kedua - pertama), timedelta(minutes=3))

    def test_akun_dibalas_kemarin_ditarik(self):
        folder = self.root / "tenant" / "uji" / "keluaran" / "percakapan"
        folder.mkdir(parents=True)
        kemarin = (SEKARANG - timedelta(days=1)).date().isoformat()
        (folder / (kemarin + ".json")).write_text(json.dumps(
            {"draf": [{"id": "x", "akun": "akun1"}]}), encoding="utf-8")
        self.tulis_masuk([percakapan_contoh(1)])

        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG,
                                    eksekusi=lambda t: {"teks": "apa saja"})
        self.assertEqual(hasil["draf"], [])
        self.assertIn("sudah dibalas", hasil["ditarik"][0]["alasan"])


class TestSetujui(Dasar):
    def test_menyetujui_draf(self):
        self.tulis_masuk([percakapan_contoh()])
        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG,
                                    eksekusi=lambda t: {"teks": "Mulai dari satu halaman profil dulu."})
        id_kirim = hasil["draf"][0]["id"]
        d = percakapan.setujui(self.root, "uji", id_kirim, "salman", SEKARANG)
        self.assertEqual(d["status"], "disetujui")
        self.assertEqual(d["disetujui_oleh"], "salman")

    def test_menyetujui_dua_kali_ditolak(self):
        self.tulis_masuk([percakapan_contoh()])
        hasil = percakapan.kerjakan(self.root, "uji", sekarang=SEKARANG,
                                    eksekusi=lambda t: {"teks": "Mulai dari satu halaman profil dulu."})
        id_kirim = hasil["draf"][0]["id"]
        percakapan.setujui(self.root, "uji", id_kirim, "salman", SEKARANG)
        with self.assertRaises(percakapan.DrafGagal):
            percakapan.setujui(self.root, "uji", id_kirim, "salman", SEKARANG)

    def test_id_tidak_dikenal(self):
        with self.assertRaises(percakapan.DrafGagal):
            percakapan.setujui(self.root, "uji", "tidak-ada", "salman", SEKARANG)


class TestSumberApi(unittest.TestCase):
    def test_tanpa_token_menolak(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "tenant" / "uji").mkdir(parents=True)
            (root / "tenant" / "uji" / ".env").write_text("", encoding="utf-8")
            with self.assertRaises(percakapan.SumberBelumAda) as ctx:
                percakapan.muat_api(root, "uji", {"kanal": {"threads_env": "JAGOAI_THREADS_TOKEN"}})
            self.assertIn("belum diisi", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
