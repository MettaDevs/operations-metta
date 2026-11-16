# Glosarium

Istilah yang dipakai tim ini punya arti spesifik. Beberapa di antaranya mirip tapi tidak sama, dan tertukar sedikit saja bisa menghasilkan schema yang salah. Sebagian besar istilah diambil dari Dynamics 365 (F&O dan Business Central); kalau sebuah istilah tidak punya padanan Inggris yang jelas, kode memakai istilah Dynamics 365, bukan terjemahan harfiah.

## Tenant, lingkungan, dan organisasi

| Istilah | Arti di repo ini |
| --- | --- |
| **Client** | Pemegang kontrak komersial (tabel `clients`). Dibuat control plane. |
| **Tenant** | Batas isolasi data tertinggi, milik satu client (tabel `tenants`). Setiap tabel tenant dan module membawa `tenant_id`. |
| **Lingkungan** | Satu salinan kerja tenant, misalnya produksi, demo, atau sandbox. Masing-masing punya database sendiri dan alamat sendiri, dicatat di `environment_routes`. |
| **Organization** | Identitas bisnis stabil **di dalam** tenant, diklasifikasikan sebagai legal entity atau operating unit. |
| **Legal entity** | Organization dengan konsekuensi hukum, ledger, pajak, dan statutory reporting sendiri. |
| **Operating unit** | Organization untuk tanggung jawab operasional: business unit, department, cost center, atau, di klinik, faskes dan unit layanan. |
| **Organization hierarchy** | Penempatan parent-child organization untuk purpose dan versi tertentu, bukan kedalaman permanen. |
| **Workspace** | Konteks kerja aktif pengguna di layar: tenant dan organisasi yang sedang dipilih (`src/platform/access/workspace.ts`). |

Tiga jebakan:

- **Tenant ≠ organization.** Tenant adalah batas kontrak dan isolasi data. Organization adalah identitas bisnis di dalamnya. Tenant bukan akar pohon organisasi.
- **Parent-child tidak melekat pada organization.** Ia hidup pada node hierarchy berversi. Jangan menyimpan `parent_id` permanen untuk organization Core. Struktur klasifikasi milik domain module (misalnya kelompok → kategori aset) boleh memakai foreign key biasa; itu bukan organization hierarchy.
- **Legal entity bukan sekadar label.** Ia menentukan ledger, pajak, dan pelaporan. Jangan dipakai untuk sekadar mengelompokkan.

Detail: [Tenant dan hierarki organisasi](../dev/01a-tenant-and-org-hierarchy.md), [Query scope dan schema](../dev/08-query-scopes-and-schema.md).

## Core dan module

| Istilah | Arti di repo ini |
| --- | --- |
| **Core** | Isi `src/`: `src/platform/` (dipakai setiap request) dan `src/foundation/` (layanan bisnis bersama). Setara System Application dan Business Foundation di Business Central. |
| **Module** | Unit yang bisa dibeli atau dipasang tersendiri oleh pelanggan, di `modules/<module>/`. Satu package Bun workspace, berjalan di proses yang sama dengan Core, memakai database lingkungan yang sama, dipisah awalan nama tabel. |
| **Area / fitur** | Susunan folder di dalam Core dan module: `<area>/<fitur>/`, mengikuti pola Business Central. Area juga menjadi grup menu di layar. |
| **Package** | Pustaka di `packages/<package>/`, dipakai Core dan module (misalnya `@operations-metta/ui`). Bukan proses dan bukan yang dibeli pelanggan. |
| **Procedure** | Endpoint oRPC, ditulis di `.routes.ts` (pengguna klinik), `.internal.routes.ts` (control plane), atau `.integration.routes.ts` (sistem luar). |
| **Kontrak** | Janji tertulis tangan kepada pemanggil di luar runtime, di `contracts/`. |
| **Harness kesetaraan** | Alat di `parity/` yang membuktikan alur yang dipindah identik dengan CoreERP. Alur mana yang wajib melewatinya ditetapkan `AGENTS.md`, bagian *Kapan sebuah alur dianggap pindah*. |

CoreERP lama memakai kata "app" untuk produk yang bisa dipasang dan menyimpan deklarasinya di `app.yaml`. Di repo ini katanya **module**, dan tidak ada `app.yaml`. Kata `apps` masih hidup sebagai nama tabel katalog (`apps`, `tenant_app_entitlements`) yang dibawa dari skema CoreERP.

