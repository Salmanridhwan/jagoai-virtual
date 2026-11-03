"""Omar, gerbang mutu dua lapis.

Lapis satu memeriksa yang bisa dipastikan: berkas ada, video lolos periksa
teknis, laporan desain lulus, subjudul ada. Lapis dua meminta penilaian isi
kepada model, dan hanya menerima jawaban berbentuk JSON yang sah.

Kalau lapis dua tidak bisa dinilai, hasilnya `manual`, bukan `lulus`. Gerbang
yang membuka sendiri saat tidak bisa memeriksa bukan gerbang.
"""
import json
import re
from datetime import datetime
from pathlib import Path

from app import brief, config, desain, env, events, papan, runtime, video

P = chr(10)

TUGAS_OMAR = P.join([
    "Kau peninjau mutu. Nilai satu berkas keluaran sebelum boleh masuk antrean unggah.",
    "",
    "Brief dan larangan yang berlaku:",
    "{BRIEF}",
    "",
    "Naskah yang dinilai:",
    "{NASKAH}",
    "",
    "Teks slide:",
    "{SLIDE}",
    "",
    "Nilai tiga hal: klaim yang tidak ada dasarnya, larangan brief yang dilanggar,",
    "dan kelayakan tayang untuk kanal tersebut.",
    "Balas HANYA objek JSON, tanpa pagar kode dan tanpa kalimat lain, dengan bentuk:",
    "{\"lulus\": true, \"temuan\": [{\"tingkat\": \"tolak\", \"bagian\": \"caption\", \"alasan\": \"...\", \"kutipan\": \"...\"}]}",
    "Isi tingkat hanya tolak atau catat. Kalau tidak ada temuan, temuan berisi larik kosong.",
])

TERLARANG_ANGKA = re.compile(r"(\d{1,4})\s?(%|persen|ribu|juta|kali|site|halaman|menit|detik)", re.IGNORECASE)
KATA_ANGKA = re.compile(
    r"\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)\s+"
    r"(site|halaman|menit|detik|kali|persen|ribu|juta)\b", re.IGNORECASE)


class TinjauGagal(RuntimeError):
    pass


def _panggil(root, tenant, cfg, tugas, kunci, sekarang):
    k = cfg["karyawan"]["omar"]
    b = brief.muat(Path(root) / "tenant" / tenant / "brief-karyawan" / "omar.md")
    if kunci is None:
        kunci = env.get(env.load_env(Path(root) / "tenant" / tenant / ".env"),
                        cfg["gerbang"]["kunci_env"])
    return runtime.jalankan(
        base_url=cfg["gerbang"]["base_url"], kunci=kunci, model=k["model"],
        agent_id="%s:omar" % tenant, tugas=tugas, brief=b["teks"],
        log_path=Path(root) / "tenant" / tenant / "events.jsonl",
        batas_tenant=int(cfg["gerbang"].get("batas_harian_tenant") or 0) or None,
        batas_shift=int(k.get("batas_shift", 20000)),
        max_tokens=int(k.get("maks_token", 400)),
        nama="Omar", jabatan=k.get("jabatan", "Peninjau Mutu"), tahun=sekarang.year,
    )


def objek_json(teks):
    t = (teks or "").strip()
    t = re.sub(r"^```[a-zA-Z]*", "", t).strip().replace("```", "")
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        return json.loads(t[i:j + 1])
    except json.JSONDecodeError:
        return None


def sahkan_putusan(data):
    """Kembalikan daftar kesalahan bentuk putusan Omar."""
    salah = []
    if not isinstance(data, dict):
        return ["putusan bukan objek"]
    if not isinstance(data.get("lulus"), bool):
        salah.append("bidang lulus harus benar atau salah")
    temuan = data.get("temuan")
    if not isinstance(temuan, list):
        salah.append("temuan harus larik")
        return salah
    for i, t in enumerate(temuan, 1):
        if not isinstance(t, dict):
            salah.append("temuan %d bukan objek" % i)
            continue
        if t.get("tingkat") not in ("tolak", "catat"):
            salah.append("temuan %d tingkatnya bukan tolak atau catat" % i)
        if not str(t.get("alasan") or "").strip():
            salah.append("temuan %d tanpa alasan" % i)
    return salah


def klaim_angka(teks, brief_teks=""):
    """Angka berunit yang tidak ada di brief, calon klaim tanpa dasar."""
    hasil = []
    for m in TERLARANG_ANGKA.finditer(teks or ""):
        angka = m.group(1)
        if angka not in (brief_teks or ""):
            hasil.append(m.group(0).strip())
    for m in KATA_ANGKA.finditer(teks or ""):
        if m.group(0).lower() not in (brief_teks or "").lower():
            hasil.append(m.group(0).strip())
    return hasil


