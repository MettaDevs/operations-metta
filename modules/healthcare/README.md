# healthcare

Module layanan kesehatan: master pasien, tipe pasien, penjamin, cara bayar, section, tenaga kesehatan, jadwal praktik, dan pendaftaran kunjungan. Kebijakan sharing pasien antar legal entity ada di Core (Sys Admin → Data sharing); module ini mendaftarkan jenis datanya, "Master pasien". Nama module yang tampil di layar datang dari baris `apps` (`Layanan kesehatan`), bukan dari kode.

## Nama tabel

Tabel module berawalan `sim_`, lalu `m_` untuk master dan `tr_` untuk transaksi, mengikuti pola legacy sistem lama (keputusan pemilik produk, 10 November 2026). Detail master ikut `m_`. Master: `sim_m_pasien`, `sim_m_pasien_cara_bayar`, `sim_m_tipe_pasien`, `sim_m_tipe_pasien_perilaku`, `sim_m_penjamin`, `sim_m_section`, `sim_m_ruangan`, `sim_m_section_ruangan`, `sim_m_nakes`, `sim_m_sesi_praktik`, `sim_m_jadwal_template`, dan `sim_m_parameter_jadwal`. Data acuan pendaftaran: `sim_m_keadaan_pasien`, `sim_m_skrining_kategori`, dan `sim_m_skrining_tanda`. Transaksi: `sim_tr_jadwal_praktik`, `sim_tr_jadwal_generate`, `sim_tr_registrasi`, `sim_tr_registrasi_tujuan`, `sim_tr_registrasi_keadaan`, `sim_tr_registrasi_skrining`, dan `sim_tr_antrean_penghitung`. `sim_m_kebijakan_berbagi` dan `sim_m_kebijakan_berbagi_perusahaan` menjadi tabel yatim sejak `0008_data_sharing_to_core.sql`: isinya disalin ke tabel Core, dan keduanya tidak dibaca atau ditulis lagi. Awalan lama `kes_` diganti `0005_table_prefix.sql`. `bun run check:boundaries` menolak `sim_` di kode Core.

## Pasien adalah peran party

Pasien mengikuti Global address book F&O (keputusan pemilik produk, 9 dan 10 November 2026). Satu orang adalah satu party Core; pasien adalah perannya (`healthcare.patient` di `party_roles`), didaftarkan untuk legal entity aktif saat pendaftaran.

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

1. Unit pendaftar adalah unit aktif di tempat kerja, dan unit itu harus termasuk batas data pasien pengguna di legal entity aktif. Legal entity aktif menjadi legal entity pasien.
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
- NIK yang sudah dipakai pasien yang terlihat dari unit pendaftar (cakupan sharing pasien, bagian Siapa melihat pasien mana) menolak pendaftaran dengan pesan form lama persis: "NIK sudah terdaftar! dengan NRM: {NRM} dan Nama: {nama}". Di aplikasi lama satu database satu klinik; padanannya di sini cakupan sharing pasien.
- NIK yang hanya dipakai pasien di luar cakupan itu, atau party buku alamat yang belum menjadi pasien, tidak ditolak dan tidak disebut: party yang sama dipakai ulang dan pasien baru mendapat NRM sendiri.
- Tidak ada pencarian NIK saat mengetik, karena form lama tidak punya. Mengubah NIK pasien ke NIK pihak lain ditolak Core ("NIK ini sudah tercatat pada pihak lain.").
- Kunci pasien adalah NRM.

Perilaku sistem lama "ketik NIK lalu ambil data dari PCare untuk pasien BPJS" kelak menjadi perilaku di katalog tipe pasien yang dijalankan module BPJS. Belum dibangun.

## Siapa melihat pasien mana

Mengikuti pola F&O (keputusan pemilik produk, 10 November 2026). Di F&O operating unit tidak memisahkan data dalam satu company, sedangkan antar-company data terpisah kecuali ada kebijakan [cross-company data sharing](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/cross-company-data-sharing).

- **Bawaan:** pasien terlihat di semua operating unit yang bekerja untuk legal entity pendaftarnya. Antar legal entity tidak terlihat.
- **Sharing antar legal entity:** sysadmin membuat kebijakan di Core, layar **Sys Admin → Data sharing** (`/sysadmin/data-sharing`, izin `core.data-sharing.*`), memilih data **Master pasien** (`healthcare.patient`, didaftarkan `0008` di `data_sharing_types`), lalu legal entity yang saling melihat pasien. Kebijakan berlaku selama aktif, sejak tanggal berlaku mulai. Satu legal entity hanya boleh ikut satu kebijakan aktif per jenis data, seperti aturan F&O "a company and table can only be in one enabled policy"; kebijakan untuk jenis data lain tidak memengaruhi pasien. Module membacanya lewat `sharedLegalEntities` dari `@core/platform/data-sharing`. Kebijakan lama di tabel module dipindah `0008` dengan id yang sama, dan role yang memegang duty `healthcare.patient-sharing.*` mendapat duty `core.data-sharing.*` yang setara. Duty lama tetap di katalog tanpa menjaga route apa pun.
- **Mempersempit dalam legal entity:** unit yang ditempatkan sysadmin di hierarchy bertujuan **Tidak sharing master pasien** (`healthcare.patient-sharing`) hanya sharing dengan kelompoknya, jadi tujuan ini memisahkan pasien antar unit dalam satu legal entity, bukan membuka sharing. Labelnya diganti dari "Kelompok sharing pasien" oleh `0009_screen_terms.sql` (keputusan pemilik produk, 11 November 2026); kodenya tetap. Kepala kelompok sebuah unit adalah operating unit teratas di jalurnya ke akar, pada versi terbit yang sedang berlaku; kelompok adalah kepala itu beserta semua operating unit di bawahnya. Unit yang tidak ditempatkan memakai bawaan legal entity: ia sharing dengan semua unit lain yang juga tidak ditempatkan. Perilaku #45 "unit yang tidak ditempatkan menjadi kelompok sendiri" sudah tidak berlaku.
- **Kepemilikan tetap.** `sim_m_pasien` menyimpan party, legal entity, unit pendaftar (`org_unit_id`), unit pemilik nomor (`nrm_unit_id`), dan NRM sekali saat didaftarkan. Trigger `pemilik_tetap` menolak perubahannya, juga lewat SQL di luar module. Kelompok dan kebijakan dihitung saat data dibaca, tidak ditulis ke catatan pasien.

