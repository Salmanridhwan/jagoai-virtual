import csv
import json
import tempfile
import unittest
from pathlib import Path

from app import data, events

PEKAN = "2026-11-02"


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.t = self.root / "tenant" / "uji"
        (self.t / "keluaran").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def tulis(self, *bagian, isi):
        p = self.t.joinpath(*bagian)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(isi if isinstance(isi, str) else json.dumps(isi), encoding="utf-8")
        return p

    def isi_contoh(self):
        self.tulis("keluaran", "jadwal", PEKAN + ".json",
                   isi={"pekan": PEKAN, "slot": [
                       {"tanggal": "2026-11-03", "kanal": "instagram", "format": "carousel", "topik": "a"},
                       {"tanggal": "2026-11-04", "kanal": "tiktok", "format": "video", "topik": "b"}]})
        self.tulis("keluaran", "naskah", "2026-11-03", "2026-11-03-a.md", isi="# naskah")
        self.tulis("keluaran", "desain", "2026-11-03", "laporan.json", isi={"lulus": True, "slide": [1]})
        self.tulis("keluaran", "video", "2026-11-03", "video-9x16.mp4", isi="x")
        self.tulis("keluaran", "tinjauan", "2026-11-03.json",
                   isi={"status": "tolak", "temuan_isi": [], "angka_tanpa_dasar": []})
        self.tulis("keluaran", "persetujuan", "2026-11-03.json", isi={"konten": [{"oleh": "salman"}]})
        self.tulis("keluaran", "antrean", "2026-11-03.json",
                   isi={"masuk": [{"jenis": "konten", "status": "siap_unggah_manual"}],
                        "ditolak": [{"jenis": "konten", "alasan": "x"}]})
        self.tulis("keluaran", "percakapan", "2026-11-03.json",
                   isi={"calon": 1, "draf": [{"id": "p1", "akun": "a", "status": "disetujui",
                                              "draf": "halo", "kanal": "threads"}],
                        "ditolak": [{"id": "p2", "alasan": "di luar bidang"}]})
        log = self.t / "events.jsonl"
        for e in [
            {"kind": "shift_start", "agent_id": "uji:nadia", "ts": "2026-11-03T09:30:00+07:00"},
            {"kind": "llm_call", "agent_id": "uji:nadia", "ts": "2026-11-03T09:30:05+07:00",
             "tokens_in": 10, "tokens_out": 30, "brief_versi": "2"},
            {"kind": "keluaran_ditolak", "agent_id": "uji:nadia", "ts": "2026-11-03T09:30:09+07:00"},
            {"kind": "llm_call", "agent_id": "uji:omar", "ts": "2026-11-04T16:00:00+07:00",
             "tokens_in": 5, "tokens_out": 5},
            {"kind": "shift_tertunda", "agent_id": "uji:omar", "ts": "2026-11-04T16:00:01+07:00",
             "alasan": "batas_tenant"},
        ]:
            events.append(log, e)


class TestTabel(Dasar):
    def test_ringkasan(self):
        self.isi_contoh()
        baris = data.tabel("ringkasan", self.root, "uji", PEKAN)
        tiga = [b for b in baris if b["tanggal"] == "2026-11-03"][0]
        self.assertEqual(tiga["naskah"], 1)
        self.assertEqual(tiga["desain_lulus"], 1)
        self.assertEqual(tiga["video"], 1)
        self.assertEqual(tiga["tinjauan"], "tolak")
        self.assertEqual(tiga["token"], 40)

    def test_karyawan(self):
        self.isi_contoh()
        baris = data.tabel("karyawan", self.root, "uji", PEKAN)
        nadia = [b for b in baris if b["karyawan"] == "nadia"][0]
        self.assertEqual(nadia["shift"], 1)
        self.assertEqual(nadia["panggilan"], 1)
        self.assertEqual(nadia["ditolak"], 1)
        self.assertEqual(nadia["versi"], "2")

    def test_keluaran_satu_baris_per_slot(self):
        self.isi_contoh()
        baris = data.tabel("keluaran", self.root, "uji", PEKAN)
        self.assertEqual(len(baris), 2)
        tiga = [b for b in baris if b["tanggal"] == "2026-11-03"][0]
        self.assertTrue(tiga["naskah"].endswith(".md"))
        self.assertEqual(tiga["video"], 1)
        self.assertEqual(tiga["antrean"], "siap_unggah_manual")
        empat = [b for b in baris if b["tanggal"] == "2026-11-04"][0]
        self.assertEqual(empat["naskah"], "")

    def test_percakapan(self):
        self.isi_contoh()
        baris = data.tabel("percakapan", self.root, "uji", PEKAN)
        self.assertEqual(len(baris), 2)
        self.assertEqual([b["status"] for b in baris], ["disetujui", "ditolak"])

    def test_biaya(self):
        self.isi_contoh()
        baris = data.tabel("biaya", self.root, "uji", PEKAN)
        nadia = [b for b in baris if b["karyawan"] == "nadia"][0]
        self.assertEqual(nadia["token"], 40)
        self.assertEqual(nadia["gagal"], 1)
        omar = [b for b in baris if b["karyawan"] == "omar"][0]
        self.assertEqual(omar["ditunda"], 1)

    def test_nama_tabel_salah(self):
        with self.assertRaises(ValueError):
            data.tabel("tidak-ada", self.root, "uji", PEKAN)


class TestCocokkanVera(Dasar):
    def test_selisih_nol(self):
        self.isi_contoh()
        self.assertEqual(data.cocokkan(self.root, "uji", PEKAN), [])

    def test_selisih_terdeteksi(self):
        self.isi_contoh()
        asli = data.vera.kumpulkan

        def salah(root, tenant, pekan):
            d = asli(root, tenant, pekan)
            d["token_total"] = d["token_total"] + 1
            return d

        data.vera.kumpulkan = salah
        try:
            selisih = data.cocokkan(self.root, "uji", PEKAN)
        finally:
            data.vera.kumpulkan = asli
        self.assertEqual(len(selisih), 1)
        self.assertEqual(selisih[0]["angka"], "token")
        self.assertEqual(selisih[0]["tabel"], 50)


class TestEkspor(Dasar):
    def test_csv(self):
        self.isi_contoh()
        berkas, jumlah = data.ekspor(self.root, "uji", "ringkasan", PEKAN, "csv")
        self.assertEqual(jumlah, 7)
        with open(berkas, encoding="utf-8", newline="") as f:
            baris = list(csv.DictReader(f))
        self.assertEqual(len(baris), 7)
        self.assertIn("tanggal", baris[0])

    def test_json(self):
        self.isi_contoh()
        berkas, _ = data.ekspor(self.root, "uji", "biaya", PEKAN, "json")
        isi = json.loads(Path(berkas).read_text(encoding="utf-8"))
        self.assertEqual(isi[0]["karyawan"], "nadia")

    def test_tabel_kosong_tetap_menulis_berkas(self):
        berkas, jumlah = data.ekspor(self.root, "uji", "keluaran", "2027-01-04", "csv")
        self.assertEqual(jumlah, 0)
        self.assertTrue(Path(berkas).exists())


if __name__ == "__main__":
    unittest.main()
