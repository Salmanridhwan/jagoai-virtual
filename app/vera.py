"""Vera: laporan pekan dari berkas nyata.

Aturan pertama modul ini: tidak ada angka yang tidak berasal dari berkas. Kalau
datanya tidak ada, laporan menulis belum ada, bukan mengisi dengan perkiraan.
Setiap laporan menyertakan daftar sumber yang dibaca supaya bisa diperiksa ulang.
"""
import csv
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from app import budget, events

P = chr(10)


def rentang(pekan):
    mulai = date.fromisoformat(pekan)
    return [(mulai + timedelta(days=i)).isoformat() for i in range(7)]


def _baca_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def kumpulkan(root, tenant, pekan):
    root = Path(root)
    hari = rentang(pekan)
    log = root / "tenant" / tenant / "events.jsonl"
    semua = events.read_all(log)
    kunci = root / "tenant" / tenant / "keluaran"

    token_hari = {}
    token_agent = defaultdict(int)
    jenis = Counter()
    ditunda = Counter()
    for h in hari:
        token_hari[h] = budget.terpakai_tenant(semua, h)
    for e in semua:
        ts = str(e.get("ts") or "")
        if ts[:10] not in hari:
            continue
        jenis[e.get("kind")] += 1
        if e.get("kind") == "llm_call":
            token_agent[e["agent_id"].split(":")[-1]] += int(e.get("tokens_in") or 0) + int(e.get("tokens_out") or 0)
        if e.get("kind") == "shift_tertunda":
            ditunda[e.get("alasan") or "tanpa alasan"] += 1

    isi = {"jadwal": 0, "naskah": 0, "desain_lulus": 0, "desain_tidak_lulus": 0,
           "video": 0, "tinjauan": {"lulus": 0, "tolak": 0, "manual": 0},
           "persetujuan": 0, "antrean_masuk": 0, "antrean_ditolak": 0,
           "percakapan": {"calon": 0, "draf": 0, "disetujui": 0, "ditolak": 0}}
    rincian = []
    sumber = []

    for h in hari:
        jadwal_p = kunci / "jadwal" / (h + ".json")
        if jadwal_p.exists():
            data = _baca_json(jadwal_p) or {}
            n = len(data.get("slot", []))
            isi["jadwal"] += n
            sumber.append(("jadwal %s" % h, n))
        for naskah_p in sorted((kunci / "naskah" / h).glob("*.md")):
            isi["naskah"] += 1
        laporan_p = kunci / "desain" / h / "laporan.json"
        if laporan_p.exists():
            lap = _baca_json(laporan_p) or {}
            if lap.get("lulus"):
                isi["desain_lulus"] += 1
            else:
                isi["desain_tidak_lulus"] += 1
            sumber.append(("desain %s" % h, len(lap.get("slide", []))))
        isi["video"] += len(list((kunci / "video" / h).glob("*.mp4")))
        tinjau_p = kunci / "tinjauan" / (h + ".json")
        if tinjau_p.exists():
            tinjau = _baca_json(tinjau_p) or {}
            status = tinjau.get("status", "manual")
            if status in isi["tinjauan"]:
                isi["tinjauan"][status] += 1
            rincian.append((h, status, len(tinjau.get("temuan_isi", [])),
                            len(tinjau.get("angka_tanpa_dasar", []))))
        setuju_p = kunci / "persetujuan" / (h + ".json")
        if setuju_p.exists():
            setuju = _baca_json(setuju_p) or {}
            isi["persetujuan"] += len(setuju.get("konten", []))
        antre_p = kunci / "antrean" / (h + ".json")
        if antre_p.exists():
            antre = _baca_json(antre_p) or {}
            isi["antrean_masuk"] += len(antre.get("masuk", []))
            isi["antrean_ditolak"] += len(antre.get("ditolak", []))
        percak_p = kunci / "percakapan" / (h + ".json")
        if percak_p.exists():
            percak = _baca_json(percak_p) or {}
            isi["percakapan"]["calon"] += int(percak.get("calon") or 0)
            isi["percakapan"]["draf"] += len(percak.get("draf", []))
            isi["percakapan"]["disetujui"] += len([d for d in percak.get("draf", [])
                                                  if d.get("status") == "disetujui"])
            isi["percakapan"]["ditolak"] += len(percak.get("ditolak", []))

    jangkauan = _jangkauan(root, tenant, hari)

    return {
        "pekan": pekan,
        "hari": hari,
        "token_hari": token_hari,
        "token_total": sum(token_hari.values()),
        "token_agent": dict(token_agent),
        "jenis_event": dict(jenis),
        "ditunda": dict(ditunda),
        "isi": isi,
        "rincian_tinjauan": rincian,
        "jangkauan": jangkauan,
        "sumber": sumber,
    }