Urutan penerapan setiap daftar, detail, ubah, hapus, dan pemeriksaan NIK saat mendaftar (`PatientSharing.visible`):

1. tenant dari konteks tepercaya;
2. permission duty pasien (`healthcare.patient.read` dan seterusnya);
3. legal entity: legal entity pasien sama dengan legal entity aktif pengguna, atau sekebijakan Data sharing Master pasien yang aktif dan sudah berlaku dengannya;
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

| Duty                                                                                                     | Privilege                                                            | Permission                                                         |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `healthcare.patient.inquire` Lihat pasien                                                                | `patient.view`                                                       | `patient.read`                                                     |
| `healthcare.patient.manage` Kelola pasien                                                                | `patient.register`, `patient.maintain`, `patient.retire`             | `patient.read`, `.create`, `.update`, `.delete`                    |
| `healthcare.payment-setup.inquire` Lihat tipe pasien dan penjamin                                        | `patient-type.view`, `guarantor.view`                                | `patient-type.read`, `guarantor.read`                              |
| `healthcare.payment-setup.manage` Kelola tipe pasien dan penjamin                                        | `patient-type.maintain`, `guarantor.maintain`                        | `patient-type.read`, `.update`, `guarantor.read`, `.update`        |
| `healthcare.service-setup.inquire` Lihat section dan ruangan                                             | `section.view`, `room.view`                                          | `section.read`, `room.read`                                        |
| `healthcare.service-setup.manage` Kelola section dan ruangan                                             | `section.maintain`, `section.retire`, `room.maintain`, `room.retire` | `section.*` dan `room.*`: `.read`, `.create`, `.update`, `.delete` |
| `healthcare.practitioner.inquire` Lihat tenaga kesehatan                                                 | `practitioner.view`                                                  | `practitioner.read`                                                |
| `healthcare.practitioner.manage` Kelola tenaga kesehatan                                                 | `practitioner.maintain`                                              | `practitioner.read`, `.update`                                     |
| `healthcare.practice-schedule.inquire` Lihat jadwal praktik                                              | `practice-schedule.view`                                             | `practice-schedule.read`                                           |
| `healthcare.practice-schedule.manage` Kelola jadwal praktik                                              | `practice-schedule.maintain`, `practice-schedule.retire`             | `practice-schedule.read`, `.create`, `.update`, `.delete`          |
| `healthcare.visit.inquire` Lihat kunjungan                                                               | `visit.view`                                                         | `visit.read`                                                       |
| `healthcare.visit.manage` Daftarkan dan batalkan kunjungan                                               | `visit.register`, `visit.void`                                       | `visit.read`, `.create`, `.cancel`                                 |
| `healthcare.patient-sharing.inquire` Lihat kebijakan sharing pasien (tidak menjaga apa pun sejak `0008`) | `patient-sharing.view`                                               | `patient-sharing.read`                                             |
| `healthcare.patient-sharing.manage` Kelola kebijakan sharing pasien (tidak menjaga apa pun sejak `0008`) | `patient-sharing.maintain`                                           | `patient-sharing.read`, `.update`                                  |

Permission pasien dan kunjungan dilindungi kebijakan data `healthcare.patient-unit` (unit kerja wajib, turunan boleh), yang sejak `0015` bernama "Akses pasien dan kunjungan menurut unit kerja". Tipe pasien, penjamin, section, ruangan, nakes, dan jadwal praktik adalah data tenant, tidak dibatasi unit; daftar tipe pasien dan penjamin juga terbaca pemegang `healthcare.patient.read` karena dipakai form pasien. Module tidak membawa role bawaan: CoreERP tidak punya pola role bawaan dari module. Saat module dipasang (`installModule`), role pemilik tenant mendapat semua duty module.

## Tipe pasien dan perilakunya

Tipe pasien adalah master per tenant dengan id tetap, diisi dan diubah admin di layar **Tipe pasien**. Kode tidak pernah mencocokkan nama atau id tipe pasien; yang dibaca adalah perilaku yang dinyalakan tipe itu.

- Katalog perilaku ada di kode (`src/coverage/patient-type/patient-type.behaviors.ts`), dan setiap perilaku diimplementasikan sekali. Isinya sekarang hanya yang dipakai form pasien sistem lama:
    - `requires_guarantor`: isian Perusahaan (penjamin);
    - `requires_card_number`: isian No. asuransi.
