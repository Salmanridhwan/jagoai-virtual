"""Uji jembatan OpenPost tanpa menyentuh jaringan sungguhan."""
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

from app import openpost

TOML_UJI = """[tenant]
slug = "jagoai"

[gerbang]
base_url = "https://contoh.invalid/v1"
kunci_env = "JAGOAI_ROUTER_KEY"

[openpost]
url = "http://127.0.0.1:8080/"
kunci_env = "JAGOAI_OPENPOST_TOKEN"
ruang_kerja = "ws-1"
media = ""
tiktok = "acc-tiktok"
"""


class EnvSementara:
    """Buat office.toml dan .env tenant di direktori sementara."""

    def __init__(self, toml=TOML_UJI, env=None):
        self.toml = toml
        self.env = {"JAGOAI_OPENPOST_TOKEN": "tok-uji"} if env is None else env

    def __enter__(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        (root / "tenant" / "jagoai").mkdir(parents=True)
        (root / "tenant" / "jagoai" / "office.toml").write_text(self.toml, encoding="utf-8")
        baris = "\n".join("%s=%s" % (k, v) for k, v in self.env.items())
        (root / "tenant" / "jagoai" / ".env").write_text(baris + "\n", encoding="utf-8")
        self.root = str(root)
        return self.root

    def __exit__(self, *arg):
        self.dir.cleanup()


class KlienPalsu:
    def __init__(self, publikasi=None, draf=None, galat=None):
        self.publikasi = list(publikasi or [
            {"renditions": [{"status": "published", "external_url": "https://tiktok.com/@jagoai/video/1"}]}
        ])
        self.draf = draf or {"id": "pub-1", "revision": 3, "status": "draft"}
        self.galat = galat
        self.dipanggil = []
        self.terbit = []
        self.ulasan = []

    def buat_draf(self, workspace_id, judul, teks, akun_id, preset="post", media_id=""):
        self.dipanggil.append({"workspace": workspace_id, "judul": judul, "teks": teks,
                               "akun": akun_id, "preset": preset, "media": media_id})
        if self.galat:
            raise self.galat
        return self.draf

    def validasi(self, pid):
        self.dipanggil.append({"validasi": pid})
        return {"ok": True}

    def terbitkan(self, pid, revisi):
        self.terbit.append((pid, revisi))
        return {"ok": True}

    def reviews(self, pid):
        return list(self.ulasan)

    def ambil(self, pid):
        if len(self.publikasi) > 1:
            return self.publikasi.pop(0)
        return self.publikasi[0]


class UjiKonfig(unittest.TestCase):
    def test_konfig_lengkap(self):
        with EnvSementara() as root:
            cfg = openpost.konfig(root, "jagoai")
        self.assertEqual(cfg["url"], "http://127.0.0.1:8080")
        self.assertEqual(cfg["workspace"], "ws-1")
        self.assertEqual(cfg["akun"], {"tiktok": "acc-tiktok"})
        self.assertEqual(cfg["media"], "")

    def test_token_dibaca_dari_env_tenant(self):
        with EnvSementara() as root:
            cfg = openpost.konfig(root, "jagoai")
        self.assertEqual(cfg["token"], "tok-uji")

    def test_token_kosong_disebut_namanya(self):
        with EnvSementara(env={}) as root:
            with self.assertRaises(openpost.OpenPostBelumSiap) as ctx:
                openpost.konfig(root, "jagoai")
        self.assertIn("JAGOAI_OPENPOST_TOKEN", str(ctx.exception))

    def test_ruang_kerja_kosong_disebut_tempatnya(self):
        toml = TOML_UJI.replace('ruang_kerja = "ws-1"', 'ruang_kerja = ""')
        with EnvSementara(toml=toml) as root:
            with self.assertRaises(openpost.OpenPostBelumSiap) as ctx:
                openpost.konfig(root, "jagoai")
        self.assertIn("openpost.ruang_kerja", str(ctx.exception))

    def test_alamat_tidak_tinggal_di_env(self):
        from app import env as envmod
        self.assertNotIn("JAGOAI_OPENPOST_URL", envmod.OPSIONAL)
        self.assertIn("JAGOAI_OPENPOST_TOKEN", envmod.OPSIONAL)


class UjiKlien(unittest.TestCase):
    def test_kiriman_membawa_bearer_dan_json(self):
        tercatat = {}

        def urlopen_palsu(permintaan, timeout=None):
            tercatat["url"] = permintaan.full_url
            tercatat["metode"] = permintaan.get_method()
            tercatat["kepala"] = dict(permintaan.header_items())
            tercatat["isi"] = json.loads(permintaan.data.decode("utf-8"))
            return io.BytesIO(b'{"id": "pub-1", "revision": 2}')

        asli = openpost.urllib.request.urlopen
        openpost.urllib.request.urlopen = urlopen_palsu
        try:
            klien = openpost.Klien("http://127.0.0.1:8080", "tok-uji")
            hasil = klien.buat_draf("ws-1", "Judul", "Isi", "acc-tiktok", preset="post")
        finally:
            openpost.urllib.request.urlopen = asli

        self.assertEqual(hasil["id"], "pub-1")
        self.assertEqual(tercatat["url"], "http://127.0.0.1:8080/api/v1/publications")
        self.assertEqual(tercatat["metode"], "POST")
        self.assertEqual(tercatat["kepala"].get("Authorization"), "Bearer tok-uji")
        self.assertEqual(tercatat["isi"]["workspace_id"], "ws-1")
        self.assertEqual(tercatat["isi"]["renditions"][0]["social_account_id"], "acc-tiktok")
        self.assertNotIn("media", tercatat["isi"]["renditions"][0])

    def test_galat_http_jadi_openpost_galat(self):
        def urlopen_palsu(permintaan, timeout=None):
            raise urllib.error.HTTPError(permintaan.full_url, 401, "Unauthorized", {},
                                         io.BytesIO(b'{"message":"token salah"}'))

        asli = openpost.urllib.request.urlopen
        openpost.urllib.request.urlopen = urlopen_palsu
        try:
            klien = openpost.Klien("http://127.0.0.1:8080", "tok-uji")
            with self.assertRaises(openpost.OpenPostGalat) as ctx:
                klien.akun()
        finally:
            openpost.urllib.request.urlopen = asli

        self.assertEqual(ctx.exception.kode, 401)
        self.assertIn("token salah", ctx.exception.pesan)


class UjiSiapkan(unittest.TestCase):
    def test_konten_video_membawa_media_dan_preset_video(self):
        with EnvSementara() as root:
            cfg = openpost.konfig(root, "jagoai")
        cfg["media"] = "med-9"
        motor = KlienPalsu()
        item = {"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok", "teks": "Naskah"}
        pid, revisi, status = openpost.siapkan(motor, cfg, item)
        panggil = motor.dipanggil[0]
        self.assertEqual(pid, "pub-1")
        self.assertEqual(revisi, 3)
        self.assertEqual(status, "draft")
        self.assertEqual(panggil["preset"], "video")
        self.assertEqual(panggil["media"], "med-9")
        self.assertEqual(panggil["akun"], "acc-tiktok")

    def test_kanal_tanpa_akun_menolak_sebelum_kirim(self):
        with EnvSementara() as root:
            cfg = openpost.konfig(root, "jagoai")
        item = {"jenis": "balasan", "id": "sampel-1", "kanal": "threads", "teks": "Halo"}
        with self.assertRaises(openpost.OpenPostBelumSiap) as ctx:
            openpost.siapkan(KlienPalsu(), cfg, item)
        self.assertIn("threads", str(ctx.exception))

    def test_teks_balasan_membawa_tautan_asal(self):
        item = {"jenis": "balasan", "teks": "Jawaban singkat", "tautan": "https://contoh.id/a"}
        self.assertIn("https://contoh.id/a", openpost.teks_item(item))

    def test_tautan_tidak_digandakan(self):
        item = {"jenis": "balasan", "teks": "Lihat https://contoh.id/a", "tautan": "https://contoh.id/a"}
        self.assertEqual(openpost.teks_item(item).count("https://contoh.id/a"), 1)


class UjiPengirim(unittest.TestCase):
    def test_terbit_dan_tautan_dikembalikan(self):
        with EnvSementara() as root:
            kirim = openpost.pengirim(root, "jagoai", klien=KlienPalsu(), detik=0)
            hasil = kirim({"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok",
                           "teks": "Naskah"}, "tiktok", None)
        self.assertTrue(hasil["ok"], hasil)
        self.assertEqual(hasil["tautan"], "https://tiktok.com/@jagoai/video/1")

    def test_revisi_yang_dibaca_dipakai_saat_terbit(self):
        motor = KlienPalsu()
        with EnvSementara() as root:
            kirim = openpost.pengirim(root, "jagoai", klien=motor, detik=0)
            kirim({"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok", "teks": "Naskah"},
                  "tiktok", None)
        self.assertEqual(motor.terbit, [("pub-1", 3)])

    def test_rendisi_gagal_dilaporkan_apa_adanya(self):
        gagal = {"renditions": [{"status": "failed", "error_message": "video terlalu pendek"}]}
        motor = KlienPalsu(publikasi=[gagal])
        with EnvSementara() as root:
            kirim = openpost.pengirim(root, "jagoai", klien=motor, detik=0)
            hasil = kirim({"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok",
                           "teks": "Naskah"}, "tiktok", None)
        self.assertFalse(hasil["ok"])
        self.assertIn("video terlalu pendek", hasil["alasan"])

    def test_belum_final_tidak_disebut_terkirim(self):
        motor = KlienPalsu(publikasi=[{"renditions": [{"status": "publishing"}]}])
        with EnvSementara() as root:
            kirim = openpost.pengirim(root, "jagoai", klien=motor, detik=0)
            hasil = kirim({"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok",
                           "teks": "Naskah"}, "tiktok", None)
        self.assertFalse(hasil["ok"])
        self.assertIn("belum final", hasil["alasan"])

    def test_konfig_kosong_tidak_melempar_keluar(self):
        with EnvSementara(env={}) as root:
            kirim = openpost.pengirim(root, "jagoai", klien=KlienPalsu(), detik=0)
            hasil = kirim({"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok",
                           "teks": "Naskah"}, "tiktok", None)
        self.assertFalse(hasil["ok"])
        self.assertIn("belum diisi", hasil["alasan"])

    def test_galat_openpost_jadi_alasan_bukan_traceback(self):
        motor = KlienPalsu(galat=openpost.OpenPostGalat(422, "media wajib"))
        with EnvSementara() as root:
            kirim = openpost.pengirim(root, "jagoai", klien=motor, detik=0)
            hasil = kirim({"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok",
                           "teks": "Naskah"}, "tiktok", None)
        self.assertFalse(hasil["ok"])
        self.assertIn("422", hasil["alasan"])


class UjiTunggu(unittest.TestCase):
    def test_berhenti_saat_final_tanpa_tidur(self):
        motor = KlienPalsu(publikasi=[{"renditions": [{"status": "published"}]}])
        publikasi, status, tautan, pesan, final = openpost.tunggu(motor, "pub-1", detik=5,
                                                                  tidur=lambda s: None)
        self.assertTrue(final)
        self.assertEqual(status, ["published"])

    def test_polling_sampai_status_berubah(self):
        motor = KlienPalsu(publikasi=[{"renditions": [{"status": "publishing"}]},
                                      {"renditions": [{"status": "published",
                                                       "external_url": "https://x/1"}]}])
        publikasi, status, tautan, pesan, final = openpost.tunggu(motor, "pub-1", detik=10,
                                                                  tidur=lambda s: None)
        self.assertTrue(final)
        self.assertEqual(tautan, "https://x/1")


if __name__ == "__main__":
    unittest.main()


class UjiDrafDanSinkron(unittest.TestCase):
    def _item(self):
        return {"jenis": "konten", "tanggal": "2026-11-04", "kanal": "tiktok", "teks": "Naskah"}

    def test_draf_tidak_menerbitkan(self):
        motor = KlienPalsu()
        with EnvSementara() as root:
            hasil = openpost.kirim_draf(root, "jagoai", self._item(), klien=motor)
        self.assertEqual(hasil["id"], "pub-1")
        self.assertEqual(motor.terbit, [])
        self.assertTrue(any("validasi" in p for p in motor.dipanggil))

    def test_sinkron_menulis_event_setelah_disetujui_dan_tayang(self):
        motor = KlienPalsu()
        motor.ulasan = [{"decision": "approved", "reviewer_id": "salman",
                          "decided_at": "2026-11-04T10:00:00Z"}]
        with EnvSementara() as root:
            hasil = openpost.sinkron(root, "jagoai", "pub-1", klien=motor, tulis_event=True)
            event = (Path(root) / "tenant" / "jagoai" / "events.jsonl").read_text(encoding="utf-8")
        self.assertTrue(hasil["tayang"])
        self.assertEqual(hasil["reviewer"], "salman")
        self.assertIn("published", event)
        self.assertIn("salman", event)

    def test_sinkron_tanpa_persetujuan_tidak_menulis_event(self):
        motor = KlienPalsu()
        motor.ulasan = [{"decision": "changes_requested", "reviewer_id": "salman"}]
        with EnvSementara() as root:
            hasil = openpost.sinkron(root, "jagoai", "pub-1", klien=motor, tulis_event=True)
            ada_event = (Path(root) / "tenant" / "jagoai" / "events.jsonl").exists()
        self.assertFalse(hasil["tayang"])
        self.assertFalse(ada_event)

    def test_sinkron_tidak_menulis_dua_kali(self):
        motor = KlienPalsu()
        motor.ulasan = [{"decision": "approved", "reviewer_id": "salman"}]
        with EnvSementara() as root:
            openpost.sinkron(root, "jagoai", "pub-1", klien=motor, tulis_event=True)
            openpost.sinkron(root, "jagoai", "pub-1", klien=motor, tulis_event=True)
            isi = (Path(root) / "tenant" / "jagoai" / "events.jsonl").read_text(encoding="utf-8")
        self.assertEqual(isi.count("published"), 1)


class KlienRingkas:
    def __init__(self, nama="JagoAI", akun=2, publikasi=None, galat=None):
        self.nama = nama
        self.akun_n = akun
        self.publikasi_data = publikasi if publikasi is not None else [
            {"status": "draft"}, {"status": "scheduled"}, {"status": "published"},
        ]
        self.galat = galat
        self.panggilan = 0

    def ruang_kerja(self):
        self.panggilan += 1
        if self.galat:
            raise self.galat
        return [{"id": "ws-1", "name": self.nama}]

    def akun(self, workspace_id=""):
        self.panggilan += 1
        return [{"id": "a%d" % i} for i in range(self.akun_n)]

    def publikasi(self, workspace_id="", batas=100):
        self.panggilan += 1
        return list(self.publikasi_data)


class UjiRingkasTenant(unittest.TestCase):
    def test_menghitung_akun_dan_kiriman(self):
        motor = KlienRingkas()
        with EnvSementara() as root:
            hasil = openpost.ringkas_tenant(root, "jagoai", klien=motor, umur=0)
        self.assertTrue(hasil["siap"])
        self.assertEqual(hasil["nama"], "JagoAI")
        self.assertEqual(hasil["workspace"], "ws-1")
        self.assertEqual(hasil["akun"], 2)
        self.assertEqual(hasil["draf"], 1)
        self.assertEqual(hasil["terjadwal"], 1)
        self.assertEqual(hasil["tayang"], 1)

    def test_token_kosong_dilaporkan_bukan_meledak(self):
        with EnvSementara(env={}) as root:
            hasil = openpost.ringkas_tenant(root, "jagoai", klien=KlienRingkas(), umur=0)
        self.assertFalse(hasil["siap"])
        self.assertIn("JAGOAI_OPENPOST_TOKEN", hasil["galat"])

    def test_galat_openpost_dilaporkan(self):
        motor = KlienRingkas(galat=openpost.OpenPostGalat(403, "tidak berhak"))
        with EnvSementara() as root:
            hasil = openpost.ringkas_tenant(root, "jagoai", klien=motor, umur=0)
        self.assertFalse(hasil["siap"])
        self.assertIn("403", hasil["galat"])

    def test_hasil_disimpan_sebentar(self):
        motor = KlienRingkas()
        with EnvSementara() as root:
            openpost.ringkas_tenant(root, "jagoai", klien=motor, umur=60)
            jumlah_awal = motor.panggilan
            openpost.ringkas_tenant(root, "jagoai", klien=motor, umur=60)
            jumlah_akhir = motor.panggilan
        self.assertEqual(jumlah_awal, jumlah_akhir)
        self.assertGreater(jumlah_awal, 0)
