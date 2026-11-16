# Identitas fasyankes, lokasi, pasien, dan nakes

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pasien dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/) (disunting 2024-12-05) · [Patient](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/patient/) (disunting 2024-12-15) · [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md)

Pemetaan Organization, Location, Patient, dan Practitioner sudah dipakai untuk satu fixture demo dan lolos baca balik Encounter awal. Gunakan nomor IHS dummy hanya di Sandbox. Keputusan mapping otomatis berdasarkan NIK Practitioner dan pengelolaan pemetaan produk tetap tercatat pada backlog. [Pemetaan fixture](../pengujian/backlog-rawat-jalan-tanpa-resep.md#pemetaan-fixture-sebelum-uji-encounter) · [Bukti Encounter awal](../pengujian/backlog-rawat-jalan-tanpa-resep.md#bukti-uji-encounter-awal-di-sandbox)

Gunakan matriks ini untuk orientasi sebelum mengirim kunjungan. [Urutan implementasi identitas](../pengujian/prioritas-implementasi.md#1-identitas-dan-koneksi) · [Cara membaca matriks](aturan-field-fhir.md#cara-membaca-matriks)

[Patient](#patient) · [Practitioner](#practitioner) · [Organization](#organization) · [Location](#location)

## Patient

Alur biasa memakai `GET /Patient?identifier=...` untuk mendapatkan `Patient.id` dari MPI. Baris registrasi baru di bawah hanya berlaku setelah pasien tidak ditemukan dan memenuhi syarat alur MPI yang sesuai. Untuk pasien tanpa NIK atau dengan identitas lain, ikuti cabang MPI resmi. [MPI pasien dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/) · [Service pasien](../../../../modules/healthcare/src/patient/patient/patient.service.ts) · [Profil Patient](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/patient/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| Query `identifier` | W untuk pencarian berdasarkan NIK | `party_identifications.number` dengan `type_code = 'nik'` dari party milik pasien | Tambah pencocokan hasil MPI. NRM adalah identitas lokal. |
| `id` | W sebagai balikan untuk referensi `Patient/{id}` | `sim_m_pasien.id` hanya kunci lokal | Penyimpanan nomor IHS dan status verifikasi belum ditemukan. |
| `identifier[]` | W pada registrasi MPI dengan NIK | `party_identifications` | Petakan sistem identifier NIK dan aturan verifikasi. |
| `name[]`, `birthDate`, `gender` | W pada registrasi MPI dengan NIK | `parties.name`, `birth_date`, `gender` | Bentuk nama dan kode gender FHIR. Validasi kesesuaian dengan identitas resmi. |
| `address[]`, `address.extension[]` | W pada registrasi MPI dengan NIK menurut tabel persyaratan minimum | Alamat party dari `PartyAddresses` dan master wilayah | Cocokkan kode wilayah Kemendagri dan persyaratan verifikasi MPI; periksa data alamat yang belum lengkap. |
| `telecom[]` | P. Tabel minimum dan langkah POST memberi rincian berbeda untuk nomor telepon | Kontak party dari `PartyAddresses` | Konfirmasi kewajiban telepon dan formatnya di Sandbox. |
| `birthPlace`, status kawin, kewarganegaraan, bahasa | K sesuai skenario dan ekstensi MPI | `parties.birth_place`, `marital_status`, `nationality_country_code`, `language` | Tentukan ekstensi dan pemetaan kode. Jangan memakai nilai default untuk mengganti fakta yang bertentangan. |

## Practitioner

`GET /Practitioner?identifier=...` melalui Master Nakes Index. Nomor IHS hasil pencarian dipakai di referensi klinis; jangan membuat Practitioner dari akun login Metta. [Prasyarat nakes](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#alur-integrasi) · [Master nakes di Metta](../../../../modules/healthcare/README.md#tenaga-kesehatan) · [Profil Practitioner](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/practitioner/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| Query `identifier` | W untuk pencarian dengan identifier | NIK party dari `sim_m_nakes.party_id` ke `party_identifications` | Konfirmasi sistem identifier dan penyelesaian hasil kosong atau ganda. |
| `id` | W sebagai balikan untuk referensi `Practitioner/{id}` | `sim_m_nakes.id` dan nakes pelaku pada fakta klinis | Pemetaan IHS nakes belum ditemukan. |
| `name[]` | K untuk nama pada referensi atau akses SSRME | `parties.name` | Tentukan nama yang cocok dengan catatan SATUSEHAT untuk kasus yang memerlukannya. |
| Bukti SIP dan fasyankes aktif | K untuk akses SSRME, sesuai Juknis | `sim_m_nakes.no_sip`, `sip_berlaku_sampai` | Validasi SIP nasional untuk fasyankes yang sedang melayani. Tanggal lokal belum membuktikan status nasional. |

## Organization

Gunakan `GET /Organization/{id}` untuk organisasi yang telah terdaftar. `POST /Organization` hanya jika skenario memerlukan suborganisasi. [Prasyarat Playbook](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#alur-integrasi) · [Profil Organization](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/organization/) · [Model organisasi Metta](../../01a-tenant-and-org-hierarchy.md)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `id` | W sebagai balikan untuk referensi `Organization/{id}` | `legal_entities.organization_id`, `organizations.id` lokal | Simpan ID induk SATUSEHAT per fasyankes dan ID suborganisasi yang dipakai. |
| `identifier[]`, `identifier[].system`, `identifier[].value` | P untuk minimum badan request orientasi | `legal_entities.company_code`, `operating_units.number` | Setujui identifier stabil dan namespace organisasi SATUSEHAT. |
| `active`, `name` | P untuk minimum badan request orientasi | `organizations.status`, `organizations.name` | Petakan status aktif dan gunakan nama resmi unit. |
| `partOf` | K untuk suborganisasi yang merujuk induk | Hierarki organisasi yang berlaku | Gunakan `Organization/{id}` induk yang sudah diverifikasi. |
| `type`, `telecom`, `address`, `contact.purpose.coding` | K/P sesuai orientasi. Coding tujuan kontak ditandai wajib di dalam kelompok kontak terkait | Klasifikasi organisasi dan data kontak atau alamat yang relevan | Konfirmasi jenis dan minimum field untuk orientasi. |

## Location

`GET /Location/{id}` untuk verifikasi dan `POST /Location` bila poli atau ruang perlu didaftarkan. [Prasyarat lokasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#alur-integrasi) · [Profil Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) · [Model section dan ruangan](../../../../modules/healthcare/README.md#section)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `id` | W sebagai balikan untuk referensi `Location/{id}` | `sim_m_section`, `sim_m_ruangan`, `bill_farmasi.lokasi_id` | Tetapkan lokasi SATUSEHAT yang mewakili tiap poli atau ruangan. Lokasi stok farmasi perlu pemetaan tersendiri bila berbeda dari tempat layanan. |
| `identifier[]`, `identifier[].system`, `identifier[].value` | P untuk minimum pendaftaran lokasi | Identitas dan kode section atau ruangan | Bentuk identifier stabil dengan namespace `location` fasyankes. |
| `status`, `name`, `mode`, `physicalType`, `managingOrganization` | P untuk minimum pendaftaran lokasi | Status, nama, section, ruang, dan legal entity | Tentukan status, tipe fisik, dan ID organisasi pengelola sesuai profil orientasi. |
| `partOf`, `address` | K/P sesuai hierarki dan profil lokasi | Relasi section dan ruangan, serta alamat fasyankes bila berlaku | Petakan ke lokasi induk. |
| `position.longitude`, `position.latitude`, `extension.serviceClass` | K/P. Ditandai di profil Location; verifikasi kelompok yang berlaku untuk poli dan ruangan | Belum ditemukan pemetaan koordinat dan kelas layanan nasional | Jika `position` dikirim, lengkapi koordinat yang sah. Uji penerapan kelas per jenis lokasi. |