def periksa_teknis(info_video, laporan_desain, subjudul_ada=True, ukuran=(1080, 1920)):
    salah = []
    if info_video:
        salah.extend(video.periksa(info_video, ukuran))
    else:
        salah.append("video belum ada")
    if laporan_desain is None:
        salah.append("laporan desain belum ada")
    elif not laporan_desain.get("lulus"):
        salah.append("laporan desain tidak lulus")
    if not subjudul_ada:
        salah.append("subjudul belum ada")
    return salah


def _muat_laporan_desain(folder):
    p = Path(folder) / "laporan.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _pilih_video(folder, ukuran=(1080, 1920)):
    semua = sorted(Path(folder).glob("*.mp4"))
    if not semua:
        return None
    tanda = "9x16" if ukuran[1] > ukuran[0] else "1x1"
    cocok = [p for p in semua if tanda in p.name]
    return (cocok or semua)[0]


def tinjau(root, tenant, tanggal, pekan=None, ukuran=(1080, 1920), sekarang=None,
           kunci=None, eksekusi=None):
    sekarang = sekarang or datetime.now().astimezone()
    root = Path(root)
    cfg = config.load(tenant, root=str(root))

    naskah_p = sorted((root / "tenant" / tenant / "keluaran" / "naskah" / (pekan or tanggal))
                      .glob(tanggal + "-*.md"))
    if not naskah_p:
        raise TinjauGagal("naskah %s tidak ada" % tanggal)
    naskah = papan.baca_naskah(naskah_p[0])
    slide = desain.baca_slide(naskah["isi"])

    video_p = _pilih_video(root / "tenant" / tenant / "keluaran" / "video" / tanggal, ukuran)
    info_video = video.ukur(video_p) if video_p else None
    folder_desain = root / "tenant" / tenant / "keluaran" / "desain" / tanggal
    laporan_desain = _muat_laporan_desain(folder_desain)
    subjudul = (root / "tenant" / tenant / "keluaran" / "video" / tanggal / "subjudul.srt").exists()

    lapis1 = periksa_teknis(info_video, laporan_desain, subjudul, ukuran)

    isi_naskah = naskah["isi"]
    teks_slide = P.join("- " + s["teks"] for s in slide)
    brief_omar = brief.muat(root / "tenant" / tenant / "brief-karyawan" / "omar.md")["teks"]
    tugas = (TUGAS_OMAR.replace("{BRIEF}", brief_omar)
             .replace("{NASKAH}", isi_naskah[:6000])
             .replace("{SLIDE}", teks_slide[:3000]))

    if eksekusi is None:
        def eksekusi(t):
            return _panggil(root, tenant, cfg, t, kunci, sekarang)

    putusan, salah_bentuk = None, []
    for percobaan in range(2):
        hasil = eksekusi(tugas if percobaan == 0 else tugas + P + "Balasan sebelumnya tidak sah: " + "; ".join(salah_bentuk))
        data = objek_json(hasil.get("teks"))
        salah_bentuk = ["putusan bukan objek JSON"] if data is None else sahkan_putusan(data)
        if not salah_bentuk:
            putusan = data
            break

    angka_mencurigakan = klaim_angka(isi_naskah, brief_omar)
    if putusan is None:
        status = "manual"
        catatan = "putusan Omar tidak bisa dibaca: " + "; ".join(salah_bentuk)
    else:
        tolak = [t for t in putusan.get("temuan", []) if t.get("tingkat") == "tolak"]
        status = "tolak" if (lapis1 or tolak or not putusan.get("lulus")) else "lulus"
        catatan = ""

    hasil = {
        "tanggal": tanggal,
        "ditinjau": sekarang.isoformat(timespec="seconds"),
        "status": status,
        "lapis_teknis": lapis1,
        "putusan_isi": putusan,
        "temuan_isi": (putusan or {}).get("temuan", []),
        "angka_tanpa_dasar": angka_mencurigakan,
        "catatan": catatan,
        "berkas": {"naskah": str(naskah_p[0]),
                   "video": str(video_p) if video_p else "",
                   "subjudul": subjudul},
    }

    folder = root / "tenant" / tenant / "keluaran" / "tinjauan"
    folder.mkdir(parents=True, exist_ok=True)
    berkas = folder / ("%s.json" % tanggal)
    berkas.write_text(json.dumps(hasil, ensure_ascii=False, indent=1), encoding="utf-8")

    log = root / "tenant" / tenant / "events.jsonl"
    events.append(log, {
        "kind": "review_pass" if status == "lulus" else "review_fail",
        "agent_id": "%s:omar" % tenant,
        "tanggal": tanggal,
        "status": status,
        "pelanggaran_teknis": len(lapis1),
        "temuan_tolak": len([t for t in (putusan or {}).get("temuan", []) if t.get("tingkat") == "tolak"]),
        "angka_tanpa_dasar": len(angka_mencurigakan),
        "summary": status,
    })
    hasil["berkas_tinjauan"] = str(berkas)
    return hasil
