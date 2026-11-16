# Standar module

Module adalah unit yang bisa dibeli dan dipasang sendiri oleh pelanggan, baik ERP maupun layanan kesehatan. Satu module adalah satu folder di `modules/<module>/`. Ia berjalan di proses yang sama dengan Core dan memakai database lingkungan yang sama. Module tidak punya container, database, proses, atau token layanan sendiri.

Aturan dasarnya ada di `AGENTS.md`, bagian **Susunan repo** dan **Aturan module**. Halaman ini menjelaskan cara menerapkannya beserta alasannya. Bila halaman ini berbeda dengan `AGENTS.md` atau kode, yang benar adalah `AGENTS.md` dan kode, lalu halaman ini yang diperbaiki.

Acuan perilaku untuk bagian yang belum dipindah adalah [standar module CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md).

## Susunan folder module

```text
modules/<module>/
├─ package.json                 # package Bun workspace bernama @operations-metta/<module>
├─ module.json                  # hanya untuk module yang boleh dijual; lihat Katalog
├─ README.md                    # aturan yang ditegakkan module, ditulis untuk developer
├─ src/
│  ├─ index.ts                  # pintu publik: route dan pendaftaran handler event
│  ├─ module.ts                 # id module dan konteks kerjanya
│  └─ <area>/<fitur>/           # .schema.ts, .service.ts, .routes.ts, .page.tsx, ...
├─ database/migrations/         # NNNN_<nama>.sql milik module ini saja
└─ test/<area>/<fitur>/         # susunannya sama dengan src/
```

Contoh yang sudah berjalan: `modules/pharmacy/` dan `modules/healthcare/`.

Yang tidak boleh ada di folder module, beserta alasannya:

- `Dockerfile`, berkas compose, `.env`, atau server sendiri. Module bukan proses yang di-deploy. Proses yang di-deploy hanya berkas di akar `src/`.
- Berkas alur CI. GitHub hanya menjalankan `.github/workflows/` di akar repo, jadi berkas alur di dalam module terlihat seperti pemeriksaan padahal tidak pernah dijalankan siapa pun.
- Migration yang membuat atau mengubah tabel milik Core. Module yang membuat ulang tabel Core berhasil di database kosong dan gagal di lingkungan yang tabelnya sudah ada.

### Package dan dua berkas di akar `src/`

Setiap module adalah satu package Bun workspace. `package.json` cukup berisi nama `@operations-metta/<module>`, `private: true`, dan `type: module`.

- `src/module.ts` memegang `moduleId`, yaitu kode app module itu. Route, izin, menu, dan reference nomor diturunkan darinya. Berkas ini juga memegang `moduleWorkspace(context, body)`, yang memeriksa CSRF lalu membuka konteks kerja lewat `Workspace.resolve` dari `src/platform/access/`.
- `src/index.ts` adalah satu-satunya pintu publik module. Ia meng-export fungsi yang mengumpulkan route semua fitur, misalnya `pharmacyRoutes()`, dan fungsi pendaftaran handler, misalnya `registerPharmacyEventHandlers()`.

Core meng-import module hanya dari berkas proses di akar `src/`. `src/main.ts` memasukkan route module ke `router`, lalu `src/main.ts` dan `src/worker.ts` memanggil fungsi pendaftaran handler-nya. Proses yang tidak memanggilnya tidak mengantar event ke module itu.

Module meng-import Core hanya lewat `@core/<lapis>/<kemampuan>/index.ts`, misalnya `@core/platform/events/index.ts` atau `@core/foundation/billing/index.ts`. Module tidak pernah meng-import module lain.

### Route module

Route ditulis sebagai procedure oRPC di `<fitur>.routes.ts`. Path module berawalan `/api/modules/<moduleId>/v1/`, sedangkan `/api/v1/` milik Core. Dua pemilik pada satu awalan berarti setiap route Core baru harus lebih dulu memeriksa apakah sebuah module sudah memakainya. Contohnya `modules/healthcare/src/service/room/room.routes.ts`.

Route untuk control plane ditulis di `.internal.routes.ts` dan route untuk sistem luar di `.integration.routes.ts`. Keduanya belum punya autentikasi di Core, jadi `new-feature` membuatnya kosong. Rinciannya di [Integrasi sistem eksternal](12-external-module-integration.md).

### Membuat fitur baru

```bash
bun run new-feature <module>/<area>/<fitur>
bun run new-feature <module>/<area>/<fitur> --audience internal
```

