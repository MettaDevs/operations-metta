# Tenant, organisasi, dan hierarchy

Model organisasi mengikuti pemisahan Microsoft Dynamics 365 F&O antara tenant, identitas organisasi, dan penempatan organisasi dalam hierarchy. Rujukan Microsoft dan alasan pemetaannya ada di [referensi model organisasi Dynamics 365](https://github.com/MettaDevs/coreERP/blob/main/docs/references/dynamics-365-organization-model.md) CoreERP.

Kodenya di `src/platform/organization/`. Skema berasal dari baseline CoreERP (`database/migrations/0001_coreerp_baseline.sql`), dengan perubahan di `0004_organization.sql` dan migration sesudahnya. Layarnya di Sys Admin:

| Layar | URL |
| --- | --- |
| Legal entity | `/sysadmin/organization/legal-entities` |
| Operating unit | `/sysadmin/organization/operating-units` |
| Hierarchy | `/sysadmin/organization/hierarchies` |

Ketiganya dijaga duty yang sama, `core.organization.inquire` untuk melihat dan `core.organization.manage` untuk mengubah. Katalog keamanannya ditulis `0004_organization.sql`.

## Batas yang tidak boleh dicampur

- `tenant_id` adalah batas kontrak dan isolasi data. Tenant bukan organisasi paling atas.
- Organisasi adalah identitas bisnis yang stabil di dalam tenant, disimpan di `organizations`. Ia tidak menyimpan parent atau kedalaman.
- Setiap organisasi punya tepat satu klasifikasi: `legal_entity` atau `operating_unit`. Keduanya punya konsekuensi berbeda.
- Hierarchy adalah satu sudut pandang atas-bawah untuk satu tujuan. Ia bukan identitas organisasi, dan satu organisasi boleh ditempatkan di beberapa hierarchy tanpa diduplikasi.
- Job, position, WBS proyek, gudang, chart of accounts, dan sales territory bukan organization hierarchy.

## Yang disimpan

| Tabel | Isi |
| --- | --- |
| `clients`, `tenants` | Pihak komersial dan tenant di database lingkungan. Ditulis penyiapan lingkungan dengan id dari control plane |
| `organizations` | Identitas: nama, klasifikasi, status |
| `legal_entities` | `company_code`, negara, zona waktu |
| `operating_units` | Tipe unit dan nomor unit |
| `organization_hierarchies`, `organization_hierarchy_purposes` | Hierarchy milik tenant dan tujuannya |
| `hierarchy_purposes` | Katalog tujuan. Tujuan Core diisi `0004_organization.sql`; module boleh menambah tujuannya sendiri lewat migration-nya |
| `organization_hierarchy_versions` | Versi `draft` atau `published`, dengan tanggal berlaku |
| `organization_hierarchy_nodes`, `organization_hierarchy_closures` | Penempatan dalam satu versi, dan pasangan atas-bawah untuk query turunan |

Closure selalu terikat ke satu versi. Kolom `distance` mempercepat query relasi; ia bukan batas kedalaman.

Di CoreERP, melepas organisasi dari draft menghapus baris node dan closure secara fisik. Di repo ini keduanya diberi `deleted_at`, indeks unik node menjadi parsial, dan pasangan atas-bawah yang pernah dilepas dihidupkan lagi saat organisasi yang sama ditempatkan ulang di draft yang sama.

## Aturan legal entity dan operating unit

`organizations.id` adalah identitas yang dipakai relasi, API, event, dan transaksi. Kode yang dibaca orang tidak menggantikannya.

**`company_code`** hanya milik legal entity. Aturannya di `organization.schema.ts`:

- unik per tenant;
- disimpan huruf besar;
- 2 sampai 16 karakter huruf, angka, atau tanda hubung, diawali huruf atau angka;
- bukan nomor registrasi, NPWP, atau nomor pajak.

Di CoreERP kode ini dikunci setelah data finansial pertama tercatat. Penguncian itu belum ada di repo ini, karena posting finance belum dipindah.

**Nomor unit** disimpan di `operating_units.number` dan tampil di layar sebagai "Kode unit". Ia nilai dimensi keuangan, padanan *operating unit number* F&O:

- huruf besar dan angka, dipisah tanda hubung tunggal;
- wajib untuk tipe unit yang tercantum di `numberedUnitTypes`, misalnya business unit dan department, dan opsional untuk tipe lain;
- unik per tenant di antara unit yang punya nomor;
- boleh diganti. Permintaan simpan yang tidak mengirim field ini mempertahankan nomor yang sudah ada.

Zona waktu hanya untuk legal entity, dan server menolaknya bila dikirim untuk operating unit.

Layar menulis "Legal entity" dan "Operating unit" apa adanya, bukan "Perusahaan" atau "Unit operasional". Ini keputusan pemilik produk 11 November 2026; `0018_legal_entity_term.sql` dan `0019_operating_unit_term.sql` mengganti label yang tersimpan di database.

Establishment bukan nilai tipe unit. Di model F&O, establishment adalah operating unit yang ditempatkan di hierarchy bertujuan `establishment`, tepat di bawah satu legal entity. Tujuan itu sudah ada di katalog, tetapi aturan penempatannya belum ditegakkan kode repo ini.

## Lifecycle hierarchy

1. Buat organisasinya lebih dulu.
2. Buat hierarchy dan pilih tujuannya.
3. Susun versi `draft`.
4. Tempatkan organisasi. Server menolak organisasi dari tenant atau versi lain, organisasi yang sudah ada di draft yang sama, dan perubahan pada versi yang sudah `published`.
5. Publikasikan. Hanya draft yang dapat dipublikasikan.
6. Draft baru dibuat dari versi yang sudah dipublikasikan. Versi lama tetap ada untuk transaksi dan laporan historis.

Memindahkan organisasi berarti mengubah draft. Itu tidak mengganti `organizations.id` dan tidak menulis ulang versi yang sudah berlaku. Penyimpanan pada versi mana pun mengunci hierarchy induknya, sehingga dua perubahan dari layar yang dibuka bersamaan tidak sama-sama lolos.

## Organisasi baru dan data bawaan

Saat legal entity atau operating unit lahir, kode yang didaftarkan lewat `onOrganizationCreated` berjalan di transaksi yang sama, misalnya number sequence bawaan per legal entity dan per unit. Pendaftarannya dilakukan berkas proses, supaya Platform tidak meng-import Foundation.

Module yang dipasang belakangan memanggil `replayOrganizationsCreated`, sehingga organisasi yang sudah ada ikut mendapat data bawaan module itu. Karena itu setiap pendengar wajib aman diulang.

## Penyiapan tenant

Tenant lahir dari control plane, tidak pernah dari pendaftaran mandiri di runtime ini. `provisionEnvironment` di `src/platform/environment/` menulis client, tenant, presisi mata uang lokal, admin pertama, keanggotaannya, dan role pemilik dalam satu transaksi.

Penyiapan tidak membuat organisasi apa pun dan tidak meminta jumlah level atau bentuk pohon:

- tenant dengan satu legal entity dapat bekerja tanpa hierarchy;
- cabang, outlet, department, atau business unit dibuat sebagai operating unit bila memang ada;
- hierarchy dibuat ketika laporan, kebijakan, establishment, atau batas akses membutuhkan hubungan atas-bawah;
- tidak ada urutan wajib seperti holding, legal entity, cabang, lalu outlet.

## Konteks transaksi

Data milik tenant selalu menyimpan `tenant_id`. Data dengan konsekuensi hukum atau akuntansi juga menyimpan `legal_entity_id`. Data operasional menyimpan `org_unit_id` bila relevan, dan nilainya menunjuk organisasi berklasifikasi operating unit.

Nilai-nilai itu datang dari `Workspace` di `src/platform/access/`, bukan dari body atau query string.

## Workspace aktif

Pengguna memilih tenant, legal entity, dan operating unit aktif lewat `PUT /api/v1/workspace-context`. Pilihan disimpan di sesi server dan divalidasi ulang di setiap request:

- tenant berasal dari keanggotaan aktif, dan alamat lingkungan membatasinya ke tenant pemilik alamat;
- legal entity dan operating unit harus termasuk organisasi yang terjangkau batas data role pengguna;
- pilihan yang tidak lagi terjangkau diganti organisasi pertama yang terjangkau.

Untuk resource milik legal entity, query biasa memakai tenant aktif **dan** legal entity aktif **dan** kebijakan data resource itu. Ini keputusan pemilik produk 13 Oktober 2026, padanan current company F&O. Hak atas legal entity A dan B memberi hak berpindah ke B; saat bekerja di A, hak itu tidak membuat query biasa menjadi A dan B. Legal entity di body yang berbeda dengan legal entity aktif ditolak. Unit aktif tetap nilai awal dan saringan opsional; pembatasan unit datang dari kebijakan data dan batas pada penugasan role. Bentuk query-nya di [Query scope dan schema](08-query-scopes-and-schema.md).

Legal entity yang saling melihat data tertentu diatur lewat data sharing, bukan lewat hierarchy. Hierarchy tidak otomatis menentukan siapa melihat pasien atau stok siapa. Lihat [Buku alamat](24-global-address-book.md#data-sharing-antar-legal-entity).

## Tenant terpisah atau organisasi?

| Kebutuhan | Model |
| --- | --- |
| Satu grup membeli satu ERP untuk semua anak usahanya | Satu tenant, beberapa legal entity dan operating unit |
| Anak usaha berbadan hukum sendiri tetapi kontrak ERP bersama | Legal entity terpisah dalam tenant yang sama |
| Cabang, outlet, atau department berbagi badan hukum dan buku besar | Operating unit |
| Susunan laporan dan pengadaan berbeda | Dua hierarchy bertujuan berbeda atas organisasi yang sama |
| Anak usaha punya kontrak, admin, tagihan, dan isolasi sendiri | Tenant terpisah |

## Lihat juga

- [Query scope dan schema](08-query-scopes-and-schema.md)
- [Identity dan access](09-identity-and-access.md)
- [Grand design](01-grand-design.md)
- [Glosarium](../onboarding/glosarium.md)
