"""Peran dan lapis tenant.

Dua peran dipisah tugas, bukan tingkat akses. Admin mengubah batas, model, dan
melihat semua tenant, tetapi tidak boleh menyetujui kiriman ke kanal. Persetujuan
isi hanya milik pengguna, karena yang menanggung akibat tayang adalah pemilik
organisasi, bukan pengelola sistem.
"""
from pathlib import Path


class AksesDitolak(PermissionError):
    pass


PERAN = ("pengguna", "admin")

AKSI = {
    "lihat_kantor": ("pengguna", "admin"),
    "lihat_data": ("pengguna", "admin"),
    "ekspor_data": ("pengguna", "admin"),
    "setujui_konten": ("pengguna",),
    "setujui_balasan": ("pengguna",),
    "ubah_brief": ("pengguna",),
    "ubah_batas": ("admin",),
    "ubah_model": ("admin",),
    "ubah_kunci": ("admin",),
    "lihat_semua_tenant": ("admin",),
}


def boleh(peran, aksi):
    if peran not in PERAN:
        return False
    if aksi not in AKSI:
        return False
    return peran in AKSI[aksi]


def wajib(peran, aksi):
    if not boleh(peran, aksi):
        raise AksesDitolak("peran %s tidak boleh %s" % (peran, aksi))
    return True


def tenant_boleh(peran, sesi, diminta):
    """Satu sesi hanya boleh menyentuh tenant-nya sendiri, kecuali admin platform."""
    if peran == "admin":
        return True
    if sesi != diminta:
        raise AksesDitolak("sesi untuk tenant %s tidak boleh menyentuh tenant %s" % (sesi, diminta))
    return True


def _hitung(root, tenant, pekan):
    from app import data, vera

    return {
        "tenant": tenant,
        "token": vera.kumpulkan(root, tenant, pekan)["token_total"],
        "naskah": len([b for b in data.keluaran(root, tenant, pekan) if b["naskah"]]),
        "video": sum(b["video"] for b in data.ringkasan(root, tenant, pekan)),
        "galat": len(data.cocokkan(root, tenant, pekan)),
    }


def ringkas_platform(root, pekan):
    """Daftar tenant beserta angkanya, dibaca dari folder tenant masing-masing."""
    folder = Path(root) / "tenant"
    hasil = []
    if not folder.exists():
        return hasil
    for t in sorted(p for p in folder.iterdir() if p.is_dir()):
        if not (t / "office.toml").exists():
            continue
        try:
            hasil.append(_hitung(root, t.name, pekan))
        except (OSError, ValueError, KeyError) as e:
            hasil.append({"tenant": t.name, "token": 0, "naskah": 0, "video": 0,
                          "galat": -1, "catatan": str(e)})
    return hasil
