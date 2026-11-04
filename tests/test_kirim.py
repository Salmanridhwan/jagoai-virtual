import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app import events, kirim

SEKARANG = datetime(2026, 11, 3, 18, 0).astimezone()
TANGGAL = "2026-11-03"


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.t = self.root / "tenant" / "uji"
        (self.t / "keluaran" / "antrean").mkdir(parents=True)
        (self.t / "office.toml").write_text('slug = "uji"\n', encoding="utf-8")
        (self.t / ".env").write_text("", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def antrean(self, masuk):
        (self.t / "keluaran" / "antrean" / (TANGGAL + ".json")).write_text(
            json.dumps({"tanggal": TANGGAL, "masuk": masuk, "ditolak": []}), encoding="utf-8")

    def balasan(self, id_="p1", akun="a", status="siap_unggah", **ubah):
        item = {"jenis": "balasan", "id": id_, "akun": akun, "kanal": "threads",
                "teks": "halo", "status": status, "disetujui_oleh": "salman"}
        item.update(ubah)
        return item


class TestPagar(Dasar):
    def test_item_tidak_ada(self):
        self.antrean([])
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p9", "salman", sekarang=SEKARANG)
        self.assertIn("tidak ada di antrean", str(ctx.exception))

    def test_admin_tidak_boleh_mengirim(self):
        self.antrean([self.balasan()])
        with self.assertRaises(Exception) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman",
                        peran_pengguna="admin", sekarang=SEKARANG)
        self.assertEqual(type(ctx.exception).__name__, "AksesDitolak")

    def test_wajib_sebut_nama(self):
        self.antrean([self.balasan()])
        with self.assertRaises(kirim.KirimDitolak):
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "  ", sekarang=SEKARANG)

    def test_manual_tidak_dikirim(self):
        self.antrean([self.balasan(status="siap_unggah_manual", alasan="token threads belum ada")])
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman", sekarang=SEKARANG)
        self.assertIn("belum siap dikirim", str(ctx.exception))
        catatan = json.loads((self.t / "keluaran" / "kirim" / (TANGGAL + ".json"))
                             .read_text(encoding="utf-8"))
        self.assertEqual(catatan["percobaan"][0]["status"], "tertahan")

    def test_balasan_tanpa_persetujuan_ditolak(self):
        self.antrean([self.balasan(disetujui_oleh="")])
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman", sekarang=SEKARANG)
        self.assertIn("belum disetujui manusia", str(ctx.exception))

    def test_konten_tanpa_berkas_persetujuan_ditolak(self):
        self.antrean([{"jenis": "konten", "tanggal": TANGGAL, "kanal": "instagram",
                       "berkas": "video.mp4", "status": "siap_unggah"}])
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "konten", TANGGAL, "salman", sekarang=SEKARANG)
        self.assertIn("belum disetujui", str(ctx.exception))


class TestPengiriman(Dasar):
    def test_tanpa_pengirim_dan_tanpa_token_tertahan(self):
        self.antrean([self.balasan()])
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman", sekarang=SEKARANG)
        self.assertIn("token threads belum ada", str(ctx.exception))
        self.assertEqual(kirim.terkirim_hari(self.root, "uji", TANGGAL), [])
        self.assertEqual(events.read_all(self.t / "events.jsonl"), [])

    def test_pengirim_palsu_berhasil_mencatat(self):
        self.antrean([self.balasan()])

        def palsu(item, kanal, sekarang):
            return {"ok": True, "tautan": "https://www.threads.net/@a/post/1"}

        catatan = kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman",
                              sekarang=SEKARANG, pengirim=palsu)
        self.assertEqual(catatan["status"], "terkirim")
        self.assertEqual(catatan["disetujui_oleh"], "salman")
        self.assertEqual(catatan["tautan"], "https://www.threads.net/@a/post/1")
        log = events.read_all(self.t / "events.jsonl")
        self.assertEqual(log[-1]["kind"], "published")
        self.assertEqual(len(kirim.terkirim_hari(self.root, "uji", TANGGAL)), 1)

    def test_pengirim_gagal_dicatat_gagal(self):
        self.antrean([self.balasan()])
        with self.assertRaises(kirim.KirimDitolak):
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman", sekarang=SEKARANG,
                        pengirim=lambda i, k, s: {"ok": False, "alasan": "401 dari kanal"})
        catatan = json.loads((self.t / "keluaran" / "kirim" / (TANGGAL + ".json"))
                             .read_text(encoding="utf-8"))
        self.assertEqual(catatan["percobaan"][-1]["status"], "gagal")
        self.assertIn("401", catatan["percobaan"][-1]["alasan"])
        self.assertEqual(kirim.terkirim_hari(self.root, "uji", TANGGAL), [])

    def test_jeda_tiga_menit(self):
        self.antrean([self.balasan("p1", "a"), self.balasan("p2", "b")])
        palsu = lambda i, k, s: {"ok": True, "tautan": "https://contoh/1"}
        kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p1", "salman",
                    sekarang=SEKARANG, pengirim=palsu)
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p2", "salman",
                        sekarang=SEKARANG + timedelta(minutes=1), pengirim=palsu)
        self.assertIn("jeda 3 menit", str(ctx.exception))
        kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p2", "salman",
                    sekarang=SEKARANG + timedelta(minutes=4), pengirim=palsu)
        self.assertEqual(len(kirim.terkirim_hari(self.root, "uji", TANGGAL)), 2)

    def test_batas_harian(self):
        masuk = [self.balasan("p%d" % i, "a%d" % i) for i in range(21)]
        self.antrean(masuk)
        palsu = lambda i, k, s: {"ok": True, "tautan": "https://contoh/x"}
        waktu = SEKARANG
        for i in range(20):
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p%d" % i, "salman",
                        sekarang=waktu, pengirim=palsu)
            waktu += timedelta(minutes=4)
        with self.assertRaises(kirim.KirimDitolak) as ctx:
            kirim.kirim(self.root, "uji", TANGGAL, "balasan", "p20", "salman",
                        sekarang=waktu, pengirim=palsu)
        self.assertIn("batas 20 kiriman", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
