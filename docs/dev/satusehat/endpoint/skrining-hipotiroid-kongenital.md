# Pencarian dan korelasi hasil skrining hipotiroid kongenital

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Observation](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/) (disunting 2023-09-27) · [DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/) (disunting 2023-09-27) · [Skrining Hipotiroid Kongenital (SHK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/) (v2.1, rilis 2024-06-12, disunting 2025-12-02)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Skrining Hipotiroid Kongenital dan tes konfirmasi](../alur/skrining-hipotiroid-kongenital.md) · [Field dan terminologi skrining hipotiroid kongenital](../payload/skrining-hipotiroid-kongenital.md)

## Query publik dan korelasi hasil SHK

Semua request di bawah memakai Bearer dan basis `/fhir-r4/v1`. Bergantung peran, hasil hanya mencakup resource yang dapat dibaca dalam lingkungan terkait.

| Operasi | Kontrak publik dan hasil |
| --- | --- |
| Baca Nomor Rujukan Nasional | `GET /ServiceRequest/{id}` untuk order yang dibuat perujuk. Ambil `identifier[].value` pada system `http://sys-ids.kemkes.go.id/referral-number`. [Postman baca order](https://www.postman.com/satusehat/satusehat-public/request/hs80lrl/servicerequest-by-id-get-nomor-rujukan-nasional) |
| Cari order dari nomor nasional | `GET /ServiceRequest?identifier={token}`. Token menggabungkan system referral-number dan nomor, dengan pemisah `%7C` pada URL yang di-encode. Baca `entry[].resource`, lalu `specimen[].reference`. [Postman cari nomor rujukan](https://www.postman.com/satusehat/satusehat-public/request/670d4s3/servicerequest-search-by-nomor-rujukan-nasional) |
| Daftar order untuk lab rujukan | `GET /ServiceRequest` memakai `performer={lab-org}`, `category={token-kategori}`, `requester={fasyankes-asal}` dan `_lastUpdated=eq{YYYY-MM-DD}` pada contoh tanggal tertentu. Token kategori memakai `http://snomed.info/sct` dan kode `266753000`. Baca tiap order yang cocok dengan scope dan asal. [Postman daftar order SHK](https://www.postman.com/satusehat/satusehat-public/request/18xjir4/servicerequest-get-all-order-with-referral-category-and-specific-puskesmas-specific-time) |
| Perbarui penerimaan | `PATCH /Specimen/{id}` dengan JSON Patch pada `/receivedTime`; isi waktu terima yang sah. Baca ulang sebelum melanjutkan pemeriksaan. [Postman waktu penerimaan](https://www.postman.com/satusehat/satusehat-public/request/9orb39d/specimen-patch-received-time) |
| Telusuri hasil dan laporan dengan ID yang sudah didapat | Katalog umum memberi `GET /Observation?subject={patient}&based-on={service-request}` dan `GET /DiagnosticReport?subject={patient}&specimen={specimen}`. Periksa `Observation.basedOn[]`, `DiagnosticReport.basedOn[]`, `specimen[]` dan `result[]`, serta Organization lab dari resource yang dirujuk. Query ini berasal dari katalog resource dan penerimaan lintas fasilitas pada SHK mengikuti izin program. [Pencarian Observation](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/#_pencarian_data) · [Pencarian DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/#_pencarian_data) |

```http
GET /fhir-r4/v1/ServiceRequest?performer=<LAB_ORG>&category=http%3A%2F%2Fsnomed.info%2Fsct%7C266753000&requester=<PERUJUK_ORG>&_lastUpdated=eq2026-11-16
Authorization: Bearer <access_token>
Accept: application/json
```

Saat kumpulan hasil kosong, periksa status dan akses sumber, bukti penerimaan sampel, dan scope role lab atau perujuk. Untuk setiap hasil, gunakan rujukan balik dan validasi IHS serta Organization sebelum mencocokkan laporan. Nama parameter gabungan nomor nasional, IHS dan Organization langsung pada endpoint hasil SHK perlu bukti dari koleksi atau akun yang diizinkan.
