"""Menjalankan satu shift satu karyawan.

Penjaga sebelum panggilan: gelembung panggilan dan batas tenant harian.
Penjaga sesudah panggilan: batas token per shift, dan penjaga keluaran.
Penjaga keluaran memeriksa identitas, tahun, dan angka karangan. Kalau ada
pelanggaran, shift mencoba sekali lagi dengan pesan perbaikan. Kalau masih
melanggar, hasil tetap dicatat apa adanya beserta pelanggarannya, tidak
disembunyikan.
"""
import uuid
from datetime import datetime
from pathlib import Path

from app import budget, events, gateway, penjaga

SISTEM = (
    "Kamu {nama}, {jabatan} di kantor jagoai-virtual. "
    "Ikuti brief di bawah ini dan jangan keluar dari peran itu. "
    "Jangan pernah menyebut dirimu asisten, model, AI, atau nama produk apa pun. "
    "Kalau brief tidak menyebut angka, tanggal, atau tahun, jangan mengarang. "
    "Jawab dalam bahasa Indonesia, ringkas, tanpa pembuka basa-basi."
)

PERBAIKAN = (
    "Balasan sebelumnya ditolak karena {alasan}. Tulis ulang jawabanmu. "
    "Tetap dalam peran, jangan menyebut dirimu asisten atau model, "
    "dan jangan memakai angka atau tahun yang tidak ada di brief."
)


class ShiftDitunda(RuntimeError):
    def __init__(self, alasan, rincian=""):
        super().__init__("%s. %s" % (alasan, rincian) if rincian else alasan)
        self.alasan = alasan


def pesan_perbaikan(pelanggaran):
    return PERBAIKAN.format(alasan=penjaga.ringkas_pelanggaran(pelanggaran))


def jalankan(base_url, kunci, model, agent_id, tugas, brief, log_path,
             batas_tenant=None, batas_shift=20000, max_tokens=400,
             gelembung_menit=10, gelembung_batas=12,
             nama="kamu", jabatan="karyawan", tahun=None):
    log_path = Path(log_path)
    shift_id = "shf_" + uuid.uuid4().hex[:8]
    tanggal = events.now_iso()[:10]
    tahun = tahun or datetime.now().year
    lama = events.read_all(log_path)

    if budget.gelembung(lama, agent_id, gelembung_menit, gelembung_batas):
        jumlah = budget.panggilan_dalam_jendela(lama, agent_id, gelembung_menit)
        events.append(log_path, {
            "kind": "shift_tertunda", "agent_id": agent_id, "shift_id": shift_id,
            "alasan": "gelembung_panggilan", "panggilan": jumlah,
            "jendela_menit": gelembung_menit,
        })
        raise ShiftDitunda("gelembung_panggilan",
                           "%d panggilan dalam %d menit, batasnya %d"
                           % (jumlah, gelembung_menit, gelembung_batas))

    if batas_tenant is not None:
        pakai = budget.terpakai_tenant(lama, tanggal)
        if pakai >= batas_tenant:
            events.append(log_path, {
                "kind": "shift_tertunda", "agent_id": agent_id, "shift_id": shift_id,
                "alasan": "batas_tenant", "terpakai": pakai, "batas": batas_tenant,
            })
            raise ShiftDitunda("batas_tenant",
                               "%d dari %d token terpakai hari ini" % (pakai, batas_tenant))

    events.append(log_path, {
        "kind": "shift_start", "agent_id": agent_id, "shift_id": shift_id,
        "tugas": tugas, "model": model,
    })
    messages = [
        {"role": "system", "content": SISTEM.format(nama=nama, jabatan=jabatan) + chr(10) * 2 + brief},
        {"role": "user", "content": tugas},
    ]
    try:
        total_in = 0
        total_out = 0
        teks = ""
        pelanggaran = []
        for percobaan in range(2):
            hasil = gateway.chat(base_url, kunci, model, messages, max_tokens=max_tokens)
            u = gateway.usage(hasil)
            total_in += u["tokens_in"]
            total_out += u["tokens_out"]
            teks = gateway.teks(hasil)
            events.append(log_path, {
                "kind": "llm_call", "agent_id": agent_id, "shift_id": shift_id,
                "model": u["model"] or model, "tokens_in": u["tokens_in"],
                "tokens_out": u["tokens_out"], "ok": True, "percobaan": percobaan + 1,
                "summary": teks[:120],
            })
            pelanggaran = penjaga.periksa(teks, brief, tahun, tugas=tugas)
            keras = [x for x in pelanggaran if x['jenis'] != 'topik']
            if not keras:
                break
            events.append(log_path, {
                "kind": "keluaran_ditolak", "agent_id": agent_id, "shift_id": shift_id,
                "percobaan": percobaan + 1,
                "pelanggaran": [p["jenis"] for p in keras],
                "cuplikan": teks[:120],
            })
            messages = messages + [
                {"role": "assistant", "content": teks},
                {"role": "user", "content": pesan_perbaikan(pelanggaran)},
            ]

        jumlah = total_in + total_out
        lewat = jumlah > batas_shift
        if lewat:
            events.append(log_path, {
                "kind": "shift_tertunda", "agent_id": agent_id, "shift_id": shift_id,
                "alasan": "batas_shift", "terpakai": jumlah, "batas": batas_shift,
            })
        if lewat:
            catatan = "batas_shift"
        elif keras:
            catatan = "keluaran_ditolak"
        elif pelanggaran:
            catatan = "topik"
        else:
            catatan = ""
        events.append(log_path, {
            "kind": "shift_end", "agent_id": agent_id, "shift_id": shift_id, "ok": True,
            "tokens_in": total_in, "tokens_out": total_out, "catatan": catatan,
        })
        return {
            "shift_id": shift_id, "tokens_in": total_in, "tokens_out": total_out,
            "teks": teks, "tertunda": lewat,
            "pelanggaran": [p["jenis"] for p in pelanggaran],
        }
    except gateway.GatewayError as e:
        events.append(log_path, {
            "kind": "tool_error", "agent_id": agent_id, "shift_id": shift_id,
            "ok": False, "status": e.status, "summary": str(e)[:200],
        })
        events.append(log_path, {
            "kind": "shift_end", "agent_id": agent_id, "shift_id": shift_id, "ok": False,
        })
        raise
