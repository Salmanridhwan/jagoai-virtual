import unittest
from datetime import datetime, timedelta

from app import state

SEKARANG = datetime(2026, 11, 3, 12, 0, 0).astimezone()


def ev(kind, detik_lalu=1, agent="jagoai:nadia", **kw):
    w = SEKARANG - timedelta(seconds=detik_lalu)
    data = {
        "kind": kind,
        "agent_id": agent,
        "ts": w.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "shift_id": "shf_uji",
    }
    data.update(kw)
    return data


class TestState(unittest.TestCase):
    def test_tanpa_event_tidur(self):
        hasil = state.ringkas([], ["jagoai:nadia"], SEKARANG)
        self.assertEqual(hasil["jagoai:nadia"]["state"], "sleep")

    def test_llm_call_jadi_think(self):
        hasil = state.ringkas([ev("llm_call", 2)], ["jagoai:nadia"], SEKARANG)
        self.assertEqual(hasil["jagoai:nadia"]["state"], "think")
        self.assertEqual(hasil["jagoai:nadia"]["sebab"], "llm_call")

    def test_tulis_berkas_jadi_type(self):
        hasil = state.ringkas([ev("file_write", 0.5)], ["jagoai:nadia"], SEKARANG)
        self.assertEqual(hasil["jagoai:nadia"]["state"], "type")

    def test_error_menahan_enam_detik(self):
        baru = state.ringkas([ev("tool_error", 2)], ["jagoai:nadia"], SEKARANG)
        lewat = state.ringkas([ev("tool_error", 30)], ["jagoai:nadia"], SEKARANG)
        lama = state.ringkas([ev("tool_error", 200)], ["jagoai:nadia"], SEKARANG, izin_ambient={"jagoai:nadia": False})
        self.assertEqual(baru["jagoai:nadia"]["state"], "error")
        self.assertEqual(lewat["jagoai:nadia"]["state"], "sit")
        self.assertEqual(lama["jagoai:nadia"]["state"], "idle")

    def test_ditunda_jadi_blocked_dan_tidak_lepas_karena_waktu(self):
        hasil = state.ringkas([ev("shift_tertunda", 6000)], ["jagoai:nadia"], SEKARANG)
        self.assertEqual(hasil["jagoai:nadia"]["state"], "blocked")

    def test_diam_lama_jadi_coffee_atau_idle(self):
        dengan = state.ringkas([ev("llm_call", 200)], ["jagoai:nadia"], SEKARANG, izin_ambient={"jagoai:nadia": True})
        tanpa = state.ringkas([ev("llm_call", 200)], ["jagoai:nadia"], SEKARANG, izin_ambient={"jagoai:nadia": False})
        self.assertEqual(dengan["jagoai:nadia"]["state"], "coffee")
        self.assertEqual(tanpa["jagoai:nadia"]["state"], "idle")

    def test_event_karyawan_lain_tidak_tercampur(self):
        daftar = [ev("file_write", 1, agent="jagoai:nadia"), ev("tool_error", 1, agent="jagoai:rian")]
        hasil = state.ringkas(daftar, ["jagoai:nadia", "jagoai:rian"], SEKARANG)
        self.assertEqual(hasil["jagoai:nadia"]["state"], "type")
        self.assertEqual(hasil["jagoai:rian"]["state"], "error")

    def test_ambil_terakhir_membatasi(self):
        daftar = [ev("llm_call", 10 - i) for i in range(8)]
        self.assertEqual(len(state.ambil_terakhir(daftar, "jagoai:nadia", 5)), 5)

    def test_prioritas_lengkap(self):
        self.assertEqual(max(state.PRIORITAS, key=state.PRIORITAS.get), "blocked")

    def test_coffee_dibatasi(self):
        daftar = [ev('llm_call', 200 + i, agent='jagoai:a%d' % i) for i in range(5)]
        hasil = state.ringkas(daftar, [e['agent_id'] for e in daftar], SEKARANG)
        nilai = [v['state'] for v in hasil.values()]
        self.assertEqual(nilai.count('coffee'), 3)
        self.assertEqual(nilai.count('idle'), 2)

if __name__ == "__main__":
    unittest.main()
