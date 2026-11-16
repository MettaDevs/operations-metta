# Identity, keamanan berbasis tanggung jawab, dan batas organisasi

Halaman ini menjelaskan siapa pengguna sebuah lingkungan, dari mana haknya datang, dan bagaimana hak itu dibatasi organisasi. Model keamanannya mengikuti role-based security Dynamics 365 F&O. Rujukan Microsoft dirangkum di [referensi model organisasi Dynamics 365](https://github.com/MettaDevs/coreERP/blob/main/docs/references/dynamics-365-organization-model.md) CoreERP.

Kodenya di `src/platform/identity/` untuk login dan sesi, dan `src/platform/access/` untuk keanggotaan, role, dan workspace. Istilah role, duty, privilege, dan permission dijelaskan di [Glosarium](../onboarding/glosarium.md).

## Siapa memiliki apa

| | Pemilik |
| --- | --- |
| Identitas orang: akun SSO, undangan, MFA, operator | [control-plane-metta](https://github.com/MettaDevs/control-plane-metta) dan penyedia SSO |
| Pengguna lingkungan, keanggotaan tenant, role, penugasan, batas data | Repo ini, di database lingkungan |
| Katalog keamanan: entry point, permission, privilege, duty | Migration Core dan migration module |

Id pengguna adalah uuid yang diberikan control plane, termasuk id admin pertama. Pengguna lahir di database lingkungan dari operasi yang dikirim control plane, misalnya:

- operasi `provision`, yang menulis admin pertama beserta kata sandinya;
- operasi `sync_identities`, yang menautkan identitas SSO ke pengguna yang sudah ada atau membuat pengguna baru tanpa kata sandi, dengan keanggotaan aktif tanpa role.

Di laptop, `bun run dev:setup` memakai `provisionEnvironment` yang sama.

Repo ini tidak punya layar membuat pengguna, undangan, atau penyiapan MFA. `Memberships` di `membership.service.ts` hanya mengatur role dan batas data anggota yang sudah ada.

## Masuk

- **Kata sandi.** `POST /login` di `session.ts`. Percobaan dibatasi per email dan alamat IP. Pengguna tanpa kata sandi ditolak dengan pesan yang sama dengan kata sandi salah.
- **SSO.** Alur tiga kaki di [SSO](32-sso.md).
- **MFA bersifat opsional.** Akun tanpa MFA masuk dengan kata sandi saja. Bila akun punya MFA yang sudah dikonfirmasi, login kata sandi menjawab `two_factor: true` dan sesi belum masuk. Langkah memasukkan kode MFA belum dipindah ke repo ini.
- **Ganti kata sandi wajib.** Pengguna yang `must_change_password`-nya terisi ditolak 423 di setiap API sampai menggantinya.

Sesi, cookie, dan CSRF dijelaskan di [Cache dan sesi](36-cache-and-sessions.md).

## Role pemilik

Keanggotaan tidak membawa penanda owner, admin, atau user. Semua hak di dalam tenant datang dari rantai role.

Setiap tenant punya satu role pemilik (`roles.is_owner`), padanan *System administrator* di Dynamics 365. Penyiapan lingkungan membuatnya dengan nama "Pemilik" dan memberikannya ke admin pertama; nama itu boleh diganti, yang menandai pemilik adalah `is_owner`.

- **Memegang semua duty yang sah untuk tenant.** Penyiapan memberinya semua duty Core, dan pemasangan module memberinya semua duty module itu.
- **Tidak dapat diubah, dihapus, atau dijadikan turunan role lain.** Role yang menjadikan pemilik sebagai turunannya akan setara pemilik.
- **Hanya pemegang role pemilik yang dapat memberikan atau mencabutnya** (`assertMayGrantRoles`).
- **Tenant tidak boleh terkunci.** Perubahan yang membuat tidak ada lagi anggota aktif pemegang `core.access.update` ditolak (`assertNotLockedOut`).

## Rantai authorization

```text
Pengguna
  -> keanggotaan tenant
  -> penugasan role
  -> security role
  -> duty
  -> privilege
  -> permission
  -> entry point
```

| Tingkat | Makna |
| --- | --- |
| Security role | Sekumpulan tanggung jawab dalam proses bisnis, disusun tenant dari duty |
| Duty | Bagian dari proses bisnis |
| Privilege | Satu tugas, kumpulan permission |
| Permission | Satu entry point dengan satu access level |
| Entry point | Form, menu item, API, report, atau action yang dilindungi |

Role tidak punya `module_id` dan tidak dimiliki department; satu role boleh memuat duty dari beberapa module. Tenant tidak dapat membuat entry point atau permission. Keduanya hanya lahir dari migration. Cara mendeklarasikan rantai ini untuk satu transaksi ada di [Rantai keamanan modul transaksi](19-transaction-security-chain.md).

### Katalog layar Core

Layar Sys Admin dan layar Core lain ikut rantai yang sama sebagai app `core`. Katalognya ditulis migration Core, kelompok per kelompok, misalnya `0004_organization.sql` untuk organisasi. Kebanyakan kelompok punya satu entry point `form` dan dua duty, padanan *Inquire* dan *Maintain* F&O: `core.<kelompok>.inquire` untuk melihat dan `core.<kelompok>.manage` untuk mengubah. Daftar lengkapnya adalah isi `security_duties` dengan `app_id = 'core'`.

Setiap route Core memeriksa permission-nya sendiri lewat `Workspace.guard`. Menu Sys Admin di `src/platform/access/navigation.ts` disaring dengan permission yang sama, tetapi penyaringan menu hanya tampilan.

### Hierarchy security role

Satu role boleh disusun di atas role lain (`security_role_children`). Pemegang role induk ikut memperoleh semua duty turunannya.

- Satu role boleh punya beberapa induk dan beberapa turunan, jadi susunannya graph berarah tanpa siklus, bukan pohon.
- Siklus ditolak saat disimpan (`wouldCreateCycle`), dihitung tanpa memandang status aktif, karena role yang dinonaktifkan hari ini dapat diaktifkan lagi.
- Role nonaktif tidak memberi hak dan tidak menjadi jembatan ke turunannya.
- Dua jalur ke role yang sama tidak menggandakan hak.

Hierarchy role menyusun tanggung jawab, bukan organisasi. Jangan meresolusi yang satu memakai yang lain.

### Konfigurasi keamanan

Layar `/sysadmin/access/security-configuration` menampilkan katalog yang dapat ditelusuri: duty, privilege, permission, lalu entry point milik app yang dipakai tenant. Layar ini hanya baca. Menyusun duty dan privilege khusus tenant, yang di CoreERP dimulai sebagai draf lalu diterbitkan, belum dipindah. Duty khusus tenant yang sudah aktif tetap dapat dipilih pada role.

### Permission dan operasi sensitif

Permission menyatakan kemampuan bisnis, bukan visibilitas menu. Layar boleh menyembunyikan tindakan yang tidak dimiliki pengguna, tetapi API tetap memeriksa izinnya.

Access level mengikuti Dynamics 365: `read`, `update`, `create`, `correct`, `delete`, `invoke`. Aksi penghapusan lunak seperti arsipkan, void, atau retire memakai `delete`. Operasi layanan tanpa makna CRUD memakai `invoke`. Aksi sensitif seperti approve, post, atau pay mendapat duty sendiri supaya dapat diperiksa pemisahan tugas.

Permission dibuat per kemampuan kecil yang benar-benar dilindungi. Satu menu "Master" tidak berarti satu permission atau satu duty. Sebelum membuat atau mengubah permission dan duty, resource, aksi, dan pemisahan baca dari kelola harus disepakati pemilik produk. Gate-nya di skill `operations-metta-architecture`, bagian Permission and duty decision gate.

## Batas data pada penugasan role

```text
role_assignments
├── membership_id, role_id
├── source: manual | automatic | temporary
└── valid_from, valid_until

app_data_policies
└── code, protected_permissions, requires_legal_entity, requires_operating_unit, allows_descendants

role_assignment_data_policy_scopes
├── role_assignment_id, policy_code
├── legal_entity_id, organization_id
├── hierarchy_version_id, include_descendants
└── valid_from, valid_until
```

Role memberi kemampuan menjalankan entry point; **kebijakan data** menentukan record mana yang terjangkau. Module mendeklarasikan kebijakannya di `app_data_policies` lewat migration, misalnya `healthcare.patient-unit` di `modules/healthcare/database/migrations/0001_patient.sql`.

- Satu penugasan boleh punya beberapa batas pada kebijakan yang sama, dan semuanya digabung.
- Batas yang menyertakan turunan selalu menyebut versi hierarchy yang dipakai. Perubahan hierarchy lain tidak mengubahnya.
- Batas tanpa legal entity dan tanpa organisasi berarti seluruh organisasi, dan tidak boleh digabung dengan batas lain pada role yang sama (`assertNoRedundantGrants`).
- Role tanpa kebijakan data berlaku di seluruh organisasi.

Bentuk query yang dihasilkannya ada di [Query scope dan schema](08-query-scopes-and-schema.md#query-scope-di-kode).

## Mengubah akses anggota

`PATCH /api/v1/memberships/{id}` mengganti seluruh penugasan manual seorang anggota dengan daftar yang dikirim. Di CoreERP penugasan lama dihapus fisik lalu ditulis ulang; di sini penugasan yang dicabut ditutup dengan `valid_until`, penugasan yang diberikan lagi dihidupkan kembali, dan batas data yang berubah ditutup lalu ditambah, sehingga riwayatnya tetap ada. Penugasan otomatis, misalnya role pemilik admin pertama, tidak disentuh.

Menghapus role mengisi `deleted_at`, menonaktifkannya, dan menutup penugasannya. Nama role boleh dipakai lagi sesudahnya karena indeks unik namanya parsial.

### Pemisahan tugas

Aturan konflik disimpan per tenant di `sod_rules`: pasangan duty dan risikonya. Saat penugasan manual diubah, `assertNoSodConflict` menghitung semua duty efektif dari penugasan otomatis ditambah role manual yang akan dipasang, termasuk role turunan, lalu menolak bila keduanya memuat dua duty dari satu aturan aktif.

Yang belum ada: layar mengatur aturan konflik, mitigasi, dan catatan konflik. Penugasan sementara dan penugasan otomatis dari posisi kerja juga belum dipindah; kolom `source` sudah mengenalnya.

## Workforce

Department, job, position, dan penugasan pekerja ke position adalah fakta berbeda. Department adalah operating unit; posisi adalah fakta HR; hak dan batas data tetap dihitung dari penugasan role. Pekerja bukan pengguna, dan tautan keduanya milik module HR.

Module HR belum ada di repo ini. Acuan perilakunya di [Identity dan access CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/09-identity-and-access.md#workforce-dan-rangkap-position).

## Workspace aktif

`PUT /api/v1/workspace-context` memilih keanggotaan, legal entity, dan operating unit aktif. Server memvalidasi pilihan terhadap organisasi yang terjangkau batas data sebelum menyimpannya di sesi. Pilihan workspace menentukan konteks transaksi baru dan nilai awal saringan; ia tidak menambah atau mengurangi izin. Endpoint tetap memeriksa batas data penuh dan tidak menerima unit dari peramban sebagai bukti hak. Rinciannya di [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md#workspace-aktif).

## Module di launcher

Katalog aplikasi di Shell menampilkan module yang dihak tenant dan sudah tercatat terpasang di `core_module_installations`. Module yang dihak tetapi belum terpasang tampil nonaktif dengan keterangan "Belum dipasang", dan module yang tidak dihak tidak tampil. Data Shell datang dari `GET /api/v1/shell` di `src/platform/access/shell.routes.ts`.

## Akses penyedia

Operator admin.erp bukan anggota tenant. Repo ini tidak punya jalur yang membuat operator dapat membaca data bisnis tenant tanpa keanggotaan.

## Acceptance

- Satu pengguna dengan batas data pada dua unit menerima gabungan hak yang tepat tanpa identitas atau keanggotaan ganda.
- Satu penugasan dapat menyimpan beberapa batas tanpa mengubah penugasan lain.
- Role lintas module bekerja tanpa `roles.module_id`.
- `include_descendants` selalu menyebut versi hierarchy acuannya.
- Konflik pemisahan tugas ditolak.
- Entitlement tanpa catatan pemasangan tidak pernah tampil sebagai module terpasang.
- API tetap menolak walau menu disembunyikan atau pilihan workspace dimanipulasi.

## Lihat juga

- [Rantai keamanan modul transaksi](19-transaction-security-chain.md)
- [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md)
- [Query scope dan schema](08-query-scopes-and-schema.md)
- [SSO](32-sso.md)
