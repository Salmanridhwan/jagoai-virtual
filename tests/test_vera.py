import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app import events, vera

PEKAN = "2026-11-02"
SEKARANG = datetime(2026, 11, 8, 7, 0).astimezone()


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.t = self.root / "tenant" / "uji"
        (self.t / "keluaran").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def tulis(self, *bagian, isi=""):
        p = self.t.joinpath(*bagian)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(isi if isinstance(isi, str) else json.dumps(isi), encoding="utf-8")
        return p


class TestRentang(unittest.TestCase):
    def test_tujuh_hari_mulai_senin(self):
        hari = vera.rentang(PEKAN)
        self.assertEqual(len(hari), 7)
        self.assertEqual(hari[0], "2026-11-02")
        self.assertEqual(hari[-1], "2026-11-08")


class TestKumpulkan(Dasar):
    def test_jadwal_naskah_desain_video(self):
        self.tulis("keluaran", "jadwal", PEKAN + ".json",
                   isi={"pekan": PEKAN, "slot": [{"tanggal": "2026-11-03"}] * 4})
        self.tulis("keluaran", "naskah", "2026-11-03", "2026-11-03-a.md", isi="# naskah")
        self.tulis("keluaran", "desain", "2026-11-03", "laporan.json",
                   isi={"lulus": True, "slide": [1, 2, 3]})
        self.tulis("keluaran", "desain", "2026-11-04", "laporan.json",
                   isi={"lulus": False, "slide": [1]})
        self.tulis("keluaran", "video", "2026-11-03", "video-9x16.mp4", isi="x")

        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertEqual(d["isi"]["jadwal"], 4)
        self.assertEqual(d["isi"]["naskah"], 1)
        self.assertEqual(d["isi"]["desain_lulus"], 1)
        self.assertEqual(d["isi"]["desain_tidak_lulus"], 1)
        self.assertEqual(d["isi"]["video"], 1)
        self.assertTrue(d["sumber"])

    def test_tinjauan_persetujuan_antrean_percakapan(self):
        self.tulis("keluaran", "tinjauan", "2026-11-03.json",
                   isi={"status": "tolak", "temuan_isi": [{"tingkat": "tolak"}],
                        "angka_tanpa_dasar": ["30%"]})
        self.tulis("keluaran", "persetujuan", "2026-11-03.json",
                   isi={"konten": [{"oleh": "salman"}]})
        self.tulis("keluaran", "antrean", "2026-11-03.json",
                   isi={"masuk": [{"jenis": "balasan"}], "ditolak": [{"jenis": "konten"}]})
        self.tulis("keluaran", "percakapan", "2026-11-03.json",
                   isi={"calon": 2, "draf": [{"status": "disetujui"}, {"status": "menunggu_persetujuan"}],
                        "ditolak": [{"alasan": "di luar bidang"}]})

        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertEqual(d["isi"]["tinjauan"]["tolak"], 1)
        self.assertEqual(d["isi"]["persetujuan"], 1)
        self.assertEqual(d["isi"]["antrean_masuk"], 1)
        self.assertEqual(d["isi"]["antrean_ditolak"], 1)
        self.assertEqual(d["isi"]["percakapan"]["draf"], 2)
        self.assertEqual(d["isi"]["percakapan"]["disetujui"], 1)
        self.assertEqual(d["rincian_tinjauan"][0][1], "tolak")

    def test_token_dari_event(self):
        log = self.t / "events.jsonl"
        events.append(log, {"kind": "llm_call", "agent_id": "uji:nadia",
                            "ts": "2026-11-03T09:00:00+07:00", "tokens_in": 10, "tokens_out": 20})
        events.append(log, {"kind": "llm_call", "agent_id": "uji:omar",
                            "ts": "2026-11-04T16:00:00+07:00", "tokens_in": 5, "tokens_out": 5})
        events.append(log, {"kind": "llm_call", "agent_id": "uji:vera",
                            "ts": "2026-10-01T07:00:00+07:00", "tokens_in": 999, "tokens_out": 0})

        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertEqual(d["token_total"], 40)
        self.assertEqual(d["token_agent"], {"nadia": 30, "omar": 10})
        self.assertEqual(d["jenis_event"].get("llm_call"), 2)

    def test_shift_end_tidak_dihitung_dua_kali(self):
        log = self.t / "events.jsonl"
        events.append(log, {"kind": "llm_call", "agent_id": "uji:nadia",
                            "ts": "2026-11-03T09:00:00+07:00", "tokens_in": 10, "tokens_out": 20})
        events.append(log, {"kind": "shift_end", "agent_id": "uji:nadia",
                            "ts": "2026-11-03T09:00:05+07:00", "tokens_in": 10, "tokens_out": 20})

        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertEqual(d["token_total"], 30)
        self.assertEqual(d["token_agent"], {"nadia": 30})

    def test_ditunda_dihitung(self):
        log = self.t / "events.jsonl"
        events.append(log, {"kind": "shift_tertunda", "agent_id": "uji:nadia",
                            "ts": "2026-11-03T09:00:00+07:00", "alasan": "batas_tenant"})
        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertEqual(d["ditunda"], {"batas_tenant": 1})


class TestJangkauan(Dasar):
    def test_tanpa_berkas(self):
        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertFalse(d["jangkauan"]["ada"])

    def test_membaca_csv_hanya_dalam_pekan(self):
        isi = "\n".join([
            "tanggal,kanal,tayangan,interaksi",
            "2026-11-03,instagram,1000,50",
            "2026-11-04,threads,500,20",
            "2026-10-20,instagram,9999,9999",
        ])
        self.tulis("data", "jangkauan.csv", isi=isi)
        d = vera.kumpulkan(self.root, "uji", PEKAN)
        self.assertTrue(d["jangkauan"]["ada"])
        self.assertEqual(d["jangkauan"]["baris"], 2)
        self.assertEqual(d["jangkauan"]["tayangan"], 1500)
        self.assertEqual(d["jangkauan"]["interaksi"], 70)
        self.assertEqual(d["jangkauan"]["kanal"], {"instagram": 50, "threads": 20})


class TestTulis(Dasar):
    def test_laporan_ditulis_dengan_peringatan_jangkauan(self):
        d = vera.tulis(self.root, "uji", PEKAN, SEKARANG)
        self.assertTrue(Path(d["berkas"]).exists())
        teks = Path(d["berkas"]).read_text(encoding="utf-8")
        self.assertIn("# Laporan pekan %s" % PEKAN, teks)
        self.assertIn("Belum ada data jangkauan", teks)
        self.assertNotIn("9999", teks)

    def test_angka_muncul_di_laporan(self):
        self.tulis("keluaran", "jadwal", PEKAN + ".json",
                   isi={"pekan": PEKAN, "slot": [{"tanggal": "2026-11-03"}] * 3})
        d = vera.tulis(self.root, "uji", PEKAN, SEKARANG)
        teks = Path(d["berkas"]).read_text(encoding="utf-8")
        self.assertIn("| Slot jadwal | 3 |", teks)
        self.assertIn("jadwal 2026-11-02", teks)

    def test_laporan_kosong_tetap_jujur(self):
        d = vera.tulis(self.root, "uji", "2027-01-04", SEKARANG)
        teks = Path(d["berkas"]).read_text(encoding="utf-8")
        self.assertIn("Belum ada shift pada pekan ini.", teks)
        self.assertIn("Belum ada tinjauan pada pekan ini.", teks)


if __name__ == "__main__":
    unittest.main()
