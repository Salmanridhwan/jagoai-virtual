"""Pekerjaan yang menghasilkan berkas: jadwal pekan oleh Rian, naskah oleh Nadia.

Aturannya satu: hasil model tidak dianggap karya sampai berkasnya ada di folder
keluaran. Kalau bentuk balasan tidak sah, pekerjaan diulang sekali dengan pesan
koreksi, lalu berhenti dengan kesalahan yang jelas, bukan dengan berkas setengah
jadi.
"""
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from app import brief, config, env, papan, runtime

P = chr(10)


class TugasGagal(RuntimeError):
    def __init__(self, pesan, kesalahan=None):
        super().__init__(pesan)
        self.kesalahan = kesalahan or []


TUGAS_RIAN = P.join([
    "Susun jadwal konten untuk pekan {pekan}, yaitu {mulai} sampai {selesai}.",
    "Bidang produk: {bidang}.",
    "Setiap topik harus berada di bidang itu, jangan memilih topik dari bidang lain.",
    "Buat empat slot. Sebarkan di tanggal berbeda, satu slot per hari.",
    "Balas HANYA larik JSON, tanpa penjelasan, tanpa pagar kode, tanpa kalimat pembuka.",
    "Bentuk tiap slot: {{\"tanggal\":\"YYYY-MM-DD\",\"kanal\":\"instagram\",\"format\":\"carousel\",\"topik\":\"...\",\"alasan\":\"...\"}}",
    "Isi kanal hanya salah satu dari: instagram, threads, tiktok.",
    "Isi format hanya salah satu dari: carousel, post, infografis, video, cerita.",
    "Topik harus konkret dan bisa dikerjakan, bukan tema umum.",
    "Jangan mengarang tanggal di luar rentang {mulai} sampai {selesai}.",
])

TUGAS_NADIA = P.join([
    "Tulis naskah lengkap untuk satu slot berikut.",
    "Tanggal: {tanggal}",
    "Kanal: {kanal}",
    "Format: {format}",
    "Topik: {topik}",
    "",
    "Balas dalam Markdown dengan empat bagian ini, urut dan tanpa bagian lain:",
    "## Hook",
    "Tulis tiga varian pembuka, masing-masing satu baris, diberi nomor.",
    "## Naskah",
    "Isi naskah per slide atau per adegan, sesuai format.",
    "## Caption",
    "Caption siap tempel beserta tiga tagar.",
    "## Catatan",
    "Satu paragraf tentang bahan yang dibutuhkan dan hal yang perlu diperiksa.",
    "Jangan memakai angka, tahun, atau klaim yang tidak ada di brief.",
])


def _teks_bersih(teks):
    t = (teks or "").strip()
    t = re.sub(r"^```[a-zA-Z]*", "", t).strip()
    return t.replace("```", "").strip()


def larik_json(teks):
    """Ambil larik JSON pertama dari balasan model, atau None."""
    t = _teks_bersih(teks)
    i = t.find("[")
    j = t.rfind("]")
    if i < 0 or j <= i:
        return None
    potongan = t[i:j + 1]
    try:
        return json.loads(potongan)
    except json.JSONDecodeError:
        potongan = potongan.replace("'", '"')
        try:
            return json.loads(potongan)
        except json.JSONDecodeError:
            return None


def topik_luar_bidang(data, kata_kunci):
    """Topik yang tidak menyentuh satu kata kunci bidang pun."""
    luar = []
    for s in data or []:
        topik = (s.get("topik") or "").lower()
        if not any(k.lower() in topik for k in kata_kunci):
            luar.append(s.get("topik"))
    return luar


def _batas_pekan(pekan):
    mulai = date.fromisoformat(pekan)
    return mulai, mulai + timedelta(days=6)


