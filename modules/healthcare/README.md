# healthcare

Module layanan kesehatan: master pasien, tipe pasien, penjamin, dan cara bayar. Nama module yang tampil di layar datang dari baris `apps` (`Layanan kesehatan`), bukan dari kode. Tabel module berawalan `kes_`.

## Pasien adalah peran party

Pasien mengikuti Global address book F&O (keputusan pemilik produk, 9 dan 10 November 2026). Satu orang adalah satu party Core; pasien adalah perannya (`healthcare.patient` di `party_roles`), didaftarkan untuk perusahaan aktif saat pendaftaran.

| Data                                                                                                                          | Tempat                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Nama, jenis kelamin, tempat dan tanggal lahir, warga negara, agama, pendidikan, status perkawinan, tanggal menikah, pekerjaan | `parties`                                                                                                   |
| NIK, No. KK, paspor                                                                                                           | `party_identifications` (NIK dan No. KK tersamar bagi yang tidak memegang `core.party-identification.read`) |
| Alamat KTP dan alamat domisili                                                                                                | alamat party berkegunaan `identity_card` dan `domicile`                                                     |
| Nomor HP dan email                                                                                                            | kontak party `phone` dan `email`                                                                            |
| NRM, NRM lama, no. dokumen RM, golongan darah, status di KK, instansi, nama ayah/KK/suami, nama ibu, NIK ibu, status aktif    | `kes_pasien`                                                                                                |
| Tipe pasien, penjamin, nomor kartu, kelas                                                                                     | `kes_pasien_cara_bayar` (boleh lebih dari satu, satu utama)                                                 |

Module menulis ke party lewat pintu Core di `src/platform/address-book/index.ts` (`Parties.createForRole`, `Parties.updateForRole`, `PartyIdentifications.replaceNumber`, `PartyAddresses.saveLocation`/`saveContact`) dan hanya membaca tabel Core lewat SQL.

## Mendaftarkan pasien

`POST /api/modules/healthcare/v1/patients`, dalam satu transaksi:

1. Unit pendaftar adalah unit aktif di tempat kerja, dan unit itu harus termasuk batas data pasien pengguna. Perusahaan aktif menjadi perusahaan pasien.
2. Party dicari lewat NIK. Bila ada, hanya peran pasien yang ditambahkan; isian identitas form diabaikan. Bila orang itu sudah pasien di kelompok berbagi yang sama, pendaftaran ditolak dengan NRM-nya. `POST .../patients/party-lookup` memberi layar hasil pencarian itu lebih dulu.
3. Bila tidak ada, party orang dibuat beserta nomor identitas, alamat, dan kontaknya.
4. NRM diambil dari `NumberIssuer` (reference `healthcare.medical-record-number`) dengan scope operating unit kepala kelompok berbagi unit pendaftar. Tidak ada pindah ke scope lain: unit tanpa sequence aktif ditolak.
5. Baris pasien dan cara bayarnya ditulis, lalu peran party didaftarkan. Kegagalan di langkah mana pun membatalkan semuanya, termasuk nomornya.

Kunci `Idempotency-Key` yang sama mengembalikan pasien yang sama.

Aturan wajib mengikuti form pasien sistem lama (`common/patients/form.php`, `Patient_m::rules`, `Patient_model::rules`), tanpa aturan baru:

- nama, jenis kelamin, dan nomor HP wajib;
- warga negara Indonesia: NIK dan alamat KTP sampai kelurahan/desa beserta alamatnya wajib; alamat domisili yang diisi wajib lengkap;
- warga negara asing: nomor paspor dan alamat domisili wajib;
- minimal satu tipe pasien;
- penjamin harus terdaftar untuk tipe pasien cara bayarnya, seperti pilihan Perusahaan form lama yang disaring per tipe pasien.

Umur tidak disimpan; ia dihitung dari tanggal lahir saat ditampilkan.

