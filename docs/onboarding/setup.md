# Menyiapkan lingkungan lokal

Target: lingkungan contoh terbuka di peramban dan kamu bisa login, lalu pemeriksaan wajib lulus di laptopmu.

Sumber kebenaran untuk perintah di halaman ini adalah [`AGENTS.md`](../../AGENTS.md) (bagian *Menjalankan layar di laptop* dan *Sebelum menyatakan hijau*), `package.json`, dan `.env.example`. Kalau halaman ini tertinggal dari berkas-berkas itu, ikuti berkasnya lalu perbaiki halaman ini.

## Yang perlu ada dulu

- **Bun**, versi yang sama dengan CI. Versinya tertulis di langkah `Setup Bun` pada `.github/workflows/ci.yml`.
- **Docker**, untuk PostgreSQL dan Valkey sekali pakai. PHP, Composer, dan Node tidak diperlukan.
- **Git**.
- **Python 3**, untuk menjalankan test harness `parity/`. CI menjalankannya dengan `python3 -m unittest`.

## Langkah 1: clone dan pasang dependency

```bash
git clone https://github.com/MettaDevs/operations-metta.git
```

```bash
cd operations-metta && bun install
```

`bun install` juga memasang hook `.githooks/pre-push`, sehingga push ditolak bila lint gagal.

## Langkah 2: database dan Valkey sekali pakai

Perintahnya ada di `AGENTS.md`, bagian *Sebelum menyatakan hijau*. Intinya: satu container `postgres:17` di `127.0.0.1:55432` dan satu container Valkey di `127.0.0.1:56379`, dengan kredensial `ci` yang memang hanya untuk laptop dan CI.

## Langkah 3: `.env`

Salin `.env.example` ke `.env`, lalu isi `APP_KEY` dengan perintah yang tertulis di komentar berkas itu. Nilai lain di berkas contoh sudah cocok dengan container di langkah 2. `BASE_DOMAIN=localhost` membuat setiap lingkungan dibuka di `<tenant>.localhost:8000`.

## Langkah 4: lingkungan contoh, lalu server

```bash
bun run dev:setup
```

```bash
bun run dev
```

`dev:setup` memigrasi database runtime, lalu membuat setiap tenant dan lingkungan di `dev/tenants.json` dengan database sendiri untuk setiap lingkungan, memasang module yang disebut di sana, dan mencetak alamat setiap lingkungan. Perintah ini aman diulang. Login dengan email dan kata sandi admin di `dev/tenants.json`; isinya data sintetis dan kata sandinya hanya untuk laptop.

`bun run dev` menyalakan server dengan `bun --watch` dan membangun ulang bundel peramban setiap kali berkas di `src/`, `modules/`, atau `packages/ui/src/` berubah. Muat ulang halaman untuk melihat hasilnya.

## Akses database

Sambungkan klien PostgreSQL ke `127.0.0.1:55432`, bukan ke PostgreSQL lain yang mungkin sudah ada di laptopmu. Ada dua jenis database:

- database runtime (`DB_DATABASE`, misalnya `operations_dev`): tabel `environment_routes` yang memetakan alamat ke database lingkungan, plus data bersama;
- satu database per lingkungan yang dibuat `dev:setup`: data tenant itu, Core dan module, dipisah awalan nama tabel.

Tidak ada database per module.

## Jebakan yang sering kena

**Test berbasis database dilewati diam-diam.** Test yang memanggil route lewat database hanya berjalan bila `DB_HOST` diisi, dan test sesi butuh `VALKEY_HOST`. Tanpa keduanya `bun test` tetap hijau karena test itu dilewati. CI selalu mengisinya.

**Berkas hasil generate tertinggal.** `src/client.tsx` dan `src/platform/shell/api-contract.generated.json` di-commit. Setelah menambah atau memindah `.page.tsx` atau procedure, jalankan `bun scripts/generate-client.ts` lalu commit hasilnya; `bun run check:generated` menolak berkas yang tertinggal.

**Mengubah menu module di database.** Menu module ditulis migration module ke `apps.navigation`. Mengubahnya berarti menulis migration baru, bukan menyunting barisnya.

**Folder worktree tanpa titik.** Worktree hanya di `.worktrees/<nama>`. Folder tanpa awalan titik ikut dijalankan `bun test`.

## Perintah verifikasi

Dari akar repo, pemeriksaan ini wajib lulus untuk setiap perubahan. Daftar yang berlaku ada di `AGENTS.md`, bagian *Sebelum menyatakan hijau*:

```bash
bun run check:generated
```

```bash
bun run typecheck
```

```bash
bun run lint
```

```bash
bun test
```

```bash
bun run format:check
```

```bash
bun run check:boundaries
```

CI juga menjalankan `bun run check:ui`, test harness `parity/`, dan `bun run build`. Kapan `build` perlu dijalankan lokal tertulis di `AGENTS.md`.

## Lihat juga

- [Hari pertama](hari-pertama.md)
- [Definition of done](definition-of-done.md)
- [Cara berkontribusi](kontribusi.md)
