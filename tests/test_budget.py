import unittest

from app import budget


class TestBudget(unittest.TestCase):
    def test_hitung_dari_event(self):
        events = [
            {
                "kind": "llm_call",
                "agent_id": "jagoai:nadia",
                "tokens_in": 100,
                "tokens_out": 40,
                "ts": "2026-11-03T09:00:00+0700",
            },
            {
                "kind": "llm_call",
                "agent_id": "jagoai:nadia",
                "tokens_in": 50,
                "tokens_out": 10,
                "ts": "2026-11-03T10:00:00+0700",
            },
            {
                "kind": "llm_call",
                "agent_id": "jagoai:rian",
                "tokens_in": 70,
                "tokens_out": 5,
                "ts": "2026-11-03T10:00:00+0700",
            },
            {
                "kind": "shift_start",
                "agent_id": "jagoai:nadia",
                "tokens_in": 999,
                "ts": "2026-11-03T11:00:00+0700",
            },
        ]
        self.assertEqual(budget.terpakai(events, "jagoai:nadia", "2026-11-03"), 200)
        self.assertEqual(budget.terpakai(events, "jagoai:rian", "2026-11-03"), 75)

    def test_tanggal_lain_tidak_dihitung(self):
        events = [
            {
                "kind": "llm_call",
                "agent_id": "a",
                "tokens_in": 10,
                "tokens_out": 1,
                "ts": "2026-11-02T09:00:00+0700",
            }
        ]
        self.assertEqual(budget.terpakai(events, "a", "2026-11-03"), 0)

    def test_boleh_jalan(self):
        events = [
            {
                "kind": "llm_call",
                "agent_id": "a",
                "tokens_in": 90,
                "tokens_out": 10,
                "ts": "2026-11-03T09:00:00+0700",
            }
        ]
        self.assertFalse(budget.boleh(events, "a", "2026-11-03", batas=100, butuh=1))
        self.assertTrue(budget.boleh(events, "a", "2026-11-03", batas=100, butuh=0))

    def test_terpakai_tenant_menjumlah_semua(self):
        events = [
            {'kind': 'llm_call', 'agent_id': 'a', 'tokens_in': 10, 'tokens_out': 5, 'ts': '2026-11-03T09:00:00+0700'},
            {'kind': 'llm_call', 'agent_id': 'b', 'tokens_in': 20, 'tokens_out': 5, 'ts': '2026-11-03T10:00:00+0700'},
            {'kind': 'llm_call', 'agent_id': 'a', 'tokens_in': 99, 'tokens_out': 1, 'ts': '2026-11-02T10:00:00+0700'},
        ]
        self.assertEqual(budget.terpakai_tenant(events, '2026-11-03'), 40)

    def test_panggilan_dalam_jendela(self):
        dari = __import__('datetime').datetime
        sekarang = dari(2026, 11, 3, 12, 0, 0).astimezone()
        events = [
            {'kind': 'llm_call', 'agent_id': 'a', 'ts': '2026-11-03T11:55:00+0700'},
            {'kind': 'llm_call', 'agent_id': 'a', 'ts': '2026-11-03T11:20:00+0700'},
            {'kind': 'llm_call', 'agent_id': 'b', 'ts': '2026-11-03T11:58:00+0700'},
        ]
        self.assertEqual(budget.panggilan_dalam_jendela(events, 'a', 10, sekarang), 1)
        self.assertEqual(budget.panggilan_dalam_jendela(events, 'a', 60, sekarang), 2)

    def test_gelembung(self):
        dari = __import__('datetime').datetime
        sekarang = dari(2026, 11, 3, 12, 0, 0).astimezone()
        events = [{'kind': 'llm_call', 'agent_id': 'a', 'ts': '2026-11-03T11:59:00+0700'} for _ in range(3)]
        self.assertTrue(budget.gelembung(events, 'a', 10, 3, sekarang))
        self.assertFalse(budget.gelembung(events, 'a', 10, 4, sekarang))

if __name__ == "__main__":
    unittest.main()
