import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app import events, mira, percakapan, peran

SEKARANG = datetime(2026, 11, 3, 18, 0).astimezone()
TANGGAL = "2026-11-09"


class TestAturanPeran(unittest.TestCase):
    def test_pengguna_boleh_setujui(self):
        self.assertTrue(peran.boleh("pengguna", "setujui_konten"))
        self.assertTrue(peran.boleh("pengguna", "setujui_balasan"))

    def test_admin_tidak_boleh_setujui_isi(self):
        self.assertFalse(peran.boleh("admin", "setujui_konten"))
        self.assertFalse(peran.boleh("admin", "setujui_balasan"))
        with self.assertRaises(peran.AksesDitolak):
            peran.wajib("admin", "setujui_konten")

    def test_admin_boleh_ubah_batas(self):
        self.assertTrue(peran.boleh("admin", "ubah_batas"))
        self.assertFalse(peran.boleh("pengguna", "ubah_batas"))

    def test_keduanya_boleh_lihat_dan_ekspor(self):
        for peran_ in peran.PERAN:
            self.assertTrue(peran.boleh(peran_, "lihat_kantor"))
            self.assertTrue(peran.boleh(peran_, "ekspor_data"))

    def test_peran_asing_ditolak(self):
        self.assertFalse(peran.boleh("tamu", "lihat_kantor"))
        self.assertFalse(peran.boleh("pengguna", "aksi_karangan"))

    def test_tenant_lain_ditolak(self):
        self.assertTrue(peran.tenant_boleh("pengguna", "jagoai", "jagoai"))
        with self.assertRaises(peran.AksesDitolak):
            peran.tenant_boleh("pengguna", "jagoai", "lain")
        self.assertTrue(peran.tenant_boleh("admin", "jagoai", "lain"))


class TestPeranDiGerbang(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        t = self.root / "tenant" / "uji"
        (t / "keluaran" / "tinjauan").mkdir(parents=True)
        (t / "keluaran" / "percakapan").mkdir(parents=True)
        (t / "office.toml").write_text('slug = "uji"\n', encoding="utf-8")
        (t / "keluaran" / "tinjauan" / (TANGGAL + ".json")).write_text(json.dumps(
            {"status": "lulus", "temuan_isi": [], "angka_tanpa_dasar": [],
             "berkas": {"video": "v.mp4"}}), encoding="utf-8")
        (t / "keluaran" / "percakapan" / "2026-11-03.json").write_text(json.dumps(
            {"draf": [{"id": "p1", "akun": "a", "status": "menunggu_persetujuan",
                       "draf": "halo", "kanal": "threads"}]}), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_admin_ditolak_saat_menyetujui_konten(self):
        with self.assertRaises(peran.AksesDitolak):
            mira.setujui_konten(self.root, "uji", TANGGAL, "salman", peran="admin")
        self.assertFalse(mira.sudah_disetujui(self.root, "uji", TANGGAL))

    def test_pengguna_bisa_menyetujui_konten(self):
        mira.setujui_konten(self.root, "uji", TANGGAL, "salman", peran="pengguna",
                            sekarang=SEKARANG)
        self.assertTrue(mira.sudah_disetujui(self.root, "uji", TANGGAL))

    def test_admin_ditolak_saat_menyetujui_balasan(self):
        with self.assertRaises(peran.AksesDitolak):
            percakapan.setujui(self.root, "uji", "p1", "salman", peran="admin")
        data = json.loads((self.root / "tenant" / "uji" / "keluaran" / "percakapan"
                           / "2026-11-03.json").read_text(encoding="utf-8"))
        self.assertEqual(data["draf"][0]["status"], "menunggu_persetujuan")


class TestRingkasPlatform(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _tenant(self, nama, token):
        t = self.root / "tenant" / nama
        (t / "keluaran").mkdir(parents=True)
        (t / "office.toml").write_text('slug = "%s"\n' % nama, encoding="utf-8")
        events.append(t / "events.jsonl", {
            "kind": "llm_call", "agent_id": "%s:nadia" % nama,
            "ts": "2026-11-03T09:00:00+07:00", "tokens_in": token, "tokens_out": 0})

    def test_dua_tenant_terpisah(self):
        self._tenant("jagoai", 100)
        self._tenant("lainnya", 7)
        hasil = peran.ringkas_platform(self.root, "2026-11-02")
        angka = {h["tenant"]: h["token"] for h in hasil}
        self.assertEqual(angka, {"jagoai": 100, "lainnya": 7})

    def test_folder_tanpa_office_toml_dilewati(self):
        self._tenant("jagoai", 100)
        (self.root / "tenant" / "sampah").mkdir(parents=True)
        hasil = peran.ringkas_platform(self.root, "2026-11-02")
        self.assertEqual([h["tenant"] for h in hasil], ["jagoai"])

    def test_tanpa_folder_tenant(self):
        self.assertEqual(peran.ringkas_platform(self.root / "kosong", "2026-11-02"), [])


if __name__ == "__main__":
    unittest.main()
