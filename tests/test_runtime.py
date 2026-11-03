import tempfile
import unittest
from pathlib import Path

from app import events, runtime
from tests import fake_gateway


class TestRuntime(unittest.TestCase):
    def setUp(self):
        self.srv, self.base = fake_gateway.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def _shift(self, log, **kw):
        dasar = dict(
            base_url=self.base,
            kunci='kunci-uji',
            model='uji/model-1',
            agent_id='jagoai:nadia',
            tugas='tulis tiga varian hook',
            brief='Tujuan tetap: menulis naskah.',
            log_path=log,
        )
        dasar.update(kw)
        return runtime.jalankan(**dasar)

    def test_satu_shift_tercatat(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            hasil = self._shift(log)
            baris = events.read_all(log)
        self.assertEqual([b['kind'] for b in baris], ['shift_start', 'llm_call', 'shift_end'])
        self.assertEqual(hasil['tokens_in'], 10)
        self.assertEqual(hasil['tokens_out'], 5)
        self.assertFalse(hasil['tertunda'])
        self.assertEqual(baris[1]['shift_id'], baris[0]['shift_id'])

    def test_batas_tenant_menunda_sebelum_panggilan(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            events.append(log, {'kind': 'llm_call', 'agent_id': 'jagoai:rian',
                                'tokens_in': 900, 'tokens_out': 100, 'ts': events.now_iso()})
            with self.assertRaises(runtime.ShiftDitunda) as ctx:
                self._shift(log, batas_tenant=500)
            baris = events.read_all(log)
        self.assertEqual(ctx.exception.alasan, 'batas_tenant')
        self.assertEqual(baris[-1]['kind'], 'shift_tertunda')
        self.assertEqual(baris[-1]['alasan'], 'batas_tenant')
        self.assertEqual(len([b for b in baris if b['kind'] == 'llm_call']), 1)

    def test_gelembung_menunda(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            for _ in range(3):
                events.append(log, {'kind': 'llm_call', 'agent_id': 'jagoai:nadia',
                                    'tokens_in': 10, 'tokens_out': 5, 'ts': events.now_iso()})
            with self.assertRaises(runtime.ShiftDitunda) as ctx:
                self._shift(log, gelembung_batas=3)
            baris = events.read_all(log)
        self.assertEqual(ctx.exception.alasan, 'gelembung_panggilan')
        self.assertEqual(baris[-1]['alasan'], 'gelembung_panggilan')
        self.assertEqual(baris[-1]['panggilan'], 3)

    def test_batas_shift_menandai_tertunda(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            hasil = self._shift(log, batas_shift=5)
            baris = events.read_all(log)
        self.assertTrue(hasil['tertunda'])
        self.assertEqual([b['kind'] for b in baris],
                         ['shift_start', 'llm_call', 'shift_tertunda', 'shift_end'])
        self.assertEqual(baris[2]['alasan'], 'batas_shift')
        self.assertEqual(baris[3]['catatan'], 'batas_shift')

    def test_galat_gerbang_tercatat(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.srv, self.base = fake_gateway.start([(401, {'error': 'API key required'})])
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            with self.assertRaises(Exception):
                self._shift(log)
            baris = events.read_all(log)
        self.assertEqual([b['kind'] for b in baris], ['shift_start', 'tool_error', 'shift_end'])
        self.assertFalse(baris[-1]['ok'])
        self.assertEqual(baris[1]['status'], 401)

    def test_keluaran_ditolak_diperbaiki_sekali(self):
        kotor = {'choices': [{'message': {'content': 'Sebagai CodeBuddy Code, 90% pengguna suka ini.'}}],
                 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}, 'model': 'uji/model-1'}
        bersih = {'choices': [{'message': {'content': 'Tiga varian hook siap dipakai.'}}],
                  'usage': {'prompt_tokens': 12, 'completion_tokens': 6}, 'model': 'uji/model-1'}
        self.srv.shutdown()
        self.srv.server_close()
        self.srv, self.base = fake_gateway.start([(200, kotor), (200, bersih)])
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            hasil = self._shift(log)
            baris = events.read_all(log)
        self.assertEqual([b['kind'] for b in baris],
                         ['shift_start', 'llm_call', 'keluaran_ditolak', 'llm_call', 'shift_end'])
        self.assertEqual(hasil['pelanggaran'], [])
        self.assertEqual(hasil['tokens_in'], 22)
        self.assertEqual(hasil['teks'], 'Tiga varian hook siap dipakai.')
        self.assertEqual(len(fake_gateway.Handler.calls), 2)

    def test_masih_melanggar_dicatat_apa_adanya(self):
        kotor = {'choices': [{'message': {'content': 'Sebagai asisten AI, siap membantu.'}}],
                 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}, 'model': 'uji/model-1'}
        self.srv.shutdown()
        self.srv.server_close()
        self.srv, self.base = fake_gateway.start([(200, kotor), (200, kotor)])
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'events.jsonl'
            hasil = self._shift(log)
            baris = events.read_all(log)
        self.assertIn('identitas', hasil['pelanggaran'])
        self.assertEqual(baris[-1]['catatan'], 'keluaran_ditolak')
        self.assertEqual(len(fake_gateway.Handler.calls), 2)

if __name__ == '__main__':
    unittest.main()
