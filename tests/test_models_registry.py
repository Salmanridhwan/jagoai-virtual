import tempfile
import unittest
from pathlib import Path

from app import models_registry
from tests import fake_gateway


class TestRegistry(unittest.TestCase):
    def setUp(self):
        self.srv, self.base = fake_gateway.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def test_ambil_dan_cache(self):
        with tempfile.TemporaryDirectory() as d:
            cache = Path(d) / "models.json"
            data = models_registry.sync(self.base, "k", cache)
            self.assertEqual([m["id"] for m in data], ["uji/model-1", "uji/model-2"])
            self.assertTrue(cache.exists())
            lagi = models_registry.load_cache(cache)
            self.assertEqual([m["id"] for m in lagi], ["uji/model-1", "uji/model-2"])

    def test_cache_kosong(self):
        self.assertEqual(models_registry.load_cache(Path("tidak-ada.json")), [])

    def test_validasi_model(self):
        data = [{"id": "uji/model-1"}]
        self.assertTrue(models_registry.model_ada(data, "uji/model-1"))
        self.assertFalse(models_registry.model_ada(data, "uji/model-9"))


if __name__ == "__main__":
    unittest.main()