Perintah ini membuat `.schema.ts`, `.service.ts`, dan `.routes.ts` di folder fitur, membuat `.test.ts` di folder yang sama di bawah `test/` module, lalu mendaftarkan route-nya di `src/index.ts` module. Ia menolak menimpa berkas yang sudah ada dan menolak folder module yang belum ada.

### Menambah module baru

Belum ada perintah yang membuat module baru. Selain folder di atas, beberapa tempat di luar folder module ikut diubah di pull request yang sama, antara lain:

1. `src/main.ts`, untuk route dan pendaftaran handler. Pendaftaran handler juga ditulis di `src/worker.ts`.
2. Pola awalan tabel di `scripts/check-boundaries.ts`, supaya nama tabel module ditolak di kode Core. Tanpa baris ini, `check:boundaries` tetap hijau untuk Core yang membaca tabel module baru itu.
3. Penamaan awalan dicatat di README module, beserta daftar tabelnya.

Sebelum membuat module, ikuti skill `module-discovery`: cari padanan Dynamics 365, tulis usulan, dan tunggu persetujuan pemilik produk.

## Katalog, entitlement, dan terpasang

Tiga hal ini berbeda dan masing-masing punya sumber kebenaran sendiri:

| Keadaan    | Artinya                                    | Sumber kebenaran                                                                                         |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Katalog    | Produk dikenal                             | `modules/<module>/module.json` untuk control plane, baris `apps` di database lingkungan untuk runtime     |
| Entitlement | Tenant berhak memakai                     | `tenant_app_entitlements`, diisi operasi worker `sync_entitlements` dari control plane                   |
| Terpasang  | Migration module sudah berjalan untuk tenant | Baris `core_module_installations` berstatus `installed`                                                |

### `module.json`

Module yang boleh dijual punya `module.json` berisi `name` dan `description`:

```json
{
    "name": "Farmasi",
    "description": "Antrean resep, penyerahan obat, dan retur obat pasien."
}
```

Worker membaca setiap `module.json` yang module-nya punya migration, lalu melaporkannya ke control plane sebagai katalog module yang dibawa image ini. Kodenya di `src/platform/environment/sync-entitlements.service.ts`. `Dockerfile` menyalin berkas itu ke image bersama migration-nya. Module tanpa `module.json` tetap bisa dipasang `bun run dev:setup`, tetapi tidak tampil di katalog control plane. `modules/asset-management/` saat ini begitu.

Tidak ada langkah pendaftaran rilis per module. Kode module ikut image runtime, jadi versi yang berarti adalah rilis image itu.

### Baris `apps` dan metadata keamanan ditulis migration module

Migration pertama module menulis baris katalognya di database lingkungan: `apps` dengan id, nama, versi, ikon, dan deskripsi, lalu entry point, permission, privilege, duty, dan menu di `apps.navigation`. Nama yang tampil di layar datang dari baris itu, bukan dari kode. Contohnya bagian pertama `modules/pharmacy/database/migrations/0001_prescription_queue.sql`.

Mengubah menu atau metadata keamanan berarti menulis migration baru. Tidak ada manifest `app.yaml` dan tidak ada perintah pendaftaran manifest.

### Memasang dan mencabut

`installModule` di `src/platform/environment/install-module.service.ts` memasang satu module untuk satu tenant:

1. Menjalankan migration module di database lingkungan, bersama module lain yang sudah terpasang.
2. Di satu transaksi: menulis entitlement aktif bila belum ada, menulis `core_module_installations` berstatus `installed`, memberi role pemilik tenant semua duty module itu, lalu menjalankan ulang data bawaan per organisasi lewat `replayOrganizationsCreated`.

Semua langkahnya aman diulang. Pemanggilnya `bun run dev:setup` dan operasi `sync_entitlements`. Operasi itu memasang module yang dihak, lalu mencabut hak yang tidak lagi diberikan dengan mengubah status entitlement menjadi `revoked`. Tabel module dan isinya tidak disentuh, jadi hak yang diberikan lagi menampilkan data lamanya.

Yang membaca status `installed`, antara lain:

- Shell, untuk katalog aplikasi di rail, di `src/platform/access/shell.routes.ts`. Module yang dihak tetapi belum terpasang tampil nonaktif.
- `publishEvent`, yang hanya menjalankan handler module yang terpasang untuk tenant itu.

Dua hal yang sering disimpulkan terbalik:

- **Entitlement bukan pemasangan.** Layar berlabel "terpasang" membaca `core_module_installations`, bukan entitlement.
- **Pemasangan bukan izin.** Hak datang dari rantai role, duty, privilege, dan permission. Module yang terpasang tidak memberi siapa pun hak apa pun, kecuali duty yang sengaja diberikan ke role pemilik saat dipasang.

