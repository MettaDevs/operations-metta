# healthcare

Module layanan kesehatan: master pasien, tipe pasien, penjamin, cara bayar, dan kebijakan berbagi pasien. Nama module yang tampil di layar datang dari baris `apps` (`Layanan kesehatan`), bukan dari kode.

## Nama tabel

Tabel module berawalan `sim_`, lalu `m_` untuk master dan `tr_` untuk transaksi, mengikuti pola legacy sistem lama (keputusan pemilik produk, 10 November 2026). Detail master ikut `m_`. Semua tabel sekarang master: `sim_m_pasien`, `sim_m_pasien_cara_bayar`, `sim_m_tipe_pasien`, `sim_m_tipe_pasien_perilaku`, `sim_m_penjamin`, `sim_m_kebijakan_berbagi`, dan `sim_m_kebijakan_berbagi_perusahaan`. Transaksi kelak, misalnya kunjungan, memakai `sim_tr_`. Awalan lama `kes_` diganti `0005_table_prefix.sql`. `bun run check:boundaries` menolak `sim_` di kode Core.

## Pasien adalah peran party

Pasien mengikuti Global address book F&O (keputusan pemilik produk, 9 dan 10 November 2026). Satu orang adalah satu party Core; pasien adalah perannya (`healthcare.patient` di `party_roles`), didaftarkan untuk perusahaan aktif saat pendaftaran.

| Data                                                                                                                          | Tempat                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Nama, jenis kelamin, tempat dan tanggal lahir, warga negara, agama, pendidikan, status perkawinan, tanggal menikah, pekerjaan | `parties`                                                                                                   |
| NIK, No. KK, paspor                                                                                                           | `party_identifications` (NIK dan No. KK tersamar bagi yang tidak memegang `core.party-identification.read`) |
| Alamat KTP dan alamat domisili                                                                                                | alamat party berkegunaan `identity_card` dan `domicile`                                                     |
| Nomor HP dan email                                                                                                            | kontak party `phone` dan `email`                                                                            |
| NRM, NRM lama, no. dokumen RM, golongan darah, status di KK, instansi, nama ayah/KK/suami, nama ibu, NIK ibu, status aktif    | `sim_m_pasien`                                                                                              |
| Tipe pasien, penjamin, nomor kartu, kelas                                                                                     | `sim_m_pasien_cara_bayar` (boleh lebih dari satu, satu utama)                                               |

Module menulis ke party lewat pintu Core di `src/platform/address-book/index.ts` (`Parties.createForRole`, `Parties.updateForRole`, `PartyIdentifications.replaceNumber`, `PartyAddresses.saveLocation`/`saveContact`) dan hanya membaca tabel Core lewat SQL.

Nama orang tua dan NIK ibu tetap teks seperti form lama, bukan relasi party. `Klp` sistem lama tidak dibawa. Keduanya keputusan pemilik produk, 10 November 2026.

## Mendaftarkan pasien

`POST /api/modules/healthcare/v1/patients`, dalam satu transaksi:

1. Unit pendaftar adalah unit aktif di tempat kerja, dan unit itu harus termasuk batas data pasien pengguna di perusahaan aktif. Perusahaan aktif menjadi perusahaan pasien.
2. Party dicari lewat NIK (lihat bagian NIK). Bila ada, hanya peran pasien yang ditambahkan; isian identitas form diabaikan.
3. Bila tidak ada, party orang dibuat beserta nomor identitas, alamat, dan kontaknya.
4. NRM diambil dari `NumberIssuer` (reference `healthcare.medical-record-number`), lihat bagian NRM.
5. Baris pasien dan cara bayarnya ditulis, lalu peran party didaftarkan. Kegagalan di langkah mana pun membatalkan semuanya, termasuk nomornya.

Kunci `Idempotency-Key` yang sama mengembalikan pasien yang sama.

Aturan wajib mengikuti form pasien sistem lama (`common/patients/form.php`, `Patient_m::rules`, `Patient_model::rules`), tanpa aturan baru:

- nama, jenis kelamin, dan nomor HP wajib;
- warga negara Indonesia: NIK ("No Identitas harus diisi!") dan alamat KTP sampai kelurahan/desa beserta alamatnya wajib; alamat domisili yang diisi wajib lengkap;
- warga negara asing: nomor paspor dan alamat domisili wajib;
- minimal satu tipe pasien; bila cara bayar tidak dikirim saat mendaftar, tipe pasien bawaan beserta penjamin bawaannya dipakai;
- penjamin harus terdaftar untuk tipe pasien cara bayarnya, seperti pilihan Perusahaan form lama yang disaring per tipe pasien.

API tidak mewajibkan Perusahaan (penjamin) dan No. asuransi, juga untuk tipe pasien yang menampilkannya, karena tidak semua perusahaan bisa bridging (keputusan pemilik produk, 10 November 2026). Layar tetap mengikuti perilaku tipe pasien.

Umur tidak disimpan; ia dihitung dari tanggal lahir saat ditampilkan.

### NIK

Mengikuti validasi form pasien aplikasi lama (keputusan pemilik produk, 10 November 2026: "satu NIK satu orang, pokoknya ikuti validasi aplikasi lama"). Sumbernya `common/views/patients/form.php` dan `common/controllers/Patients.php` aplikasi puskesmas lama.

- NIK hanya angka, tanpa batas panjang, seperti input angka form lama. Isian pengganti seperti `00000000` untuk bayi diterima. Pola ini milik Core (`party_identification_types`, Core `0015`), jadi berlaku juga di Buku alamat.
- NIK wajib untuk warga negara Indonesia. Warga negara asing tanpa NIK mendapat NIK pengganti `9999999999999999`, seperti form lama.
- Satu NIK satu orang (indeks unik Core), kecuali NIK pengganti `9999999999999999`, yang boleh dipakai banyak orang dan tidak pernah dipakai untuk mencari party.
- NIK yang sudah dipakai pasien yang terlihat dari unit pendaftar (cakupan berbagi pasien, bagian Siapa melihat pasien mana) menolak pendaftaran dengan pesan form lama persis: "NIK sudah terdaftar! dengan NRM: {NRM} dan Nama: {nama}". Di aplikasi lama satu database satu klinik; padanannya di sini cakupan berbagi pasien.
- NIK yang hanya dipakai pasien di luar cakupan itu, atau party buku alamat yang belum menjadi pasien, tidak ditolak dan tidak disebut: party yang sama dipakai ulang dan pasien baru mendapat NRM sendiri.
- Tidak ada pencarian NIK saat mengetik, karena form lama tidak punya. Mengubah NIK pasien ke NIK pihak lain ditolak Core ("NIK ini sudah tercatat pada pihak lain.").
- Kunci pasien adalah NRM.

Perilaku sistem lama "ketik NIK lalu ambil data dari PCare untuk pasien BPJS" kelak menjadi perilaku di katalog tipe pasien yang dijalankan module BPJS. Belum dibangun.

## Siapa melihat pasien mana

Mengikuti pola F&O (keputusan pemilik produk, 10 November 2026). Di F&O operating unit tidak memisahkan data dalam satu company, sedangkan antar-company data terpisah kecuali ada kebijakan [cross-company data sharing](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/cross-company-data-sharing).

- **Bawaan:** pasien terlihat di semua operating unit yang bekerja untuk legal entity pendaftarnya. Antar legal entity tidak terlihat.
- **Kebijakan berbagi antar legal entity:** sysadmin membuat kebijakan di layar **Berbagi pasien antar perusahaan** dan memilih legal entity yang saling melihat pasien. Kebijakan berlaku selama aktif, sejak tanggal berlaku mulai. Satu legal entity hanya boleh ikut satu kebijakan aktif, seperti aturan F&O "a company and table can only be in one enabled policy". Perubahannya tercatat di change log (`change_log_setup_tables` disalakan untuk kedua tabelnya oleh `0004`), dan legal entity yang dilepas diarsipkan.
- **Mempersempit dalam legal entity:** unit yang ditempatkan sysadmin di hierarchy bertujuan **Kelompok berbagi pasien** (`healthcare.patient-sharing`) hanya berbagi dengan kelompoknya. Kepala kelompok sebuah unit adalah operating unit teratas di jalurnya ke akar, pada versi terbit yang sedang berlaku; kelompok adalah kepala itu beserta semua operating unit di bawahnya. Unit yang tidak ditempatkan memakai bawaan legal entity: ia berbagi dengan semua unit lain yang juga tidak ditempatkan. Perilaku #45 "unit yang tidak ditempatkan menjadi kelompok sendiri" sudah tidak berlaku.
- **Kepemilikan tetap.** `sim_m_pasien` menyimpan party, legal entity, unit pendaftar (`org_unit_id`), unit pemilik nomor (`nrm_unit_id`), dan NRM sekali saat didaftarkan. Trigger `pemilik_tetap` menolak perubahannya, juga lewat SQL di luar module. Kelompok dan kebijakan dihitung saat data dibaca, tidak ditulis ke catatan pasien.

