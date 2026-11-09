# Alur permintaan

Perjalanan satu permintaan dari alamat sampai data yang boleh dibaca: lingkungan, sesi, konteks tenant, izin, dan penyaringan baris. Nama tabel dan kolom adalah skema yang berlaku sekarang; stack baru membacanya persis sama.

## 1. Satu permintaan dari peramban

Urutan lapisan penjaga, dari luar ke dalam:

1. **Penjaga dasar**: proxy tepercaya, CORS, mode pemeliharaan, batas ukuran, pemangkasan teks.
2. **Jejak**: permintaan ditandai; setelah jawaban selesai (termasuk saat gagal) `tenant_id`, module, `legal_entity_id`, `org_unit_id`, dan `user_id` ditempel ke jejaknya. Tidak membaca database, tidak menolak.
3. **Lingkungan dari alamat** (hanya bila domain dasar disetel):
   - Host di luar domain, domain dasar polos, atau label cadangan (admin, www, api, registry) → lanjut tanpa lingkungan.
   - `<tenant>.<domain>` = production; `<tenant>.<demo|sandbox>.<domain>` = demo/sandbox; bentuk lain → 404.
   - Cari `environments` (hosting `provider`, kind sesuai, `deleted_at IS NULL`) yang `tenants.slug` = label. Tidak ada → 404.
   - Status bukan `active` → 503 bila `schema_migrated_at` terisi, selain itu 404.
   - Lingkungan ditemukan → koneksi database dipindah (§7).
4. **Origin passkey**: RP ID = domain dasar, origin = host saat ini.
5. **Sesi dan cookie**: cookie terenkripsi kecuali `appearance` dan `sidebar_state`; token form (CSRF) kecuali logout dari penyedia identitas. Rute yang wajib masuk tanpa sesi → 401 JSON untuk API, selain itu dialihkan ke login.
6. **Tampilan**: cookie `appearance` (bawaan `system`).
7. **Logout dari penyedia identitas**: generasi sesi di sesi dibandingkan dengan nilai per pengguna di cache; berbeda → pengguna dikeluarkan dan sesi dibatalkan.
8. **Keanggotaan pada alamat**: di alamat tenant, pengguna yang sudah masuk wajib punya keanggotaan aktif pada tenant itu → selain itu 403. Dilepas untuk logout, bergabung lewat undangan, dan akun berbaris `provider_access`.
9. **Data bersama halaman**: keanggotaan, konteks kerja, izin Core, lisensi, jam, tanggal kerja, produk yang berhak dan dapat diluncurkan.
10. **Wajib ganti sandi**: `users.must_change_password` → semua rute selain keamanan, ubah sandi, dan logout dialihkan ke layar keamanan.
11. **Lisensi situs** (bila diwajibkan): berkas lisensi bertanda tangan RSA-SHA256 hilang, tidak sah, atau kedaluwarsa → 403 `license_locked` (API) atau halaman kunci berstatus 403.
12. **Rute module** → konteks module (§2–§4), lalu aksi.

## 2. Konteks tenant tepercaya

`tenant_id` tidak pernah diambil dari isi permintaan peramban.

1. Kandidat: `tenant_memberships` milik pengguna dengan status `active`, urut `created_at`. Di alamat tenant, hanya tenant itu.
2. Keanggotaan aktif: `workspace.membership_id` di sesi bila termasuk kandidat, selain itu kandidat pertama; hasilnya ditulis balik ke sesi.
3. Organisasi terjangkau: `organizations` (tenant sama, status `active`, urut `name`). Kebijakan data `all` → semua; selain itu hanya legal entity dan unit dari hibah (§4).
4. Perusahaan aktif = `workspace.legal_entity_id` bila berklasifikasi `legal_entity` dan terjangkau, selain itu yang pertama. Unit aktif = `workspace.org_unit_id` dengan aturan sama untuk `operating_unit`.
5. Rute module tanpa keanggotaan → 403 "Tidak ada tenant aktif untuk permintaan ini." Konteks module berisi `tenant_id`, `legal_entity_id`, `org_unit_id`, `user_id`, izin, dan kebijakan data.
6. Zona waktu: `users.timezone` → `legal_entities.timezone` → bawaan aplikasi.
7. Konteks dihitung **sekali per permintaan** lalu dibuang di akhir permintaan. Satu daftar module dianggarkan paling banyak 10 query.