Belum ada operasi menonaktifkan atau melepas module di repo ini. Dependency antar module juga tidak ada, karena module tidak bergantung pada module lain.

## Empat lapis keamanan

Migration module menulis keempat lapis secara terpisah, mengikuti [role-based security Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/role-based-security):

| Lapis       | Arti                                                         | Tabel                                             | Bentuk kode                   |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------- | ----------------------------- |
| Entry point | Yang dilindungi: form, menu item, API, report, atau action   | `app_entry_points`                                | `<module>.<resource>.<form\|api>` |
| Permission  | Pasangan entry point dan access level                        | `permissions`                                     | `<module>.<resource>.<aksi>`  |
| Privilege   | Satu tugas, kumpulan permission                              | `security_privileges`, `security_privilege_permissions` | `<module>.<resource>.<tugas>` |
| Duty        | Bagian proses bisnis, kumpulan privilege                     | `security_duties`, `security_duty_privileges`     | `<module>.<area>.<proses>`    |

Access level mengikuti Dynamics 365: `read`, `update`, `create`, `correct`, `delete`, dan `invoke`. Penghapusan lunak tetap memakai `delete`.

Kode privilege tidak boleh sama dengan kode permission. Tanpa aturan ini satu kode dipakai di dua lapis, dan rantai duty ke permission berubah menjadi satu lapis yang ditulis tiga kali. Belum ada pemeriksaan otomatis untuk aturan ini, jadi ia dijaga peninjau.

Route memeriksa izinnya lewat `workspace.guard(resource, action)`, yang menolak dengan 403 bila permission `<moduleId>.<resource>.<action>` tidak dipegang anggota. Security role, penugasan role ke anggota, dan batas organisasinya dibuat di tenant, bukan di migration module. Rantai lengkapnya di [rantai keamanan modul transaksi CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/19-transaction-security-chain.md).

## Ownership dan data

**Sebuah module tidak membaca atau menulis tabel milik module lain.** Fakta yang perlu diketahui module lain dikirim sebagai event, dan module penerima mencatatnya di tabelnya sendiri. Contohnya resep dari layanan kesehatan ke farmasi lewat `healthcare.prescription.issued.v1`.

Batas ini ditegakkan pemeriksaan otomatis dan peninjauan, bukan mesin database. PostgreSQL menjalankan `JOIN` lintas module tanpa keberatan. Jangan menulis bahwa database menjaganya, karena pembaca berikutnya akan menganggap query lintas module pasti ditolak.

`bun run check:boundaries` antara lain menolak impor dari module ke module lain dan nama tabel module di kode Core. Daftar lengkapnya di `AGENTS.md` dan `scripts/check-boundaries.ts`. Teks SQL di dalam module tidak diperiksa, jadi module yang menulis nama tabel module lain di query-nya tidak ditolak mesin. Peninjau yang menangkapnya.

**Arah sebaliknya berbeda: Core boleh membaca tabel module secara langsung**, misalnya untuk laporan dan analitik. Ini keputusan pemilik produk pada 3 Oktober 2026. Alasannya pelanggan bisa membeli satu module saja. Module yang membaca module lain tidak dapat dipasang sendirian, sedangkan Core ada di setiap pemasangan. Syaratnya empat:

- **Nama tabel dan kolom datang dari yang didaftarkan module**, tidak ditulis mati di kode Core. Module bisa tidak terpasang, dan repo ini melarang nama module ditulis mati.
- **Tenant disaring dan kebijakan data module diterapkan**, lewat kolom yang dinyatakan module untuk kebijakan itu. Core tidak menebak kolom mana yang berarti legal entity atau unit kerja.
- **Bacaan yang menggabungkan beberapa module hanya ditawarkan bila semuanya terpasang** untuk tenant itu.
- **Core hanya membaca.** Menulis tetap lewat module pemiliknya, karena validasi, nomor, dan posting hidup di sana.

Belum ada kode Core yang membaca tabel module. `check:boundaries` menolak awalan tabel module yang ditulis di `src/`. Itu sejalan dengan syarat pertama: pembaca Core yang pertama mengambil nama tabel dari pendaftaran module, bukan dari teks di kodenya.

Aturan lain yang mengikuti dari satu database bersama:

