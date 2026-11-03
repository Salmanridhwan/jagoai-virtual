"""Antarmuka baris perintah."""
import argparse
import sys
from datetime import datetime
from pathlib import Path

from app import brief, config, env, gateway, models_registry, penjadwal, runtime


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
        cfg = config.load(a.tenant, root=a.root) if a.root else config.load(a.tenant)
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

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