## 3. Rantai izin

Bentuk Dynamics 365 F&O: role → duty → privilege → permission.

1. Role yang diberikan: `role_assignments` (keanggotaan ini, status `active`, `valid_from` ≤ sekarang, `valid_until` kosong atau > sekarang) ⨝ `roles` yang aktif.
2. Role efektif: ditelusuri rekursif lewat `security_role_children` (`parent_role_id` → `child_role_id`); induk mewarisi duty seluruh turunannya.
3. Izin untuk app X: `permissions.code` unik dari `security_role_duties` ⨝ `security_duty_privileges` ⨝ `security_privilege_permissions` ⨝ `permissions` dengan `permissions.app_id` = X.
4. Rute module: lisensi diperiksa, daftar izin dihitung sekali; kosong → 403; setiap aksi memeriksa kodenya ada di daftar.
5. Asal definisi: manifest module (blok security: entry point, permission, privilege, duty, kebijakan data; dan navigasi), didaftarkan dalam satu transaksi ke `apps`, `app_entry_points`, `permissions`, `security_privileges`, `security_privilege_permissions`, `security_duties`, `security_duty_privileges`, `app_data_policies`. Role Owner (`roles.is_owner`) di setiap tenant mendapat semua duty.
6. Menu: `apps.navigation` berisi rail, sidebar, dan entri pencarian, masing-masing dengan permission. Item tampil bila permission-nya dimiliki; rail tanpa item disembunyikan.
7. Peluncur produk: app yang punya izin ∩ `core_module_installations` berstatus `installed` ∩ lisensi.

Kode permission, duty, dan kebijakan tercatat pada role tenant. Mengganti kodenya di manifest mencabut akses tanpa suara, jadi kode diperlakukan sebagai kontrak.

## 4. Kebijakan data dan penyaringan baris

1. Module menyatakan kebijakan (`code`, `protected_permissions`, `requires_legal_entity`, `requires_operating_unit`, `allows_descendants`) → `app_data_policies`.
2. Hibah per penugasan role: `role_assignment_data_policy_scopes`. `legal_entity_id` dan `organization_id` keduanya kosong = tanpa batas. Turunan hanya bila `allows_descendants`, memakai `organization_hierarchy_closures` versi yang tercatat.
3. Setiap query baca module diberi lapisan saringan berurutan:
   - **Tenant**: `<tabel>.tenant_id = tenant aktif`. Tanpa tenant aktif → galat, bukan nol baris. Saat menulis, `tenant_id` kosong diisi otomatis; berbeda → ditolak.
   - **Arsip**: `<tabel>.deleted_at IS NULL`.
   - **Perusahaan aktif**: kolom legal entity resource = perusahaan aktif; tanpa perusahaan aktif → nol baris.
   - **Kebijakan**: `all` → tanpa saringan; tanpa hibah → nol baris; dua kolom → OR atas hibah `(le = hibah.le AND unit IN hibah.units)`; satu kolom → `IN`.
   Kolom yang dipakai dipilih module per resource; contoh aset: `aset_tr_aset.legal_entity_id` dan `responsible_org_unit_id`.
4. Satu record dibaca dengan saringan yang sama + `id`: di luar jangkauan → 404. Saat menulis: legal entity record ≠ perusahaan aktif → 422; di luar hibah → 403.
5. Core boleh **membaca** tabel module (laporan, analitik), tidak menulisnya. Syaratnya: module terpasang dan berlisensi, pengguna berizin baca dataset, nama tabel dan kolom diambil dari yang didaftarkan module, setiap join membawa `tenant_id` yang sama dan `deleted_at IS NULL`, lalu saringan perusahaan dan kebijakan diterapkan sebelum saringan pengguna.
6. Module tidak pernah menyentuh tabel module lain.

## 5. Daftar bertahap (server)