Urutan penerapan setiap daftar, detail, ubah, hapus, dan pemeriksaan NIK saat mendaftar (`PatientSharing.visible`):

1. tenant dari konteks tepercaya;
2. permission duty pasien (`healthcare.patient.read` dan seterusnya);
3. legal entity: legal entity pasien sama dengan legal entity aktif pengguna, atau sekebijakan aktif dan sudah berlaku dengannya;
4. kelompok dan lingkup role: unit pendaftar pasien sekelompok dengan salah satu unit yang diberikan kepada pengguna lewat kebijakan data `healthcare.patient-unit` di legal entity aktif (keduanya di kelompok yang sama, atau keduanya tidak ditempatkan). Batas "seluruh organisasi" tidak membatasi unit, jadi hanya langkah 3 yang berlaku. Pengguna tanpa unit tidak melihat pasien.

Unit yang masuk dua kelompok sekaligus (dua hierarchy aktif) ditolak saat mendaftarkan pasien, dengan pesan untuk merapikan susunannya.

## NRM

Reference NRM boleh berscope legal entity atau operating unit, menyalakan `default_per_legal_entity` dan `default_per_operating_unit`, dan `numbers_unique_per_scope` (Core `0012`, `0014`):

- Unit yang tidak ditempatkan di kelompok: NRM dari sequence legal entity pendaftar, satu untuk semua unit itu. `nrm_unit_id` kosong.
- Unit yang ditempatkan di kelompok: NRM dari sequence unit kepala kelompoknya, seperti #45. `nrm_unit_id` berisi kepala itu.
- Pendaftaran menyebut tepat satu nilai scope ke `NumberIssuer`. Tidak ada pindah ke scope lain: unit tanpa sequence aktif ditolak dengan pesan NumberIssuer.
- Setiap legal entity dan operating unit baru mendapat sequence NRM bawaan dari Core (`NumberSequences.createLegalEntityDefaults`/`createUnitDefaults`, dipanggil Organization lewat `onOrganizationCreated` di `src/main.ts`), hanya bila tenant berhak memakai module ini. Module yang dipasang setelah legal entity dan unit dibuat (`installModule`) menjalankan ulang pembuat yang sama untuk setiap legal entity dan unit yang sudah ada, di transaksi yang sama dengan entitlement-nya; pemasangan ulang tidak membuat sequence kedua. Reference NRM juga hanya ditawarkan di layar Nomor dokumen bagi tenant itu. Sequence yang terlanjur dibuat `0001` untuk tenant tanpa entitlement dihentikan `0004`.
- Format bawaan sama dengan sistem lama, `00.00.01` (segmen nomor dengan mask `##.##.##`), non-continuous, 1 sampai 999999. Admin bebas mengubahnya di Nomor dokumen.
- NRM unik per pemilik nomornya: legal entity (`sim_m_pasien_nrm_legal_entity_unique`) atau unit kepala kelompok (`sim_m_pasien_nrm_unique`). Satu orang satu catatan pasien per pemilik nomor di setiap legal entity.
- **Saat dua kelompok digabung**, pasien lama tetap membawa NRM dari unit pemilik nomornya, sehingga NRM yang sama bisa muncul dua kali dalam kelompok gabungan. Sarankan format berawalan kode unit, yaitu segmen Operating unit di Nomor dokumen (misalnya `PKM1-00.00.01`), sebelum menggabung. Ini saran, tidak dipaksa.

