"""Klien gerbang model, format OpenAI."""
import json
import time
import urllib.error
import urllib.request

UA = "jagoai-virtual/0.2 (office)"
RETRY_STATUS = (429, 500, 502, 503, 504)


class GatewayError(RuntimeError):
    def __init__(self, status, body):
        super().__init__("gerbang membalas %s: %s" % (status, str(body)[:300]))
        self.status = status
        self.body = body


def _headers(kunci):
    return {
        "Content-Type": "application/json",
        "Authorization": "Bearer %s" % kunci,
        "User-Agent": UA,
    }


def _dari_sse(mentah, model):
    """Rakit balasan dari aliran SSE menjadi bentuk balasan biasa."""
    potongan = []
    usage = {}
    model_id = model
    for baris in mentah.splitlines():
        baris = baris.strip()
        if not baris.startswith("data:"):
            continue
        isi = baris[5:].strip()
        if not isi or isi == "[DONE]":
            continue
        try:
            obj = json.loads(isi)
        except json.JSONDecodeError:
            continue
        if obj.get("model"):
            model_id = obj["model"]
        if obj.get("usage"):
            usage = obj["usage"]
        for ch in obj.get("choices", []):
            delta = ch.get("delta") or {}
            pesan = ch.get("message") or {}
            if delta.get("content"):
                potongan.append(delta["content"])
            elif pesan.get("content") and not potongan:
                potongan.append(pesan["content"])
    return {
        "choices": [{"message": {"content": "".join(potongan)}}],
        "usage": usage,
        "model": model_id,
        "sse": True,
    }


def chat(base_url, kunci, model, messages, max_tokens=400, timeout=120, retries=2, backoff=2.0):
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "stream": False}
    data = json.dumps(payload).encode()
    terakhir = (0, "belum ada percobaan")
    for percobaan in range(retries + 1):
        req = urllib.request.Request(url, data=data, method="POST", headers=_headers(kunci))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                mentah = r.read().decode(errors="replace")
                jenis = (r.headers.get("Content-Type") or "").lower()
                if "text/event-stream" in jenis or mentah.lstrip().startswith("data:"):
                    return _dari_sse(mentah, model)
                try:
                    return json.loads(mentah)
                except json.JSONDecodeError:
                    try:
                        return json.JSONDecoder().raw_decode(mentah.lstrip())[0]
                    except json.JSONDecodeError:
                        raise GatewayError(r.status, "balasan tidak bisa dibaca: " + mentah[:300])
        except urllib.error.HTTPError as e:
            isi = e.read().decode(errors="replace")
            if e.code in RETRY_STATUS and percobaan < retries:
                terakhir = (e.code, isi)
                time.sleep(backoff * (percobaan + 1))
                continue
            raise GatewayError(e.code, isi)
        except urllib.error.URLError as e:
            terakhir = (0, str(e.reason))
            if percobaan < retries:
                time.sleep(backoff * (percobaan + 1))
                continue
    raise GatewayError(*terakhir)


def list_models(base_url, kunci, timeout=20):
    url = base_url.rstrip("/") + "/models"
    req = urllib.request.Request(url, headers=_headers(kunci))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            mentah = r.read().decode(errors="replace")
            try:
                return json.loads(mentah).get("data", [])
            except json.JSONDecodeError:
                raise GatewayError(r.status, "balasan bukan JSON: " + mentah[:300])
    except urllib.error.HTTPError as e:
        raise GatewayError(e.code, e.read().decode(errors="replace"))
    except urllib.error.URLError as e:
        raise GatewayError(0, str(e.reason))


def usage(hasil):
    u = hasil.get("usage") or {}
    return {
        "tokens_in": int(u.get("prompt_tokens", 0)),
        "tokens_out": int(u.get("completion_tokens", 0)),
        "model": hasil.get("model"),
    }


def teks(hasil):
    if not isinstance(hasil, dict):
        return ""
    try:
        isi = hasil["choices"][0]["message"].get("content")
    except (KeyError, IndexError, TypeError, AttributeError):
        return ""
    return isi or ""
