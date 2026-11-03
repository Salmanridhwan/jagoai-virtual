"""Server HTTP tiruan untuk menguji klien gerbang tanpa jaringan."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    script = []
    get_script = []
    calls = []

    def _kirim(self, status, payload):
        if isinstance(payload, str):
            data = payload.encode()
        else:
            data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        Handler.calls.append(
            {
                "path": self.path,
                "body": body,
                "auth": self.headers.get("Authorization"),
                "ua": self.headers.get("User-Agent"),
            }
        )
        if Handler.script:
            status, payload = Handler.script.pop(0)
        else:
            status = 200
            payload = {
                "choices": [{"message": {"content": "ok"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                "model": body.get("model"),
            }
        self._kirim(status, payload)

    def do_GET(self):
        Handler.calls.append(
            {
                "path": self.path,
                "auth": self.headers.get("Authorization"),
                "ua": self.headers.get("User-Agent"),
            }
        )
        if Handler.get_script:
            status, payload = Handler.get_script.pop(0)
        else:
            status, payload = 200, {"data": [{"id": "uji/model-1"}, {"id": "uji/model-2"}]}
        self._kirim(status, payload)

    def log_message(self, *args):
        pass


def start(script=None, get_script=None):
    Handler.script = list(script or [])
    Handler.get_script = list(get_script or [])
    Handler.calls = []
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base = "http://127.0.0.1:%d/v1" % srv.server_address[1]
    return srv, base
