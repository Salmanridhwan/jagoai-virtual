"""Jembatan ke OpenPost: gerbang persetujuan kita tetap di depan.

Modul ini tidak memutuskan apa yang boleh tayang. Ia hanya mengantar barang yang
sudah lolos `app.kirim` ke OpenPost, lalu memastikan OpenPost benar benar
menerbitkannya sebelum kita menulis event `published`.

Alamat, ruang kerja, dan id akun tinggal di `office.toml`. Yang di `.env` hanya
token, sesuai aturan pemisahan rahasia dan alamat.

Alur satu kiriman:

1. buat draf publikasi (POST /publications), belum tayang
2. validasi rendisi (POST /publications/{id}/validate)
3. terbitkan (POST /publications/{id}/publish-now) dengan revisi yang kita baca
4. tunggu status rendisi sampai final, lalu laporkan apa adanya

Kalau status belum final saat batas tunggu habis, kita melaporkan gagal dengan
alasan "belum final". Berbohong bahwa sudah terkirim lebih buruk daripada
menyuruh manusia memeriksa sekali lagi.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from app import config as config_mod
from app import env

KANAL = ("tiktok", "threads", "instagram")
TUNGGU_DETIK = 90
JEDA_POLL = 3
FINAL = ("published", "failed", "cancelled")


class OpenPostBelumSiap(RuntimeError):
    """Konfigurasi belum lengkap, jadi tidak ada yang dikirim."""


class OpenPostGalat(RuntimeError):
    """OpenPost menolak permintaan; bawa kode HTTP dan pesannya."""

    def __init__(self, kode, pesan):
        super().__init__("OpenPost %s: %s" % (kode, pesan))
        self.kode = kode
        self.pesan = pesan


def konfig(root, tenant, cfg=None):
    """Baca alamat dari office.toml dan token dari .env tenant."""
    if cfg is None:
        cfg = config_mod.load(tenant, root=str(root))
    bagian = cfg.get("openpost") or {}
    nama_token = bagian.get("kunci_env") or "JAGOAI_OPENPOST_TOKEN"
    sumber = env.load_env(Path(root) / "tenant" / tenant / ".env")
    token = sumber.get(nama_token) or os.environ.get(nama_token) or ""

    kurang = []
    if not bagian.get("url"):
        kurang.append("openpost.url di office.toml")
    if not token:
        kurang.append(nama_token)
    if not bagian.get("ruang_kerja"):
        kurang.append("openpost.ruang_kerja di office.toml")
    if kurang:
        raise OpenPostBelumSiap("belum diisi: %s" % ", ".join(kurang))

    akun = {}
    for kanal in KANAL:
        if bagian.get(kanal):
            akun[kanal] = bagian[kanal]
    return {
        "url": str(bagian["url"]).rstrip("/"),
        "token": token,
        "workspace": str(bagian["ruang_kerja"]),
        "akun": akun,
        "media": str(bagian.get("media") or ""),
    }


class Klien:
    """Pembungkus tipis HTTP API OpenPost v1."""

    def __init__(self, url, token, timeout=30):
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _panggil(self, metode, jalur, isi=None):
        data = None
        kepala = {"Authorization": "Bearer %s" % self.token, "Accept": "application/json"}
        if isi is not None:
            data = json.dumps(isi).encode("utf-8")
            kepala["Content-Type"] = "application/json"
        permintaan = urllib.request.Request(self.url + jalur, data=data, headers=kepala,
                                            method=metode)
        try:
            with urllib.request.urlopen(permintaan, timeout=self.timeout) as jawab:
                teks = jawab.read().decode("utf-8")
                return json.loads(teks) if teks.strip() else {}
        except urllib.error.HTTPError as galat:
            badan = galat.read().decode("utf-8", "replace")[:400]
            raise OpenPostGalat(galat.code, badan) from None
        except urllib.error.URLError as galat:
            raise OpenPostGalat("jaringan", str(galat.reason)) from None

    def ruang_kerja(self):
        return self._panggil("GET", "/api/v1/workspaces") or []

    def akun(self, workspace_id=""):
        jalur = "/api/v1/accounts"
        if workspace_id:
            jalur += "?workspace_id=" + urllib.parse.quote(str(workspace_id))
        return self._panggil("GET", jalur) or []

    def publikasi(self, workspace_id="", batas=100):
        jalur = "/api/v1/publications?limit=%d" % int(batas)
        if workspace_id:
            jalur += "&workspace_id=" + urllib.parse.quote(str(workspace_id))
        hasil = self._panggil("GET", jalur)
        return (hasil.get("items") or hasil.get("publications") or []) if isinstance(hasil, dict) else (hasil or [])

    def buat_draf(self, workspace_id, judul, teks, akun_id, preset="post", media_id=""):
        rendisi = {"social_account_id": akun_id, "body": teks}
        if media_id:
            rendisi["media"] = [{"media_id": media_id}]
        isi = {
            "workspace_id": workspace_id,
            "title": judul,
            "content_profile": "social",
            "creation_preset": preset,
            "source_text": teks,
            "renditions": [rendisi],
        }
        return self._panggil("POST", "/api/v1/publications", isi)

    def validasi(self, pid):
        return self._panggil("POST", "/api/v1/publications/%s/validate" % pid)

    def terbitkan(self, pid, revisi):
        return self._panggil("POST", "/api/v1/publications/%s/publish-now" % pid,
                             {"expected_revision": int(revisi)})

    def ambil(self, pid):
        return self._panggil("GET", "/api/v1/publications/%s" % pid)

    def reviews(self, pid):
        return self._panggil("GET", "/api/v1/publications/%s/reviews" % pid) or []


def teks_item(item):
    """Teks yang akan tayang, diambil dari bentuk barang antrean kita."""
    if item.get("jenis") == "balasan":
        teks = (item.get("teks") or "").strip()
        tautan = (item.get("tautan") or "").strip()
        if tautan and tautan not in teks:
            teks = (teks + "\n\n" + tautan).strip()
        return teks
    return (item.get("teks") or item.get("naskah") or "").strip()


def judul_item(item):
    if item.get("jenis") == "balasan":
        return "Balasan %s" % (item.get("id") or "")
    return "Konten %s" % (item.get("tanggal") or "")


def siapkan(klien, cfg, item):
    """Buat draf dan validasi. Mengembalikan (id, revisi, status_awal)."""
    kanal = item.get("kanal") or "tiktok"
    akun_id = cfg["akun"].get(kanal)
    if not akun_id:
        raise OpenPostBelumSiap("akun OpenPost untuk kanal %s belum diisi (openpost.%s di office.toml)"
                                % (kanal, kanal))
    teks = teks_item(item)
    if not teks:
        raise OpenPostBelumSiap("barang %s tidak punya teks untuk dikirim" % judul_item(item))
    media_id = cfg.get("media") if item.get("jenis") == "konten" else ""
    preset = "video" if item.get("jenis") == "konten" else "post"
    draf = klien.buat_draf(cfg["workspace"], judul_item(item), teks, akun_id,
                           preset=preset, media_id=media_id or "")
    pid = draf.get("id")
    if not pid:
        raise OpenPostGalat("bentuk", "draf tidak mengembalikan id")
    klien.validasi(pid)
    return pid, int(draf.get("revision") or 1), draf.get("status") or "draft"


def _ringkas_status(publikasi):
    rendisi = publikasi.get("renditions") or []
    status = [r.get("status") or "" for r in rendisi]
    tautan = ""
    for r in rendisi:
        if r.get("external_url"):
            tautan = r["external_url"]
            break
    pesan = ""
    for r in rendisi:
        if r.get("status") == "failed" and r.get("error_message"):
            pesan = r["error_message"]
            break
    return status, tautan, pesan


def tunggu(klien, pid, detik=TUNGGU_DETIK, jeda=JEDA_POLL, tidur=time.sleep):
    """Polling sampai semua rendisi final atau batas tunggu habis."""
    habis = time.monotonic() + detik
    publikasi = klien.ambil(pid)
    while True:
        status, tautan, pesan = _ringkas_status(publikasi)
        final = bool(status) and all(s in FINAL for s in status)
        if final or time.monotonic() >= habis:
            return publikasi, status, tautan, pesan, final
        tidur(jeda)
        publikasi = klien.ambil(pid)


def pengirim(root, tenant, klien=None, detik=TUNGGU_DETIK, tidur=time.sleep):
    """Buat fungsi pengirim yang dipakai `app.kirim.kirim`."""

    def kirim(item, kanal, sekarang):
        try:
            cfg = konfig(root, tenant)
        except OpenPostBelumSiap as galat:
            return {"ok": False, "alasan": str(galat)}
        motor = klien or Klien(cfg["url"], cfg["token"])
        try:
            pid, revisi, _ = siapkan(motor, cfg, item)
            motor.terbitkan(pid, revisi)
            publikasi, status, tautan, pesan, final = tunggu(motor, pid, detik=detik, tidur=tidur)
        except OpenPostBelumSiap as galat:
            return {"ok": False, "alasan": str(galat)}
        except OpenPostGalat as galat:
            return {"ok": False, "alasan": str(galat)}

        if not final:
            return {"ok": False,
                    "alasan": "sudah masuk OpenPost sebagai %s, status belum final; periksa %s"
                              % (pid, pid)}
        if "failed" in status:
            return {"ok": False, "alasan": "OpenPost menolak: %s" % (pesan or "tanpa pesan")}
        if all(s == "published" for s in status):
            return {"ok": True, "tautan": tautan, "id": publikasi.get("id", pid)}
        return {"ok": False, "alasan": "status akhir %s, bukan published" % ",".join(status)}

    return kirim


def kirim_draf(root, tenant, item, klien=None, cfg=None):
    """Setor draf ke OpenPost tanpa menerbitkan apa pun.

    Dipakai saat OpenPost bertindak sebagai admin: kantor hanya menaruh bahan,
    manusia meninjau dan menerbitkan dari sana.
    """
    cfg = cfg or konfig(root, tenant)
    motor = klien or Klien(cfg["url"], cfg["token"])
    pid, revisi, status = siapkan(motor, cfg, item)
    return {"id": pid, "revisi": revisi, "status": status, "tautan": ""}


def _buku_sinkron(root, tenant):
    return Path(root) / "tenant" / tenant / "keluaran" / "openpost" / "sinkron.json"


def _sudah_dicatat(peta, pid):
    return bool((peta.get("publikasi") or {}).get(pid))


def _catat_sinkron(root, tenant, pid, data):
    p = _buku_sinkron(root, tenant)
    p.parent.mkdir(parents=True, exist_ok=True)
    isi = {"publikasi": {}}
    if p.exists():
        try:
            isi = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    isi.setdefault("publikasi", {})[pid] = data
    p.write_text(json.dumps(isi, ensure_ascii=False, indent=1), encoding="utf-8")


def keputusan_terakhir(reviews):
    """Ambil keputusan review terbaru yang sudah diputuskan."""
    diputus = [r for r in (reviews or []) if r.get("decision")]
    if not diputus:
        return None
    diputus.sort(key=lambda r: r.get("decided_at") or r.get("created_at") or "")
    return diputus[-1]


def sinkron(root, tenant, pid, klien=None, cfg=None, tulis_event=False):
    """Baca keadaan satu publikasi dan catat apa adanya.

    `published` hanya dicatat kalau seluruh rendisi `published` dan review
    terakhir OpenPost berstatus disetujui.
    """
    from app import events as events_mod

    cfg = cfg or konfig(root, tenant)
    motor = klien or Klien(cfg["url"], cfg["token"])
    publikasi = motor.ambil(pid)
    reviews = motor.reviews(pid)
    keputusan = keputusan_terakhir(reviews)
    status, tautan, pesan = _ringkas_status(publikasi)
    lulus = bool(status) and all(s == "published" for s in status)
    disetujui = bool(keputusan) and str(keputusan.get("decision")).lower() in ("approved", "approve")

    hasil = {
        "id": pid,
        "status": status,
        "tautan": tautan,
        "pesan": pesan,
        "reviewer": (keputusan or {}).get("reviewer_id") or "",
        "keputusan": (keputusan or {}).get("decision") or "",
        "diputuskan_pada": (keputusan or {}).get("decided_at") or "",
        "tayang": lulus and disetujui,
    }
    if hasil["tayang"] and not _sudah_dicatat({"publikasi": _muat_sinkron(root, tenant)}, pid):
        _catat_sinkron(root, tenant, pid, hasil)
        if tulis_event:
            events_mod.append(Path(root) / "tenant" / tenant / "events.jsonl", {
                "kind": "published", "agent_id": "%s:openpost" % tenant,
                "publikasi": pid, "tautan": tautan,
                "disetujui_oleh": hasil["reviewer"],
            })
    return hasil


def _muat_sinkron(root, tenant):
    p = _buku_sinkron(root, tenant)
    if not p.exists():
        return {}
    try:
        return (json.loads(p.read_text(encoding="utf-8")) or {}).get("publikasi") or {}
    except json.JSONDecodeError:
        return {}


_CACHE = {}


def ringkas_tenant(root, tenant, klien=None, umur=30, sekarang=None):
    """Ringkasan satu tenant dari sisi OpenPost: ruang kerja, akun, dan kiriman.

    Dipakai layar Kontrol supaya admin bisa melihat tenant mana yang sudah
    benar benar tersambung ke Studio, bukan hanya ada di folder.
    """
    kunci = (str(root), tenant)
    sekarang = time.monotonic() if sekarang is None else sekarang
    tersimpan = _CACHE.get(kunci)
    if tersimpan and sekarang - tersimpan[0] < umur:
        return tersimpan[1]

    dasar = {"siap": False, "workspace": "", "nama": "", "akun": 0,
             "draf": 0, "terjadwal": 0, "tayang": 0, "galat": ""}
    try:
        cfg = konfig(root, tenant)
    except (OpenPostBelumSiap, FileNotFoundError, KeyError) as galat:
        dasar["galat"] = str(galat)
        _CACHE[kunci] = (sekarang, dasar)
        return dasar

    motor = klien or Klien(cfg["url"], cfg["token"])
    hasil = dict(dasar)
    hasil["workspace"] = cfg["workspace"]
    try:
        for r in motor.ruang_kerja():
            if str(r.get("id")) == cfg["workspace"]:
                hasil["nama"] = r.get("name") or ""
                break
        hasil["akun"] = len(motor.akun(workspace_id=cfg["workspace"]))
        for kiriman in motor.publikasi(cfg["workspace"]):
            status = str(kiriman.get("status") or "").lower()
            if status in ("draft",):
                hasil["draf"] += 1
            elif status in ("scheduled", "queued"):
                hasil["terjadwal"] += 1
            elif status == "published":
                hasil["tayang"] += 1
        hasil["siap"] = True
    except OpenPostGalat as galat:
        hasil["galat"] = str(galat)
    _CACHE[kunci] = (sekarang, hasil)
    return hasil