## Izin

| Duty                                                                | Privilege                                                | Permission                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `healthcare.patient.inquire` Lihat pasien                           | `patient.view`                                           | `patient.read`                                              |
| `healthcare.patient.manage` Kelola pasien                           | `patient.register`, `patient.maintain`, `patient.retire` | `patient.read`, `.create`, `.update`, `.delete`             |
| `healthcare.payment-setup.inquire` Lihat tipe pasien dan penjamin   | `patient-type.view`, `guarantor.view`                    | `patient-type.read`, `guarantor.read`                       |
| `healthcare.payment-setup.manage` Kelola tipe pasien dan penjamin   | `patient-type.maintain`, `guarantor.maintain`            | `patient-type.read`, `.update`, `guarantor.read`, `.update` |
| `healthcare.patient-sharing.inquire` Lihat kebijakan berbagi pasien | `patient-sharing.view`                                   | `patient-sharing.read`                                      |
| `healthcare.patient-sharing.manage` Kelola kebijakan berbagi pasien | `patient-sharing.maintain`                               | `patient-sharing.read`, `.update`                           |

Permission pasien dilindungi kebijakan data `healthcare.patient-unit` (unit kerja wajib, turunan boleh). Tipe pasien, penjamin, dan kebijakan berbagi adalah master tenant, tidak dibatasi unit; daftar tipe pasien dan penjamin juga terbaca pemegang `healthcare.patient.read` karena dipakai form pasien. Module tidak membawa role bawaan: CoreERP tidak punya pola role bawaan dari module. Saat module dipasang (`installModule`), role pemilik tenant mendapat semua duty module.

## Tipe pasien dan perilakunya

Tipe pasien adalah master per tenant dengan id tetap, diisi dan diubah admin di layar **Tipe pasien**. Kode tidak pernah mencocokkan nama atau id tipe pasien; yang dibaca adalah perilaku yang dinyalakan tipe itu.

- Katalog perilaku ada di kode (`src/coverage/patient-type/patient-type.behaviors.ts`), dan setiap perilaku diimplementasikan sekali. Isinya sekarang hanya yang dipakai form pasien sistem lama:
    - `requires_guarantor`: isian Perusahaan (penjamin);
    - `requires_card_number`: isian No. asuransi.
- Tipe pasien menyalakan perilaku lewat satu baris per perilaku di `sim_m_tipe_pasien_perilaku`. Perilaku baru kelak (cek kepesertaan, mode tagihan, wajib rujukan) cukup menjadi kode baru di katalog; tabel dan data pasien tidak berubah.
- `sim_m_tipe_pasien.memakai_penjamin` dari `0001` masih ditulis sama dengan `requires_guarantor` untuk kode rilis sebelumnya, dan dibuang di rilis sesudahnya.
- **Tipe bawaan:** centang "Bawaan pasien baru" menandai paling banyak satu tipe per tenant (`sim_m_tipe_pasien_bawaan_unique`). Menandai tipe lain memindahkan tandanya. Penjamin punya tanda serupa, paling banyak satu per tipe pasien. Kartu pasien baru terisi tipe bawaan beserta penjamin bawaannya, dan pendaftaran lewat API tanpa cara bayar memakainya. Hanya tipe dan penjamin yang aktif yang dipakai. Tidak ada id yang ditulis di kode.

## Layar

Katalog aplikasi Shell menampilkan module ini sebagai satu aplikasi bernama `apps.name`, bila tenant berhak dan module terpasang. Grup menu di rail sama dengan folder di `src/`, dan URL halaman berawalan folder itu:

| Kelompok sidebar | Folder           | Halaman                                                                                                                       |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dashboard        | `src/dashboard/` | Dashboard (`/healthcare/dashboard`), halaman pertama area dan halaman awal pengguna. Isinya belum diputuskan; kerangka kosong |
| Pasien           | `src/patient/`   | Pasien (`patient/`), Berbagi pasien antar perusahaan (`patient-sharing/`)                                                     |
| Penjaminan       | `src/coverage/`  | Tipe pasien (`patient-type/`), Penjamin (`guarantor/`)                                                                        |