- **Foreign key dari tabel module hanya menunjuk tabel milik Core**, tidak pernah tabel module lain. Foreign key lintas module membuat dua module tidak bisa dipasang atau dicabut sendiri-sendiri. Farmasi menyimpan id section layanan kesehatan tanpa foreign key, karena section milik module lain.
- **Satu lingkungan memakai satu database.** Module menulis tabelnya lewat koneksi yang sama dengan Core. Lingkungan di database bersama dipisah `tenant_id`.
- **Laporan lintas tenant tidak ada.** Konsolidasi terjadi di dalam satu tenant, lewat legal entity dan operating unit.

### Nama tabel

Nama tabel memakai `snake_case`, bahasa Indonesia, dan menyatakan jenis data, bukan nama layar.

Setiap module memakai awalan nama tabelnya sendiri, lalu `m_` untuk master dan `tr_` untuk transaksi, mengikuti pola legacy sistem lama. Ini keputusan pemilik produk pada 10 November 2026.

| Module             | Awalan                                                              | Contoh                                         |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| `asset-management` | `aset_`                                                             | `aset_m_kondisi_aset`, `aset_tr_mutasi_aset`   |
| `healthcare`       | `sim_`                                                              | `sim_m_pasien`, `sim_tr_registrasi`            |
| `pharmacy`         | `far_`, ditambah nama legacy `bill_farmasi` dan `retur_farmasi`     | `far_m_golongan_obat`, `far_tr_resep`          |

Daftar yang berlaku ada di pola awalan `scripts/check-boundaries.ts` dan di README tiap module, bukan di tabel ini.

- **Awalan dipilih pendek** dan boleh berbeda dari nama folder. Folder `asset-management` memakai `aset_`.
- **Awalan tidak berubah setelah module dipasang di lingkungan sungguhan.** Mengubahnya berarti mengganti nama seluruh tabel lewat migration di setiap database. `healthcare` sempat mengganti `kes_` menjadi `sim_` lewat `0005_table_prefix.sql` sebelum ada lingkungan sungguhan.
- **Awalan tidak boleh saling menelan.** `far_` dan `far_lama_` bukan awalan yang sama, tetapi tabel `far_lama_obat` cocok dengan keduanya.
- **Detail master ikut `m_`, detail transaksi ikut `tr_`.** Module yang lahir di repo ini menamai tabel baris dengan akhiran `_detail`, misalnya `far_tr_resep_detail` dan `sim_tr_resep_detail`. Tabel aset dari baseline CoreERP memakai `_details`.
- **Nama legacy dipertahankan bila memang diambil dari sistem lama**, seperti `bill_farmasi` untuk BILLFarmasi. Nama itu dicatat di README module dan di pola `check-boundaries.ts`.

Nama generik seperti `tbl_aset` atau `aset_data` tidak dipakai. Tabel yang tidak cocok dengan pola di atas diputuskan dulu bersama pemilik produk sebelum migration-nya ditulis.

Setiap tabel tenant membawa `tenant_id`. Data dengan konsekuensi hukum atau akuntansi membawa `legal_entity_id`, dan data operasional membawa `org_unit_id` bila pemiliknya operating unit. Id baru dibuat dengan `Bun.randomUUIDv7()`.

### Penyaringan tenant

Tidak ada lapisan model yang menyaring tenant otomatis. Setiap query atas tabel tenant menulis saringan `tenant_id` sendiri, dengan nilai dari konteks tepercaya:

- Di route, `workspace.tenantId` dari `Workspace`. Tenant ditentukan alamat lingkungan dan keanggotaan pengguna, bukan dari body, query string, atau path kiriman klien.
- Di handler event, `envelope.tenant_id`, karena handler tidak punya sesi.

Penyaringan yang ditulis per query harus benar di setiap tempat, dan satu tempat yang terlewat membocorkan data tenant lain. Yang menahannya antara lain:

- Foreign key gabungan `(tenant_id, <induk>_id)` ke `(tenant_id, id)` induknya, seperti `far_m_golongan_obat_legal_entity_foreign`. Database sendiri menolak induk milik tenant lain.
- Test route yang membuktikan record tenant lain dijawab 404.

### Konteks perusahaan

`Workspace` membawa legal entity dan operating unit aktif, beserta kebijakan data anggota.

- `workspace.require(legalEntityId, orgUnitId)` menolak penulisan tanpa legal entity aktif, ke legal entity lain, atau ke unit di luar batas data anggota.
- `workspace.allows(...)` dan `workspace.filter(...)` dipakai saat membaca.

Scope diputuskan per resource, bukan satu pilihan untuk seluruh module. Master bersama memakai saringan tenant dan izinnya. Resource milik perusahaan menambah legal entity aktif. Resource unit memakai kebijakan data yang disetujui. Detail mengikuti pemiliknya. Konteks perusahaan tidak menambah hak: izin tetap diperiksa. Farmasi, misalnya, belum menyatakan kebijakan data per unit; resep dan setelannya dibatasi legal entity aktif dan izin duty, seperti tertulis di `modules/pharmacy/src/module.ts`.

