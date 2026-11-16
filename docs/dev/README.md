# Desain kanonik operations-metta

> **Baru bergabung dengan tim?** Mulai dari [panduan onboarding](../onboarding/index.md), bukan dari halaman ini. Halaman di folder ini adalah aturan, bukan orientasi.

Folder ini memuat desain kanonik yang berlaku untuk Core dan semua module di repo ini. Isinya dipindah dari [`docs/dev/` CoreERP](https://github.com/MettaDevs/coreERP/tree/main/docs/dev) pada November 2026 lalu ditulis ulang untuk stack dan susunan repo ini: Bun + Elysia, procedure oRPC, layar SPA TanStack, migration SQL per pemilik, id uuid, dan control plane di repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta).

Urutan kebenarannya:

1. Kode di repo ini.
2. [`AGENTS.md`](../../AGENTS.md).
3. Halaman di folder ini.
4. Kode dan docs CoreERP, sebagai acuan perilaku untuk alur yang belum dipindah.

Kalau halaman di sini berbeda dengan kode atau `AGENTS.md`, halaman inilah yang diperbaiki. Halaman yang fiturnya belum ada di repo ini menyebutnya di awal dan menautkan acuannya di CoreERP. Rujukan desain untuk hal baru adalah Dynamics 365 Finance & Operations dan Business Central di [MS Learn](https://learn.microsoft.com/en-us/dynamics365/).

Nomor berkas dipertahankan dari CoreERP supaya mudah dicocokkan. Nomor yang tidak ada di sini tidak dipindah; alasannya di bagian [Yang tidak dipindah](#yang-tidak-dipindah).

## Peta dokumen

### Arsitektur dan lingkungan

| Dokumen | Isi |
| --- | --- |
| [01-grand-design.md](01-grand-design.md) | Runtime ini dan control plane, lingkungan dan database-nya, SaaS dan on-prem, lapis platform, foundation, dan module |
| [01a-tenant-and-org-hierarchy.md](01a-tenant-and-org-hierarchy.md) | Tenant, legal entity, operating unit, dan hierarchy berversi |
| [03-release-and-on-prem.md](03-release-and-on-prem.md) | Rilis dan on-prem dari sisi runtime: image, migration, operasi worker, perubahan skema dan mundur |
| [05-customization-and-addons.md](05-customization-and-addons.md) | Urutan jawaban untuk kebutuhan khusus pelanggan tanpa fork |
| [08-query-scopes-and-schema.md](08-query-scopes-and-schema.md) | Query per scope tenant, legal entity, dan organisasi; indeks unik parsial |
| [18-module-discovery-and-decision-gate.md](18-module-discovery-and-decision-gate.md) | Gate keputusan sebelum membuat module, master, transaksi, workflow, nomor, atau integrasi |

### Identity, akses, dan sesi

| Dokumen | Isi |
| --- | --- |
| [09-identity-and-access.md](09-identity-and-access.md) | Role pemilik, security role, duty, privilege, data policy scope, workspace |
| [19-transaction-security-chain.md](19-transaction-security-chain.md) | Rantai keamanan satu transaksi dari permission sampai pengguna |
| [32-sso.md](32-sso.md) | SSO dari sisi runtime |
| [36-cache-and-sessions.md](36-cache-and-sessions.md) | Sesi di database atau Valkey, batas tenant dan lingkungan |

### Data bersama dan layanan foundation

| Dokumen | Isi |
| --- | --- |
| [14-number-sequences.md](14-number-sequences.md) | Number sequence pola F&O: reference, scope, reset fiskal, penerbitan di dalam transaksi |
| [15-fiscal-calendars.md](15-fiscal-calendars.md) | Kalender fiskal dan kalender kerja |
| [16-units-of-measure.md](16-units-of-measure.md) | Satuan dan konversi |
| [24-global-address-book.md](24-global-address-book.md) | Buku alamat: party, alamat, kontak, vendor |
| [37-funding-sources.md](37-funding-sources.md) | Sumber dana |

### Belum dipindah, desainnya tetap berlaku

| Dokumen | Isi |
| --- | --- |
| [21-visual-workflow-engine.md](21-visual-workflow-engine.md) | Engine alur dan inbox persetujuan |
| [23-document-rendering.md](23-document-rendering.md) | Dokumen cetak dan laporan lewat mesin template |
| [35-analitik.md](35-analitik.md) | Engine analitik |

### Module, integrasi, dan pengujian

| Dokumen | Isi |
| --- | --- |
| [02-module-standard.md](02-module-standard.md) | Standar module: susunan folder, `module.json` dan katalog, migration, nama tabel, tenant, hapus lunak, Core membaca tabel module |
| [04-api-and-integration.md](04-api-and-integration.md) | Procedure oRPC, module memanggil Core, event dan envelope, kontrak |
| [07-reporting-and-replicas.md](07-reporting-and-replicas.md) | Sumber baca laporan dan konsistensinya |
| [12-external-module-integration.md](12-external-module-integration.md) | Integrasi sistem luar ke module |
| [17-healthcare-finance-subledger.md](17-healthcare-finance-subledger.md) | Healthcare sebagai subledger dan posting ke finance |
| [20-load-and-concurrency-testing.md](20-load-and-concurrency-testing.md) | Gate beban dan kebenaran sebelum module dinyatakan selesai |
| [25-standar-penjaga-dan-pengujian.md](25-standar-penjaga-dan-pengujian.md) | Syarat sebuah penjaga batas boleh dipercaya |
| [28-pelaporan-kesalahan.md](28-pelaporan-kesalahan.md) | Pelaporan kesalahan ke Sentry |
| [33-muatan-halaman-dan-paginasi.md](33-muatan-halaman-dan-paginasi.md) | Muatan halaman SPA: paginasi di server dan bentuk data yang dikirim |
| [34-feed-posting-finance.md](34-feed-posting-finance.md) | Feed posting finance |

## Yang tidak dipindah

| Halaman CoreERP | Alasan |
| --- | --- |
| 06 Worktree target, 26 Modul yang sedang dipindah | Rencana pemisahan repo dan penarikan module lewat subtree di CoreERP. Tidak berlaku di repo ini. |
| 10 Gate fondasi Core | Potret status fondasi CoreERP. Aturan keputusannya sudah ada di `AGENTS.md`. |
| 11 Docker development lokal | Stack Laravel dan Docker CoreERP. Diganti [Menyiapkan lingkungan lokal](../onboarding/setup.md). |
| 13 Mendaftarkan katalog produk | Katalog module di repo ini adalah `modules/<module>/module.json`, dijelaskan di `AGENTS.md`. |
| 22 CI/CD polyrepo | Pemeriksaan yang berlaku ada di `AGENTS.md` dan `.github/workflows/ci.yml`. |
| 27 UI modul di dalam shell | Bentuk Inertia. Layar di repo ini diatur bagian *Layar* `AGENTS.md` dan [`docs/design-system/`](../design-system/index.md). |
| 29 Alur rilis, 30 Registry Harbor, 31 admin.erp | Milik control plane, di repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta). |
| 38 Tahun rencana | Belum ada kode yang memakainya di repo ini. |
| 39 Pindah ke Bun + Elysia | Tetap di [CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md), sebagai catatan keputusan dan angka yang diukur. Angka runtime ada di skill `operations-metta-bun-elysia`. |

## Glosarium

Istilah yang dipakai di halaman-halaman ini dijelaskan di [Glosarium onboarding](../onboarding/glosarium.md).