1. Saringan §4 dan filter khusus resource diterapkan lebih dulu, lalu hasilnya dibungkus subquery; nama lookup di-join sesudahnya.
2. Parameter: `q` ≤ 200 karakter; `sort` harus kunci allowlist (kunci publik → kolom); `direction` asc|desc; `cursor` ≤ 2000; `per_page` 1–100 (bawaan 40); `record_id`; `record_ids[]` ≤ 100.
3. Pencarian: teks dinormalisasi (NFC, huruf kecil); tiap kata dicocokkan sebagai awalan full-text konfigurasi `simple`, antar-kata AND, antar-kolom OR; teks bertanda kutip dicari sebagai frasa; kolom identitas juga cocok tanpa spasi, titik, atau strip.
4. Urutan: NULL selalu terakhir, lalu nilai, lalu `id` searah sebagai pembeda.
5. Server mengambil `per_page + 1` untuk tahu masih ada data. Cursor membawa posisi (penanda NULL, nilai urut, `id`, arah) dan bersifat buram bagi klien.
6. Jawaban `{data, next_cursor}`; `next_cursor` null = habis. Sort tak dikenal atau cursor rusak → 422 "Posisi daftar tidak valid. Muat ulang daftar."

## 6. Pemanggil selain peramban

Semua tetap melewati §1 langkah 1–4.

| Pemanggil | Kredensial | Tenant ditentukan dari | Batas laju |
| --- | --- | --- | --- |
| App/layanan (`internal/v1`) | Header `X-CoreERP-App-Id`, `X-CoreERP-Service-Token` (`<id>.<rahasia>`), `X-CoreERP-Tenant-Id`; sha256 rahasia dibandingkan waktu-tetap dengan `app_service_credentials.token_digest` | Header, lalu wajib ada entitlement aktif ⨝ `core_module_installations` `installed` | 600/menit per app dan tenant |
| Klien integrasi | `Bearer <ulid>.<rahasia>` ke `integration_clients` (status `active`); `allowed_ips` dan `scopes` diperiksa | `integration_clients.tenant_id`, tidak pernah dari permintaan | 120/menit per klien |
| Pusat admin | Bearer dibandingkan waktu-tetap dengan token pusat; token kosong → selalu 401 | Path atau body | 30/menit per rute dan alamat |
| Gerbang pendaftaran produk | Bearer gateway minimal 32 karakter | — | 30 atau 120 per 60 detik |

Gagal: kredensial tidak ada → 401; tidak cocok, IP, atau scope → 403; lingkungan non-produksi untuk pengiriman keluar → 503.

## 7. Database bersama atau database sendiri

1. Tanpa lingkungan dari alamat (on-prem, lokal, konsol) → koneksi bawaan.
2. `environments.database_name` kosong → database bersama; isolasi hanya lewat `tenant_id`.
3. Terisi → koneksi ke database itu menjadi bawaan untuk sisa permintaan.
4. Tetap di database pusat: sesi, cache, antrean, token reset sandi, `users`, `tenants`, `tenant_memberships`, `provider_access`, `clients`, `environments`, `environment_operations`, `passkeys`, `external_identities`, `sso_login_attempts`, `tenant_identity_providers`, `sites`, `site_*`, `console_settings`, `operator_audit_events`.
5. Selebihnya dibaca dari database lingkungan, dengan `tenant_id` tetap disaring.
6. Setiap koneksi yang dipakai menulis wajib memasang variabel sesi PostgreSQL `coreerp.user_id` (id pengguna, angka) dan `coreerp.change_log`, lalu meresetnya sebelum koneksi dipakai permintaan lain (lihat Alur data §9). Dengan pool koneksi, ini menjadi tanggung jawab stack baru.

## 8. Celah yang ditemukan (keadaan kode saat ini)

Putuskan untuk setiap butir: dipertahankan 1:1 atau diperbaiki saat pindah.

- Rute module tidak membaca `core_module_installations`; peluncur, analitik, dan kredensial app membacanya.
- Kredensial app dengan `tenant_id` kosong berlaku untuk tenant mana pun yang disebut header, dan tidak dicocokkan dengan tenant alamat.
- Hibah kebijakan data tidak memeriksa `roles.is_active`.
- Pada mode database sendiri, pembacaan lewat relasi dari model pusat jatuh ke database pusat, sedangkan pembacaan langsung ke database lingkungan (misalnya produk berhak dan pemeriksaan role Owner).
- "Produk berhak" mengabaikan `starts_at`; registrasi manifest menghapus fisik kode yang tidak lagi dinyatakan.
- Urutan kolom non-native di daftar bertahap berbasis teks.
- `internal/v1/members` hanya menerima satu app id yang ditulis mati.
- Perusahaan dan unit aktif tidak diperiksa saling berkaitan.
