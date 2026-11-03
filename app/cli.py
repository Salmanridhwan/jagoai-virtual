"""Antarmuka baris perintah."""
import argparse
import sys
from datetime import datetime
from pathlib import Path

from app import brief, config, env, gateway, models_registry, penjadwal, runtime
from app import papan, tugas as tugas_mod
from app import percakapan, peran


def _argumen(argv):
    p = argparse.ArgumentParser(prog="office")
    p.add_argument("--root", help="folder induk lain, berguna untuk uji dan instance terpisah")
    sub = p.add_subparsers(dest="perintah", required=True)

    m = sub.add_parser("models", help="ambil daftar model dari gerbang")
    m.add_argument("--tenant", default="jagoai")
    m.add_argument("--base-url")
    m.add_argument("--kunci")
    m.add_argument("--cache")

    r = sub.add_parser("run", help="jalankan satu shift")
    r.add_argument("--tenant", default="jagoai")
    r.add_argument("--agent", required=True)
    r.add_argument("--tugas", required=True)
    r.add_argument("--base-url")
    r.add_argument("--kunci")
    r.add_argument("--model")

    c = sub.add_parser("env-check", help="periksa kredensial tanpa menampilkan nilainya")
    c.add_argument("--tenant", default="jagoai")

    j = sub.add_parser("jadwal", help="jalankan slot harian yang jatuh tempo")
    j.add_argument("--tenant", default="jagoai")
    j.add_argument("--sekarang", help="waktu uji, contoh 2026-11-03T09:05")
    j.add_argument("--sekali", action="store_true", help="jalankan sekali lalu berhenti")
    j.add_argument("--jeda", type=int, default=60, help="detik antar putaran")
    j.add_argument("--toleransi", type=int, default=180, help="menit sebelum slot dianggap terlewat")
    j.add_argument("--kunci")

    t = sub.add_parser("tugas", help="kerjakan tugas yang menghasilkan berkas nyata")
    t.add_argument("--tenant", default="jagoai")
    t.add_argument("--agent", required=True, choices=["rian", "nadia"])
    t.add_argument("--pekan", required=True, help="tanggal Senin, contoh 2026-11-09")
    t.add_argument("--tanggal", help="untuk nadia, contoh 2026-11-10")
    t.add_argument("--topik", help="untuk nadia")
    t.add_argument("--kanal", default="instagram")
    t.add_argument("--format", dest="format_", default="carousel")
    t.add_argument("--kunci")

    d = sub.add_parser("desain", help="gambar slide dari naskah dan periksa margin serta kontras")
    d.add_argument("--tenant", default="jagoai")
    d.add_argument("--pekan", required=True)
    d.add_argument("--tanggal", required=True)
    d.add_argument("--format", dest="format_", default="carousel")
    d.add_argument("--footer", default="jagoai")

    v = sub.add_parser("video", help="susun video dari slide lalu periksa dengan ffprobe")
    v.add_argument("--tenant", default="jagoai")
    v.add_argument("--tanggal", required=True)
    v.add_argument("--pekan", help="untuk mengambil teks subjudul dari naskah")
    v.add_argument("--ukuran", default="9x16", choices=["9x16", "1x1"])
    v.add_argument("--durasi", type=int, default=4, help="detik per slide")

    o = sub.add_parser("tinjau", help="Omar menilai keluaran sebelum masuk antrean")
    o.add_argument("--tenant", default="jagoai")
    o.add_argument("--tanggal", required=True)
    o.add_argument("--pekan")
    o.add_argument("--kunci")

    k = sub.add_parser("percakapan", help="Bayu menyaring, Sinta menyusun draf balasan")
    k.add_argument("--tenant", default="jagoai")
    k.add_argument("--tanggal")
    k.add_argument("--kanal", default="threads")
    k.add_argument("--setujui", help="id draf yang disetujui manusia")
    k.add_argument("--oleh", default="pemilik")
    k.add_argument("--kunci")

    mp = sub.add_parser("mira", help="paket persetujuan dan catatan keputusan pemilik")
    mp.add_argument("--tenant", default="jagoai")
    mp.add_argument("--tanggal", required=True)
    mp.add_argument("--setujui", action="store_true", help="tandai konten disetujui")
    mp.add_argument("--oleh", default="")
    mp.add_argument("--catatan", default="")

    an = sub.add_parser("antrean", help="Kiki menyusun antrean unggah dari yang disetujui")
    an.add_argument("--tenant", default="jagoai")
    an.add_argument("--tanggal", required=True)

    lp = sub.add_parser("laporan", help="Vera menyusun laporan pekan dari berkas nyata")
    lp.add_argument("--tenant", default="jagoai")
    lp.add_argument("--pekan", required=True, help="tanggal Senin, contoh 2026-11-02")

    dt = sub.add_parser("data", help="lima tabel mode data dari berkas nyata")
    dt.add_argument("--tenant", default="jagoai")
    dt.add_argument("--tabel", default="ringkasan", choices=("ringkasan", "karyawan", "keluaran",
                                                             "percakapan", "biaya", "semua"))
    dt.add_argument("--pekan", required=True)
    dt.add_argument("--ekspor", choices=("csv", "json"))
    dt.add_argument("--cocokkan", action="store_true", help="bandingkan dengan angka Vera")

    kt = sub.add_parser("kontrol", help="layar admin: ringkasan semua tenant")
    kt.add_argument("--pekan", required=True)
    kt.add_argument("--peran", default="admin", choices=("pengguna", "admin"))

    rk = sub.add_parser("rekam", help="putar ulang kantor dari events.jsonl")
    rk.add_argument("--tenant", default="jagoai")
    rk.add_argument("--tanggal")
    rk.add_argument("--langkah", type=int, default=10)
    rk.add_argument("--bingkai", type=int, default=6, help="berapa bingkai dicetak")
    rk.add_argument("--mode", default="peristiwa", choices=("peristiwa", "jam"))

    return p.parse_args(argv)


