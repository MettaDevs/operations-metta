# operations-metta

- Repo ini runtime ERP yang dijalankan untuk klinik, di SaaS maupun on-prem, dan ditulis dengan Bun + Elysia. Praktik Dokter direncanakan berjalan di runtime yang sama. Kode Praktik Dokter belum ada di repo ini.
- Onboarding, trial gratis Praktik Dokter, pengelolaan tenant dan lingkungan, rilis, dan agen server milik repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta). Pengelolaan pengguna dan role di dalam tenant tetap milik repo ini.
- **CoreERP tetap acuan perilaku sampai setiap alur selesai dipindah.** Kodenya ada di [repo CoreERP](https://github.com/MettaDevs/coreERP). Keputusan pindah ke Bun + Elysia beserta hasil pengukurannya ada di [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md). Alur layar, permintaan, dan data CoreERP tanpa ikatan framework ada di [`docs/design-system/`](https://github.com/MettaDevs/coreERP/tree/main/docs/design-system). Folder itu potret kode CoreERP pada satu commit. Bila isinya berbeda dengan kode CoreERP, yang benar adalah kodenya.
- Jaga perubahan dan dependency tetap minimal. Jangan membuat abstraksi atau compatibility layer spekulatif. Kalau ada yang membingungkan, tanyakan langsung ke pemilik produk dan berhenti dulu sampai konteksnya jelas.
- SaaS dikelola lewat control plane. On-prem perpetual berdiri sendiri, memakai update bertanda tangan, dan tidak mewajibkan telemetry.

## Susunan repo

- `src/` adalah Core.
  - `src/platform/` berisi bagian yang dipakai setiap request: identitas, sesi, akses, tenant, pool database, dan actor audit.
  - `src/foundation/` berisi layanan bisnis bersama: number sequence, mata uang, dan posting finance.
- `modules/<nama>/` berisi satu package Bun workspace per module. Module pertama adalah `modules/asset-management/`.
- `src/main.ts` adalah satu-satunya berkas Core yang merangkai module ke dalam runtime. Di luar berkas itu, Core tidak pernah meng-import module. `bun run check:boundaries` menolak pelanggarannya.

## Aturan module

Aturan ini dibawa dari bagian [Satu bentuk module](https://github.com/MettaDevs/coreERP/blob/main/AGENTS.md#satu-bentuk-module) di CoreERP dan tidak boleh dilonggarkan dengan alasan apa pun.

- Sebuah module tidak boleh membaca atau menulis tabel milik module lain. PostgreSQL tidak menolak `JOIN` lintas module, jadi jangan mengandalkan database untuk menjaga batas ini.
- Setiap module memakai awalan nama tabelnya sendiri, sama dengan di CoreERP. `asset-management` memakai `aset_`.
- Setiap tabel module membawa `tenant_id`, dan setiap query menyaringnya. Tenant diambil dari konteks tepercaya di `src/platform/`, bukan dari nilai kiriman klien yang belum diperiksa.
- Nama event `module.aggregate.action.vN`, envelope, dan aturan versinya tidak berubah. Event yang sudah terbit tidak diubah di tempat. Menambah atau menghapus field wajib berarti `vN+1`. Bentuk envelope ada di [Kontrak wajib](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/04-api-and-integration.md#kontrak-wajib).
- Core boleh membaca tabel module secara langsung, misalnya untuk laporan dan analitik. Ini keputusan pemilik produk pada 3 Oktober 2026. Bacaan itu wajib memenuhi syarat dari [Ownership dan data](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#ownership-dan-data):
  - Nama tabel dan kolom datang dari yang didaftarkan module, tidak ditulis mati di kode Core.
  - Tenant disaring, dan kebijakan data yang dinyatakan module diterapkan.
  - Bacaan yang menggabungkan beberapa module hanya ditawarkan bila semuanya terpasang untuk tenant itu.
  - Core hanya membaca. Menulis tetap lewat module pemiliknya.
- Katalog, entitlement, dan pemasangan module tidak sama. Katalog berarti produk dikenal, entitlement berarti tenant berhak memakai, dan `installed` hanya sah setelah migration module berhasil dan tercatat di `core_module_installations`. Layar berlabel "terpasang" membaca catatan pemasangan itu, tidak menyimpulkannya dari entitlement.

## Database

- Skema CoreERP adalah titik awal, bukan batas. Keputusan pemilik produk 9 November 2026: perubahan yang membuat skema lebih baik boleh dilakukan, misalnya nama yang lebih jelas, tipe kolom yang lebih tepat, atau index yang lebih berguna. Setiap perubahan:
  - alasannya ditulis di PR-nya;
  - dikerjakan lewat migration, tidak pernah diubah tangan di database;
  - ikut memperbarui harness kesetaraan, termasuk pemetaan nama lama ke nama baru, supaya alur yang sudah pindah tetap terbukti setara;
  - tidak mengubah bentuk respons API yang sudah dipakai. Bentuk baru dirilis sebagai versi API baru.
- Tabel yang ada di CoreERP dan masih dipakai CoreERP: migration-nya ditulis di CoreERP. Setelah areanya selesai pindah, migration-nya pindah ke repo ini.
- Tabel baru yang tidak ada di CoreERP, misalnya tabel Healthcare, sejak awal milik repo ini beserta migration-nya.
- Konfigurasi runtime dan aturan database ditetapkan skill `coreerp-bun-elysia` dan [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md), antara lain jumlah proses Bun, pool koneksi, `idleTimeout`, prepared statement, tipe parameter, tempat sesi, actor audit, dan setelan PostgreSQL yang dilarang. Berkas ini sengaja tidak menyalin angkanya. Baca dari sumbernya.
- Tidak ada baris yang dihapus fisik. Menghapus berarti mengisi `deleted_at`. Indeks unik pada kode bisnis wajib parsial (`WHERE deleted_at IS NULL`), supaya kode yang sudah dihapus bisa dipakai lagi. Rinciannya di [Penghapusan lunak](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#penghapusan-lunak).

## Kode dan nomor dokumen

Keputusan pemilik produk, 4 November 2026. Di CoreERP hampir setiap master diberi kode otomatis. Mulai sekarang kode hanya ada bila memang dipakai orang.

- Mesin number sequence di `src/foundation/number-sequence.ts` tetap seperti di CoreERP: scope, reset fiskal, mode continuous dan non-continuous, dan preallocation.
- Nomor otomatis hanya untuk dua hal: dokumen transaksi (penerimaan, mutasi, penjualan, pemusnahan, work order, dan sejenisnya) dan master utama yang dicari orang lewat kodenya, misalnya aset.
- Master setup kecil, misalnya kondisi aset, tipe lokasi, dan sebab kerusakan, tidak memakai number sequence. Bila orang memang mengetik atau menyaring dengan kode, kodenya pendek dan diketik pengguna, seperti field `Code` di Business Central. Bila tidak, cukup nama dan ID internal.
- Baris dokumen dan entri ledger tidak punya kode bisnis.
- Master memakai mode non-continuous, jadi nomornya boleh bolong. Mode continuous hanya untuk dokumen yang memang diaudit.
- Diputuskan per master saat master itu dipindah. Kolom kode yang tidak lagi diisi otomatis dibuat opsional lewat migration di CoreERP, bersama pencabutan referensi nomornya di manifest, karena skema masih milik CoreERP.

## Kapan sebuah alur dianggap pindah

- Sebuah alur dianggap pindah hanya setelah harness kesetaraan melaporkannya identik dengan CoreERP untuk input yang sama. Harness itu terdiri dari:
  - Golden run, yang membandingkan respons HTTP dan jejak SQL.
  - Conformance, yang antara lain menguji pencabutan akses, rollback, dan throttle.
  - Oracle SQL, yang memeriksa isi database langsung tanpa memakai kode aplikasi.
- Harness itu sekarang ada di [`experiments/stack-comparison/scripts`](https://github.com/MettaDevs/coreERP/tree/codex/native-stack-comparison/experiments/stack-comparison/scripts) pada branch `codex/native-stack-comparison` di CoreERP.
- Sebuah module boleh disebut sudah pindah setelah [pemeriksaan kesetiaan](https://github.com/MettaDevs/coreERP/blob/main/docs/design-system/04-pemeriksaan-kesetiaan.md) terpenuhi seluruhnya, termasuk syarat beban dan kebenarannya.
- Test yang lulus di repo ini belum berarti sebuah alur sudah pindah.

## Kontrak

- Repo ini pemilik endpoint `internal/v1` yang dipanggil control plane. Setiap endpoint, event, dan webhook yang dipakai dari luar runtime wajib punya kontrak.
- Kontrak ditulis tangan, tidak pernah di-generate dari kode.
- REST untuk perintah dan permintaan data. Event untuk fakta yang sudah terjadi. Jangan mengontrakkan panggilan REST sebagai event, atau sebaliknya.
- Kontrak menggambarkan keadaan sebenarnya. Kalau kode belum memenuhi aturan, tulis gap-nya di `info.description`, bukan bentuk ideal yang belum dikirim kode.
- Mengubah kontrak berarti mengubah repo penerbit dan repo pemanggil dalam pekerjaan yang sama.
- Test sisi pemanggil memvalidasi permintaannya terhadap berkas kontrak, bukan terhadap fake berjawaban tetap. Di CoreERP, Core memeriksa `Authorization: Bearer`, konsol mengirim header lain, dan kedua suite tetap hijau.

## Bahasa

- **Nama di dalam kode ditulis bahasa Inggris, tanpa kecuali.** Ini berlaku untuk berkas, folder, fungsi, class, type, variabel, properti, nama route, kunci config, variabel env, nama perintah CLI, dan komponen UI. Contohnya, `siapkanLingkungan` menjadi `provisionEnvironment`.
- Yang tetap bahasa Indonesia, dan ini disengaja: nama tabel, kolom, index, dan constraint database, teks yang dibaca pengguna di layar, alamat URL layar yang diketik operator, komentar, docs, dan pesan commit.
- Kalau sebuah istilah tidak punya padanan Inggris yang jelas, pakai istilah Dynamics 365 untuk hal yang sama. Jangan mengarang terjemahan harfiah.
- Istilah teknis yang sudah baku ditulis apa adanya, misalnya push, pull, scope, token, signing secret, webhook, endpoint, GET, POST, dan PUT. Ini berlaku di layar, pesan, kontrak, dan docs. Tulis "scope `vendors.read`", bukan "cakupan `vendors.read`". Batasnya ada di skill `coreerp-docs` CoreERP, bagian [Where the loanword boundary sits](https://github.com/MettaDevs/coreERP/blob/main/.agents/skills/coreerp-docs/SKILL.md#where-the-loanword-boundary-sits).
- Teks layar untuk pengguna bisnis memakai bahasa sehari-hari yang menjelaskan tindakan atau dampaknya. Istilah internal seperti `tenant_id`, entitlement, atau nama class tidak tampil di layar itu. Pengecualiannya hanya layar yang memang untuk developer atau operator teknis.

## Nama datang dari database

- Jangan menulis mati nama perusahaan, nama orang, atau nama module besar seperti Praktik Dokter di kode. Nama itu datang dari konfigurasi di database. Kalau belum jelas sebuah nama termasuk atau tidak, tanyakan ke pemilik produk.

## Repo ini publik

Siapa pun bisa membaca isi repo ini, termasuk berkas yang sudah dihapus, karena riwayat git menyimpannya.

- Tidak ada secret di repo. Secret hanya disimpan di GitHub Actions secrets.
- Tidak ada data pasien. Fixture dan data uji dibuat sintetis.
- Alamat server, IP, user SSH, dan nama service di server ditulis sebagai contoh, misalnya `server.example.com` dan `203.0.113.10`, bukan nilai sebenarnya.
- Tidak ada self-hosted runner. Pull request dari fork dapat menjalankan kode apa pun di runner semacam itu.
- Workflow deploy hanya berjalan di `main` atau tag, tidak pernah pada event `pull_request`.

## Skill

- Setiap skill ada di `.agents/skills/` dan `.claude/skills/` dengan isi yang sama persis, karena kedua folder dibaca alat yang berbeda. Ubah keduanya dalam commit yang sama.
- `coreerp-bun-elysia` disalin apa adanya dari CoreERP. Path `docs/...` di dalamnya menunjuk ke repo CoreERP. Bila skill itu berubah di CoreERP, salin ulang ke kedua folder di sini.

## Alur kerja

Keputusan pemilik produk, 9 November 2026: setiap perubahan masuk `main` lewat pull request, supaya CI selalu lulus sebelum perubahan sampai di `main`. PR tidak dibuat sebagai draft dan tidak menunggu review.

- Kerjakan di worktree sendiri, lalu jalankan pemeriksaan di bagian [Sebelum menyatakan hijau](#sebelum-menyatakan-hijau).
- Push branch-nya dan langsung buka PR biasa: `gh pr create --base main`. Jangan `--draft`.
- Langsung pasang auto-merge: `gh pr merge --auto --squash`. GitHub me-merge PR itu sendiri begitu check `check` hijau, jadi tidak ada yang perlu menunggu. CI yang merah diperbaiki di branch yang sama.
- Branch `main` dijaga ruleset GitHub: setiap perubahan wajib lewat PR, check `check` wajib lulus, dan force push serta penghapusan `main` ditolak. Push langsung ke `main` ditolak, juga untuk admin.
- **Hotfix.** Admin repo boleh me-merge PR tanpa menunggu CI dengan `gh pr merge --admin --squash`. Jalan ini hanya dipakai bila pemilik produk menyatakan perubahannya hotfix. Tulis "Hotfix" beserta alasannya di judul atau badan PR. Bila CI PR itu ternyata merah, perbaikannya menjadi PR berikutnya sebelum pekerjaan lain dilanjutkan.
- Jangan mematikan ruleset untuk meloloskan perubahan.
- Sebelum menyentuh folder yang mungkin sedang dikerjakan sesi lain, periksa `git worktree list` dan kabari sesi itu lebih dulu.

## Worktree

Keputusan pemilik produk, 9 November 2026: worktree tidak dibuat di folder kerja di luar repo, supaya folder kerja tidak dipenuhi salinan repo yang lupa dihapus.

- Worktree hanya dibuat di `.worktrees/<nama>` di dalam clone ini: `git worktree add .worktrees/<nama> -b <branch> origin/main`. Folder `.worktrees/` sudah di-ignore git.
- Hapus begitu PR-nya di-merge: `git worktree remove .worktrees/<nama>`, lalu `git branch -D <branch>`. Jangan menghapus foldernya dengan `rm -rf`.
- `git worktree list` menampilkan semua worktree yang masih ada. Periksa sebelum memulai pekerjaan baru.
- `bun scripts/prune-worktrees.ts`, dijalankan dari clone utama, menghapus worktree di `.worktrees/` yang commit-nya sudah ada di `main` dan HEAD-nya tidak bergerak 24 jam, atau yang PR-nya sudah di-merge atau ditutup, beserta branch lokalnya. Batas 24 jam melindungi worktree yang baru dibuat dari `main` dan belum diisi. Worktree yang masih punya perubahan belum di-commit atau commit yang belum masuk `main` tidak disentuh. Tambahkan `--dry-run` untuk melihat hasilnya tanpa menghapus apa pun.
- Setiap worktree yang dibiarkan dilaporkan tertinggal berapa commit dari `main` dan sudah berapa hari tidak disentuh, dengan tanda `LAMA` sesudah tujuh hari. Jalankan perintah itu di awal setiap sesi. Worktree `LAMA` diputuskan saat itu juga: selesaikan dan merge PR-nya, gabungkan `main` terbaru ke branch-nya sebelum dilanjutkan, atau tutup PR-nya supaya terhapus pada putaran berikutnya.
- Nama foldernya harus tetap berawalan titik. Prettier mengabaikannya karena tercantum di `.gitignore`, `bun test` tidak masuk ke folder berawalan titik, dan `tsconfig.json` hanya membaca folder yang disebut. Folder tanpa titik akan ikut dijalankan `bun test`.

## Sebelum menyatakan hijau

Jalankan dari akar repo. Keempat pemeriksaan ini wajib lulus untuk setiap perubahan:

```bash
bun run typecheck
bun test
bun run format:check
bun run check:boundaries
```

`bun run build` hanya perlu dijalankan bila perubahan menyentuh hasil build: `package.json`, `bun.lock`, `tsconfig.json`, `Dockerfile`, atau `src/main.ts`. Untuk perubahan lain, lewati saja, karena build memakan waktu dan CI tetap menjalankannya di setiap PR.
