# Selamat datang di operations-metta

Halaman ini untuk orang yang baru masuk tim. Tujuannya satu: dalam beberapa hari kamu bisa mengubah sesuatu di repo ini tanpa melanggar aturan yang tidak kelihatan dari kodenya.

## Yang perlu kamu tahu duluan

operations-metta adalah runtime ERP untuk klinik, ditulis dengan Bun + Elysia, dan berjalan sama di SaaS maupun on-prem. Ia tidak berdiri sendiri:

| Repository | Isinya |
| --- | --- |
| `operations-metta` (repo ini) | Core (`src/platform/`, `src/foundation/`), seluruh module bisnis (`modules/<module>/`), pustaka bersama (`packages/`), layar SPA, dan pengguna serta role di dalam tenant. |
| [`control-plane-metta`](https://github.com/MettaDevs/control-plane-metta) | admin.erp: onboarding client, tenant dan lingkungan, entitlement, rilis, dan agen server. Database-nya sendiri; repo ini tidak membacanya. |
| [`coreERP`](https://github.com/MettaDevs/coreERP) | Aplikasi lama (Laravel + Inertia), dibekukan 9 November 2026. Tetap **acuan perilaku** untuk alur yang belum dipindah, tetapi tidak diubah lagi. |

Daftar module yang ada dibaca dari folder `modules/`. Jangan menghafalnya dari halaman mana pun, karena ia bertambah.

Tiga hal yang paling sering bikin kaget orang baru:

**Satu module tidak boleh menyentuh data module lain.** Semua module memakai database lingkungan yang sama, dan PostgreSQL tidak akan menolak `JOIN` ke tabel sebelah. Yang menjaga batasnya awalan nama tabel, `bun run check:boundaries`, dan review. Arahnya tidak simetris: **Core boleh membaca tabel module** (untuk laporan dan analitik) dengan syarat di [Ownership dan data](../dev/02-module-standard.md#ownership-dan-data), karena pelanggan bisa membeli satu module saja dan Core selalu ada.

**Kode di repo ini mengalahkan dokumen.** Dokumen di `docs/dev/` dipindah dari CoreERP dan diadaptasi. Kalau sebuah kalimat di sana berbeda dengan `AGENTS.md` atau kodenya, yang benar `AGENTS.md` dan kodenya, lalu dokumennya diperbaiki lewat PR.

**Banyak fitur masih dalam pemindahan.** Halaman yang fiturnya belum ada di repo ini menyebutnya di awal ("belum dipindah") dan menautkan acuan di CoreERP. Jangan menulis kode seolah-olah fondasinya sudah ada.

## Jalur baca

**Hari pertama** — [Hari pertama](hari-pertama.md) → [Menyiapkan lingkungan lokal](setup.md) → [Glosarium](glosarium.md) → [`AGENTS.md`](../../AGENTS.md)

**Minggu pertama** — [Grand design](../dev/01-grand-design.md) → [Tiga kebenaran lifecycle](tiga-kebenaran.md) → [Alur end-to-end](alur-end-to-end.md) → [Peta kode ke dokumen](peta-kode.md) → [Cara berkontribusi](kontribusi.md) → [Definition of done](definition-of-done.md)

**Saat dibutuhkan** — sisanya di [indeks desain kanonik](../dev/README.md), dibuka sesuai tugas. Untuk layar, buka juga [`docs/design-system/`](../design-system/index.md).

Kalau kamu ditugaskan ke module tertentu, baca `modules/<module>/README.md`-nya. Kalau akan membuat module, master, transaksi, workflow, atau integrasi baru, mulai dari [Gate penemuan dan keputusan](../dev/18-module-discovery-and-decision-gate.md), bukan dari menyalin folder module yang sudah jadi.

## Tiga hal yang paling sering disalahpahami

**1. Tenant bukan organization.** Tenant adalah pemegang kontrak dan batas isolasi data tertinggi. Organization (legal entity, operating unit) adalah identitas bisnis di dalamnya. Lihat [Glosarium](glosarium.md) dan [Tenant dan hierarki organisasi](../dev/01a-tenant-and-org-hierarchy.md).

**2. "Terpasang" bukan satu status.** Katalog, entitlement, dan pemasangan module adalah tiga fakta terpisah dengan sumber masing-masing. Lihat [Tiga kebenaran lifecycle](tiga-kebenaran.md).

**3. Lingkungan bukan tenant.** Satu tenant bisa punya lingkungan produksi, demo, dan sandbox, masing-masing di database sendiri dan di alamat sendiri (`<tenant>.<domain>`, `<tenant>.demo.<domain>`). Lihat [Grand design](../dev/01-grand-design.md).

## Kalau ada yang tidak jelas

Dokumentasi ini masih tumbuh. Lubang di dokumen adalah bug dokumen: perbaiki lewat PR. Kalau yang tidak jelas adalah keputusan produk, tanyakan ke pemilik produk dan berhenti dulu sampai jelas, jangan menebak. Lihat [Cara berkontribusi](kontribusi.md).
