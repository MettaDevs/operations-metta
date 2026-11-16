# Onboarding, OAuth, Organization, Location, dan Practitioner

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Panduan Registrasi](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/) (disunting 2025-07-16) · [Kode Akses API ( Sandbox )](https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-sandbox/) (disunting 2026-01-22) · [Kode Akses API ( Production )](https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-production/) (disunting 2024-08-15)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Matriks identitas](../payload/matriks-identitas.md) · [Master Patient Index](master-data-pasien.md)

Tahap orientasi memastikan credential per fasyankes dapat mengakses resource nasional yang benar sebelum mengirim kunjungan. Pemetaan lokal menghubungkan legal entity dan unit ke Organization, poli atau ruang layanan ke Location, serta nakes ke Practitioner. Patient memiliki [alur MPI tersendiri](master-data-pasien.md). Kontrak di bawah diperiksa 16 November 2026.

[Akses fasyankes dan sistem RME](#akses-fasyankes-dan-sistem-rme) · [OAuth](#oauth) · [Organization dan Location](#organization-dan-location) · [Practitioner](#practitioner) · [Error dan rekonsiliasi orientasi](#error-dan-rekonsiliasi-orientasi)

## Akses fasyankes dan sistem RME

1. Tentukan siapa yang mendaftarkan sistem, apakah fasyankes memakai sistem RME mandiri atau penyedia RME. Panduan Kemenkes memisahkan registrasi fasyankes, registrasi sistem RME, verifikasi, dan akses kode API.
2. Cocokkan institusi, pilihan atau hubungan sistem RME, dan Organization di portal. Konfigurasi integrasi Metta mengikat tenant serta legal entity ke kredensial fasyankes pada environment itu.
3. Gunakan kredensial Sandbox untuk fixture. Panduan Kemenkes menjelaskan kode Production untuk fasyankes dan mitra yang telah terverifikasi. Catat status pemenuhan prasyarat Production pada saat aktivasi.
4. Buktikan OAuth, baca Organization akar, baca atau siapkan unit dan ruangan yang akan dirujuk, lalu selesaikan IHS nakes serta pasien. Jalankan pengiriman kunjungan setelah pemetaan fixture bisa dibaca balik. Gunakan ID yang berasal dari environment yang sama.

[Panduan registrasi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/) · [Kode akses Sandbox](https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-sandbox/) · [Kode akses Production](https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-production/) · [Uji orientasi SB-00](../pengujian/skenario-sandbox.md#sb-00-identitas-dan-koneksi)

## OAuth

| Environment | Host API |
| --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id` |
| Production | `https://api-satusehat.kemkes.go.id` |

Ambil token di backend memakai `grant_type=client_credentials`. Parameter `grant_type` berada pada query. Kirim `client_id` dan `client_secret` dalam body form dengan encoding yang sesuai.

```http
POST /oauth2/v1/accesstoken?grant_type=client_credentials
Content-Type: application/x-www-form-urlencoded
Accept: application/json

client_id=<client-id-url-encoded>&client_secret=<client-secret-url-encoded>
```

Contoh respons sukses yang disederhanakan. Nilai token dan masa berlaku hanya placeholder.

```json
{
  "access_token": "<token-dari-server>",
  "token_type": "BearerToken",
  "expires_in": "<durasi-dalam-detik-sebagai-string>"
}
```

Gunakan `Authorization: Bearer <access_token>` pada API berikutnya. Parse dan periksa masa berlaku dari respons. Cache token di backend berdasarkan pasangan environment dan kredensial, lalu perbarui sebelum kedaluwarsa. Simpan kredensial sesuai tempat penyimpanan rahasia dan gunakan identitas Organization dari scope yang sama. Tabel sumber mengikat satu kredensial ke satu Organization.

Jika OAuth ditolak, periksa bentuk form, host, kredensial, dan scope. Jika token yang sebelumnya valid sudah kedaluwarsa, ambil token baru. Uji tersendiri bila layanan master atau SSRME memerlukan akses tambahan. Catat status, waktu, dan kategori penyebab. Redaksi access token, client secret, dan body form dari log. [Kontrak token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/) · [Bukti uji OAuth](../pengujian/backlog-rawat-jalan-tanpa-resep.md#hasil-uji-rj-00-sampai-rj-05)

## Organization dan Location

Semua path berikut relatif terhadap `/fhir-r4/v1` pada host yang dipilih. Sertakan Bearer token. GET memakai query atau path dan body kosong. Katalog mendokumentasikan `Content-Type: application/json` untuk POST, PUT, dan PATCH Organization/Location. PATCH menggunakan array operasi, dengan path dan operasi yang diizinkan oleh resource.

| Fungsi | Organization | Location |
| --- | --- | --- |
| Cari kandidat | `GET /Organization`. Filter `name` atau `partof` sesuai kontrak. | `GET /Location`. Filter `identifier`, `name`, atau `organization`. Untuk `identifier`, kirim pasangan sistem dan nilai sebagai satu parameter yang sudah di-URL-encode. |
| Baca ID server | `GET /Organization/{id}` | `GET /Location/{id}` |
| Buat resource | `POST /Organization` untuk suborganisasi yang memang diperlukan. | `POST /Location` untuk lokasi yang akan dirujuk. |
| Perbarui resource yang sama | `PUT /Organization/{id}` atau `PATCH /Organization/{id}` | `PUT /Location/{id}` atau `PATCH /Location/{id}` |

Pencarian mengembalikan `Bundle`. Detail, create, dan update yang berhasil mengembalikan resource dengan ID balikan sesuai bentuk yang didokumentasikan. Cocokkan tipe resource dan simpan ID di mapping. Lihat `OperationOutcome` bila mutasi atau pencarian ditolak. [Kontrak Organization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/) · [Kontrak Location](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/)

### Suborganisasi

Mulai dari ID Organization akar yang diperoleh untuk fasyankes. Cari unit di bawah induk yang benar. Buat suborganisasi jika alur memerlukannya dan kecocokan belum ada. Gunakan identifier stabil untuk unit, nama resmi, `active`, serta `partOf` untuk merujuk Organization induk. Jenis organisasi, kontak, dan alamat mengikuti profil dan pemakaian institusi. Pemetaan legal entity dan unit tersedia di [matriks Organization](../payload/matriks-identitas.md#organization).

Contoh payload untuk membuat suborganisasi sintetis.

```json
{
  "resourceType": "Organization",
  "identifier": [
    {
      "use": "official",
      "system": "http://sys-ids.kemkes.go.id/organization/<organization-akar-id>",
      "value": "<kode-unit-uji>"
    }
  ],
  "active": true,
  "name": "Unit Rawat Jalan Contoh",
  "partOf": {"reference": "Organization/<organization-induk-id>"}
}
```

### Lokasi pelayanan

Gunakan identifier stabil untuk lokasi fisik. Sistem identifier memakai namespace `http://sys-ids.kemkes.go.id/location/{organization-id}`. Tautkan `managingOrganization` ke Organization yang mengelola lokasi. Gunakan `partOf` bila mengacu ke Location induk. Isi bentuk fisik, kode layanan, atau extension administratif sesuai profil use case. Contoh berikut mengikuti struktur yang dipakai untuk fixture ruangan di Sandbox.

```json
{
  "resourceType": "Location",
  "identifier": [
    {
      "use": "official",
      "system": "http://sys-ids.kemkes.go.id/location/<organization-id>",
      "value": "<kode-ruang-uji>"
    }
  ],
  "status": "active",
  "name": "Ruang Periksa Contoh",
  "mode": "instance",
  "physicalType": {"coding": [
    {"system": "http://terminology.hl7.org/CodeSystem/location-physical-type", "code": "ro"}
  ]},
  "managingOrganization": {"reference": "Organization/<organization-id>"}
}
```

Contoh respons baca balik yang disederhanakan.

```json
{
  "resourceType": "Location",
  "id": "<location-id>",
  "status": "active",
  "managingOrganization": {"reference": "Organization/<organization-id>"}
}
```

Simpan `Location.id` setelah GET mengonfirmasi identifier, status, dan Organization pengelola. Untuk update, lanjutkan dengan ID yang sama. PUT membawa resource lengkap. PATCH membawa operasi perubahan seperti `replace` pada path yang tercantum pada kontrak resource. Sebelum mengirim, baca kondisi terkini agar perubahan lokal tidak menghapus field yang diperlukan. [Profil Organization](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/organization/) · [Profil Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) · [Matriks Location](../payload/matriks-identitas.md#location)

## Practitioner

Gunakan Practitioner dari layanan identitas nakes. Katalog orientasi mendokumentasikan pencarian dan baca detail. Pemetaan nakes Metta dapat dihubungkan ke akun dan peran klinis lokal, dengan IHS yang cocok untuk referensi FHIR. Jika use case perlu `PractitionerRole`, perlakukan sebagai resource yang memuat hubungan peran, Organization, dan lokasi sesuai kontraknya. [Matriks Practitioner](../payload/matriks-identitas.md#practitioner) · [API PractitionerRole](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/)

| Fungsi | Request | Hasil |
| --- | --- | --- |
| Cari berdasarkan NIK | `GET /Practitioner?identifier=<system\|nik>`. Sistem NIK `https://fhir.kemkes.go.id/id/nik`. URL-encode seluruh nilai. | Kandidat dalam Bundle. |
| Cari berdasarkan demografi | `GET /Practitioner?name=<nama>&birthdate=<tanggal>&gender=<gender>` sesuai filter yang didokumentasikan. | Kandidat dalam Bundle. Nilai pencarian harus berasal dari sumber yang berwenang. |
| Baca IHS diketahui | `GET /Practitioner/{id}`. | Resource Practitioner dengan ID server. |

Contoh request baca balik.

```http
GET /fhir-r4/v1/Practitioner/<practitioner-ihs>
Authorization: Bearer <access_token>
Accept: application/json
```

Gunakan hanya IHS yang cocok dengan nakes dan environment. Uji Sandbox Metta berhasil membaca dummy Practitioner per IHS, sementara query NIK pada fixture sebelumnya menghasilkan kosong atau kandidat yang tidak cocok. Pemetaan fixture uji dilakukan secara eksplisit menggunakan dummy resmi. Pencarian NIK belum menjadi dasar pemetaan otomatis pada produk. [Kontrak Practitioner](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/practitioner/) · [Bukti pemetaan fixture](../pengujian/backlog-rawat-jalan-tanpa-resep.md#pemetaan-fixture-sebelum-uji-encounter)

## Error dan rekonsiliasi orientasi

| Hasil | Tindakan |
| --- | --- |
| GET `2xx` dengan hasil kosong | Periksa parameter dan scope terlebih dahulu. Untuk Organization/Location, pastikan tujuan create belum tersedia sebelum membuat resource. Untuk Practitioner, gunakan pencarian atau verifikasi SDMK sesuai data yang tersedia. |
| Kandidat ganda | Cocokkan identifier, induk, dan Organization. Selesaikan kecocokan sebelum menyimpan mapping atau menjalankan write. |
| `4xx` dengan `OperationOutcome` | Catat kategori, field, dan nomor aturan bila ada. Pastikan hierarki, environment, payload, dan scope benar. |
| POST tanpa kepastian hasil | Cari kembali dengan identifier atau relasi yang didukung. Jika hasil cocok, simpan ID itu. Jika belum jelas, tahan dan rekonsiliasi sebelum mencoba lagi. |
| PUT atau PATCH sukses | Baca ID yang sama dan verifikasi perubahan yang dikirim. |

Uji OAuth, Organization akar, pembuatan dan baca balik Location, pemetaan Practitioner, scope yang salah, serta pemetaan ulang setelah hasil ambigu. Untuk operasi yang diimplementasikan, buktikan bahwa update tidak membuat resource kedua. Sandbox Metta sudah memiliki bukti OAuth, baca Organization, POST dan GET Location, serta baca Practitioner. Pembuatan Organization, PATCH/PUT, konfigurasi Production, dan pencarian otomatis Practitioner masih perlu bukti pada skenario yang sesuai. [Bukti awal](../pengujian/skenario-sandbox.md#status-bukti) · [Validasi dan error](../validasi/respons-dan-error.md)