### Kolom jejak, versi baris, dan log perubahan

Setiap tabel tenant membawa `created_by_user_id`, `updated_by_user_id`, dan `version`, padanan `SystemCreatedBy`, `SystemModifiedBy`, dan `SystemRowVersion` di Business Central. Isinya bukan urusan kode module. Trigger dari baseline Core mengisinya:

| Trigger             | Fungsi                       | Yang dikerjakan                                                                                        |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `stamp_audit_actor` | `coreerp_stamp_audit_actor()` | Mengisi pembuat dan pengubah dari `coreerp.user_id`, yang dipasang `Database.actor` untuk pengguna yang login |
| `bump_row_version`  | `coreerp_bump_row_version()` | Menaikkan `version` pada setiap UPDATE, apa pun jalurnya                                               |
| `log_change`        | `coreerp_log_change()`       | Mencatat perubahan ke `change_log_entries` untuk tabel dan field yang menyala                          |

Tabel baru memasang ketiganya di migration-nya, lalu mendaftarkan tabelnya di `change_log_setup_tables` beserta nama yang tampil di layar. Bentuknya ada di bagian terakhir `modules/pharmacy/database/migrations/0001_prescription_queue.sql`. Layar riwayat perubahan belum dipindah dari CoreERP. Log-nya sudah tertulis, tetapi belum ada route atau layar yang membacanya.

`src/main.ts` mengosongkan pelaku di akhir setiap request lewat `db.actor(null)` sebelum koneksi dikembalikan ke pool. Tanpa itu, request berikutnya di koneksi yang sama tercatat dibuat pengguna dari request sebelumnya.

### Pengaman edit bersamaan

Tanpa versi, dua orang yang membuka record yang sama lalu menyimpan bergantian saling menimpa, dan perubahan orang pertama hilang tanpa pesan. Karena itu setiap endpoint yang mengubah, menghapus, atau mengganti baris anak sebuah record:

1. Membaca versi yang dikirim pemanggil lewat `expectedVersion(request, body)` dari `src/platform/http/`. Sumbernya header `If-Match` berisi ETag `W/"12"` atau field `version` di body. Tanpa keduanya jawabannya 428 `version_required`.
2. Menulis dengan syarat `version = <versi itu>`. Bila tidak ada baris yang berubah, jawabannya 409 `stale_version` dengan pesan untuk pengguna. Contohnya `update` dan `destroy` di `modules/healthcare/src/service/room/room.service.ts`.
3. Endpoint yang hanya mengganti baris anak tetap mengklaim versi induknya, sehingga dua penggantian dengan versi yang sama tidak mungkin sama-sama lolos.

Endpoint baca memulangkan `version` bersama record-nya, dan jawaban simpan memulangkan versi baru. Layar mengirim versi dari data yang terakhir dimuat. Versi baris tidak menggantikan kunci baris: proses berlangkah banyak di satu transaksi tetap memakai `select ... for update`.

### Klasifikasi data per kolom

