---
name: verify-operations-metta
description: Menyalakan operations-metta dari database kosong milik sendiri lalu menggerakkan SPA web lewat peramban terskrip, seperti pengguna klinik, untuk membuktikan perubahan di aplikasi asli. Pakai sebelum menyatakan sebuah perubahan jalan, terutama yang menyentuh pendaftaran, pemeriksaan poli, resep dan farmasi, kasir, atau penjualan obat bebas, dan setiap kali perlu bukti bahwa satu pasien rawat jalan masih bisa berjalan dari pendaftaran sampai bayar di kasir.
---

# Verifikasi operations-metta di aplikasi asli

Satu perintah, `bun scripts/verify.ts`, menyalakan, memeriksa, menggerakkan, dan mematikan satu run verifikasi. Setiap run punya PostgreSQL di container sendiri, server dari worktree ini di port acak, dan Chrome headless dengan profil sendiri, jadi run bisa berjalan berdampingan dengan `bun run dev` pemilik, instance lain, dan run dari worktree lain. Jalankan semua perintah dari akar worktree.

Permukaan yang digerakkan hanya SPA web. API `/api/v1/...` tidak digerakkan langsung; ia hanya dibaca lewat efeknya di database.

## Launch

Prasyarat: Docker berjalan, `bun install` sudah dijalankan, dan Chrome atau Edge terpasang (isi `CHROME_PATH` bila path-nya lain).

```bash
bun scripts/verify.ts up
```

`up` membuat container `ops-verify-<run>` (`postgres:17`, port host acak di 127.0.0.1), menunggu PostgreSQL menerima koneksi TCP, menjalankan `scripts/dev-setup.ts` (migration dan data contoh dari `dev/tenants.json`, sekitar 2 sampai 3 menit), membangun peramban ke folder run, lalu menyalakan `bun src/main.ts` dan Chrome headless. Semua proses anak memakai `--no-env-file`, jadi `.env` worktree tidak ikut terbaca. Siap berarti baris terakhir `READY http://klinik-contoh.localhost:<port>`: server sudah menjawab alamat tenant dan peramban sudah menjawab CDP. Login belum terjadi.

`up` menolak menyala bila run sebelumnya dari worktree yang sama belum dimatikan. Run yang gagal di tengah `up` langsung dimatikan, dan log-nya tetap ada.

## Doctor

```bash
bun scripts/verify.ts doctor
```

Hanya membaca. Ia memeriksa run belum dimatikan, worktree dan commit sama dengan HEAD, container berjalan, PID server hidup, `GET /api/v1/shell` di alamat tenant dijawab 401 oleh server run ini, dan peramban menjawab CDP. Jalankan setiap kali ada yang terasa aneh. Commit yang berbeda berarti server menjalankan kode lama: `down` lalu `up` lagi.

## Drive

Peramban dikendalikan lewat Chrome DevTools Protocol dengan WebSocket bawaan Bun (`scripts/verify/browser.ts`), tanpa dependency baru. Elemen dicari dari role dan nama aksesnya, seperti yang dibaca pembaca layar.

```bash
bun scripts/verify.ts login                       # admin tenant contoh; kata sandi dibaca dari dev/tenants.json
bun scripts/verify.ts go healthcare/registration/visits/new
bun scripts/verify.ts fill combobox Pasien "Budi"
bun scripts/verify.ts click option "3171011204800001"
bun scripts/verify.ts click button "Poli Umum" --within "Poli atau ruangan" --exact
bun scripts/verify.ts click button "Simpan registrasi"
bun scripts/verify.ts snapshot daftar             # evidence/daftar.aria.txt
bun scripts/verify.ts shot daftar                 # evidence/daftar.png; --alert untuk close-up ringkasan error
bun scripts/verify.ts sql "select no_reg, status from sim_tr_registrasi" --save registrasi
```

- Role yang dikenal: `button`, `link`, `textbox`, `combobox`, `option`, `tab`, `menuitem`, `checkbox` (termasuk switch), `radio`, `row`, `heading`, `text`. Field angka (`spinbutton`) dicari sebagai `textbox`.
- Nama dicocokkan sebagai potongan teks tanpa peduli huruf besar. `--exact` mencocokkan seluruh nama, `--prefix` awal nama, `--nth N` memilih kecocokan ke-N (mulai 0), dan `--within T` membatasi ke dialog, group, region, form, atau baris yang nama atau teksnya memuat T.
- `click` dan `fill` menunggu sampai 15 detik sampai elemen muncul dan aktif. `wait <role> <nama> [--gone]` menunggu tanpa mengklik, dan `find` mencetak kecocokan tanpa mengkliknya.
- `snapshot` adalah cara tercepat menemukan nama elemen di layar yang belum dikenal. Baca berkasnya, lalu pakai role dan nama yang tertulis.
- `fill-password <role> <nama> [email]` mengisi kata sandi dari `dev/tenants.json` tanpa mencetaknya, misalnya untuk Clerk Start. Jangan menulis kata sandi di perintah, chat, PR, atau skill.
- `sql` berjalan di database lingkungan tenant contoh (bukan database runtime) lewat `psql` di container run.
- Di Git Bash, path layar ditulis tanpa `/` di depan. Git Bash mengubah argumen berawalan `/` menjadi path Windows.