def _jangkauan(root, tenant, hari):
    p = Path(root) / "tenant" / tenant / "data" / "jangkauan.csv"
    if not p.exists():
        return {"ada": False, "baris": 0, "tayangan": 0, "interaksi": 0, "kanal": {}}
    tayangan = interaksi = baris = 0
    kanal = defaultdict(int)
    try:
        with open(p, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                if (r.get("tanggal") or "")[:10] not in hari:
                    continue
                baris += 1
                try:
                    tayangan += int(float(r.get("tayangan") or 0))
                    interaksi += int(float(r.get("interaksi") or 0))
                except ValueError:
                    continue
                kanal[r.get("kanal") or "tanpa kanal"] += int(float(r.get("interaksi") or 0))
    except OSError:
        return {"ada": False, "baris": 0, "tayangan": 0, "interaksi": 0, "kanal": {}}
    return {"ada": True, "baris": baris, "tayangan": tayangan, "interaksi": interaksi,
            "kanal": dict(kanal)}


def tulis(root, tenant, pekan, sekarang=None):
    sekarang = sekarang or datetime.now().astimezone()
    d = kumpulkan(root, tenant, pekan)

    baris = []
    baris.append("# Laporan pekan %s" % pekan)
    baris.append("")
    baris.append("Dibuat %s oleh Vera dari berkas di `tenant/%s/`." % (
        sekarang.isoformat(timespec="seconds"), tenant))
    baris.append("")
    baris.append("## Ringkasan")
    baris.append("")
    baris.append("| Ukuran | Angka |")
    baris.append("|---|---|")
    baris.append("| Token terpakai pekan ini | %d |" % d["token_total"])
    baris.append("| Slot jadwal | %d |" % d["isi"]["jadwal"])
    baris.append("| Naskah ditulis | %d |" % d["isi"]["naskah"])
    baris.append("| Desain lulus periksa | %d |" % d["isi"]["desain_lulus"])
    baris.append("| Desain tidak lulus | %d |" % d["isi"]["desain_tidak_lulus"])
    baris.append("| Video dibuat | %d |" % d["isi"]["video"])
    baris.append("| Tinjauan lulus, tolak, manual | %d, %d, %d |" % (
        d["isi"]["tinjauan"]["lulus"], d["isi"]["tinjauan"]["tolak"], d["isi"]["tinjauan"]["manual"]))
    baris.append("| Persetujuan manusia | %d |" % d["isi"]["persetujuan"])
    baris.append("| Antrean masuk dan ditolak | %d, %d |" % (
        d["isi"]["antrean_masuk"], d["isi"]["antrean_ditolak"]))
    baris.append("")
    baris.append("## Percakapan")
    baris.append("")
    p = d["isi"]["percakapan"]
    baris.append("| Calon | Draf | Disetujui | Ditolak |")
    baris.append("|---|---|---|---|")
    baris.append("| %d | %d | %d | %d |" % (p["calon"], p["draf"], p["disetujui"], p["ditolak"]))
    baris.append("")
    baris.append("## Token per hari")
    baris.append("")
    baris.append("| Hari | Token |")
    baris.append("|---|---|")
    for h in d["hari"]:
        baris.append("| %s | %d |" % (h, d["token_hari"][h]))
    baris.append("")
    baris.append("## Token per karyawan")
    baris.append("")
    if d["token_agent"]:
        baris.append("| Karyawan | Token |")
        baris.append("|---|---|")
        for nama, jumlah in sorted(d["token_agent"].items(), key=lambda x: -x[1]):
            baris.append("| %s | %d |" % (nama, jumlah))
    else:
        baris.append("Belum ada shift pada pekan ini.")
    baris.append("")
    baris.append("## Penjaga dan penundaan")
    baris.append("")
    baris.append("| Jenis event | Jumlah |")
    baris.append("|---|---|")
    for k, v in sorted(d["jenis_event"].items()):
        baris.append("| %s | %d |" % (k, v))
    baris.append("")
    if d["ditunda"]:
        baris.append("Shift ditunda: %s." % ", ".join(
            "%s %d kali" % (k, v) for k, v in d["ditunda"].items()))
        baris.append("")
    baris.append("## Jangkauan")
    baris.append("")
    j = d["jangkauan"]
    if not j["ada"]:
        baris.append("Belum ada data jangkauan. Berkas `tenant/%s/data/jangkauan.csv` tidak ditemukan, "
                     "jadi tidak ada angka yang dilaporkan di bagian ini." % tenant)
    else:
        baris.append("| Ukuran | Angka |")
        baris.append("|---|---|")
        baris.append("| Baris data | %d |" % j["baris"])
        baris.append("| Tayangan | %d |" % j["tayangan"])
        baris.append("| Interaksi | %d |" % j["interaksi"])
        baris.append("")
        if j["kanal"]:
            baris.append("| Kanal | Interaksi |")
            baris.append("|---|---|")
            for k, v in sorted(j["kanal"].items(), key=lambda x: -x[1]):
                baris.append("| %s | %d |" % (k, v))
    baris.append("")
    baris.append("## Rincian tinjauan")
    baris.append("")
    if d["rincian_tinjauan"]:
        baris.append("| Tanggal | Status | Temuan isi | Angka tanpa dasar |")
        baris.append("|---|---|---|---|")
        for h, status, temuan, angka in d["rincian_tinjauan"]:
            baris.append("| %s | %s | %d | %d |" % (h, status, temuan, angka))
    else:
        baris.append("Belum ada tinjauan pada pekan ini.")
    baris.append("")
    baris.append("## Sumber yang dibaca")
    baris.append("")
    baris.append("| Berkas | Jumlah |")
    baris.append("|---|---|")
    for nama, jumlah in d["sumber"]:
        baris.append("| %s | %d |" % (nama, jumlah))
    if not d["sumber"]:
        baris.append("| tidak ada berkas pekan ini | 0 |")
    baris.append("")

    folder = Path(root) / "tenant" / tenant / "keluaran" / "laporan"
    folder.mkdir(parents=True, exist_ok=True)
    berkas = folder / (pekan + ".md")
    berkas.write_text(P.join(baris) + P, encoding="utf-8")
    d["berkas"] = str(berkas)
    return d