> **Status di repo ini:** belum dipindah. Acuan perilaku: [klasifikasi data per kolom di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#klasifikasi-data-per-kolom).

Aturannya tetap: setiap tabel tenant menyatakan jenis data yang disimpannya, padanan `DataClassification` di Business Central. Kolom berisi data pribadi, misalnya nama orang, NIK, kontak, alamat, dan catatan medis, wajib ditandai sebagai data pribadi. Di CoreERP penandanya atribut model PHP, dan repo ini belum punya padanannya. Satu-satunya jejaknya hari ini kolom `document_attachments.data_class`.

### Retensi data log

> **Status di repo ini:** belum dipindah. Acuan perilaku: [retensi data log di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#retensi-data-log).

Aturannya tetap: log dan berkas teknis yang tumbuh terus dihapus berdasarkan umur oleh satu layanan Core, dari daftar tabel yang boleh diretensi. Data bisnis tidak pernah didaftarkan dan tidak pernah dihapus fisik.

### Lampiran dokumen

> **Status di repo ini:** sebagian. Tabel `document_attachments` ada di baseline Core, dan penerimaan aset meneruskan lampirannya ke aset hasilnya saat diselesaikan, di `modules/asset-management/src/fixed-asset/asset-receipt/asset-receipt.service.ts`. Route unggah dan unduh milik Core belum dipindah. Acuan perilaku: [lampiran dokumen di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#lampiran-dokumen).

Aturannya tetap. Lampiran semua record disimpan Core di satu tabel, padanan `Document Attachment` di Business Central. Module tidak menyimpan berkas sendiri. Hak atas lampiran mengikuti hak atas record induknya, yang dijawab module pemiliknya. Lampiran baris dokumen menempel ke header dengan nomor barisnya. Lampiran diarsipkan dengan `deleted_at`, tidak pernah dihapus fisik. Komponen layarnya `@operations-metta/ui/attachment`.

### Penghapusan lunak

Tidak ada baris yang dihapus fisik. Menghapus berarti mengisi `deleted_at`, dan baris itu tetap ada di tabelnya. Ini berlaku untuk semua tabel, bukan hanya yang menyimpan data berkonsekuensi hukum.

Alasannya bukan sekadar kehati-hatian. Rekam medis elektronik wajib disimpan paling singkat 25 tahun sejak kunjungan terakhir menurut Permenkes 24/2022. Perintah hapus yang tersedia tetapi "tidak boleh dipakai untuk module tertentu" cepat atau lambat dipakai untuk module yang lupa menyatakan larangannya. Perintah yang tidak ada tidak bisa salah dipakai.

Di layar, tindakan ini bernama **Delete** dengan ikon tempat sampah, sesuai keputusan pemilik produk. Perilakunya tetap penghapusan lunak, dan permission-nya tetap ber-access level `delete`.

#### Indeks unik pada kode bisnis wajib parsial

Indeks unik biasa ikut menghitung baris yang sudah dihapus. Akibatnya kode yang sudah dihapus tidak pernah bisa dipakai lagi, dan pengguna melihat "kode sudah dipakai" untuk kode yang tidak muncul di daftar mana pun.

```sql
CREATE UNIQUE INDEX far_m_golongan_obat_kode_unique
    ON public.far_m_golongan_obat USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);
```

Aturannya: setiap indeks unik yang memuat kolom kode bisnis pada tabel yang memiliki `deleted_at` wajib parsial. Indeks unik pada identitas teknis, seperti `id` atau pasangan `tenant_id` dengan `id`, tetap penuh.

Kolom scope pada indeks mengikuti scope nomornya. Master per tenant memakai `(tenant_id, kode)`. Dokumen bernomor per legal entity memakai `(tenant_id, legal_entity_id, kode)`. Indeks se-tenant untuk nomor per legal entity gagal saat legal entity kedua mendapat nomor yang sama. Rinciannya di skill `number-sequence-design`.

#### Penyaringan ditulis di setiap query

Repo ini tidak punya lapisan model yang menyaring baris terhapus. Setiap query yang membaca tabel ber-`deleted_at` menulis `deleted_at is null` sendiri. Penyaringan yang diulang harus benar di setiap tempat. Tempat yang terlewat memunculkan baris terhapus di satu layar saja, dan itu terbaca sebagai bug data, bukan bug query. Karena itu setiap module punya test yang menghapus satu baris lalu membuktikan baris itu tidak muncul di daftar dan tidak bisa diambil lewat detail.

#### Mencabut module tidak menyentuh data

`sync_entitlements` mencabut hak dengan mengubah status entitlement, dan berhenti di situ. Tidak ada opsi menghapus data dalam bentuk apa pun. Hak yang diberikan lagi mengembalikan datanya seperti sedia kala, sama dengan Business Central yang mencabut ekstensi tanpa menyentuh datanya.

#### `aktif` bukan `deleted_at`

| Kolom        | Arti                                                          | Muncul di daftar   |
| ------------ | ------------------------------------------------------------- | ------------------ |
| `aktif`      | Ada dan sah, tetapi sedang tidak dipakai untuk transaksi baru | Ya, dengan penanda |
| `deleted_at` | Dianggap tidak ada oleh pengguna                              | Tidak              |

Master yang tidak boleh dipakai lagi tetapi masih dirujuk transaksi lama memakai `aktif = false`, bukan `deleted_at`.

#### Data tumbuh selamanya

Karena tidak ada yang dihapus, tabel hanya bertambah. Pemilik module memantau ukuran tabelnya dan melaporkannya bersama hasil load test. Tenant yang berhenti berlangganan tidak diselesaikan penghapusan lunak; jalan keluarnya, berupa ekspor lengkap atau serah terima database, ditulis di kontrak sebelum pelanggan pergi.

## Migration module

Migration ditulis sebagai berkas SQL biasa bernama `NNNN_<nama>.sql`, di `database/migrations/` untuk Core dan di `modules/<module>/database/migrations/` untuk module. `migrate` di `src/platform/migration/` menjalankannya:

- Berkas diurutkan menurut nama, per pemilik. Core berjalan lebih dulu, lalu module, karena migration module boleh bergantung pada Core dan tidak sebaliknya. Migration Core tidak membuat atau merujuk tabel module.
- Setiap berkas berjalan di transaksinya sendiri, didahului `reset all`, lalu dicatat di `schema_migrations` dengan kunci `(owner, name)` dan checksum SHA-256 isinya. `owner` bernilai `core` atau nama folder module, jadi dua module boleh punya nama berkas yang sama.
- **Migration yang sudah berjalan tidak disunting.** Checksum yang berbeda dari catatannya membuat `migrate` berhenti dengan pesan. Perubahan selalu berupa berkas baru.
- Dua proses `migrate` yang berjalan bersamaan saling menunggu di satu kunci advisory.
- `bun run migrate --modules a,b` memigrasi Core dan module yang disebut saja. `--modules ''` hanya Core.

CI menjalankan migration di database kosong, mengulanginya untuk memastikan tidak ada yang berubah, lalu membandingkan skema "semua sekaligus" dengan skema "Core dulu, lalu module". Langkahnya di job `migrations` di `.github/workflows/ci.yml`.

### Data awal: migration, bukan seeder

Repo ini tidak punya seeder untuk data produksi. Data acuan yang harus sampai ke tenant ditulis migration, karena migration juga yang sampai ke lingkungan yang sudah memasang module. Seeder yang ditambahi baris pada versi berikutnya tidak pernah berjalan lagi untuk tenant lama.

Data acuan per tenant atau per legal entity ditulis di migration yang sama dengan tabelnya. Bentuk lengkapnya `far_isi_acuan` di `modules/pharmacy/database/migrations/0001_prescription_queue.sql`:

1. Fungsi pengisi yang hanya mengisi bila legal entity itu belum pernah punya baris sama sekali, termasuk yang sudah dihapus. Pengisian ulang tidak boleh mengembalikan data yang sengaja dihapus pengguna.
2. Trigger pada `core_module_installations` dan `legal_entities`, supaya tenant yang memasang module sesudahnya dan legal entity yang lahir sesudahnya ikut mendapatkannya.
3. Satu pemanggilan untuk tenant yang sudah memasang module saat migration berjalan.

Data bawaan yang dibuat kode TypeScript, misalnya number sequence per legal entity, didaftarkan lewat `onOrganizationCreated` di `src/platform/organization/`. `installModule` menjalankannya ulang untuk organisasi yang sudah ada.

Data contoh untuk laptop ada di `dev/tenants.json` dan diisi `bun run dev:setup` lewat API. Ia tidak ikut ke image.

## Kode yang hidup lama di satu proses

Satu proses Bun melayani banyak request dari banyak tenant berturut-turut, dan semua yang ada di level module JavaScript tetap hidup di antara request. Yang tetap hidup antara lain variabel di level berkas, daftar handler yang didaftarkan saat start, pool koneksi, dan setelan sesi PostgreSQL di koneksi yang dipakai ulang.

- Data milik request, pengguna, atau tenant tidak disimpan di variabel level berkas. Ia dibawa lewat `context` dan argumen fungsi. Service menerima nilai yang ia butuhkan, misalnya `db` dan `workspace`, bukan seluruh context request.
- Cache di level berkas hanya sah bila isinya sama untuk semua tenant dan jumlahnya berbatas. Bila isinya bergantung pada database, kuncinya menyebut database itu, karena satu proses melayani banyak database lingkungan.
- Setelan sesi PostgreSQL yang dipasang dengan `set_config(..., false)` menempel di koneksi. Ia wajib dilepas sebelum koneksi dikembalikan, seperti `db.actor(null)`. Setelan sesi baru ikut dilepas di tempat yang sama.

Angka runtime, ukuran pool, dan aturan prepared statement ada di skill `operations-metta-bun-elysia`.

## Master bersama dan module yang berdiri sendiri

Pelanggan yang membeli satu module mendapat seluruh kemampuan module itu tanpa dipaksa membeli module lain demi sebuah master.

- **Master yang dipakai lebih dari satu module hidup di Core**, di `src/foundation/<layanan>/` atau `src/platform/<kemampuan>/`, bukan di module yang pertama memintanya. Contohnya barang persediaan di `src/foundation/inventory/` dan buku alamat di `src/platform/address-book/`.
- **Satu master, satu halaman.** Kolom yang hanya dibutuhkan satu module disimpan di tabel module itu dengan id master sebagai kuncinya, padanan `tableextension` di Business Central. `far_m_obat` dan `sim_m_obat` sama-sama memperluas barang Core `gd_m_barang` dengan id yang sama.
- **Module hanya bergantung ke bawah.** Kerja sama dua module dibangun lewat event, dan module pertama tetap utuh tanpa module kedua. Core juga menyediakan titik perluasan yang didaftarkan module, misalnya `onBeforePayment` dan `onPaymentHolds` dari `src/foundation/billing/`, yang dipakai farmasi supaya kasir menunggu resep yang belum disiapkan.
- **Data sharing antar legal entity milik Core** di `src/platform/data-sharing/`. Module mendaftarkan jenis datanya di `data_sharing_types` lewat migration dan membaca hasilnya lewat `sharedLegalEntities`.

## Bantuan kontekstual pada halaman dan field

UI mengikuti pola **field description** Dynamics 365: setiap field boleh punya help text, tetapi bantuan hanya ditulis untuk field yang rumit atau pemakaiannya tidak langsung jelas. Lihat [View and export field descriptions](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/get-started/view-export-field-descriptions).

- Judul page, card, dan dialog cukup menyatakan konteksnya. Deskripsi atau ikon bantuan di header bukan bawaan. Pakai hanya bila ada aturan yang berlaku untuk seluruh permukaan.
- Detail yang berlaku untuk satu field melekat pada field itu. Jelaskan arti bisnis, nilai yang diharapkan, batasan, ketergantungan, atau dampak pengisiannya dalam bahasa sehari-hari.
- Field yang sudah jelas tidak diberi help text. Jangan menyalin kalimat yang sama ke header dan setiap field.
- Hover sekitar satu detik menampilkan bantuan sementara, dan bantuan hilang saat cursor berpindah. Klik label atau judul field menampilkan bantuan yang tetap terbuka walau cursor pergi, dan klik berikutnya menutupnya. Fokus dan keyboard dapat melakukan toggle yang sama.
- Syarat wajib, validasi, dan error tetap terlihat. Ia tidak boleh disembunyikan di bantuan hover.

Standar ini mengatur isi dan perilaku, bukan nama prop atau bentuk ikon. Implementasinya hari ini `FormControl` dengan prop `hint` dan `ContextualTitle` di `@operations-metta/ui`, dengan kontrak perilakunya di `docs/design-system/components/FormControl/` dan `docs/design-system/components/ContextualTitle/`.

## Membuat banyak baris sekaligus

Sebelum membuat layar pembuatan data, jawab dulu: dalam satu kunjungan, berapa banyak yang biasanya dibuat pengguna, dan seberapa banyak detail per satuannya?

| Yang biasa dibuat | Detail per satuan              | Bentuk                                       |
| ----------------- | ------------------------------ | -------------------------------------------- |
| Banyak            | Ringkas dan seragam            | Tabel: satu baris satu data, sel diisi langsung |
| Satu              | Ringkas                        | Card                                         |
| Banyak            | Bercabang, banyak detail kecil | Card                                         |
| Satu              | Bercabang                      | Card                                         |

Tabel hanya dipakai bila kedua syarat terpenuhi. Detail yang tidak muat dalam sel dipindah ke dialog lapis kedua, bukan dibuang. Endpoint menerima bentuk jamak dalam satu request dan satu transaksi. Acuannya pola _Edit List_ Business Central.

## Layar module

Aturan layar ada di `AGENTS.md`, bagian **Layar**, di skill `operations-metta-page-standard` dan `operations-metta-ui`, dan di `docs/design-system/`. Yang khusus module:

- Halaman module adalah `.page.tsx` di folder fiturnya, dengan path `/<module>/<folder>/...`.
- Menu module ditulis migration ke `apps.navigation`, dengan permission `read` di setiap entri. Grup rail sama dengan folder area di `src/`, dan grup pertama selalu dashboard module di `modules/<module>/src/dashboard/`.
- Muatan halaman dan paginasi mengikuti [Muatan halaman dan paginasi](33-muatan-halaman-dan-paginasi.md).

## Lihat juga

- [API, event, dan integrasi module](04-api-and-integration.md)
- [Penjaga dan pengujian](25-standar-penjaga-dan-pengujian.md)
- [Load dan concurrency testing](20-load-and-concurrency-testing.md)
- [Tiga kebenaran lifecycle](../onboarding/tiga-kebenaran.md)
- [Gate penemuan dan keputusan di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/18-module-discovery-and-decision-gate.md)
