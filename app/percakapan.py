"""Jalur percakapan: Bayu menyaring, Sinta menyusun draf, manusia menyetujui.

Sumber percakapan ada dua. Yang jalan sekarang adalah berkas yang diisi manusia
di `tenant/<slug>/masuk/percakapan.jsonl`. Sumber API menolak jalan kalau token
kanal belum ada, karena mengarang percakapan lebih buruk daripada tidak ada
percakapan.

Tidak ada pengiriman di modul ini. Draf berhenti di `menunggu_persetujuan`.
"""
import difflib
import json
from datetime import datetime, timedelta
from pathlib import Path

from app import brief, config, env, penjaga, runtime

P = chr(10)

BATAS_BALASAN_HARI = 20
JEDA_MENIT = 3
HARI_ULANG = 7
MIRIP_MAKS = 0.85
PANJANG_MIN = 12

TUGAS_SINTA = P.join([
    "Tulis satu draf balasan untuk percakapan berikut.",
    "Kanal: {kanal}",
    "Teks asli: {teks}",
    "",
    "Aturan:",
    "- Bahasa Indonesia, sopan, maksimal tiga kalimat.",
    "- Jawab pertanyaannya langsung, jangan membuka dengan jualan.",
    "- Jangan menyebut angka, harga, tahun, atau janji hasil.",
    "- Jangan menyebut dirimu bot, AI, atau asisten.",
    "- Jangan menambah tautan selain tautan asal.",
    "Balas hanya teks balasannya, tanpa pembuka dan tanpa tanda kutip.",
])


class SumberBelumAda(RuntimeError):
    pass


class DrafGagal(RuntimeError):
    pass


def jalur_masuk(root, tenant):
    return Path(root) / "tenant" / tenant / "masuk" / "percakapan.jsonl"


def muat_masuk(root, tenant):
    p = jalur_masuk(root, tenant)
    if not p.exists():
        return []
    hasil = []
    for baris in p.read_text(encoding="utf-8").splitlines():
        baris = baris.strip()
        if not baris:
            continue
        try:
            data = json.loads(baris)
        except json.JSONDecodeError:
            continue
        data.setdefault("kanal", "threads")
        hasil.append(data)
    return hasil


def muat_api(root, tenant, cfg):
    import os

    sumber = env.load_env(Path(root) / "tenant" / tenant / ".env")
    nama = (cfg.get("kanal") or {}).get("threads_env", "JAGOAI_THREADS_TOKEN")
    if not (sumber.get(nama) or os.environ.get(nama)):
        raise SumberBelumAda(
            "%s belum diisi, jadi percakapan tidak bisa diambil dari API. "
            "Isi berkas masuk/percakapan.jsonl atau isi tokennya." % nama)
    raise SumberBelumAda("pengambil API belum dibangun, hanya berkas yang jalan")


def akun_sudah_dibalas(root, tenant, sekarang, hari=HARI_ULANG):
    batas = sekarang.date() - timedelta(days=hari)
    akun = set()
    for p in sorted((Path(root) / "tenant" / tenant / "keluaran" / "percakapan").glob("*.json")):
        try:
            tanggal = datetime.strptime(p.stem, "%Y-%m-%d").date()
        except ValueError:
            continue
        if tanggal < batas:
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for d in data.get("draf", []):
            if d.get("akun"):
                akun.add(d["akun"])
    return akun


def saring(daftar, kata_bidang, sudah_dibalas, kanal_aktif=("threads",), panjang_min=PANJANG_MIN):
    calon, ditarik = [], []
    for p in daftar:
        teks = (p.get("teks") or "").strip()
        alasan = None
        if p.get("kanal") not in kanal_aktif:
            alasan = "kanal tidak aktif"
        elif len(teks) < panjang_min:
            alasan = "terlalu pendek untuk dinilai"
        elif kata_bidang and not any(k.lower() in teks.lower() for k in kata_bidang):
            alasan = "di luar bidang"
        elif not str(p.get("tautan") or "").startswith("http"):
            alasan = "tanpa tautan asal"
        elif p.get("akun") in sudah_dibalas:
            alasan = "akun sudah dibalas dalam %d hari" % HARI_ULANG
        if alasan:
            ditarik.append({"id": p.get("id"), "akun": p.get("akun"), "alasan": alasan})
        else:
            calon.append(p)
    return calon, ditarik


def kemiripan(a, b):
    return difflib.SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def terlalu_mirip(teks, daftar_teks, batas=MIRIP_MAKS):
    for t in daftar_teks:
        if kemiripan(teks, t) > batas:
            return t
    return None


