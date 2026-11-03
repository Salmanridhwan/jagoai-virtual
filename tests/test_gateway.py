import unittest

from app import gateway
from tests import fake_gateway

PESAN = [{"role": "user", "content": "halo"}]


class Dasar(unittest.TestCase):
    def setUp(self):
        self.srv, self.base = fake_gateway.start()

    def tearDown(self):
        self._tutup(self.srv)

    @staticmethod
    def _tutup(srv):
        srv.shutdown()
        srv.server_close()

    def _ganti(self, script):
        self._tutup(self.srv)
        self.srv, self.base = fake_gateway.start(script)


class TestGatewaySukses(Dasar):

    def test_kirim_ua_dan_auth(self):
        hasil = gateway.chat(self.base, "kunci-uji", "uji/model-1", PESAN)
        self.assertEqual(hasil["choices"][0]["message"]["content"], "ok")
        call = fake_gateway.Handler.calls[-1]
        self.assertEqual(call["path"], "/v1/chat/completions")
        self.assertEqual(call["auth"], "Bearer kunci-uji")
        self.assertIn("jagoai-virtual", call["ua"])

    def test_mengembalikan_usage(self):
        hasil = gateway.chat(self.base, "k", "uji/model-1", PESAN)
        self.assertEqual(gateway.usage(hasil)["tokens_in"], 10)
        self.assertEqual(gateway.usage(hasil)["tokens_out"], 5)

    def test_teks_dan_usage_kosong(self):
        self.assertEqual(gateway.teks({}), "")
        self.assertEqual(gateway.usage({})["tokens_in"], 0)

    def test_teks_null_jadi_kosong(self):
        hasil = {"choices": [{"message": {"content": None, "reasoning": "..."}}]}
        self.assertEqual(gateway.teks(hasil), "")
        self.assertEqual(gateway.teks({"choices": []}), "")


class TestGatewayGalat(Dasar):
    def test_401_tidak_dicoba_ulang(self):
        self._ganti([(401, {"error": "API key required"})])
        with self.assertRaises(gateway.GatewayError) as ctx:
            gateway.chat(self.base, "salah", "uji/model-1", PESAN, retries=2, backoff=0)
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(len(fake_gateway.Handler.calls), 1)

    def test_429_dicoba_ulang_lalu_gagal(self):
        self._ganti([(429, {"error": "rate"}), (429, {"error": "rate"}), (429, {"error": "rate"})])
        with self.assertRaises(gateway.GatewayError) as ctx:
            gateway.chat(self.base, "k", "uji/model-1", PESAN, retries=2, backoff=0)
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(len(fake_gateway.Handler.calls), 3)

    def test_balasan_bukan_json_jadi_galat(self):
        self._ganti([(200, "<html>gerbang sibuk</html>")])
        with self.assertRaises(gateway.GatewayError) as ctx:
            gateway.chat(self.base, "k", "uji/model-1", PESAN, retries=0)
        self.assertEqual(ctx.exception.status, 200)
        self.assertIn("tidak bisa dibaca", str(ctx.exception))

    def test_balasan_sse_dirakit(self):
        sse = (
            'data: {"model":"uji/model-1","choices":[{"delta":{"content":"siap "}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"bekerja"}}],'
            '"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n'
            "data: [DONE]\n\n"
        )
        self._ganti([(200, sse)])
        hasil = gateway.chat(self.base, "k", "uji/model-1", PESAN, retries=0)
        self.assertEqual(gateway.teks(hasil), "siap bekerja")
        self.assertEqual(gateway.usage(hasil)["tokens_in"], 7)
        self.assertEqual(gateway.usage(hasil)["tokens_out"], 3)
        self.assertTrue(hasil["sse"])

    def test_429_lalu_berhasil(self):
        self._ganti([(429, {"error": "rate"})])
        hasil = gateway.chat(self.base, "k", "uji/model-1", PESAN, retries=2, backoff=0)
        self.assertEqual(hasil["choices"][0]["message"]["content"], "ok")


if __name__ == "__main__":
    unittest.main()