def _kunci(cfg, tenant, argumen_kunci):
    if argumen_kunci:
        return argumen_kunci
    root = Path(cfg["_root"])
    sumber = env.load_env(root / "tenant" / tenant / ".env")
    return env.get(sumber, cfg["gerbang"]["kunci_env"])


def periksa_env(root, tenant):
    """Cetak status kredensial tanpa pernah menampilkan nilainya."""
    sumber = env.load_env(Path(root) / "tenant" / tenant / ".env")
    baris = env.cek(sumber)
    kurang = [b["nama"] for b in baris if b["wajib"] and not b["ada"]]
    for b in baris:
        tanda = "ada" if b["ada"] else "kosong"
        keterangan = "wajib" if b["wajib"] else "opsional"
        panjang = ("%d karakter" % b["panjang"]) if b["ada"] else "belum diisi"
        print("%-28s %-9s %-8s %s" % (b["nama"], keterangan, tanda, panjang))
    if kurang:
        print("kurang %d variabel wajib: %s" % (len(kurang), ", ".join(kurang)))
        return 7
    print("semua variabel wajib tersedia")
    return 0


def main(argv=None):
    a = _argumen(argv)
    try:
        tenant_cfg = getattr(a, "tenant", "jagoai")
        cfg = config.load(tenant_cfg, root=a.root) if a.root else config.load(tenant_cfg)
        root = Path(cfg["_root"])
        base_url = getattr(a, "base_url", None) or cfg["gerbang"]["base_url"]
        kunci_arg = getattr(a, "kunci", None)

        if a.perintah == "models":
            cache = Path(a.cache) if a.cache else root / "tenant" / a.tenant / "state" / "models.json"
            data = models_registry.sync(base_url, _kunci(cfg, a.tenant, a.kunci), cache)
            for m in data:
                print(m.get("id"))
            print("total %d model" % len(data))
            return 0

        if a.perintah == "env-check":
            return periksa_env(root, a.tenant)

        if a.perintah == "jadwal":
            kini = datetime.fromisoformat(a.sekarang) if a.sekarang else datetime.now().astimezone()
            if a.sekali:
                hasil = penjadwal.sekali(root, a.tenant, kini, toleransi_menit=a.toleransi,
                                         kunci=_kunci(cfg, a.tenant, a.kunci))
                if not hasil:
                    print("tidak ada slot jatuh tempo pada %s" % kini.strftime("%Y-%m-%d %H:%M"))
                penjadwal.cetak(hasil)
                return 0
            print("penjadwal berjalan, tiap %d detik. Ctrl+C untuk berhenti." % a.jeda)
            penjadwal.putar(root, a.tenant, jeda=a.jeda)
            return 0

        if a.perintah == "rekam":
            from app import rekam
            tanggal = a.tanggal or (rekam.daftar_tanggal(root, a.tenant) or [""])[-1]
            d = rekam.bingkai(root, a.tenant, tanggal, a.langkah, mode=a.mode)
            if d["kosong"]:
                print("tidak ada event pada %s" % tanggal)
                return 4
            print("%s | %d event | %d bingkai | mode %s | token %d" % (
                tanggal, d["jumlah_event"], len(d["bingkai"]), d["mode"],
                rekam.token_hari(root, a.tenant, tanggal)))
            for b in d["bingkai"][:a.bingkai]:
                ringkas = " ".join("%s=%s" % (n, s) for n, s in b["karyawan"].items() if s != "sleep")
                print("  %s %s" % (b["jam"], ringkas or "semua tidur"))
            return 0

        if a.perintah == "data":
            from app import data
            if a.cocokkan:
                selisih = data.cocokkan(root, a.tenant, a.pekan)
                print("selisih dengan Vera: %d" % len(selisih))
                for s in selisih:
                    print("  %s: tabel %s, vera %s" % (s["angka"], s["tabel"], s["vera"]))
                return 0 if not selisih else 6
            nama = list(data.TABEL) if a.tabel == "semua" else [a.tabel]
            for t in nama:
                if a.ekspor:
                    berkas, jumlah = data.ekspor(root, a.tenant, t, a.pekan, a.ekspor)
                    print("%-11s %3d baris -> %s" % (t, jumlah, berkas))
                else:
                    baris = data.tabel(t, root, a.tenant, a.pekan)
                    print("%s: %d baris" % (t, len(baris)))
                    for b in baris[:3]:
                        print("   " + " | ".join("%s=%s" % (k, v) for k, v in b.items()
                                                 if k not in ("draf", "naskah", "tautan")))
                    if len(baris) > 3:
                        print("   ... %d baris lain" % (len(baris) - 3))
            return 0

        if a.perintah == "kontrol":
            from app import peran
            peran.wajib(a.peran, "lihat_semua_tenant")
            for h in peran.ringkas_platform(root, a.pekan):
                print("%-10s token %-7d naskah %-3d video %-3d galat %d" % (
                    h["tenant"], h["token"], h["naskah"], h["video"], h["galat"]))
            return 0

        if a.perintah == "laporan":
            from app import vera
            d = vera.tulis(root, a.tenant, a.pekan)
            print("pekan %s | token %d | naskah %d | desain lulus %d | video %d | tinjauan %s" % (
                d["pekan"], d["token_total"], d["isi"]["naskah"], d["isi"]["desain_lulus"],
                d["isi"]["video"], d["isi"]["tinjauan"]))
            print("jangkauan: %s" % ("ada, %d baris" % d["jangkauan"]["baris"]
                                     if d["jangkauan"]["ada"] else "belum ada data"))
            print("laporan: %s" % d["berkas"])
            return 0

        if a.perintah == "mira":
            from app import mira
            if a.setujui:
                data = mira.setujui_konten(root, a.tenant, a.tanggal, a.oleh, a.catatan)
                print("disetujui oleh %s pada %s" % (data["oleh"], data["pada"]))
                return 0
            paket = mira.paket(root, a.tenant, a.tanggal)
            print("menunggu keputusan: %d | tertahan: %d" % (paket["menunggu_keputusan"],
                                                             len(paket["tertahan"])))
            for s in paket["siap"]:
                keterangan = s.get("akun") or s.get("berkas", "")
                print("  siap   %-8s %-22s %s" % (s["jenis"], s["status"], keterangan))
            for t in paket["tertahan"]:
                print("  tahan  %-8s %s" % (t["jenis"], t["alasan"]))
                for temuan in t.get("temuan", []):
                    print("         - %s" % temuan)
            return 0

        if a.perintah == "antrean":
            from app import antrean
            h = antrean.susun(root, a.tenant, a.tanggal)
            print("masuk %d | ditolak %d | siap unggah manual %d" % (
                h["jumlah"]["masuk"], h["jumlah"]["ditolak"], h["jumlah"]["manual"]))
            for m in h["masuk"]:
                print("  masuk  %-8s %-20s %s" % (m["jenis"], m["status"],
                                                  m.get("akun") or m.get("berkas", "")))
            for d in h["ditolak"]:
                print("  tolak  %-8s %s" % (d["jenis"], d["alasan"]))
            print("berkas: %s" % h["berkas"])
            return 0

        if a.perintah == "percakapan":
            if a.setujui:
                d = percakapan.setujui(root, a.tenant, a.setujui, a.oleh)
                print("disetujui: %s oleh %s, rencana kirim %s" % (
                    d["id"], d["disetujui_oleh"], d.get("rencana_kirim", "")))
                return 0
            h = percakapan.kerjakan(root, a.tenant, tanggal=a.tanggal, kanal=(a.kanal,),
                                    kunci=_kunci(cfg, a.tenant, a.kunci))
            print("sumber %s | calon %d | draf %d | ditolak %d | ditarik %d" % (
                h["sumber"], h["calon"], len(h["draf"]), len(h["ditolak"]), len(h["ditarik"])))
            for d in h["draf"]:
                print("  %s @%s: %s" % (d["id"], d["akun"], d["draf"][:100]))
            for d in h["ditolak"]:
                print("  ditolak %s: %s" % (d["id"], d["alasan"]))
            for d in h["ditarik"]:
                print("  ditarik %s: %s" % (d["id"], d["alasan"]))
            print("berkas: %s" % h["berkas"])
            return 0

        if a.perintah == "tinjau":
            from app import omar
            h = omar.tinjau(root, a.tenant, a.tanggal, pekan=a.pekan or a.tanggal,
                            kunci=_kunci(cfg, a.tenant, a.kunci))
            print("status: %s" % h["status"])
            if h["lapis_teknis"]:
                for s in h["lapis_teknis"]:
                    print("  teknis: %s" % s)
            for t in h["temuan_isi"]:
                print("  %s pada %s: %s (%s)" % (t.get("tingkat"), t.get("bagian", ""),
                                                 t.get("alasan", ""), t.get("kutipan", "")))
            if h["angka_tanpa_dasar"]:
                print("  angka tanpa dasar di naskah: %s" % ", ".join(h["angka_tanpa_dasar"]))
            print("tinjauan: %s" % h["berkas_tinjauan"])
            return {"lulus": 0, "tolak": 6, "manual": 7}[h["status"]]

        if a.perintah == "video":
            from app import desain, video
            folder = root / "tenant" / a.tenant / "keluaran" / "desain" / a.tanggal
            if not folder.exists():
                print("slide untuk %s belum ada, jalankan perintah desain dulu" % a.tanggal)
                return 4
            teks = []
            if a.pekan:
                naskah = sorted((root / "tenant" / a.tenant / "keluaran" / "naskah" / a.pekan)
                                .glob(a.tanggal + "-*.md"))
                if naskah:
                    teks = desain.baca_slide(Path(naskah[0]).read_text(encoding="utf-8"))
            ukuran = (1080, 1920) if a.ukuran == "9x16" else (1080, 1080)
            h = video.susun(root, a.tenant, a.tanggal, folder, teks_slide=teks,
                            ukuran=ukuran, durasi_per_slide=a.durasi)
            info = video.ukur(h["berkas"])
            print("%s %sx%s %.1f detik %s/%s byte=%d faststart=%s" % (
                h["berkas"], info["lebar"], info["tinggi"], info["durasi"],
                info["kodek_video"], info["kodek_audio"], info["ukuran_byte"], info["faststart"]))
            suara = video.analisis_audio(h["berkas"])
            if suara.get("audio_kosong"):
                print("audio: kosong, kenyaringan tidak dilaporkan sebagai angka")
            elif suara.get("terbaca"):
                print("audio: %s LUFS" % suara.get("input_i"))
            salah = video.periksa(info, ukuran)
            if salah:
                for s in salah:
                    print("  pelanggaran: %s" % s)
                return 6
            print("periksa teknis: lulus")
            return 0

        if a.perintah == "desain":
            from app import desain
            pola = sorted((root / "tenant" / a.tenant / "keluaran" / "naskah" / a.pekan)
                          .glob(a.tanggal + "-*.md"))
            if not pola:
                print("naskah untuk %s belum ada di pekan %s" % (a.tanggal, a.pekan))
                return 4
            laporan = desain.buat(root, a.tenant, a.tanggal, pola[0],
                                  format_=a.format_, footer=a.footer)
            print("slide %d, kanvas %s, kontras %s" % (
                len(laporan["slide"]), laporan["kanvas"], laporan["kontras"]))
            for s in laporan["slide"]:
                print("  slide %d %s %s" % (s["nomor"], Path(s["berkas"]).name,
                                            "lulus" if not s["pelanggaran"] else "; ".join(s["pelanggaran"])))
            if laporan["palet_salah"]:
                for p in laporan["palet_salah"]:
                    print("  palet: %s" % p)
            print("laporan: %s" % (Path(laporan["slide"][0]["berkas"]).parent / "laporan.json"))
            return 0 if laporan["lulus"] else 6

        if a.perintah == "tugas":
            if a.agent == "rian":
                h = tugas_mod.rian(root, a.tenant, a.pekan, kunci=_kunci(cfg, a.tenant, a.kunci))
                print("jadwal %d slot -> %s" % (len(h["slot"]), h["berkas"]))
                for s in h["slot"]:
                    print("  %s %-9s %-10s %s" % (s.get("tanggal"), s.get("kanal", ""),
                                                   s.get("format", ""), s.get("topik", "")))
            else:
                if not a.tanggal or not a.topik:
                    print("nadia butuh --tanggal dan --topik")
                    return 2
                h = tugas_mod.nadia(root, a.tenant, a.pekan, a.tanggal, a.topik,
                                    kanal=a.kanal, format_=a.format_,
                                    kunci=_kunci(cfg, a.tenant, a.kunci))
                print("naskah -> %s" % h["berkas"])
            print("token=%d" % h["tokens"])
            return 0

        if a.perintah == "run":
            k = config.karyawan(cfg, a.agent)
            model = a.model or k.get("model") or ""
            if not model:
                print("model untuk %s belum diisi di office.toml" % a.agent)
                return 2
            slug = a.agent.split(":")[1]
            b = brief.muat(root / "tenant" / a.tenant / "brief-karyawan" / (slug + ".md"))
            hasil = runtime.jalankan(
                base_url=base_url,
                kunci=_kunci(cfg, a.tenant, a.kunci),
                model=model,
                agent_id=a.agent,
                tugas=a.tugas,
                brief=b["teks"],
                log_path=root / "tenant" / a.tenant / "events.jsonl",
                batas_tenant=int(cfg["gerbang"].get("batas_harian_tenant") or 0) or None,
                batas_shift=int(k.get("batas_shift", 20000)),
                max_tokens=int(k.get("maks_token", 400)),
                nama=slug.capitalize(),
                jabatan=k.get("jabatan", "karyawan"),
            )
            print(hasil["teks"])
            print("shift=%s token=%d+%d" % (hasil["shift_id"], hasil["tokens_in"], hasil["tokens_out"]))
            if hasil.get("tertunda"):
                print("catatan: shift melewati batas_shift, ditandai tertunda")
            keras = [j for j in hasil.get("pelanggaran", []) if j != "topik"]
            if keras:
                print("catatan: keluaran masih melanggar %s setelah satu perbaikan" % ", ".join(keras))
            if "topik" in hasil.get("pelanggaran", []):
                print("catatan: balasan belum menyentuh kata kunci tugas, perlu ditinjau")
            return 0

    except gateway.GatewayError as e:
        print("gagal: %s" % e)
        return 3
    except FileNotFoundError as e:
        print("berkas tidak ada: %s" % e)
        return 4
    except KeyError as e:
        print("kurang pengaturan: %s" % e)
        return 4
    except brief.BriefError as e:
        print("brief ditolak: %s" % e)
        return 5
    except runtime.ShiftDitunda as e:
        print("shift ditunda: %s" % e)
        return 8
    except tugas_mod.TugasGagal as e:
        print("tugas gagal: %s (%s)" % (e, "; ".join(e.kesalahan)))
        return 9
    except peran.AksesDitolak as e:
        print("akses ditolak: %s" % e)
        return 11
    except percakapan.DrafGagal as e:
        print("draf tidak bisa diputuskan: %s" % e)
        return 9
    except percakapan.SumberBelumAda as e:
        print("sumber percakapan belum ada: %s" % e)
        return 10

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
