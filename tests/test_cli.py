import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from app import cli, config, events
from tests import fake_gateway


class TestCli(unittest.TestCase):
    def setUp(self):
        self.srv, self.base = fake_gateway.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def test_models(self):
        with tempfile.TemporaryDirectory() as d:
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.main(
                    [
                        "models",
                        "--base-url",
                        self.base,
                        "--kunci",
                        "k",
                        "--cache",
                        str(Path(d) / "m.json"),
                    ]
                )
        self.assertEqual(kode, 0)
        self.assertIn("uji/model-1", out.getvalue())
        self.assertIn("total 2 model", out.getvalue())

    def test_kunci_salah_jadi_pesan(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.srv, self.base = fake_gateway.start(
            get_script=[(401, {"error": "API key required for remote API access"})]
        )
        with tempfile.TemporaryDirectory() as d:
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.main(
                    [
                        "models",
                        "--base-url",
                        self.base,
                        "--kunci",
                        "salah",
                        "--cache",
                        str(Path(d) / "m.json"),
                    ]
                )
        self.assertEqual(kode, 3)
        self.assertIn("401", out.getvalue())

    def test_model_belum_diisi(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'tenant' / 'uji').mkdir(parents=True)
            toml = chr(10).join([
                '[tenant]',
                'slug = "uji"',
                'nama = "Uji"',
                '[gerbang]',
                'base_url = "http://127.0.0.1:9/v1"',
                'kunci_env = "UJI_KEY"',
                '[karyawan.nadia]',
                'model = ""',
                'anggaran_token_harian = 1000',
            ])
            (Path(d) / 'tenant' / 'uji' / 'office.toml').write_text(toml, encoding='utf-8')
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.main(['--root', d, 'run', '--tenant', 'uji',
                                 '--agent', 'uji:nadia', '--tugas', 'x', '--kunci', 'k'])
        self.assertEqual(kode, 2)
        self.assertIn('belum diisi', out.getvalue())

    def test_env_check_tanpa_berkas(self):
        with tempfile.TemporaryDirectory() as d:
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.periksa_env(Path(d), "jagoai")
        teks = out.getvalue()
        self.assertEqual(kode, 7)
        self.assertIn("JAGOAI_ROUTER_KEY", teks)
        self.assertIn("kurang 1 variabel wajib", teks)
        self.assertNotIn("Bearer", teks)

    def test_env_check_dengan_berkas(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "tenant" / "jagoai").mkdir(parents=True)
            (Path(d) / "tenant" / "jagoai" / ".env").write_text(
                "JAGOAI_ROUTER_KEY=kunci-uji-panjang\n", encoding="utf-8"
            )
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.periksa_env(Path(d), "jagoai")
        teks = out.getvalue()
        self.assertEqual(kode, 0)
        self.assertIn("semua variabel wajib tersedia", teks)
        self.assertIn("%d karakter" % len("kunci-uji-panjang"), teks)
        self.assertNotIn("kunci-uji-panjang", teks)

    def test_karyawan_tidak_terdaftar(self):
        out = io.StringIO()
        with redirect_stdout(out):
            kode = cli.main(["run", "--agent", "jagoai:hilang", "--tugas", "x"])
        self.assertEqual(kode, 4)
        self.assertIn("kurang pengaturan", out.getvalue())

    def test_run_utuh(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'tenant' / 'uji' / 'brief-karyawan').mkdir(parents=True)
            toml = chr(10).join([
                '[tenant]',
                'slug = "uji"',
                'nama = "Uji"',
                '[gerbang]',
                'base_url = "http://127.0.0.1:9/v1"',
                'kunci_env = "UJI_KEY"',
                '[karyawan.nadia]',
                'model = "uji/model-1"',
                'maks_token = 700',
                'batas_shift = 20000',
            ])
            (root / 'tenant' / 'uji' / 'office.toml').write_text(toml, encoding='utf-8')
            brief = chr(10).join([
                '# Brief uji',
                '',
                'agent_id: uji:nadia',
                'versi: 1',
                'diubah_oleh: uji',
                'tanggal: 2026-11-03',
                'status: aktif',
                '',
                '## Tujuan tetap',
                'Menulis naskah.',
                '',
                '## Riwayat',
                '- v1, dibuat untuk uji',
            ])
            (root / 'tenant' / 'uji' / 'brief-karyawan' / 'nadia.md').write_text(brief, encoding='utf-8')
            log = root / 'tenant' / 'uji' / 'events.jsonl'
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.main(['--root', d, 'run', '--tenant', 'uji',
                                 '--agent', 'uji:nadia', '--tugas', 'tulis hook',
                                 '--base-url', self.base, '--kunci', 'kunci-uji'])
            teks = out.getvalue()
            baris = events.read_all(log)
        self.assertEqual(kode, 0)
        self.assertIn('token=10+5', teks)
        self.assertEqual([b['kind'] for b in baris], ['shift_start', 'llm_call', 'shift_end'])
        self.assertEqual(fake_gateway.Handler.calls[-1]['body']['max_tokens'], 700)
        self.assertFalse(fake_gateway.Handler.calls[-1]['body']['stream'])

    def test_peringatan_topik_dibedakan(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'tenant' / 'uji' / 'brief-karyawan').mkdir(parents=True)
            (root / 'tenant' / 'uji' / 'office.toml').write_text(
                'slug = "uji"' + chr(10) + '[gerbang]' + chr(10) + 'base_url = "http://127.0.0.1:9/v1"' + chr(10)
                + 'kunci_env = "UJI_KEY"' + chr(10) + '[karyawan.nadia]' + chr(10)
                + 'model = "uji/model-1"' + chr(10), encoding='utf-8')
            (root / 'tenant' / 'uji' / 'brief-karyawan' / 'nadia.md').write_text(
                chr(10).join(['# b', '', 'agent_id: uji:nadia', 'versi: 1', 'diubah_oleh: uji',
                              'tanggal: 2026-11-03', 'status: aktif', '', '## Riwayat', '- v1']),
                encoding='utf-8')
            out = io.StringIO()
            with redirect_stdout(out):
                kode = cli.main(['--root', d, 'run', '--tenant', 'uji', '--agent', 'uji:nadia',
                                 '--tugas', 'tulis sasaran pekan', '--base-url', self.base,
                                 '--kunci', 'k'])
            teks = out.getvalue()
        self.assertEqual(kode, 0)
        self.assertIn('belum menyentuh kata kunci tugas', teks)
        self.assertNotIn('setelah satu perbaikan', teks)

if __name__ == "__main__":
    unittest.main()