URL sebelum 11 November 2026 (`/healthcare/patients`, `/healthcare/patient-types`, `/healthcare/guarantors`, `/healthcare/sharing-policies`) dialihkan ke alamat barunya.

- **Pasien** (`/healthcare/patient/patients`): daftar dengan pencarian di toolbar dan filter status serta tipe pasien di panel kiri, dan kartu pasien dengan urutan isian form lama dalam tiga kelompok (identitas dan cara bayar bawaan; data tambahan; alamat KTP dan domisili). Kode pos tidak tampil, seperti form lama; komponen alamat bersama tetap menampilkannya di layar lain (`showPostalCode`).
- Kartu hanya mengelola cara bayar bawaan (utama). Cara bayar lain yang tersimpan lewat API tidak tampil dan dikirim balik apa adanya.
- **Tipe pasien** (`/healthcare/coverage/patient-types`) dan **Penjamin** (`/healthcare/coverage/guarantors`).
- **Berbagi pasien antar perusahaan** (`/healthcare/patient/sharing-policies`): daftar kebijakan dengan pencarian di toolbar dan filter status di panel kiri; kartu dengan nama, tanggal berlaku mulai, status, dan pilihan perusahaan.
- Menu module ditulis migration ke `apps.navigation` (terakhir `0006_navigation_areas.sql`) dan disaring Shell dengan permission tiap entri.

## Penjamin

Penjamin adalah party organisasi berperan `healthcare.guarantor`, dicatat untuk satu tipe pasien di `sim_m_penjamin`. `POST .../guarantors` memakai organisasi yang sudah ada di buku alamat (`party_id`) atau membuat party organisasi baru (`name`). Nama penjamin diubah di buku alamat.

## Endpoint

Semua di bawah `/api/modules/healthcare/v1`.

| Endpoint                                                                                                                                                                              | Izin                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /patients` (cari: nama, NRM, NRM lama, NIK, nomor kartu, nomor HP, alamat, tanggal lahir yyyy-mm-dd, dd-mm-yyyy, ddmmyyyy, yyyymmdd; saring status, tipe pasien, unit pendaftar) | `patient.read`                     |
| `GET /patients/metadata` (termasuk cara bayar bawaan)                                                                                                                                 | `patient.read`                     |
| `GET /patients/{id}`                                                                                                                                                                  | `patient.read`                     |
| `POST /patients`                                                                                                                                                                      | `patient.create`                   |
| `PATCH /patients/{id}`                                                                                                                                                                | `patient.update`                   |
| `DELETE /patients/{id}` (mengisi `deleted_at`)                                                                                                                                        | `patient.delete`                   |
| `GET, POST /patient-types`, `PATCH, DELETE /patient-types/{id}`                                                                                                                       | `patient-type.read` / `.update`    |
| `GET, POST /guarantors`, `PATCH, DELETE /guarantors/{id}`                                                                                                                             | `guarantor.read` / `.update`       |
| `GET /sharing-policies`, `GET /sharing-policies/legal-entities`, `POST /sharing-policies`, `PATCH, DELETE /sharing-policies/{id}`                                                     | `patient-sharing.read` / `.update` |

## Dicatat untuk nanti

- **Cara bayar kunjungan ditulis balik ke pasien.** Pendaftaran kunjungan sistem lama (`registrations/helpers/registration_helper.php`) menyalin tipe pasien, penjamin, dan nomor kartu kunjungan ke `mPasien`, jadi cara bayar terakhir menjadi bawaan pasien. Pendaftaran kunjungan kelak membawa perilaku itu ke cara bayar utama pasien ini (keputusan pemilik produk, 10 November 2026). Belum dibangun.
- **Ambil data PCare dari NIK** untuk pasien BPJS kelak menjadi perilaku di katalog tipe pasien, dijalankan module BPJS. Belum dibangun.

## Belum dibuat

Sesuai keputusan pemilik produk: NRM per poli (`mPasienNRM`), pendaftaran kunjungan, pemeriksaan, cetak general consent, riwayat pemeriksaan, dokumen pasien, merge NRM, serta harga dan tarif. Uji beban dan kebenaran module ini juga belum dijalankan.
