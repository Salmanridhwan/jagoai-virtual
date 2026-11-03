import tempfile
import unittest
from pathlib import Path

from app import brief

CONTOH = """# Brief Nadia

agent_id: jagoai:nadia
versi: 1
diubah_oleh: salman
tanggal: 2026-11-02
status: aktif

## Tujuan tetap
Mengubah slot jadi naskah siap produksi.

## Fokus sekarang
Nada lebih santai.

## Cara kerja
1. Tiga varian hook.

## Larangan khusus
- Jangan pakai kata instan.

## Rujukan
- brief/

## Eskalasi
- Sudut butuh angka.

## Riwayat
- v1, 2026-11-02, dibuat
"""


class TestBrief(unittest.TestCase):
    def test_parse_lengkap(self):
        b = brief.parse(CONTOH)
        self.assertEqual(b["agent_id"], "jagoai:nadia")
        self.assertEqual(b["versi"], 1)
        self.assertIn("Tujuan tetap", b["bagian"])
        self.assertEqual(len(b["hash"]), 16)

    def test_tolak_bidang_kosong(self):
        rusak = CONTOH.replace("agent_id: jagoai:nadia\n", "")
        with self.assertRaises(brief.BriefError) as ctx:
            brief.parse(rusak)
        self.assertIn("agent_id", str(ctx.exception))

    def test_tolak_versi_bukan_angka(self):
        rusak = CONTOH.replace("versi: 1", "versi: satu")
        with self.assertRaises(brief.BriefError):
            brief.parse(rusak)

    def test_tolak_kredensial(self):
        bocor = CONTOH.replace("- brief/", "- brief/\n- sk-ant-api03-rahasia")
        with self.assertRaises(brief.BriefError) as ctx:
            brief.parse(bocor)
        self.assertIn("kunci API", str(ctx.exception))

    def test_tolak_harga(self):
        harga = CONTOH.replace("Nada lebih santai.", "Harga mulai 99rb.")
        with self.assertRaises(brief.BriefError) as ctx:
            brief.parse(harga)
        self.assertIn("harga", str(ctx.exception))

    def test_tolak_klaim(self):
        klaim = CONTOH.replace("Nada lebih santai.", "Kualitas dijamin bagus.")
        with self.assertRaises(brief.BriefError):
            brief.parse(klaim)

    def test_tolak_tanpa_riwayat(self):
        rusak = CONTOH.split("## Riwayat")[0]
        with self.assertRaises(brief.BriefError):
            brief.parse(rusak)

    def test_kata_terlarang_dalam_kutipan_boleh(self):
        boleh = CONTOH.replace(
            "Nada lebih santai.",
            "Hindari kata `dijamin` dan `instan` di caption.",
        )
        b = brief.parse(boleh)
        self.assertIn("`dijamin`", b["bagian"]["Fokus sekarang"])

    def test_kredensial_dalam_kutipan_tetap_ditolak(self):
        bocor = CONTOH.replace(
            "Nada lebih santai.",
            "Contoh salah: `sk-ant-api03-rahasia` jangan ditulis.",
        )
        with self.assertRaises(brief.BriefError):
            brief.parse(bocor)

    def test_muat_dari_berkas(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "nadia.md"
            p.write_text(CONTOH, encoding="utf-8")
            b = brief.muat(p)
        self.assertEqual(b["agent_id"], "jagoai:nadia")


class TestSemuaBrief(unittest.TestCase):
    def test_setiap_karyawan_punya_brief_sah(self):
        from app import config
        cfg = config.load('jagoai')
        for nama in cfg['karyawan']:
            p = Path('tenant/jagoai/brief-karyawan') / (nama + '.md')
            self.assertTrue(p.exists(), 'brief hilang: %s' % nama)
            b = brief.muat(p)
            self.assertEqual(b['agent_id'], 'jagoai:' + nama)
            self.assertGreaterEqual(b['versi'], 1)

if __name__ == "__main__":
    unittest.main()