## Kepemilikan tetap, kelompok dihitung saat dibaca

`kes_pasien` menyimpan party, perusahaan, unit pendaftar (`org_unit_id`), unit pemilik nomor (`nrm_unit_id`), dan NRM sekali saat didaftarkan. Trigger `pemilik_tetap` menolak perubahannya, juga lewat SQL di luar module.

Kelompok berbagi pasien adalah rancangan kita sendiri, karena F&O tidak punya scope data menurut hierarchy:

- Sysadmin menyusunnya di Hierarki organisasi dengan tujuan **Kelompok berbagi pasien** (`healthcare.patient-sharing`): versi, draft, publikasi, dan tanggal berlaku milik Core.
- Versi yang dipakai adalah versi terbit dengan tanggal berlaku terakhir yang sudah lewat, di setiap hierarchy aktif bertujuan itu.
- Kepala kelompok sebuah unit adalah operating unit teratas di jalurnya ke akar. Kelompok adalah kepala itu beserta semua operating unit di bawahnya. Unit yang tidak ditempatkan menjadi kelompok sendiri.
- Unit yang masuk dua kelompok sekaligus (dua hierarchy aktif) ditolak saat mendaftarkan pasien, dengan pesan untuk merapikan susunannya.
- Pasien terlihat bagi pengguna bila unit pendaftarnya sekelompok dengan salah satu unit yang diberikan kepadanya lewat kebijakan data `healthcare.patient-unit`. Batas "seluruh organisasi" melihat semua pasien tenant.
- Memisah atau menggabung kelompok berarti versi hierarchy baru. Pasien lama tetap milik unit pendaftarnya dan tetap membawa NRM dari unit pemilik nomornya; yang berubah hanya siapa yang melihatnya. Pendaftaran baru memakai kepala kelompok yang baru.

NRM unik per unit pemilik nomor (`kes_pasien_nrm_unique`), sama dengan scope sequence-nya. Setelah dua kelompok digabung, NRM yang sama bisa ada di dua pasien dengan unit pemilik nomor berbeda.

## Sequence NRM per unit

Reference NRM menyalakan `default_per_operating_unit` dan `numbers_unique_per_scope` (Core `0012_unit_number_sequences.sql`):

- Setiap operating unit baru mendapat sequence NRM bawaan dari Core (`NumberSequences.createUnitDefaults`, dipanggil Organization lewat `onOperatingUnitCreated` di `src/main.ts`). Unit yang sudah ada diisi `0001_patient.sql`.
- Format bawaan sama dengan sistem lama: enam digit berkelompok dua, `00.00.01` (segmen nomor dengan mask `##.##.##`), non-continuous, 1 sampai 999999. Admin bebas mengubahnya di Nomor dokumen.
- Format yang sama di unit lain tidak ditolak, karena NRM unik per unit pemilik nomor.

## Izin

| Duty                                                              | Privilege                                                | Permission                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `healthcare.patient.inquire` Lihat pasien                         | `patient.view`                                           | `patient.read`                                              |
| `healthcare.patient.manage` Kelola pasien                         | `patient.register`, `patient.maintain`, `patient.retire` | `patient.read`, `.create`, `.update`, `.delete`             |
| `healthcare.payment-setup.inquire` Lihat tipe pasien dan penjamin | `patient-type.view`, `guarantor.view`                    | `patient-type.read`, `guarantor.read`                       |
| `healthcare.payment-setup.manage` Kelola tipe pasien dan penjamin | `patient-type.maintain`, `guarantor.maintain`            | `patient-type.read`, `.update`, `guarantor.read`, `.update` |

Permission pasien dilindungi kebijakan data `healthcare.patient-unit` (unit kerja wajib, turunan boleh). Tipe pasien dan penjamin master tenant, tidak dibatasi unit; daftar keduanya juga terbaca pemegang `healthcare.patient.read` karena dipakai form pasien. Module tidak membawa role bawaan: CoreERP tidak punya pola role bawaan dari module.

