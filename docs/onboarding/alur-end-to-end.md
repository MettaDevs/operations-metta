# Alur end-to-end: dari client baru sampai module siap dipakai

Satu alur yang ditelusuri sampai ke kode. Kalau kamu paham yang satu ini, sebagian besar arsitektur repo ini akan masuk akal.

Skenarionya: operator membuat client baru di admin.erp, menyiapkan lingkungan produksinya, lalu memberi hak dua module. Di CoreERP titik masuknya `RegisterBusiness` yang menulis semuanya dalam satu aplikasi. Di sini pekerjaannya terbelah dua: control plane memutuskan, runtime ini mengerjakan di database.

## 0. Di control plane: keputusan, bukan data ERP

Client, tenant, lingkungan, dan hak module diputuskan di [control-plane-metta](https://github.com/MettaDevs/control-plane-metta), di database miliknya sendiri. Id tenant dan client dibuat di sana. Repo ini tidak membaca database pusat; ia menerima **operasi**.

## 1. Worker menarik operasi

`src/worker.ts` (di image: `bun dist/worker.js`) menarik operasi lingkungan dari control plane lewat API worker yang ditandatangani (`src/platform/control-plane/`), lalu menjalankannya satu per satu lewat `runOperation` di `src/platform/environment/worker.service.ts`. Setiap langkah dilaporkan **sebelum** dijalankan, sehingga control plane bisa memperpanjang tenggatnya, dan worker berhenti di antara langkah bila operasinya tidak lagi ia pegang. Kegagalan ditutup `failed` beserta sebabnya.

Daftar operasi yang dikenal ada di `knownOperations` dalam berkas itu. `switch`-nya memakai pemeriksaan `never`, jadi operasi baru yang belum ditangani gagal saat typecheck.

## 2. `provision`: database, tenant, admin pertama

`provisionEnvironment` (`src/platform/environment/provision.service.ts`) berjalan dalam empat langkah bernama:

1. **`create-database`** — membuat database lingkungan. Nama database runtime atau database sistem PostgreSQL ditolak (`assertEnvironmentDatabase`).
2. **`migrate`** — memigrasi **Core saja** di database itu (`migrate(sql, source, { modules: [] })`). Module belum ikut.
3. **`bootstrap-tenant`** — dalam satu transaksi: client, tenant, presisi mata uang lokal, admin pertama, membership, role pemilik (`is_owner`) dengan semua duty Core, dan role assignment-nya.
4. **`record-route`** — mencatat alamat lingkungan di `environment_routes` pada database runtime.

Dua hal yang layak diperhatikan:

**Alamat dicatat terakhir.** Runtime memilih database lingkungan dari alamat request. Kalau alamat dicatat lebih dulu, ada saat di mana alamat itu menunjuk lingkungan setengah jadi. Dengan urutan ini, alamat yang bisa dibuka selalu menunjuk tenant yang lengkap.

**Aman diulang.** Database yang sudah ada dilewati (`42P04`), tenant yang sudah ada berarti transaksi pernah selesai sehingga tidak ada yang ditulis lagi, dan id datang dari control plane sehingga percobaan ulang menemukan tenant yang sama. Worker yang mati di tengah jalan cukup diulang.

Tenant bukan organization. Legal entity dan operating unit dibuat sesudahnya, di dalam tenant, oleh admin klinik di Sys Admin. Kalau pembedaan ini terasa berlebihan, baca [Tenant dan hierarki organisasi](../dev/01a-tenant-and-org-hierarchy.md).

## 3. Sampai sini, apa yang sudah nyata?

| Fakta | Status |
| --- | --- |
| Tenant dan admin pertama | ada, admin bisa login di alamat lingkungannya |
| Module catalogued | dikenal control plane dari laporan katalog worker |
| Module entitled | belum |
| Module installed | belum |

Kalau layar menampilkan module "terpasang" pada titik ini, itu bohong.

## 4. `sync_entitlements`: hak lalu pemasangan

Control plane mengirim seluruh hak module tenant yang masih hidup. `syncEntitlements` (`src/platform/environment/sync-entitlements.service.ts`):

- menolak seluruh operasi bila ada module yang tidak dibawa rilis host ini;
- untuk setiap module: mengaktifkan hak yang sudah ada atau, bila belum ada yang berlaku, memanggil `installModule`;
- terakhir mencabut (`revoked`) hak module yang tidak ada di daftar. Tabel dan isinya tidak disentuh.

`installModule` menjalankan migration module, lalu dalam satu transaksi mencatat entitlement, `core_module_installations`, duty module untuk role pemilik, dan data bawaan per organisasi yang sudah ada. Rinciannya di [Tiga kebenaran lifecycle](tiga-kebenaran.md).

## 5. Pengguna membuka layar

Peramban membuka `https://<tenant>.<BASE_DOMAIN>/`. Runtime membaca `environment_routes` untuk memilih database lingkungan dan membatasi workspace ke tenant pemilik alamat; alamat yang tidak tercatat dijawab 404. Server mengirim dokumen SPA yang sama untuk setiap URL layar, lalu layar mengambil datanya sendiri dari `/api/`. Data bersama Shell (pengguna, workspace, menu, katalog aplikasi) datang dari `GET /api/v1/shell`, yang membaca entitlement dan catatan pemasangan untuk memutuskan module mana yang dibuka. Rinciannya di bagian *Layar* `AGENTS.md`.

## Yang bisa kamu bawa dari alur ini

1. Fakta lifecycle tidak disimpulkan dari fakta sebelumnya; masing-masing dibaca dari sumbernya.
2. Setiap langkah yang dijalankan dari luar aman diulang, karena worker bisa mati di mana saja.
3. Yang membuat sesuatu terlihat (alamat, tanda terpasang) ditulis paling akhir.
4. Control plane memutuskan, runtime ini menulis data ERP. Tidak ada yang membaca database pihak lain.
5. Duty Core didaftarkan migration Core dan duty module didaftarkan migration module, bukan ditulis di kode penyiapan.

## Lihat juga

- [Tiga kebenaran lifecycle](tiga-kebenaran.md)
- [Grand design](../dev/01-grand-design.md)
- [Release dan on-prem dari sisi runtime](../dev/03-release-and-on-prem.md)
- [Identity dan access](../dev/09-identity-and-access.md)
- [Peta kode ke dokumen](peta-kode.md)
