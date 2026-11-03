import tempfile
import unittest
from pathlib import Path

from app import events


class TestEvents(unittest.TestCase):
    def test_append_dan_baca(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "events.jsonl"
            events.append(p, {"kind": "shift_start", "agent_id": "jagoai:nadia"})
            events.append(p, {"kind": "shift_end", "agent_id": "jagoai:nadia"})
            baris = events.read_all(p)
        self.assertEqual([b["kind"] for b in baris], ["shift_start", "shift_end"])
        self.assertIn("T", baris[0]["ts"])

    def test_baris_rusak_dilewati(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "events.jsonl"
            p.write_text('{"kind": "a"}\nbukan json\n{"kind": "b"}\n', encoding="utf-8")
            baris = events.read_all(p)
        self.assertEqual(len(baris), 2)

    def test_id_unik(self):
        self.assertNotEqual(events.new_id(), events.new_id())

    def test_berkas_belum_ada(self):
        self.assertEqual(events.read_all(Path("belum-ada.jsonl")), [])


if __name__ == "__main__":
    unittest.main()