## Tipe pasien dan perilakunya

Tipe pasien adalah master per tenant dengan id tetap, diisi dan diubah admin di layar **Tipe pasien**. Kode tidak pernah mencocokkan nama atau id tipe pasien; yang dibaca adalah perilaku yang dinyalakan tipe itu.

- Katalog perilaku ada di kode (`src/setup/patient-type/patient-type.behaviors.ts`), dan setiap perilaku diimplementasikan sekali. Isinya sekarang hanya yang dipakai form pasien sistem lama:
    - `requires_guarantor`: isian Perusahaan (penjamin);
    - `requires_card_number`: isian No. asuransi.
- Tipe pasien menyalakan perilaku lewat satu baris per perilaku di `kes_tipe_pasien_perilaku`. Perilaku baru kelak (cek kepesertaan, mode tagihan, wajib rujukan) cukup menjadi kode baru di katalog; tabel dan data pasien tidak berubah.
- `kes_tipe_pasien.memakai_penjamin` dari `0001` masih ditulis sama dengan `requires_guarantor` untuk kode rilis sebelumnya, dan dibuang di rilis sesudahnya.

## Layar

- **Pasien** (`/healthcare/patients`): daftar dengan pencarian di toolbar dan filter status serta tipe pasien di panel kiri, dan kartu pasien dengan urutan isian form lama dalam tiga kelompok (identitas dan cara bayar bawaan; data tambahan; alamat KTP dan domisili).
- Kartu hanya mengelola cara bayar bawaan (utama). Cara bayar lain yang tersimpan lewat API tidak tampil dan dikirim balik apa adanya.
- **Tipe pasien** (`/healthcare/patient-types`) dan **Penjamin** (`/healthcare/guarantors`).
- Menu module ditulis `0002_navigation.sql` ke `apps.navigation` dan disaring Shell dengan permission tiap entri.

## Penjamin

Penjamin adalah party organisasi berperan `healthcare.guarantor`, dicatat untuk satu tipe pasien di `kes_penjamin`. `POST .../guarantors` memakai organisasi yang sudah ada di buku alamat (`party_id`) atau membuat party organisasi baru (`name`). Nama penjamin diubah di buku alamat.

## Endpoint

Semua di bawah `/api/modules/healthcare/v1`.

| Endpoint                                                                                                                                                                              | Izin                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `GET /patients` (cari: nama, NRM, NRM lama, NIK, nomor kartu, nomor HP, alamat, tanggal lahir yyyy-mm-dd, dd-mm-yyyy, ddmmyyyy, yyyymmdd; saring status, tipe pasien, unit pendaftar) | `patient.read`                  |
| `GET /patients/metadata`                                                                                                                                                              | `patient.read`                  |
| `POST /patients/party-lookup`                                                                                                                                                         | `patient.create`                |
| `GET /patients/{id}`                                                                                                                                                                  | `patient.read`                  |
| `POST /patients`                                                                                                                                                                      | `patient.create`                |
| `PATCH /patients/{id}`                                                                                                                                                                | `patient.update`                |
| `DELETE /patients/{id}` (mengisi `deleted_at`)                                                                                                                                        | `patient.delete`                |
| `GET, POST /patient-types`, `PATCH, DELETE /patient-types/{id}`                                                                                                                       | `patient-type.read` / `.update` |
| `GET, POST /guarantors`, `PATCH, DELETE /guarantors/{id}`                                                                                                                             | `guarantor.read` / `.update`    |

## Belum dibuat

Sesuai keputusan pemilik produk: NRM per poli (`mPasienNRM`), pendaftaran kunjungan, pemeriksaan, cetak general consent, riwayat pemeriksaan, dokumen pasien, merge NRM, serta harga dan tarif. Uji beban dan kebenaran module ini juga belum dijalankan.