## Lifecycle

| Istilah | Arti di repo ini |
| --- | --- |
| **Catalogued** | Module dikenal: ada `modules/<module>/module.json` dan migration-nya, dan worker melaporkannya ke control plane sebagai katalog. Di database lingkungan, migration module menulis barisnya ke `apps`. |
| **Entitled** | Tenant berhak memakai module itu: baris aktif di `tenant_app_entitlements`. Sumbernya control plane, lewat operasi `sync_entitlements`. |
| **Installed** | Migration module berhasil di database lingkungan dan tercatat di `core_module_installations` berstatus `installed`. |

Ketiganya fakta terpisah. Lihat [Tiga kebenaran lifecycle](tiga-kebenaran.md).

## Deployment

| Istilah | Arti di repo ini |
| --- | --- |
| **Control plane** | Peran vendor untuk mengelola tenant, lingkungan, lisensi, rilis, dan operasi SaaS. Dijalankan repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta) (admin.erp). Pengguna klinik tidak memakainya. |
| **Runtime** | Repo ini saat berjalan: `src/main.ts` (HTTP), `src/worker.ts` (worker lingkungan), `src/migrate.ts` (migration). |
| **Worker** | Proses yang menarik operasi lingkungan dari control plane (`provision`, `migrate`, `convert`, `expire`, `restore`, `purge`, dan sinkronisasi) lalu menjalankannya di database host ini. |
| **Database runtime** | Database milik host runtime, berisi antara lain `environment_routes`. Berbeda dari database lingkungan. |
| **Database bersama** | Pilihan paket termurah: lingkungan tanpa database sendiri (`database` kosong), dipisah `tenant_id` di database runtime. Bawaannya database sendiri per lingkungan. |
| **On-prem perpetual** | Pemasangan di server pelanggan dengan module yang dibeli saja, update bertanda tangan, dan tanpa telemetry wajib. |

## Identity dan akses

| Istilah | Arti di repo ini |
| --- | --- |
| **Membership** | Kaitan pengguna dengan tenant (`tenant_memberships`). |
| **Security role** | Kumpulan duty yang diberikan ke membership lewat role assignment. Role pemilik ditandai `is_owner`, bukan oleh namanya. |
| **Duty** | Tanggung jawab bisnis yang berisi privilege. Duty Core didaftarkan migration Core, duty module didaftarkan migration module. |
| **Privilege / permission** | Izin operasi konkret. Kode permission adalah kontrak: role tenant menyimpannya, jadi mengganti kodenya mencabut akses tanpa suara. |
| **Data policy scope** | Pembatas organisasi pada satu role assignment. Kolom `null` berarti tidak dibatasi. |
| **Data sharing** | Legal entity yang saling melihat jenis data tertentu, pola *cross-company data sharing* F&O, milik Core (`src/platform/data-sharing/`). |
| **SoD** | Segregation of Duties: pengaju tidak boleh sekaligus memverifikasi atau menyetujui. |

Detail: [Identity dan access](../dev/09-identity-and-access.md).

## Istilah yang tidak boleh muncul di layar pengguna bisnis

`entitlement`, `artifact`, `deployment registry`, `installation registry`, `TenantContext`, `tenant_id`, nama class, dan istilah arsitektur lain **dilarang** tampil di layar pengguna bisnis, termasuk di hint, label, dialog, empty state, error, dan status. Pakai bahasa sehari-hari yang menjelaskan tindakan atau dampaknya. Pengecualiannya hanya layar yang memang untuk developer atau operator teknis.

Ini bukan larangan memakai istilah teknis yang sudah baku: push, pull, scope, token, signing secret, webhook, endpoint, GET, POST, dan PUT ditulis apa adanya di layar, pesan, kontrak, dan docs. Batasnya ada di skill [`operations-metta-docs`](../../.agents/skills/operations-metta-docs/SKILL.md#where-the-loanword-boundary-sits).

## Lihat juga

- [Indeks desain kanonik](../dev/README.md)
- [Tenant dan hierarki organisasi](../dev/01a-tenant-and-org-hierarchy.md)
- [Identity dan access](../dev/09-identity-and-access.md)
- [Model organisasi Dynamics 365 di MS Learn](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/organizations-organizational-hierarchies), asal banyak istilah di atas
