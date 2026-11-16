# Peta kode ke dokumen

Ketemu berkas tapi tidak tahu aturannya, atau baca dokumen tapi tidak tahu kodenya di mana. Halaman ini jembatannya. Semua path relatif terhadap akar repo.

Tabel lengkap tempat setiap jenis berkas ada di [`AGENTS.md`, bagian Susunan repo](../../AGENTS.md#susunan-repo). Halaman ini tidak menyalinnya; ia menjelaskan cara membacanya.

## Susunan kode

Kode tidak dikelompokkan per jenis teknis (`models/`, `controllers/`), tetapi per **lapis**, lalu per **area dan fitur**. Polanya meniru Business Central: System Application, Business Foundation, lalu aplikasi bisnis.

| Lapis | Tempat | Isinya |
| --- | --- | --- |
| Platform | `src/platform/<kemampuan>/` | Yang dipakai setiap request: identity, access, environment, organization, address-book, geography, data-sharing, events, migration, shell, dan seterusnya |
| Foundation | `src/foundation/<layanan>/` | Layanan bisnis bersama lintas module: number-sequence, calendar, currency, inventory, purchasing, pricing, billing, finance-posting |
| Module | `modules/<module>/` | Aplikasi bisnis yang dibeli tersendiri, satu package Bun workspace |
| Package | `packages/<package>/` | Pustaka tanpa proses, misalnya `@operations-metta/ui` |

Daftar kemampuan, layanan, dan module yang berlaku adalah isi folder-folder itu sendiri.

### Pintu publik

`index.ts` adalah satu-satunya pintu publik folder kemampuan atau layanan, setara pasangan `Email` dan `Email Impl` di BC. Kode di luar folder itu hanya meng-import `index.ts`-nya; module meng-import Core lewat `@core/...`. Berkas di dalam satu folder boleh saling meng-import langsung. Module tidak pernah meng-import module lain, dan Core meng-import module hanya dari berkas proses di akar `src/`.

### Isi satu fitur

```
modules/<module>/src/<area>/<fitur>/
  <fitur>.schema.ts              bentuk baris dan input (zod), satu-satunya sumber tipe
  <fitur>.service.ts             aturan bisnis; menerima nilai yang ia butuhkan (db, workspace), bukan seluruh request
  <fitur>.routes.ts              procedure oRPC untuk pengguna klinik
  <fitur>.internal.routes.ts     procedure untuk control plane
  <fitur>.integration.routes.ts  procedure untuk sistem luar
  <fitur>.posting.ts             posting ke ledger atau finance
  <fitur>.page.tsx               layar (definePage)
modules/<module>/test/<area>/<fitur>/<fitur>.test.ts
```

Berkas yang tidak dibutuhkan sebuah fitur memang tidak ada. Peran berkas lain boleh ditambahkan bila perlu (misalnya `asset.code.ts`). Berkas milik satu pemanggil tidak meng-import berkas milik pemanggil lain; aturan yang dipakai bersama ada di `.service.ts`.

`bun run new-feature <module>/<area>/<fitur>` membuat kerangka itu dan mendaftarkan route-nya di `src/index.ts` module. Jangan menyalin folder fitur lain lalu mengganti namanya: kamu akan membawa aturan bisnis fitur itu tanpa sadar.

### Berkas yang dibuat mesin

`src/client.tsx` dan `src/platform/shell/api-contract.generated.json` ditulis `scripts/generate-client.ts` dan tidak pernah disunting tangan. `src/client.tsx` satu-satunya berkas yang meng-import `.page.tsx` langsung.

### Penjaga arah

`scripts/check-boundaries.ts` (`bun run check:boundaries`) menolak impor yang melanggar arah di atas, nama tabel module di `src/`, test di luar folder test, folder test tanpa pasangan kode, dan package yang meng-import Core atau module. Daftar lengkapnya di `AGENTS.md`. `scripts/check-ui.ts` (`bun run check:ui`) menjaga pola layar. Lihat [Standar penjaga dan pengujian](../dev/25-standar-penjaga-dan-pengujian.md).

## Berdasarkan area

| Area | Kode | Dokumen |
| --- | --- | --- |
| Proses dan HTTP | `src/main.ts`, `src/worker.ts`, `src/migrate.ts`, `src/platform/http/` | [Grand design](../dev/01-grand-design.md), bagian *Layar* `AGENTS.md` |
| Lingkungan, penyiapan, pemasangan module | `src/platform/environment/`, `src/platform/control-plane/`, `src/platform/migration/` | [Release dan on-prem](../dev/03-release-and-on-prem.md), [Tiga kebenaran](tiga-kebenaran.md), [Alur end-to-end](alur-end-to-end.md) |
| Tenant, organisasi, hierarki | `src/platform/organization/` | [Tenant dan hierarki organisasi](../dev/01a-tenant-and-org-hierarchy.md), [Query scope dan schema](../dev/08-query-scopes-and-schema.md) |
| Identity, sesi, SSO | `src/platform/identity/` | [Identity dan access](../dev/09-identity-and-access.md), [SSO](../dev/32-sso.md), [Cache dan sesi](../dev/36-cache-and-sessions.md) |
| Akses, role, menu, workspace | `src/platform/access/` | [Identity dan access](../dev/09-identity-and-access.md), [Rantai keamanan transaksi](../dev/19-transaction-security-chain.md) |
| Buku alamat dan vendor | `src/platform/address-book/`, `src/foundation/purchasing/vendor/` | [Buku alamat](../dev/24-global-address-book.md) |
| Data sharing antar legal entity | `src/platform/data-sharing/` | [Standar module](../dev/02-module-standard.md) |
| Event dan outbox | `src/platform/events/`, `contracts/events/` | [API dan integrasi](../dev/04-api-and-integration.md) |
| Nomor dokumen | `src/foundation/number-sequence/` | [Number sequences](../dev/14-number-sequences.md), skill `number-sequence-design` |
| Kalender kerja | `src/foundation/calendar/` | Komentar di kodenya |
| Persediaan dan satuan | `src/foundation/inventory/` | [Satuan dan konversi](../dev/16-units-of-measure.md) |
| Tagihan, kasir, posting finance | `src/foundation/billing/`, `src/foundation/finance-posting/` | [Healthcare dan finance subledger](../dev/17-healthcare-finance-subledger.md), [Feed posting finance](../dev/34-feed-posting-finance.md) |
| Pelaporan kesalahan | `src/platform/error-reporting/` | [Pelaporan kesalahan](../dev/28-pelaporan-kesalahan.md) |
| Layar dan komponen | `src/platform/shell/`, `packages/ui/`, `*.page.tsx` | [`docs/design-system/`](../design-system/index.md), [Muatan halaman](../dev/33-muatan-halaman-dan-paginasi.md), skill `operations-metta-ui` dan `operations-metta-page-standard` |
| Module bisnis | `modules/<module>/` | `modules/<module>/README.md`, [Standar module](../dev/02-module-standard.md) |
| Kesetaraan dengan CoreERP | `parity/` | `parity/README.md` |

Kalau sebuah tautan di kolom dokumen belum ada atau halamannya menyebut "belum dipindah", fiturnya masih hidup hanya di CoreERP. Acuannya tautan CoreERP di halaman itu.

## Berdasarkan pertanyaan

| Pertanyaan | Mulai dari |
| --- | --- |
| Kenapa layar ini tidak muncul di menu? | `src/platform/access/navigation.ts` (menu Core) atau migration module yang menulis `apps.navigation`, lalu permission pengguna |
| Kenapa module tampil "Belum dipasang"? | `core_module_installations` di database lingkungan, lalu `installModule` |
| Alamat ini membuka database yang mana? | `environment_routes` di database runtime, `src/platform/environment/route.service.ts` |
| Dari mana tenant request ini diambil? | `src/platform/access/workspace.ts` dan pemilihan lingkungan dari alamat |
| Bagaimana nomor dokumen diambil? | `src/foundation/number-sequence/index.ts` |
| Kode CoreERP untuk alur yang belum dipindah? | [repo coreERP](https://github.com/MettaDevs/coreERP) dan [`docs/design-system/`](../design-system/index.md) |

## Aturan yang tidak ada di `docs/`

- `AGENTS.md` di akar repo: aturan kerja yang mengikat semua orang dan agen.
- `.agents/skills/*/SKILL.md`: pengetahuan per bidang (arsitektur, UI, runtime Bun, nomor, docs). Claude Code belum memuat folder ini otomatis; buka `SKILL.md`-nya langsung.
- Komentar di kode, terutama di atas fungsi yang menulis data. Komentar di repo ini menjelaskan *kenapa*, dan sering lebih mutakhir daripada dokumen.

## Lihat juga

- [Indeks desain kanonik](../dev/README.md)
- [Cara berkontribusi](kontribusi.md)
