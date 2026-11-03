"""Video pendek: slide menjadi berkas mp4 yang bisa diukur.

Yang dibuat Doni pada tahap ini adalah video dari slide yang sudah lulus periksa
desain. Belum ada rekaman produk, jadi tidak ada bahan bergerak.

Pemeriksaan memakai ffprobe dan pembacaan awal berkas, bukan perkiraan:
resolusi, durasi, kodek, letak moov untuk faststart, dan ada tidaknya audio.
Kalau tidak ada audio, kenyaringan tidak dilaporkan sebagai angka, karena
mengukur keheningan lalu menyebutnya -14 LUFS adalah kebohongan.
"""
import json
import subprocess
from pathlib import Path

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

DURASI_MIN = 15
DURASI_MAKS = 60


class VideoGagal(RuntimeError):
    pass


def srt(slide, durasi_per_slide=4.0):
    """Subjudul satu cue per slide, waktu dihitung dari durasi tiap slide."""
    def waktu(detik):
        j = int(detik // 3600)
        m = int((detik % 3600) // 60)
        s = detik % 60
        return ("%02d:%02d:%06.3f" % (j, m, s)).replace(".", ",")

    baris = []
    for i, s in enumerate(slide):
        mulai = i * durasi_per_slide
        selesai = mulai + durasi_per_slide
        teks = (s.get("teks") or "").strip()
        if not teks:
            continue
        baris.append(str(i + 1))
        baris.append("%s --> %s" % (waktu(mulai), waktu(selesai)))
        baris.append(teks)
        baris.append("")
    return "\n".join(baris)


def perintah_susun(folder_slide, keluaran, ukuran=(1080, 1920), durasi_per_slide=4,
                   latar="0x0F1B2D"):
    w, h = ukuran
    vf = ("scale=%d:%d:force_original_aspect_ratio=decrease,"
          "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=%s,setsar=1,fps=30" % (w, h, w, h, latar))
    return [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", "1/%d" % durasi_per_slide,
        "-i", str(Path(folder_slide) / "slide-%02d.png"),
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", vf,
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(keluaran),
    ]


def susun(root, tenant, tanggal, folder_desain, teks_slide=None, ukuran=(1080, 1920),
          durasi_per_slide=4):
    folder_desain = Path(folder_desain)
    slide = sorted(folder_desain.glob("slide-*.png"))
    if not slide:
        raise VideoGagal("tidak ada slide di %s" % folder_desain)

    keluar = Path(root) / "tenant" / tenant / "keluaran" / "video" / tanggal
    keluar.mkdir(parents=True, exist_ok=True)
    berkas = keluar / ("video-%s.mp4" % ("9x16" if ukuran[1] > ukuran[0] else "1x1"))

    perintah = perintah_susun(folder_desain, berkas, ukuran, durasi_per_slide)
    hasil = subprocess.run(perintah, capture_output=True, text=True)
    if hasil.returncode != 0:
        raise VideoGagal("ffmpeg gagal: %s" % (hasil.stderr.strip()[-400:] or "tanpa pesan"))

    sub = keluar / "subjudul.srt"
    sub.write_text(srt(teks_slide or [], durasi_per_slide), encoding="utf-8")
    return {"berkas": str(berkas), "subjudul": str(sub), "slide": len(slide)}


def ukur(berkas):
    perintah = [FFPROBE, "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", str(berkas)]
    hasil = subprocess.run(perintah, capture_output=True, text=True)
    if hasil.returncode != 0:
        raise VideoGagal("ffprobe gagal: %s" % hasil.stderr.strip()[:200])
    data = json.loads(hasil.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if video is None:
        raise VideoGagal("berkas tidak punya aliran video")
    return {
        "lebar": int(video.get("width") or 0),
        "tinggi": int(video.get("height") or 0),
        "kodek_video": video.get("codec_name"),
        "kodek_audio": (audio or {}).get("codec_name"),
        "durasi": float(data.get("format", {}).get("duration") or 0),
        "ukuran_byte": int(data.get("format", {}).get("size") or 0),
        "faststart": faststart(berkas),
    }


def faststart(berkas):
    """benar kalau atom moov muncul sebelum mdat pada awal berkas."""
    with open(berkas, "rb") as f:
        kepala = f.read(4096)
    i_moov = kepala.find(b"moov")
    i_mdat = kepala.find(b"mdat")
    if i_moov < 0:
        return False
    return i_mdat < 0 or i_moov < i_mdat


def periksa(info, harapan=(1080, 1920)):
    salah = []
    if (info.get("lebar"), info.get("tinggi")) != harapan:
        salah.append("resolusi %sx%s, seharusnya %dx%d" % (
            info.get("lebar"), info.get("tinggi"), harapan[0], harapan[1]))
    durasi = info.get("durasi") or 0
    if durasi < DURASI_MIN or durasi > DURASI_MAKS:
        salah.append("durasi %.1f detik, harus antara %d dan %d" % (durasi, DURASI_MIN, DURASI_MAKS))
    if info.get("kodek_video") != "h264":
        salah.append("kodek video %s, seharusnya h264" % info.get("kodek_video"))
    if not info.get("faststart"):
        salah.append("moov tidak di awal berkas, faststart gagal")
    if not info.get("kodek_audio"):
        salah.append("tidak ada aliran audio")
    return salah


def analisis_audio(berkas):
    """Kenyaringan menurut loudnorm. Kosong berarti tidak ada isi audio."""
    perintah = [FFMPEG, "-hide_banner", "-nostats", "-i", str(berkas),
                "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
                "-f", "null", "-"]
    hasil = subprocess.run(perintah, capture_output=True, text=True)
    teks = hasil.stderr
    awal = teks.rfind("{")
    akhir = teks.rfind("}")
    if awal < 0 or akhir <= awal:
        return {"terbaca": False, "alasan": "keluaran loudnorm tidak ditemukan"}
    try:
        data = json.loads(teks[awal:akhir + 1])
    except json.JSONDecodeError:
        return {"terbaca": False, "alasan": "keluaran loudnorm bukan JSON"}
    try:
        masuk = float(data.get("input_i"))
    except (TypeError, ValueError):
        masuk = None
    return {
        "terbaca": True,
        "input_i": masuk,
        "input_tp": data.get("input_tp"),
        "audio_kosong": masuk is None or masuk < -70,
    }
