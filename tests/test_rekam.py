import json
import tempfile
import unittest
from pathlib import Path

from app import events, rekam


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.t = self.root / "tenant" / "uji"
        (self.t / "keluaran").mkdir(parents=True)
        (self.t / "office.toml").write_text("\n".join([
            'slug = "uji"',
            '[karyawan.nadia]', 'model = "uji/m"', 'jabatan = "Penulis"', 'meja = "tetap:2"',
            '[karyawan.omar]', 'model = "uji/m"', 'jabatan = "Peninjau"', 'meja = "tetap:10"', '']),
            encoding="utf-8")
        self.log = self.t / "events.jsonl"

    def tearDown(self):
        self.tmp.cleanup()

    def tulis(self, kind, jam, agent="nadia", **lain):
        events.append(self.log, {"kind": kind, "agent_id": "uji:%s" % agent,
                                 "ts": "2026-11-03T%s+07:00" % jam, **lain})


class TestBingkai(Dasar):
    def test_hari_kosong(self):
        d = rekam.bingkai(self.root, "uji", "2026-11-03")
        self.assertTrue(d["kosong"])
        self.assertEqual(d["bingkai"], [])

    def test_bingkai_berurutan(self):
        self.tulis("shift_start", "09:00:00")
        self.tulis("llm_call", "09:00:05", tokens_in=10, tokens_out=20)
        self.tulis("shift_end", "09:00:10")
        d = rekam.bingkai(self.root, "uji", "2026-11-03")
        self.assertFalse(d["kosong"])
        jam = [b["jam"] for b in d["bingkai"]]
        self.assertEqual(jam, sorted(jam))
        self.assertEqual(d["jumlah_event"], 3)

    def test_bingkai_pertama_sebelum_event(self):
        self.tulis("shift_start", "09:00:00")
        d = rekam.bingkai(self.root, "uji", "2026-11-03")
        self.assertLess(d["bingkai"][0]["jam"], "09:00")
        self.assertEqual(d["bingkai"][0]["karyawan"]["nadia"], "sleep")

    def test_state_berubah_dalam_rekaman(self):
        self.tulis("shift_start", "09:00:00")
        self.tulis("file_write", "09:12:00")
        d = rekam.bingkai(self.root, "uji", "2026-11-03", langkah_menit=1)
        keadaan = {b["jam"]: b["karyawan"]["nadia"] for b in d["bingkai"]}
        self.assertEqual(keadaan["09:00"], "walk")
        self.assertEqual(keadaan["09:12"], "type")
        self.assertEqual(keadaan["09:20"], "coffee")

    def test_omar_tanpa_event_tidur(self):
        self.tulis("shift_start", "09:00:00")
        d = rekam.bingkai(self.root, "uji", "2026-11-03")
        for b in d["bingkai"]:
            self.assertEqual(b["karyawan"]["omar"], "sleep")

    def test_kegiatan_memuat_jenis_event(self):
        self.tulis("shift_start", "09:00:00")
        self.tulis("review_pass", "09:20:00", agent="omar")
        d = rekam.bingkai(self.root, "uji", "2026-11-03")
        jenis = {k["kind"] for b in d["bingkai"] for k in b["kegiatan"]}
        self.assertEqual(jenis, {"shift_start", "review_pass"})
        self.assertEqual(len(d["kegiatan"]), 2)

    def test_batas_bingkai_dihormati(self):
        for menit in range(0, 120, 5):
            self.tulis("read_file", "0%d:%02d:00" % (9 + menit // 60, menit % 60))
        d = rekam.bingkai(self.root, "uji", "2026-11-03", langkah_menit=1, batas=20)
        self.assertLessEqual(len(d["bingkai"]), 20)
        self.assertGreater(d["langkah_menit"], 1)

    def test_tanggal_lain_tidak_tercampur(self):
        self.tulis("shift_start", "09:00:00")
        events.append(self.log, {"kind": "shift_start", "agent_id": "uji:nadia",
                                 "ts": "2026-11-04T09:00:00+07:00"})
        d = rekam.bingkai(self.root, "uji", "2026-11-03")
        self.assertEqual(d["jumlah_event"], 1)

class TestModePeristiwa(Dasar):
    def test_satu_bingkai_per_event(self):
        self.tulis("shift_start", "09:00:00")
        self.tulis("llm_call", "09:00:04", tokens_in=1, tokens_out=2)
        self.tulis("shift_end", "09:00:09")
        d = rekam.bingkai(self.root, "uji", "2026-11-03", mode="peristiwa")
        self.assertEqual(d["mode"], "peristiwa")
        self.assertEqual(len(d["bingkai"]), 3)
        self.assertEqual([b["karyawan"]["nadia"] for b in d["bingkai"]],
                         ["walk", "think", "sit"])

    def test_kegiatan_tiap_bingkai_satu_event(self):
        self.tulis("shift_start", "09:00:00")
        self.tulis("file_write", "09:00:20")
        d = rekam.bingkai(self.root, "uji", "2026-11-03", mode="peristiwa")
        self.assertEqual(len(d["bingkai"][1]["kegiatan"]), 1)
        self.assertEqual(d["bingkai"][1]["kegiatan"][0]["kind"], "file_write")
        self.assertEqual(d["bingkai"][1]["karyawan"]["nadia"], "type")

    def test_batas_berlaku_juga(self):
        for i in range(30):
            self.tulis("read_file", "09:%02d:00" % i)
        d = rekam.bingkai(self.root, "uji", "2026-11-03", mode="peristiwa", batas=5)
        self.assertEqual(len(d["bingkai"]), 5)

    def test_hari_kosong_mode_peristiwa(self):
        d = rekam.bingkai(self.root, "uji", "2026-11-09", mode="peristiwa")
        self.assertTrue(d["kosong"])

class TestAlatBantu(Dasar):
    def test_daftar_tanggal(self):
        self.tulis("shift_start", "09:00:00")
        events.append(self.log, {"kind": "shift_start", "agent_id": "uji:nadia",
                                 "ts": "2026-11-05T09:00:00+07:00"})
        self.assertEqual(rekam.daftar_tanggal(self.root, "uji"), ["2026-11-03", "2026-11-05"])

    def test_token_hari(self):
        self.tulis("llm_call", "09:00:00", tokens_in=10, tokens_out=30)
        self.assertEqual(rekam.token_hari(self.root, "uji", "2026-11-03"), 40)


if __name__ == "__main__":
    unittest.main()