def _panggil(root, tenant, cfg, slug, tugas, kunci, sekarang):
    k = cfg["karyawan"][slug]
    b = brief.muat(Path(root) / "tenant" / tenant / "brief-karyawan" / (slug + ".md"))
    if kunci is None:
        kunci = env.get(env.load_env(Path(root) / "tenant" / tenant / ".env"),
                        cfg["gerbang"]["kunci_env"])
    return runtime.jalankan(
        base_url=cfg["gerbang"]["base_url"],
        kunci=kunci,
        model=k["model"],
        agent_id="%s:%s" % (tenant, slug),
        tugas=tugas,
        brief=b["teks"],
        log_path=Path(root) / "tenant" / tenant / "events.jsonl",
        batas_tenant=int(cfg["gerbang"].get("batas_harian_tenant") or 0) or None,
        batas_shift=int(k.get("batas_shift", 20000)),
        max_tokens=int(k.get("maks_token", 400)),
        nama=slug.capitalize(),
        jabatan=k.get("jabatan", "karyawan"),
        tahun=sekarang.year,
    )


def rian(root, tenant, pekan, sekarang=None, kunci=None, eksekusi=None):
    sekarang = sekarang or datetime.now().astimezone()
    cfg = config.load(tenant, root=str(root))
    mulai, selesai = _batas_pekan(pekan)
    merek = cfg.get("merek") or {}
    bidang = merek.get("bidang") or "konten media sosial"
    kunci_bidang = merek.get("kata_kunci") or []
    tugas = TUGAS_RIAN.format(pekan=pekan, mulai=mulai.isoformat(),
                              selesai=selesai.isoformat(), bidang=bidang)
    if eksekusi is None:
        def eksekusi(t):
            return _panggil(root, tenant, cfg, "rian", t, kunci, sekarang)

    kesalahan = []
    for percobaan in range(2):
        hasil = eksekusi(tugas if percobaan == 0 else tugas + P + "Perbaiki kesalahan ini: " + "; ".join(kesalahan))
        data = larik_json(hasil.get("teks"))
        if data is None:
            kesalahan = ["balasan bukan larik JSON yang sah"]
            continue
        kesalahan = papan.validasi_jadwal(data)
        if not kesalahan and kunci_bidang:
            luar = topik_luar_bidang(data, kunci_bidang)
            if len(luar) > len(data) // 2:
                kesalahan = ["topik keluar dari bidang: " + "; ".join(str(x) for x in luar)]
        if kesalahan:
            continue
        berkas = papan.simpan_jadwal(root, tenant, pekan, data)
        return {"berkas": str(berkas), "slot": data, "shift_id": hasil.get("shift_id"),
                "tokens": hasil.get("tokens_in", 0) + hasil.get("tokens_out", 0)}
    raise TugasGagal("jadwal ditolak", kesalahan)


def nadia(root, tenant, pekan, tanggal, topik, kanal="instagram", format_="carousel",
          sekarang=None, kunci=None, eksekusi=None):
    sekarang = sekarang or datetime.now().astimezone()
    cfg = config.load(tenant, root=str(root))
    tugas = TUGAS_NADIA.format(tanggal=tanggal, kanal=kanal, format=format_, topik=topik)
    if eksekusi is None:
        def eksekusi(t):
            return _panggil(root, tenant, cfg, "nadia", t, kunci, sekarang)

    kurang = []
    for percobaan in range(2):
        hasil = eksekusi(tugas if percobaan == 0 else tugas + P + "Bagian yang kurang: " + ", ".join(kurang))
        isi = _teks_bersih(hasil.get("teks"))
        kurang = papan.bagian_hilang(isi)
        if kurang:
            continue
        berkas = papan.tulis_naskah(root, tenant, pekan, tanggal, topik, isi,
                                    kanal=kanal, format_=format_)
        return {"berkas": str(berkas), "isi": isi, "shift_id": hasil.get("shift_id"),
                "tokens": hasil.get("tokens_in", 0) + hasil.get("tokens_out", 0)}
    raise TugasGagal("naskah ditolak", ["bagian hilang: " + ", ".join(kurang)])
