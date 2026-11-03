"""Penjaga keluaran: memeriksa balasan model sebelum dicatat sebagai hasil.

Yang dijaga hanya tiga hal, dan semuanya bisa diperiksa tanpa model lain:
- identitas: model menyebut dirinya asisten, AI, atau nama produk
- tahun: menyebut tahun yang tidak ada di brief dan bukan tahun berjalan
- angka karangan: persentase atau jumlah orang yang tidak ada di brief

Penjaga ini tidak menilai mutu tulisan dan tidak menggantikan Omar.
"""
import re

POLA_IDENTITAS = [
    (re.compile(r"(?i)\bcodebuddy\b"), "menyebut nama produk"),
    (re.compile(r"(?i)\b(chatgpt|openai|anthropic|claude|gemini|copilot)\b"), "menyebut merek model"),
    (re.compile(r"(?i)\basisten\s+(ai|coding|kode|virtual)\b"), "menyebut diri asisten"),
    (re.compile(r"(?i)\b(language model|large language model|model bahasa)\b"), "menyebut diri model"),
    (re.compile(r"(?i)\bsaya\s+(adalah|sebagai)\s+(model|ai|asisten)\b"), "menyebut diri model"),
]

POLA_ANGKA = [
    (re.compile(r"(\d{1,3})\s?%"), "persentase"),
    (re.compile(r"(?i)(\d+)\s?(ribu|juta)\s*(pengguna|orang|user|klien)"), "jumlah orang"),
]

POLA_TAHUN = re.compile(r"\b(20\d\d)\b")

STOPWORD = set("""
yang dan atau untuk dengan tanpa dari pada saat kalau jika karena supaya
serta juga sudah belum masih saja lebih paling sangat akan bisa dapat
harus wajib perlu boleh tidak jangan agar bahwa adalah ialah ini itu
saya kamu kita mereka dia kami anda tiap setiap para semua banyak
buat bikin tulis tuliskan sebutkan jelaskan berikan ambil pakai
satu dua tiga empat lima kata kalimat secara dalam antara sesuai
pekan hari jam bulan tahun kerja tugas hal cara salah benar
kau aku nya pun kah lah dong sih ya tidak tanpa oleh atas bawah
""".split())

POLA_KUTIPAN_BRIEF = re.compile(r"`([^`]+)`")


def _bagian_brief(brief, judul):
    baris = []
    aktif = False
    for isi in (brief or "").splitlines():
        if isi.startswith("## "):
            aktif = isi[3:].strip().lower().startswith(judul.lower())
            continue
        if aktif:
            baris.append(isi)
    return " ".join(baris)


def kata_kunci(teks):
    hasil = set()
    for kata in re.findall(r"[a-zA-Z]+", (teks or "").lower()):
        if len(kata) >= 4 and kata not in STOPWORD:
            hasil.add(kata)
    return hasil


def periksa_tugas(teks, tugas):
    """Balasan harus menyentuh setidaknya satu kata kunci dari tugas."""
    kunci_tugas = kata_kunci(tugas)
    if not kunci_tugas:
        return []
    if kata_kunci(teks) & kunci_tugas:
        return []
    return [{"jenis": "topik", "alasan": "tidak menyentuh kata kunci tugas",
             "cuplikan": ", ".join(sorted(kunci_tugas)[:4])}]


def periksa_larangan(teks, brief):
    """Kata yang dikurung backtick di bagian Larangan khusus tidak boleh muncul."""
    larangan = _bagian_brief(brief, "Larangan khusus")
    pelanggaran = []
    for kata in POLA_KUTIPAN_BRIEF.findall(larangan):
        kata = kata.strip()
        if not kata:
            continue
        pola = re.compile("(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(kata), re.IGNORECASE)
        if pola.search(teks or ""):
            pelanggaran.append({"jenis": "larangan_brief", "alasan": "kata terlarang dipakai",
                                "cuplikan": kata})
    return pelanggaran

def periksa(teks, brief, tahun=None, tugas=None):
    """Kembalikan daftar pelanggaran, kosong berarti bersih."""
    teks = teks or ""
    brief = brief or ""
    pelanggaran = []

    for pola, alasan in POLA_IDENTITAS:
        m = pola.search(teks)
        if m:
            pelanggaran.append({"jenis": "identitas", "alasan": alasan, "cuplikan": m.group(0)})

    for m in POLA_TAHUN.finditer(teks):
        nilai = m.group(1)
        if nilai not in brief and (tahun is None or nilai != str(tahun)):
            pelanggaran.append({"jenis": "tahun", "alasan": "tahun tidak ada di brief", "cuplikan": nilai})

    for pola, alasan in POLA_ANGKA:
        for m in pola.finditer(teks):
            angka = m.group(1)
            if angka not in brief:
                pelanggaran.append({"jenis": "angka", "alasan": alasan, "cuplikan": m.group(0).strip()})

    pelanggaran.extend(periksa_larangan(teks, brief))
    if tugas:
        pelanggaran.extend(periksa_tugas(teks, tugas))

    return pelanggaran


def ringkas_pelanggaran(pelanggaran):
    jenis = []
    for p in pelanggaran:
        kalau = "%s (%s)" % (p["jenis"], p["cuplikan"])
        if kalau not in jenis:
            jenis.append(kalau)
    return ", ".join(jenis)