Resep per fitur ada di [features/README.md](features/README.md). Perjalanan rawat jalan penuh sudah ditulis sebagai satu perintah:

```bash
bun scripts/verify.ts journey outpatient
bun scripts/verify.ts journey outpatient --prepare-cashier
```

Perjalanan itu masuk sebagai admin, memilih tempat kerja dari `sample.workspace`, mendaftarkan pasien kunjungan contoh pertama ke polinya, Mulai periksa dari antrean, mengisi dokter, keluhan, periksa fisik wajib, satu tindakan, dan satu baris e-resep, Simpan, Kirim ke farmasi, Selesai periksa, Siapkan di farmasi, lalu Bayar tunai di kasir dan membaca database. Data contoh belum membuat jenis bayar tunai maupun Clerk Start, jadi tanpa `--prepare-cashier` perjalanan berhenti gagal di langkah `kasir-bayar` dengan alasannya. `--prepare-cashier` membuat keduanya lewat layar Kasir (Jenis bayar dan Clerk) sebelum membayar, dan mencatatnya di `journey.json`.

## Evidence

Bukti ada di `<VERIFY_HOME>/<run>/evidence/`, bawaan `<tmpdir>/operations-metta-verify/` (di Windows `%TEMP%\operations-metta-verify\`), di luar repo, sehingga bertahan setelah `down` dan setelah worktree dihapus. `up` dan `doctor` mencetak path-nya. Isinya:

- `server.log` dan `server.err.log` server run itu;
- `<nama>.png` dan `<nama>.aria.txt` dari `shot` dan `snapshot`, `<nama>.sql.txt` dari `sql --save`;
- `outpatient-<waktu>/` dari setiap `journey outpatient`: screenshot dan snapshot per langkah (`NN-<langkah>.png`, akhiran `-gagal` untuk langkah yang gagal), `database.txt`, dan `journey.json` berisi commit, nomor dokumen, durasi, dan catatan tiap langkah.

Standar bukti:

- Gerakkan jalur pengguna lewat layar. Jangan memanggil endpoint langsung atau mengisi tabel untuk melewati sebuah layar.
- Rekam aksinya dan keadaan sesudahnya, bukan hanya layar terakhir: screenshot dan snapshot sesudah setiap aksi yang mengubah data.
- Periksa efek sampingnya di database dengan `sql`: baris yang lahir, status yang berubah, nomor dokumen yang terisi. Pesan toast saja bukan bukti.
- Prasyarat yang tidak ada di data contoh adalah kegagalan yang dilaporkan, bukan alasan melemahkan perjalanan. Catat di Gotchas fitur itu.

## Cleanup

```bash
bun scripts/verify.ts down
```

`down` mematikan pohon proses server dan peramban dari PID yang dicatat `up`, menghapus container run beserta volumenya, lalu menghapus profil peramban dan build peramban run itu. `evidence/` dan `run.json` tidak disentuh. Jangan mematikan proses berdasarkan nama (`bun`, `chrome`), karena proses milik pemilik dan sesi lain ikut mati. Jalankan `down` juga sesudah setiap percobaan yang gagal. Container yang tertinggal dari run lama bisa dilihat dengan `docker ps -a --filter label=operations-metta-verify=1`; hapus hanya yang namanya cocok dengan `run.json` yang `stoppedAt`-nya kosong dan prosesnya sudah tidak ada.

## Helpers

- `scripts/verify.ts`: perintah di atas. `bun scripts/verify.ts` tanpa argumen mencetak daftar lengkapnya.
- `scripts/verify/stack.ts`: `up`, `down`, keadaan run, dan `psql`.
- `scripts/verify/browser.ts`: klien CDP, pencari elemen, `fill`, `click`, `waitForText`, screenshot, dan snapshot aksesibilitas.
- `scripts/verify/outpatient.ts`: perjalanan rawat jalan penuh.
- Variabel: `VERIFY_HOME` (lokasi run dan bukti), `VERIFY_RUN` (gerakkan run tertentu, bukan run terakhir dari worktree ini), `CHROME_PATH`.

## Batas yang belum terbukti

Skill ini dibuktikan di laptop Windows dengan Docker Desktop, Git Bash, dan Chrome. Path Chrome untuk macOS dan Linux, pembunuhan pohon proses di luar Windows, dan perilaku `docker port` di Linux belum pernah dijalankan.