- Tipe pasien menyalakan perilaku lewat satu baris per perilaku di `sim_m_tipe_pasien_perilaku`. Perilaku baru kelak (cek kepesertaan, mode tagihan, wajib rujukan) cukup menjadi kode baru di katalog; tabel dan data pasien tidak berubah.
- `sim_m_tipe_pasien.memakai_penjamin` dari `0001` masih ditulis sama dengan `requires_guarantor` untuk kode rilis sebelumnya, dan dibuang di rilis sesudahnya.
- **Tipe bawaan:** centang "Bawaan pasien baru" menandai paling banyak satu tipe per tenant (`sim_m_tipe_pasien_bawaan_unique`). Menandai tipe lain memindahkan tandanya. Penjamin punya tanda serupa, paling banyak satu per tipe pasien. Kartu pasien baru terisi tipe bawaan beserta penjamin bawaannya, dan pendaftaran lewat API tanpa cara bayar memakainya. Hanya tipe dan penjamin yang aktif yang dipakai. Tidak ada id yang ditulis di kode.
- **Batas kunjungan per poli per hari** (`sim_m_tipe_pasien.maks_kunjungan_per_poli_per_hari`, API `max_visits_per_section_per_day`): berapa kali pasien bertipe ini boleh didaftarkan ke poli yang sama dalam satu hari, aturan puskesmas (misalnya BPJS 1, Umum tanpa batas). 0 berarti tanpa batas dan menjadi nilai tipe yang sudah ada; tenant sendiri yang mengisi 1 untuk tipe BPJS-nya. Sistem lama tidak punya kolom ini. Pendaftaran kunjungan menolak pendaftaran yang melewati batas (lihat [Pendaftaran kunjungan](#pendaftaran-kunjungan)).

## Layar

Katalog aplikasi Shell menampilkan module ini sebagai satu aplikasi bernama `apps.name`, bila tenant berhak dan module terpasang. Bila tenant berhak tetapi module belum terpasang, ia tampil nonaktif dengan keterangan "Belum dipasang". Grup menu di rail sama dengan folder di `src/`, dan URL halaman berawalan folder itu:

| Kelompok sidebar | Folder              | Halaman                                                                                                                             |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard        | `src/dashboard/`    | Dashboard (`/healthcare/dashboard`), halaman pertama area dan halaman awal pengguna. Isinya belum diputuskan; kerangka kosong       |
| Pasien           | `src/patient/`      | Pasien (`patient/`); aturan siapa melihat pasien di `patient-sharing/` tanpa halaman                                                |
| Penjaminan       | `src/coverage/`     | Tipe pasien (`patient-type/`), Penjamin (`guarantor/`)                                                                              |
| Pelayanan        | `src/service/`      | Section (`section/`), Ruangan (`room/`), Sesi praktik, Template jadwal, Jadwal praktik, dan Parameter jadwal (`practice-schedule/`) |
| Tenaga kesehatan | `src/practitioner/` | Nakes (`practitioner/`)                                                                                                             |

URL sebelum 11 November 2026 (`/healthcare/patients`, `/healthcare/patient-types`, `/healthcare/guarantors`) dialihkan ke alamat barunya. `/healthcare/sharing-policies` dan `/healthcare/patient/sharing-policies` dialihkan ke `/sysadmin/data-sharing`.

- **Pasien** (`/healthcare/patient/patients`): daftar dengan pencarian di toolbar dan filter status serta tipe pasien di panel kiri, dan kartu pasien dengan urutan isian form lama dalam tiga kelompok (identitas dan cara bayar bawaan; data tambahan; alamat KTP dan domisili). Kode pos tidak tampil, seperti form lama; komponen alamat bersama tetap menampilkannya di layar lain (`showPostalCode`).
- Kartu hanya mengelola cara bayar bawaan (utama). Cara bayar lain yang tersimpan lewat API tidak tampil dan dikirim balik apa adanya.
- **Tipe pasien** (`/healthcare/coverage/patient-types`) dan **Penjamin** (`/healthcare/coverage/guarantors`).
- **Section** (`/healthcare/service/sections`): daftar dengan pencarian di toolbar dan filter unit, jenis, serta status di panel kiri. Kartu section memilih ruangan yang melayaninya dari ruangan unit yang sama.
- **Ruangan** (`/healthcare/service/rooms`): daftar dengan pencarian di toolbar dan filter unit serta status di panel kiri.
- **Sesi praktik** (`/healthcare/service/practice-sessions`): daftar dengan pencarian di toolbar dan filter status di panel kiri, dan kartu sesi.
- **Template jadwal** (`/healthcare/service/schedule-templates`): pilih section, lalu delapan kolom Senin sampai Minggu dan Hari libur, masing-masing berisi nakes, sesi, dan kapasitasnya. Tambah di kolom membuka kartu template dengan hari itu.
- **Jadwal praktik** (`/healthcare/service/practice-schedules`): pilih section dan minggu (bawaan minggu ini), lalu tujuh kolom tanggal berisi jadwal bertanggal: nakes (dan yang digantikannya), sesi dan jam, terdaftar dan kapasitas, serta status. Kartu jadwal mengubah status (Batal dengan alasan), nakes pengganti, dan kapasitas. Baru membuat jadwal tambahan di luar template; Generate jadwal menyusun jadwal dari template.
- **Parameter jadwal** (`/healthcare/service/schedule-parameters`): Generate jadwal otomatis (aktif atau tidak) dan Jumlah hari ke depan. Halaman satu record yang langsung terbuka untuk diubah bagi pemegang izin ubah jadwal praktik.
- **Nakes** (`/healthcare/practitioner/practitioners`): daftar dengan pencarian nama dan no. SIP di toolbar, filter profesi dan status di panel kiri, dan kartu nakes.
- Penjaminan, Pelayanan, dan Tenaga kesehatan adalah bagian rail **Setup**; judul bagian mengikuti folder domainnya.
- Menu module ditulis migration ke `apps.navigation` (terakhir ditulis utuh oleh `0010_setup_rail.sql`; sejak `0011_section.sql` migration menambah item ke grupnya tanpa menimpa item lain) dan disaring Shell dengan permission tiap entri.
- Ikon module di katalog aplikasi ditulis ke `apps.icon` (`heart-pulse`), dan ikon setiap grup rail ke `icon` di grup `apps.navigation`: Dashboard `layout-dashboard`, Pasien `users`, Penjaminan `shield-plus`. Isinya nama ikon lucide; nama yang tidak dikenal Shell (`src/platform/shell/navigation-icons.ts`) memakai ikon bawaan.

## Penjamin

Penjamin adalah party organisasi berperan `healthcare.guarantor`, dicatat untuk satu tipe pasien di `sim_m_penjamin`. `POST .../guarantors` memakai organisasi yang sudah ada di buku alamat (`party_id`) atau membuat party organisasi baru (`name`). Nama penjamin diubah di buku alamat.

## Tenaga kesehatan

Nakes (dokter, dokter gigi, bidan, perawat, apoteker, analis, lainnya) mengikuti pola pasien: party orang berperan `healthcare.practitioner` ("Tenaga kesehatan"), didaftarkan untuk legal entity aktif, dan dicatat di `sim_m_nakes` satu baris per orang per tenant (`sim_m_nakes_party_unique`). Ditambahkan `0012_practitioner.sql` (keputusan pemilik produk, 11 November 2026). Pendaftaran kunjungan kelak memilih nakes dari yang punya jadwal praktik (lihat [Jadwal praktik](#jadwal-praktik)).

| Data                                               | Tempat                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| Nama, jenis kelamin, NIK, nomor HP                 | party, nomor identitas, dan kontak party Core                             |
| Profesi, spesialisasi, no. SIP, SIP berlaku sampai | `sim_m_nakes` (`profesi`, `spesialisasi`, `no_sip`, `sip_berlaku_sampai`) |
| Kode dokter BPJS, akun login, status aktif         | `sim_m_nakes` (`kode_dokter_bpjs`, `user_id`, `aktif`)                    |

- Profesi adalah kode dari katalog di kode (`src/practitioner/practitioner/practitioner.professions.ts`): `dokter`, `dokter_gigi`, `bidan`, `perawat`, `apoteker`, `analis`, `lainnya`.
- `POST .../practitioners` memakai orang yang sudah ada di buku alamat (`party_id`) atau membuat orang baru dari nama, NIK, jenis kelamin, dan nomor HP. Hanya nama yang wajib. Memilih dari buku alamat ditawarkan di layar bagi pemegang izin buku alamat (`core.organization.read`), karena daftarnya daftar party Core.
- Sesudah dibuat, nama dan identitas diubah di Buku alamat; kartu nakes mengubah profesi, SIP, kode dokter BPJS, akun login, dan status.
- Masa berlaku SIP hanya dicatat. Tidak ada aturan yang menolak nakes dengan SIP habis (keputusan pemilik produk: tidak menambah aturan bisnis sendiri).
- Akun login opsional, dipilih dari anggota aktif tenant.

## Endpoint

Semua di bawah `/api/modules/healthcare/v1`.

| Endpoint                                                                                                                                                                                                | Izin                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /patients` (cari: nama, NRM, NRM lama, NIK, nomor kartu, nomor HP, alamat, tanggal lahir yyyy-mm-dd, dd-mm-yyyy, ddmmyyyy, yyyymmdd; saring status, tipe pasien, unit pendaftar)                   | `patient.read`                                               |
| `GET /patients/metadata` (termasuk cara bayar bawaan)                                                                                                                                                   | `patient.read`                                               |
| `GET /patients/{id}`                                                                                                                                                                                    | `patient.read`                                               |
| `POST /patients`                                                                                                                                                                                        | `patient.create`                                             |
| `PATCH /patients/{id}`                                                                                                                                                                                  | `patient.update`                                             |
| `DELETE /patients/{id}` (mengisi `deleted_at`)                                                                                                                                                          | `patient.delete`                                             |
| `GET, POST /patient-types`, `PATCH, DELETE /patient-types/{id}`                                                                                                                                         | `patient-type.read` / `.update`                              |
| `GET /sections/metadata` (pilihan unit, ruangan, dan izin layar)                                                                                                                                        | `section.read`                                               |
| `GET, POST /sections` (cari: nama, unit, kode nomor bukti; saring `operating_unit_id`, `kind`, `status`), `PATCH, DELETE /sections/{id}`                                                                | `section.read` / `.create` / `.update` / `.delete`           |
| `GET /rooms/metadata` (pilihan unit dan izin layar)                                                                                                                                                     | `room.read`                                                  |
| `GET, POST /rooms` (cari: kode, nama, lantai, nama di layar antrean; saring `operating_unit_id`, `status`), `PATCH, DELETE /rooms/{id}`                                                                 | `room.read` / `.create` / `.update` / `.delete`              |
| `GET, POST /guarantors`, `PATCH, DELETE /guarantors/{id}`                                                                                                                                               | `guarantor.read` / `.update`                                 |
| `GET /practitioners` (cari: nama, no. SIP; saring profesi, status), `GET /practitioners/metadata`                                                                                                       | `practitioner.read`                                          |
| `POST /practitioners`, `PATCH, DELETE /practitioners/{id}`, `GET /practitioners/users` (akun anggota tenant)                                                                                            | `practitioner.update`                                        |
| `GET /practice-schedules/metadata` (section aktif, sesi, kalender, izin), `GET /practice-schedules/practitioners` (nakes aktif untuk pemilih)                                                           | `practice-schedule.read`                                     |
| `GET, POST /practice-sessions` (cari: nama; saring `status`), `PATCH, DELETE /practice-sessions/{id}`                                                                                                   | `practice-schedule.read` / `.create` / `.update` / `.delete` |
| `GET /schedule-templates?section_id=`, `POST /schedule-templates`, `PATCH, DELETE /schedule-templates/{id}`                                                                                             | `practice-schedule.read` / `.create` / `.update` / `.delete` |
| `GET /practice-schedules?section_id=&from=&to=` (paling panjang 42 hari), `POST /practice-schedules` (jadwal tambahan), `PATCH /practice-schedules/{id}`                                                | `practice-schedule.read` / `.create` / `.update`             |
| `GET /practice-schedules/parameters`, `PUT /practice-schedules/parameters` (`auto_generate`, `horizon_days`, `version`)                                                                                 | `practice-schedule.read` / `.update`                         |
| `POST /practice-schedules/generate` (`from`, `to`, `section_id` opsional; paling panjang 92 hari)                                                                                                       | `practice-schedule.create` dan `.update`                     |
| `GET /visits/metadata` (tanggal hari ini, tipe pasien beserta perilaku dan penjamin, keadaan pasien, skrining, section di unit pengguna beserta jadwal hari ini)                                        | `visit.read`                                                 |
| `GET /visits` (`from` dan `to` bawaan hari ini, paling panjang 366 hari; saring `section_id`, `practitioner_id`, `patient_type_id`, `status`; `patient_id`; cari NRM, nama, NoReg; `counts` per status) | `visit.read`                                                 |
| `GET /visits/{id}`                                                                                                                                                                                      | `visit.read`                                                 |
| `POST /visits` (header `Idempotency-Key` opsional)                                                                                                                                                      | `visit.create`                                               |
| `POST /visits/{id}/cancel` (`version`, `reason`)                                                                                                                                                        | `visit.cancel`                                               |

## Section

Section adalah poli atau titik layanan lain di satu operating unit (faskes), padanan `SIMmSection` sistem lama. Pendaftaran kunjungan kelak memilih section; tenaga kesehatan dan jadwal menyusul. Ruangan tidak dipilih saat pendaftaran dan tidak ditetapkan di jadwal dokter: petugas yang memanggil pasien berikutnya yang memilih ruangannya (PR berikutnya).

- Satu section milik satu operating unit (`operating_unit_id`). Namanya unik per unit selama belum dihapus (`sim_m_section_nama_unique`).
- Jenis section adalah kode dari katalog di kode (`src/service/section/section.kinds.ts`) beserta labelnya: `rawat_jalan` Rawat jalan, `gawat_darurat` Gawat darurat, `rawat_inap` Rawat inap, `penunjang` Penunjang, `farmasi` Farmasi, `kasir` Kasir. Kodenya disimpan di `sim_m_section.jenis`.
- Tidak ada kode otomatis. `kode_no_bukti` adalah kode pendek opsional yang diketik pengguna dan kelak menjadi segmen nomor pemeriksaan; `kode_poli_bpjs` opsional.
- **Ruangan** (`sim_m_ruangan`) adalah ruang fisik per operating unit, misalnya L1R1..L1R3, L2R1, dan L2R2 seperti di sistem lama, diisi di layar Ruangan. Kodenya unik per unit selama belum dihapus (`sim_m_ruangan_kode_unique`); `urutan` mengurutkannya di unit itu.
- **Ruangan section** (`sim_m_section_ruangan`): banyak ke banyak, karena satu ruang fisik bisa melayani "Poli Umum" dan "Poli Umum Sore" yang sengaja dipisah supaya laporan bisa menyaringnya. Kartu section memilih ruangannya; API menerima `room_ids` lengkap, ruangan yang tidak disebut lagi dilepas (dihapus lunak), dan tanpa `room_ids` ruangan tidak disentuh. Section hanya menerima ruangan unit section itu sendiri, juga saat section pindah unit. Unit ruangan tidak bisa diganti selama section masih memakainya.
- **Antrean**: `mode_antrean` adalah kode dari katalog di kode (`src/service/section/section.queue-modes.ts`), bawaan `bersama`. `bersama`: satu nomor per section per hari dipakai semua ruangan, dan ruangan terikat saat ruangan memanggil pasien, seperti sistem lama. `per_jadwal`: satu nomor per sesi praktik atau jadwal dokter. `awalan_antrean` adalah awalan pendek opsional, misalnya `A` menjadi `A-012`. Nomor antrean mulai lagi setiap hari, jadi tidak ada kolom periode. Belum ada yang menerbitkan nomor antrean; pendaftaran kunjungan yang kelak melakukannya.
- Delete mengisi `deleted_at`. Section yang dihapus tidak tampil, melepas namanya, dan melepas ruangannya; ruangan yang dihapus lepas dari setiap section yang memakainya.
- Pilihan unit dibaca module langsung dari `organizations` dan `operating_units` Core, karena daftar organisasi Core dijaga izin organisasi.

## Jadwal praktik

Pendaftaran kunjungan kelak menawarkan nakes yang punya jadwal praktik di section itu pada hari itu. Tidak ada tabel penugasan nakes ke section terpisah (keputusan pemilik produk, 11 November 2026). Bentuknya mengikuti sistem lama (template mingguan `SIMtrDokterJagaDefault`, jadwal bertanggal `SIMtrDokterJagaDetail`, sesi `SIMmWaktuPraktek`, prosedur `GenerateJadwalDokterMingguan`) dengan pola F&O "Compose working times". Ditambahkan `0014_practice_schedule.sql`.

| Tabel                   | Isi                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sim_m_sesi_praktik`    | Sesi: nama, jam mulai dan selesai. `lewat_tengah_malam` dihitung database (selesai pada atau sebelum jam mulai), jadi 20:00-08:00 jaga malam dan 08:00-08:00 jaga 24 jam. Tanpa kode.                                              |
| `sim_m_jadwal_template` | Template mingguan per nakes, section, hari, dan sesi, dengan kapasitas, kalender libur, dan masa berlaku. `hari` 1..7 = Senin..Minggu, 8 = template hari libur. Satu template aktif per kunci itu.                                 |
| `sim_tr_jadwal_praktik` | Jadwal bertanggal. Jam, tanggal selesai, dan kapasitas disalin. `sumber` `template`, `manual`, atau kelak `impor_bpjs`; `status` `terjadwal` atau `batal` dengan `alasan_batal`. Satu baris per nakes, section, tanggal, dan sesi. |

- **Kapasitas.** Kosong (NULL) berarti tanpa batas; angka yang diisi paling kecil 1. Kapasitas jadwal tidak boleh diturunkan di bawah jumlah pasien yang sudah terdaftar. `jumlah_terdaftar` kelak dinaikkan pendaftaran kunjungan.
- **Generate jadwal** (`generatePracticeSchedule` di `practice-schedule.service.ts`) aman diulang. Tanggal tanpa baris mendapat baris dari template aktif yang berlaku. Baris dari template yang belum disentuh (`diubah_manual` false dan `jumlah_terdaftar` 0) diperbarui bila templatenya berubah, dan diarsipkan bila tidak ada lagi template yang menurunkannya. Baris manual, baris yang diubah di layar, dan baris yang sudah punya pendaftar tidak pernah disentuh. Template, nakes, section, dan sesi yang nonaktif tidak ikut.
- **Hari libur** datang dari kalender Core yang dipasang di template (`calendar_id`). Pada tanggal yang disusun dan ditutup kalender itu, jadwal hari itu tetap ditulis dengan status `batal` dan alasan "Hari libur", supaya terlihat di layar. Bila ada template hari libur (hari 8) dengan kalender itu untuk nakes, section, dan sesi yang sama, template itulah yang dipakai. Tanggal yang belum disusun di kalender tidak dihitung libur, berbeda dari pembacaan kalender biasa: kalender yang lupa disusun tidak boleh membatalkan seluruh jadwal.
- **Batal** mengisi status dan alasan; barisnya tidak dihapus. **Nakes pengganti** (`nakes_pengganti_id`) disimpan di baris bertanggal. Setiap perubahan di layar menandai `diubah_manual`.
- **Untuk pendaftaran**, `schedulesForRegistration(db, { tenantId, sectionId, date })` di `practice-schedule.service.ts` mengembalikan jadwal terjadwal di section aktif, dengan nakes yang benar-benar praktik (pengganti bila ada, dan masih aktif), jam sesi, kapasitas, jumlah terdaftar, dan `full`. Jadwal tanpa kapasitas tidak pernah penuh. Pendaftaran kunjungan menaikkan `jumlah_terdaftar`, dan pembatalan menurunkannya.
- **Generate otomatis** diatur di Parameter jadwal (`sim_m_parameter_jadwal`, satu baris per tenant, pola halaman parameters F&O; ditambahkan `0017_schedule_parameters.sql`, keputusan pemilik produk 12 November 2026). Tanpa baris, generate otomatis aktif untuk 7 hari; horizon 1 sampai 92 hari, sama dengan rentang terpanjang satu kali generate. Repo ini belum punya penjadwal per tenant (worker hanya menjalankan operasi dari control plane), jadi `ensurePracticeSchedule` di `practice-schedule.service.ts` menjalankan `generatePracticeSchedule` untuk hari ini (zona waktu legal entity aktif) sampai horizon saat jadwal dibaca: daftar Jadwal praktik dan `GET /visits/metadata`. Agar pembacaan tidak mengulang pekerjaan, `sim_tr_jadwal_generate` mencatat tanggal terakhir yang digenerate dan sidik master (jumlah baris ditambah jumlah versi template, sesi, nakes, dan section). Generate dilewati selama rentang itu sudah tercakup dan sidiknya sama, jadi ia berjalan sekali sehari dan sekali lagi setiap kali master itu berubah. Perubahan kalender libur sampai pada generate hari berikutnya, atau lewat tombol. Setelan mati berarti tidak ada generate otomatis sama sekali; tombol Generate jadwal tetap ada untuk rentang mana pun.

## Pendaftaran kunjungan

Petugas mendaftarkan kunjungan rawat jalan pasien ke satu section dan satu nakes yang punya jadwal praktik hari itu. Bentuknya mengikuti sistem lama (kepala `SIMtrRegistrasi`, tujuan per section `SIMtrDataRegPasien`); padanan Microsoft-nya Encounter di Cloud for Healthcare. Ditambahkan `0015_registration.sql` (keputusan pemilik produk, 11 November 2026).

Layarnya di grup rail **Pendaftaran** (`0016_registration_navigation.sql`, sesudah Pasien dan sebelum Setup):

- `/healthcare/registration/visits`: daftar registrasi seperti "Daftar registrasi" sistem lama. Penghitung status di toolbar sekaligus saringan status; filter di kiri untuk tanggal (bawaan hari ini), tipe pasien, nakes, poli, dan status; pencarian NRM, nama, atau NoReg. Klik dua kali baris membuka kunjungannya.
- `/healthcare/registration/visits/new?patient=<id>`: pendaftaran di halaman penuh. Data pasien di kiri beserta riwayat kunjungan, data kunjungan, skrining visual, dan tujuan (instalasi, poli, dokter hari ini dari jadwal beserta kuotanya) di kanan. Aksi Registrasi kunjungan di kartu pasien membuka halaman ini dengan pasiennya. Pasien dipilih lewat lookup Pasien: hasil (NRM, nama, NIK, tanggal lahir, alamat) dimuat saat mengetik dan bertambah saat digulir, kaca pembesar membuka Daftar lengkap, dan Baru di lookup sama dengan aksi Pasien baru di toolbar: kartu pasien baru terbuka, dan pasien yang tersimpan langsung terpilih. Tipe pasien dan Perusahaan memakai lookup yang sama dengan kartu pasien. Penolakan API tampil di field-nya dengan pesan sistem lama.
- `/healthcare/registration/visits/<id>`: halaman yang sama dalam keadaan terkunci, dengan panel nomor antrean, NoReg, dan NoBukti, serta aksi Batalkan registrasi yang meminta alasan.

| Tabel                        | Isi                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sim_tr_registrasi`          | Kepala kunjungan: NoReg, legal entity, unit, pasien, tanggal dan jam daftar, salinan cara bayar, tinggi dan berat badan, sakit atau sehat, umur saat daftar, baru atau lama, kategori skrining, status, dan data batal.  |
| `sim_tr_registrasi_tujuan`   | Tujuan per section: jadwal praktik, nakes yang praktik (pengganti bila ada), nomor dan kode antrean, NoBukti, status tujuan, dan ruangan (diisi kelak saat ruangan memanggil). Pendaftaran sekarang menulis satu tujuan. |
| `sim_tr_registrasi_keadaan`  | Keadaan pasien yang dicentang, dari `sim_m_keadaan_pasien`.                                                                                                                                                              |
| `sim_tr_registrasi_skrining` | Tanda skrining visual yang dicentang, dari `sim_m_skrining_tanda`.                                                                                                                                                       |
| `sim_tr_antrean_penghitung`  | Nomor antrean terakhir per section per hari, atau per jadwal praktik untuk section bermode `per_jadwal`.                                                                                                                 |

`POST /visits`, dalam satu transaksi:

1. Pasien harus terlihat bagi pengguna (aturan [Siapa melihat pasien mana](#siapa-melihat-pasien-mana)) dan aktif. Barisnya dikunci sampai transaksi selesai, supaya batas kunjungan dan baru/lama tetap benar bila pasien yang sama didaftarkan serentak.
2. Section harus aktif, dan unitnya termasuk unit yang diberikan kepada pengguna lewat kebijakan data pasien. Unit section menjadi unit kunjungan, dan legal entity aktif menjadi legal entity kunjungan.
3. Cara bayar: tipe pasien aktif wajib. Penjamin wajib bila tipe itu menyalakan `requires_guarantor`, nomor kartu wajib bila menyalakan `requires_card_number`, dan penjamin harus terdaftar untuk tipe itu. Berbeda dari master pasien, API kunjungan menegakkan kedua perilaku itu.
4. Batas kunjungan: bila tipe pasien membatasi (`maks_kunjungan_per_poli_per_hari` lebih dari 0) dan pasien sudah punya sebanyak itu kunjungan yang tidak batal di section ini hari ini, pendaftaran ditolak dengan pesan sistem lama persis: "Pasien sudah memiliki registrasi hari ini di poli yang sama.".
5. Jadwal: section yang punya jadwal apa pun hari itu, termasuk yang batal, mewajibkan jadwal praktik yang terjadwal di section dan tanggal itu, dengan nakes aktif. Section tanpa jadwal hari itu, misalnya laboratorium, didaftarkan tanpa nakes. Baris jadwal dikunci. Bila kapasitasnya terisi, pendaftaran ditolak ("Kuota jadwal dokter ini sudah penuh."); selain itu `jumlah_terdaftar` naik satu.
6. Nomor antrean diambil dari penghitung dengan `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, tidak pernah dari klien. Kode antrean adalah awalan antrean section dan nomor tiga digit, misalnya `A-012`.
7. NoReg (`healthcare.visit-number`) dan NoBukti (`healthcare.examination-number`) dari `NumberIssuer`, scope operating unit section. Kode nomor bukti section (`kode_no_bukti`) dikirim sebagai nilai konteks `section`, untuk admin yang memasang segmen konteks itu di formatnya.
8. Kepala, tujuan, keadaan, dan skrining ditulis. Umur dihitung dari tanggal lahir pada tanggal kunjungan. Kunjungan berjenis `lama` bila pasien sudah punya kunjungan yang tidak batal di bulan kalender yang sama (aturan sistem lama), selain itu `baru`. Kategori skrining adalah kategori paling gawat (`tingkat` terkecil) di antara tanda yang dicentang.
9. Cara bayar kunjungan menimpa cara bayar utama pasien, atau menjadi cara bayar utama bila pasien belum punya, seperti sistem lama yang menimpa `mPasien` setiap pendaftaran.

Tanggal kunjungan adalah hari ini menurut zona waktu legal entity aktif. Kunci `Idempotency-Key` yang sama mengembalikan kunjungan yang sama. Jadwal sesi malam yang berakhir besok hanya ditawarkan pada tanggal mulainya.

**Nomor.** NoReg dan NoBukti unik per tenant (`sim_tr_registrasi_no_reg_unique` dan `sim_tr_registrasi_tujuan_no_bukti_unique`), supaya sharing pemeriksaan antar legal entity kelak tidak memerlukan penomoran ulang. Karena itu reference-nya `numbers_unique_per_scope` false, sehingga Nomor dokumen menolak dua sequence yang bisa menghasilkan nomor sama. Format bawaannya mencetak nomor unit: `<nomor unit>-REG-00000001` dan `<nomor unit>-RJ-00000001`, non-continuous, 1 sampai 99999999, tanpa reset. Setiap operating unit mendapat kedua sequence itu dari Core (`default_per_operating_unit`), dan `0015` mengisinya untuk unit tenant yang sudah berhak. Unit tanpa nomor unit ditolak saat menerbitkan, dengan pesan dari Nomor dokumen untuk mengisinya.

**Status.** `terdaftar` lalu `diperiksa` lalu `selesai`, atau `terdaftar` lalu `batal`; perpindahannya dijaga `visit.statuses.ts`. Batal (`POST /visits/{id}/cancel`) butuh alasan dan versi kunjungan, hanya dari `terdaftar`, mengisi `batal_oleh`, `batal_pada`, dan `alasan_batal`, menandai tujuan batal, dan menurunkan `jumlah_terdaftar` jadwalnya. Kunjungan yang sudah diperiksa ditolak dengan pesan sistem lama persis: "Gagal Batal Registrasi! Pasien dengan Registrasi ini sudah dilakukan Pemeriksaan.". Batal setelah dibayar menyusul bersama kasir.

**Data acuan.** Keadaan pasien (Handaya, Difabel, Lansia, Lain-lain) dan skrining visual (Merah, Oranye, Kuning, Hijau beserta tandanya) adalah baris per tenant, bukan daftar di kode. `warna` kategori berisi nama token warna layar, misalnya `triage-red`; tokennya ditambahkan bersama layar. `0015` mengisi data acuan untuk tenant yang sudah memasang module. Trigger `sim_isi_acuan_registrasi` di `core_module_installations` mengisinya saat tenant lain memasang module ini, karena di database bersama migration module hanya berjalan sekali. Tabel yang sudah punya baris untuk tenant itu, termasuk yang dihapus, tidak diisi ulang.

**Siapa melihat kunjungan mana.** Kunjungan legal entity aktif, di unit yang diberikan kepada pengguna lewat kebijakan data pasien; batas "seluruh organisasi" melihat semua unit. Yang lain dijawab 404.

**Daftar.** Penghitung `counts` (`waiting` terdaftar, `in_examination` diperiksa, `done` selesai, `cancelled` batal, dan `total`) mengikuti saringan tanggal, section, nakes, dan tipe pasien, tetapi tidak saringan status dan pencarian, supaya angka setiap status tetap terlihat saat satu status dipilih.

**Event.** `healthcare.visit.registered.v1` belum diterbitkan: repo ini belum punya penerbit event maupun kontrak event. Tabel `outbox_events` dari baseline CoreERP ada, tetapi tidak ada kode yang menulis atau mengirimnya.

## Dicatat untuk nanti

- **Ambil data PCare dari NIK** untuk pasien BPJS kelak menjadi perilaku di katalog tipe pasien, dijalankan module BPJS. Belum dibangun.

## Belum dibuat

Sesuai keputusan pemilik produk: NRM per poli (`mPasienNRM`), layar pendaftaran kunjungan, pemeriksaan, cetak general consent, riwayat pemeriksaan, dokumen pasien, merge NRM, serta harga dan tarif. Uji beban dan kebenaran module ini juga belum dijalankan.