def _panggil(root, tenant, cfg, tugas, kunci, sekarang, agent="sinta"):
    k = cfg["karyawan"][agent]
    b = brief.muat(Path(root) / "tenant" / tenant / "brief-karyawan" / (agent + ".md"))
    if kunci is None:
        kunci = env.get(env.load_env(Path(root) / "tenant" / tenant / ".env"),
                        cfg["gerbang"]["kunci_env"])
    return runtime.jalankan(
        base_url=cfg["gerbang"]["base_url"], kunci=kunci, model=k["model"],
        agent_id="%s:%s" % (tenant, agent), tugas=tugas, brief=b["teks"],
        log_path=Path(root) / "tenant" / tenant / "events.jsonl",
        batas_tenant=int(cfg["gerbang"].get("batas_harian_tenant") or 0) or None,
        batas_shift=int(k.get("batas_shift", 20000)),
        max_tokens=int(k.get("maks_token", 400)),
        nama=agent.capitalize(), jabatan=k.get("jabatan", "karyawan"), tahun=sekarang.year,
    )


def kerjakan(root, tenant, tanggal=None, kanal=("threads",), sekarang=None, kunci=None,
             eksekusi=None, batas_harian=BATAS_BALASAN_HARI):
    sekarang = sekarang or datetime.now().astimezone()
    tanggal = tanggal or sekarang.date().isoformat()
    root = Path(root)
    cfg = config.load(tenant, root=str(root))
    kata_bidang = (cfg.get("merek") or {}).get("kata_kunci") or []

    masuk = muat_masuk(root, tenant)
    sudah = akun_sudah_dibalas(root, tenant, sekarang)
    calon, ditarik = saring(masuk, kata_bidang, sudah, kanal_aktif=tuple(kanal))

    if eksekusi is None:
        def eksekusi(t):
            return _panggil(root, tenant, cfg, t, kunci, sekarang)

    brief_sinta = brief.muat(root / "tenant" / tenant / "brief-karyawan" / "sinta.md")["teks"]
    draf, ditolak = [], []
    teks_terpakai = []
    dibuat = 0

    for c in calon:
        if dibuat >= batas_harian:
            ditolak.append({"id": c.get("id"), "alasan": "batas %d balasan sehari" % batas_harian})
            continue
        tugas = (TUGAS_SINTA.replace("{kanal}", str(c.get("kanal")))
                 .replace("{teks}", str(c.get("teks"))[:1200]))
        hasil = eksekusi(tugas)
        teks = (hasil.get("teks") or "").strip().strip('"')
        pelanggaran = penjaga.periksa(teks, brief_sinta, sekarang.year)
        keras = [p for p in pelanggaran if p["jenis"] != "topik"]
        if keras:
            ditolak.append({"id": c.get("id"), "alasan": "penjaga: " + ", ".join(
                sorted({p["jenis"] for p in keras}))})
            continue
        mirip = terlalu_mirip(teks, teks_terpakai)
        if mirip is not None:
            ditolak.append({"id": c.get("id"), "alasan": "kemiripan di atas 85%"})
            continue
        teks_terpakai.append(teks)
        jadwal = sekarang + timedelta(minutes=JEDA_MENIT * len(draf))
        draf.append({
            "id": c.get("id"),
            "akun": c.get("akun"),
            "kanal": c.get("kanal"),
            "tautan": c.get("tautan"),
            "teks_asli": c.get("teks"),
            "draf": teks,
            "status": "menunggu_persetujuan",
            "disetujui_oleh": "",
            "rencana_kirim": jadwal.isoformat(timespec="seconds"),
            "shift_id": hasil.get("shift_id"),
        })
        dibuat += 1

    hasil = {
        "tanggal": tanggal,
        "dibuat": sekarang.isoformat(timespec="seconds"),
        "sumber": "berkas" if jalur_masuk(root, tenant).exists() else "kosong",
        "calon": len(calon),
        "draf": draf,
        "ditolak": ditolak,
        "ditarik": ditarik,
    }
    folder = root / "tenant" / tenant / "keluaran" / "percakapan"
    folder.mkdir(parents=True, exist_ok=True)
    berkas = folder / (tanggal + ".json")
    berkas.write_text(json.dumps(hasil, ensure_ascii=False, indent=1), encoding="utf-8")
    hasil["berkas"] = str(berkas)
    return hasil


def setujui(root, tenant, id_kirim, oleh, sekarang=None):
    sekarang = sekarang or datetime.now().astimezone()
    folder = Path(root) / "tenant" / tenant / "keluaran" / "percakapan"
    for p in sorted(folder.glob("*.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        for d in data.get("draf", []):
            if d.get("id") == id_kirim and d.get("status") == "menunggu_persetujuan":
                d["status"] = "disetujui"
                d["disetujui_oleh"] = oleh
                d["disetujui_pada"] = sekarang.isoformat(timespec="seconds")
                p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
                return d
    raise DrafGagal("draf %s tidak ditemukan atau sudah diputuskan" % id_kirim)
