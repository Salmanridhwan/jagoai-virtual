import unittest

from app import penjaga

P = chr(10)

BRIEF = "Tujuan tetap: menulis naskah carousel tentang cara membuat website tanpa coding."


class TestPenjaga(unittest.TestCase):
    def test_bersih(self):
        self.assertEqual(penjaga.periksa("Tulis tiga varian hook, lalu pilih satu.", BRIEF, 2026), [])

    def test_nama_produk(self):
        hasil = penjaga.periksa("Sebagai CodeBuddy Code, saya sarankan begini.", BRIEF, 2026)
        self.assertEqual(hasil[0]["jenis"], "identitas")

    def test_asisten(self):
        hasil = penjaga.periksa("Sebagai asisten AI yang fokus pada kode.", BRIEF, 2026)
        self.assertTrue(any(p["jenis"] == "identitas" for p in hasil))

    def test_tahun_karangan(self):
        hasil = penjaga.periksa("Slot pertama Rabu, 16 Juli 2025.", BRIEF, 2026)
        self.assertEqual(hasil[0]["jenis"], "tahun")
        self.assertEqual(hasil[0]["cuplikan"], "2025")

    def test_tahun_berjalan_boleh(self):
        self.assertEqual(penjaga.periksa("Kampanye 2026 dimulai pekan ini.", BRIEF, 2026), [])

    def test_tahun_di_brief_boleh(self):
        brief = BRIEF + " Sasaran 2024 dipertahankan."
        self.assertEqual(penjaga.periksa("Angka 2024 masih dipakai.", brief, 2026), [])

    def test_persentase_karangan(self):
        hasil = penjaga.periksa("90% website mati di detik ketiga.", BRIEF, 2026)
        self.assertEqual(hasil[0]["jenis"], "angka")

    def test_persentase_di_brief_boleh(self):
        brief = BRIEF + " Gunakan angka 90% dari laporan Vera."
        self.assertEqual(penjaga.periksa("Sekitar 90% audiens berhenti.", brief, 2026), [])

    def test_jumlah_orang_karangan(self):
        hasil = penjaga.periksa("12 ribu pengguna sudah bergabung.", BRIEF, 2026)
        self.assertEqual(hasil[0]["jenis"], "angka")

    def test_ringkasan(self):
        hasil = penjaga.periksa("Sebagai asisten AI, 12 ribu pengguna di 2025.", BRIEF, 2026)
        teks = penjaga.ringkas_pelanggaran(hasil)
        self.assertIn("identitas", teks)
        self.assertIn("angka", teks)
        self.assertIn("tahun", teks)

    def test_larangan_dari_brief(self):
        brief = P.join([
            'Header: x',
            '',
            '## Larangan khusus',
            '- Jangan memakai kata `instan` atau `dijamin`.',
            '',
            '## Riwayat',
            '- v1',
        ])
        hasil = penjaga.periksa('Ini dijamin cepat dan instan.', brief, 2026)
        jenis = [p['jenis'] for p in hasil]
        self.assertIn('larangan_brief', jenis)
        self.assertEqual(len([j for j in jenis if j == 'larangan_brief']), 2)

    def test_larangan_aman(self):
        brief = P.join(['## Larangan khusus', '- Jangan memakai kata `instan`.', '', '## Riwayat', '- v1'])
        self.assertEqual(penjaga.periksa('Naskah ini memakai kata yang aman.', brief, 2026), [])

    def test_tugas_melenceng(self):
        hasil = penjaga.periksa('Meningkatkan efisiensi penyelesaian tugas harian.', BRIEF, 2026,
                                tugas='tulis satu sasaran pekan ini')
        self.assertIn('topik', [p['jenis'] for p in hasil])

    def test_tugas_nyambung(self):
        hasil = penjaga.periksa('Sasaran pekan ini adalah konten no-code.', BRIEF, 2026,
                                tugas='tulis satu sasaran pekan ini')
        self.assertEqual(hasil, [])

if __name__ == "__main__":
    unittest.main()
