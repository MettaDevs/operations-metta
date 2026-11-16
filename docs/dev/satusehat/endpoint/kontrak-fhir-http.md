# Kontrak HTTP bersama untuk resource FHIR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) (disunting 2024-10-03) · [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/) (disunting 2026-11-06) · [Panduan Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/) (disunting 2026-10-12)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Inventaris operasi HTTP](inventaris-operasi-http.md#fhir-dan-orientasi) · [Validasi dan error](../validasi/respons-dan-error.md)

Gunakan halaman ini bersama kontrak resource dan Playbook per use case. Inventaris operasi menentukan metode dan query yang didokumentasikan untuk resource tersebut. Profil menentukan struktur field, terminologi, dan kardinalitas. Use case menentukan kapan data dikirim dan field kondisional yang berlaku. [Katalog Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) · [Profil FHIR SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/) · [Panduan Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/)

[Host, header, dan scope](#host-header-dan-scope) · [Bentuk metode dan respons](#bentuk-metode-dan-respons) · [Pencarian dan pembacaan](#pencarian-dan-pembacaan) · [Create, update, dan perubahan parsial](#create-update-dan-perubahan-parsial) · [Validasi sebelum pengiriman](#validasi-sebelum-pengiriman) · [Error, retry, dan bukti](#error-retry-dan-bukti)

## Host, header, dan scope

Untuk header, query, parameter URI dan jenis balikan setiap operasi yang dicantumkan Kemenkes, gunakan [Kontrak per operasi API](kontrak-operasi-api.md).

| Environment | Base URL FHIR |
| --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1` |
| Production | `https://api-satusehat.kemkes.go.id/fhir-r4/v1` |

Gunakan Bearer token dari Organization dan environment yang dipilih. Tambahkan `Accept: application/json` untuk membaca respons. Pada katalog FHIR yang diperiksa 16 November 2026, body POST dan PUT resource menggunakan `Content-Type: application/json`, dan operasi PATCH yang tercantum juga mendokumentasikan header itu dengan body array perubahan. Gunakan tipe media yang ditetapkan pada metode dan layanan yang dipanggil. API di luar prefix FHIR dapat memakai envelope dan tipe media berbeda. [OAuth dan onboarding](onboarding-fhir.md) · [Endpoint environment](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/)

## Bentuk metode dan respons

| Operasi | Request | Respons yang diperiksa |
| --- | --- | --- |
| Pencarian | `GET /{Resource}?{query}`, tanpa body. Gunakan filter yang didokumentasikan untuk resource. | `Bundle` bertipe `searchset`. Baca `entry[].resource`, `total` bila ada, dan `link[]` bila hasil berhalaman. |
| Detail | `GET /{Resource}/{id}`. ID adalah string dari server. | Resource dengan `resourceType` dan `id` yang sesuai. |
| Create | `POST /{Resource}` dengan objek JSON resource sesuai use case. | Status sukses dan ID yang dikembalikan server pada resource atau lokasi yang dijanjikan kontrak. Simpan korelasi sebelum mengirim dependensi berikutnya. |
| Pembaruan penuh | `PUT /{Resource}/{id}` dengan objek resource sesuai kontrak. | Resource pada ID yang sama. Untuk finalisasi Encounter, sertakan ID yang sama dalam body dan path. |
| Pembaruan sebagian | `PATCH /{Resource}/{id}` dengan array operasi pada path yang didukung. | Resource yang berhasil diubah. Baca balik ID yang sama dan periksa field tujuan. |

Jika resource hanya memiliki sebagian operasi di katalog, pakai metode yang terdokumentasi. Pastikan ID balikan tersimpan di bawah scope environment, tenant, Organization, dan jenis resource. Identifier lokal berupa kunci bisnis yang stabil untuk pencocokan. Referensi yang akan dikirim ke SATUSEHAT menggunakan ID resource server sesuai profil.

## Pencarian dan pembacaan

Filter query berbeda menurut resource. Contoh Encounter menggunakan `subject` untuk pencarian pasien dalam katalog.

```http
GET /fhir-r4/v1/Encounter?subject=<patient-ihs>
Authorization: Bearer <access_token>
Accept: application/json
```

Contoh respons sintetis, disederhanakan menjadi satu hasil.

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "entry": [
    {
      "search": {"mode": "match"},
      "resource": {"resourceType": "Encounter", "id": "<encounter-id>", "status": "arrived"}
    }
  ]
}
```

Filter `subject` dapat mengembalikan banyak kunjungan. Untuk rekonsiliasi, cocokkan identifier dan Organization dari fakta lokal. Gunakan pagination yang didokumentasikan. Validasi host dan prefix dari tautan halaman lanjutan sebelum mengirim token, lalu pertahankan scope dan filter pencarian. Jika total atau field demografi tidak disertakan, gunakan data yang ada sesuai aturan use case dan tandai hasil yang ambigu. [API Encounter](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/) · [MPI](master-data-pasien.md#pencarian-dan-keputusan-pemetaan)

## Create, update, dan perubahan parsial

Sebelum create, selesaikan dependensi seperti Patient, Practitioner, dan Location serta validasi field berbasis use case. Catat identitas pekerjaan dan versi fakta. Setelah create, periksa sukses, ambil ID balikan, dan lakukan baca balik bila perlu membuktikan kecocokan. `201` diikuti GET `200` telah terlihat pada Location dan Encounter awal untuk fixture Metta. [Bukti Encounter awal](../pengujian/backlog-rawat-jalan-tanpa-resep.md#bukti-uji-encounter-awal-di-sandbox)

Pada PUT, mulai dari ID dan resource yang benar, lalu pertahankan field yang masih berlaku dan isi perubahan sesuai fakta. Gunakan PATCH hanya bila resource dan path didukung. Contoh bentuk array perubahan yang menggunakan `replace` adalah berikut. Ganti placeholder dengan path yang telah diverifikasi dan nilai dengan tipe yang benar.

```json
[
  {"op": "replace", "path": "<field-yang-didukung>", "value": "<nilai-baru>"}
]
```

Periksa kontrak masing-masing untuk operasi, path, tipe nilai, dan apakah field sudah ada. Respons 4xx yang mengarah ke path yang tidak sesuai perlu ditangani dengan koreksi mapping. [PATCH Location](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#_pembaruan_sebagian_data) · [PATCH MPI](master-data-pasien.md#pembaruan-parsial) · [Finalisasi Encounter](../payload/contoh-rawat-jalan-dan-farmasi.md#encounter-saat-finalisasi)

## Validasi sebelum pengiriman

Periksa ejaan JSON, tipe pilihan, dan extension sesuai resource. Untuk field yang berbeda dari definisi dasar R4, gunakan [Kompatibilitas payload FHIR](../payload/kompatibilitas-payload-fhir.md) dan profil use case aktif.

1. Pilih template dan versi use case. Isi `resourceType` dan method dari kontrak, lalu periksa field wajib pada tahap yang dikirim.
2. Validasi kardinalitas serta tipe JSON. Array dan objek mengikuti struktur FHIR. Pilih satu field yang sesuai untuk bentuk `[x]`, misalnya `Observation.valueQuantity` atau `Observation.valueCodeableConcept`.
3. Validasi pasangan `system` dan `code` berdasarkan profil dan terminologi. Gunakan tanggal dan waktu dari kejadian yang tercatat. Jangan menebak kode, jenis layanan, urutan status, atau hasil klinis.
4. Terjemahkan reference dari mapping yang sudah diperiksa. Clock, Organization, dan scope harus sesuai dengan transaksi dan environment tujuan.
5. Simpan respons dan ID dengan korelasi fakta lokal. Tahan pekerjaan yang menunggu dependensi. Evaluasi status tiap entri jika use case memakai Bundle dengan respons per entri.

[Kardinalitas payload](../payload/aturan-field-fhir.md#kardinalitas-yang-memengaruhi-payload) · [Contoh FHIR](../payload/contoh-rawat-jalan-dan-farmasi.md) · [Aturan data dan alur kirim](../operasional/pengiriman-fhir.md#mekanisme-pengiriman-yang-diusulkan)

## Error, retry, dan bukti

Parse `OperationOutcome.issue` bila tersedia. Pada sebagian endpoint kegagalan server berupa teks. Jika POST mengalami timeout atau koneksi terputus setelah request dikirim, tandai hasil belum pasti dan rekonsiliasi. Hasil kosong pada pencarian awal belum membuktikan resource pasti tidak tersimpan jika ada keterlambatan indeks atau filter yang belum tervalidasi.

Untuk pengujian setiap operasi yang dipakai, catat metode, status HTTP, kategori validasi, ID yang disamarkan, dan hasil pencocokan saat dibaca balik. Uji hasil kosong, referensi salah, pelanggaran scope, dan pengulangan pada fixture yang diizinkan. Simulasikan gangguan sementara secara lokal bila percobaan khusus akan membebani Sandbox. Simpan log yang sudah disaring dari token, identitas mentah, dan payload klinis. [Daftar tindakan error](../validasi/respons-dan-error.md#tindakan-berdasarkan-http-dan-hasil-operasi) · [Format bukti Sandbox](../pengujian/skenario-sandbox.md#catatan-hasil)
