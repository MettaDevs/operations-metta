# Kontrak request dan respons per operasi API

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) (disunting 2024-10-03) · [Prerequisites](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/) (disunting 2024-11-08) · [AllergyIntolerance](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Inventaris HTTP](inventaris-operasi-http.md) · [Profil resource](../payload/inventaris-profil-resource.md) · [Panduan error](../validasi/respons-dan-error.md)

Snapshot 16 November 2026. Gunakan tabel untuk menyiapkan header, parameter dan body suatu operasi. Tautan pada nama operasi menuju bagian katalog Kemenkes. Tautan panduan pada setiap kelompok memberi fungsi, field, pemetaan Metta, contoh, dan kriteria uji. [Katalog FHIR](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) · [Katalog orientasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/)

Untuk basis FHIR, host Sandbox adalah `https://api-satusehat-stg.dto.kemkes.go.id` dan host Production `https://api-satusehat.kemkes.go.id`. Pelajari host khusus pada dokumen layanan, terutama KFA, KYC, MSI dan Wilayah. `{id}`/ `:id` berarti ID resource yang diberikan server. Gunakan ID dan token dari environment yang sama. [Endpoint dan autentikasi](onboarding-fhir.md#oauth)

[Header dan parameter](#header-dan-parameter) · [Cara membaca body dan respons](#cara-membaca-body-dan-respons) · [FHIR untuk interoperabilitas dan orientasi](#fhir-untuk-interoperabilitas-dan-orientasi) · [Token, validasi identitas, dan master data](#token-validasi-identitas-dan-master-data) · [Operasi dari Playbook dan panduan lain](#operasi-dari-playbook-dan-panduan-lain)

## Header dan parameter

| Tanda | Nilai yang dicantumkan sumber |
| --- | --- |
| A | `Authorization: Bearer <access_token>` |
| J | `Content-Type: application/json` |
| F | `Content-Type: application/x-www-form-urlencoded` |
| T | `Content-Type: text/plain` |

Header pada tabel dicatat dari bagian Request, termasuk `Content-Type` pada beberapa GET detail. Tanda `*` menunjukkan wajib. Tanda `?` mengikuti definisi Kemenkes, yaitu wajib jika memilih skenario terkait. Parameter tanpa tanda mengikuti aturan variasinya. Gunakan percent-encoding untuk nilai query. Baris yang belum menyatakan tipe tidak diberi tipe tambahan.

## Cara membaca body dan respons

Gunakan [indeks contoh payload](../payload/indeks-contoh-payload.md) untuk melihat bentuk resource atau objek dari modul yang dipilih.

| Bentuk di tabel | Siapkan atau periksa |
| --- | --- |
| Resource FHIR (objek) | Kirim objek resource sesuai profil dan metode. Pada PUT gunakan ID body yang sama dengan path. Gunakan [contoh payload lokal](../payload/contoh-rawat-jalan-dan-farmasi.md) dan panduan masing-masing resource. |
| JSON Patch (array) | Cocokkan `op`, `path` dan `value` berikut bentuk elemen yang akan diubah. Katalog menulis media type pada tabel header. Uji path dan media type yang diizinkan. |
| Bundle pencarian | Baca `type=searchset`, `entry[].resource`, `entry[].search.mode` bila ada, `total` bila tersedia, dan `link[]` untuk halaman lanjutan. |
| Resource FHIR | Baca `resourceType`, `id`, resource yang dituju, identifier, referensi, serta versi jika diberikan. Simpan status HTTP aktual. |
| Token OAuth | Baca `access_token`, `token_type` dan masa berlaku sesuai respons. Simpan rahasia dalam penyimpanan aman. |
| JSON sesuai modul atau pesan terenkripsi | Gunakan schema dan contoh pada panduan KFA/MSI/Wilayah/KYC, termasuk body khusus dan pemisahan envelope FHIR. |

Katalog umumnya memberi kelas `2xx`, `4xx`, `5xx`. Tabel menunjukkan format jika dicantumkan pada bagian operasi. Jangan menetapkan kode HTTP pasti hanya dari kelas. Untuk 4xx FHIR, periksa `OperationOutcome.issue[]`, path dan Rule Number yang tersedia. Untuk 5xx dengan `text/plain`, catat informasi yang aman tanpa mengasumsikan JSON. [Kontrak FHIR dan retry](kontrak-fhir-http.md) · [Kamus Rule Number](../validasi/kamus-rule-number.md) · [Monitoring dan rekonsiliasi](../operasional/monitoring-dan-aduan.md)

### Contoh request dan bentuk balikan FHIR

Untuk pencarian Encounter, isi ID pasien dari environment yang benar.

```http
GET /fhir-r4/v1/Encounter?subject=<PATIENT_IHS>
Authorization: Bearer <access_token>
Accept: application/json
```

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "entry": [{
    "resource": {"resourceType": "Encounter", "id": "<ENCOUNTER_ID>", "status": "in-progress", "class": {"code": "AMB"}},
    "search": {"mode": "match"}
  }]
}
```

Untuk perubahan parsial, periksa struktur resource saat ini sebelum memilih path. Contoh menunjukkan bentuk body untuk `PATCH /fhir-r4/v1/Encounter/{id}`; kirim hanya saat status baru sesuai fakta.

```json
[{"op": "replace", "path": "/status", "value": "in-progress"}]
```

## FHIR untuk interoperabilitas dan orientasi

### AllergyIntolerance

[Panduan lokal](../payload/matriks-rawat-jalan.md#allergyintolerance)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/#api-pecarian-data)<br>`GET /fhir-r4/v1/AllergyIntolerance` | A | Query 1. `patient` (string) / 2. `?patient` (string), `?code` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/#_detail_data)<br>`GET /fhir-r4/v1/AllergyIntolerance/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/#_penambahan_data)<br>`POST /fhir-r4/v1/AllergyIntolerance` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/#_pembaruan_data)<br>`PUT /fhir-r4/v1/AllergyIntolerance/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/AllergyIntolerance/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Appointment

[Panduan lokal](../alur/penjadwalan-dan-janji-temu.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/#_pencarian_data)<br>`GET /fhir-r4/v1/Appointment` | A | Query `actor` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/#_detail_data)<br>`GET /fhir-r4/v1/Appointment/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/#_penambahan_data)<br>`POST /fhir-r4/v1/Appointment` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Appointment/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Appointment/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### AppointmentResponse

[Panduan lokal](../alur/penjadwalan-dan-janji-temu.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/#_pencarian_data)<br>`GET /fhir-r4/v1/AppointmentResponse` | A | Query `appointment` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/#_detail_data)<br>`GET /fhir-r4/v1/AppointmentResponse/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/#_penambahan_data)<br>`POST /fhir-r4/v1/AppointmentResponse` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/#_pembaruan_data)<br>`PUT /fhir-r4/v1/AppointmentResponse/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/AppointmentResponse/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### CarePlan

[Panduan lokal](../alur/igd-dan-rawat-inap.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/care-plan/#_pencarian_data)<br>`GET /fhir-r4/v1/CarePlan` | A | Query 1. `subject` (string) / 2. `?subject` (string), `?encounter` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/care-plan/#_detail_data)<br>`GET /fhir-r4/v1/CarePlan/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/care-plan/#_penambahan_data)<br>`POST /fhir-r4/v1/CarePlan` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/care-plan/#_pembaruan_data)<br>`PUT /fhir-r4/v1/CarePlan/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/care-plan/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/CarePlan/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### ClinicalImpression

[Panduan lokal](../alur/igd-dan-rawat-inap.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/clinical-impression/#_pencarian_data)<br>`GET /fhir-r4/v1/ClinicalImpression` | A | Query `subject` (string), `encounter` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/clinical-impression/#_detail_data)<br>`GET /fhir-r4/v1/ClinicalImpression/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/clinical-impression/#_penambahan_data)<br>`POST /fhir-r4/v1/ClinicalImpression` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/clinical-impression/#_pembaruan_data)<br>`PUT /fhir-r4/v1/ClinicalImpression/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/clinical-impression/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/ClinicalImpression/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Composition

[Panduan lokal](../payload/matriks-rawat-jalan.md#composition)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/composition/#_pencarian_data)<br>`GET /fhir-r4/v1/Composition` | A | Query `subject` (string), `encounter` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/composition/#_detail_data)<br>`GET /fhir-r4/v1/Composition/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/composition/#_penambahan_data)<br>`POST /fhir-r4/v1/Composition` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/composition/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Composition/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/composition/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Composition/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Condition

[Panduan lokal](../payload/matriks-rawat-jalan.md#condition)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/condition/#_pencarian_data)<br>`GET /fhir-r4/v1/Condition` | A | Query `subject` (string), `encounter` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/condition/#_detail_data)<br>`GET /fhir-r4/v1/Condition/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/condition/#_penambahan_data)<br>`POST /fhir-r4/v1/Condition` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/condition/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Condition/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/condition/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Condition/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### DiagnosticReport

[Panduan lokal](../alur/laboratorium-rujukan-spesimen.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/#_pencarian_data)<br>`GET /fhir-r4/v1/DiagnosticReport` | A | Query 1. `subject` (string), `encounter` (uuid) / 2. `?subject` (string), `?specimen` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/#_detail_data)<br>`GET /fhir-r4/v1/DiagnosticReport/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/#_penambahan_data)<br>`POST /fhir-r4/v1/DiagnosticReport` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/#_pembaruan_data)<br>`PUT /fhir-r4/v1/DiagnosticReport/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/DiagnosticReport/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Encounter

[Panduan lokal](../payload/matriks-rawat-jalan.md#encounter)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/#_pencarian_data)<br>`GET /fhir-r4/v1/Encounter` | A | Query `subject` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/#_detail_data)<br>`GET /fhir-r4/v1/Encounter/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/#_penambahan_data)<br>`POST /fhir-r4/v1/Encounter` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Encounter/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Encounter/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### EpisodeOfCare

[Panduan lokal](episode-kehamilan-dan-neonatus.md#kontrak-episodeofcare-dan-encounter)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/#_pencarian_data)<br>`GET /fhir-r4/v1/EpisodeOfCare` | A | Query 1. `subject` (string) / 2. `?subject` (string), `?organization` (string), `?care-manager` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/#_detail_data)<br>`GET /fhir-r4/v1/EpisodeOfCare/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/#_penambahan_data)<br>`POST /fhir-r4/v1/EpisodeOfCare` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/#_pembaruan_data)<br>`PUT /fhir-r4/v1/EpisodeOfCare/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/EpisodeOfCare/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### FamilyMemberHistory

[Panduan lokal](../payload/matriks-layanan-kondisional.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/family-member-history/#_pencarian_data)<br>`GET /fhir-r4/v1/FamilyMemberHistory` | A | Query `?patient` (string), `?relationship` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/family-member-history/#_detail_data)<br>`GET /fhir-r4/v1/FamilyMemberHistory/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/family-member-history/#_penambahan_data)<br>`POST /fhir-r4/v1/FamilyMemberHistory` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/family-member-history/#_pembaruan_data)<br>`PUT /fhir-r4/v1/FamilyMemberHistory/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/family-member-history/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/FamilyMemberHistory/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### HealthcareService

[Panduan lokal](../alur/penjadwalan-dan-janji-temu.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/#_pencarian_data)<br>`GET /fhir-r4/v1/HealthcareService` | A | Query `specialty` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/#_detail_data)<br>`GET /fhir-r4/v1/HealthcareService/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/#_penambahan_data)<br>`POST /fhir-r4/v1/HealthcareService` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/#_pembaruan_data)<br>`PUT /fhir-r4/v1/HealthcareService/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/HealthcareService/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### ImagingStudy

[Panduan lokal](radiologi-dicom.md#endpoint-dan-respons)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/#_pencarian_data)<br>`GET /fhir-r4/v1/ImagingStudy` | A | Query `*identifier` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/#_penambahan_data)<br>`POST /fhir-r4/v1/ImagingStudy` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/#_pembaruan_data)<br>`PUT /fhir-r4/v1/ImagingStudy/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Immunization

[Panduan lokal](../alur/imunisasi-dan-kipi.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/#_pencarian_data)<br>`GET /fhir-r4/v1/Immunization` | A | Query `patient` (string), `date` (date) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/#_detail_data)<br>`GET /fhir-r4/v1/Immunization/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/#_penambahan_data)<br>`POST /fhir-r4/v1/Immunization` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Immunization/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Immunization/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Medication

[Panduan lokal](../payload/matriks-farmasi.md#medication)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication/#_detail_data)<br>`GET /fhir-r4/v1/Medication/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication/#_penambahan_data)<br>`POST /fhir-r4/v1/Medication` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Medication/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Medication/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### MedicationDispense

[Panduan lokal](../payload/matriks-farmasi.md#medicationdispense)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-dispense/#_pencarian_data)<br>`GET /fhir-r4/v1/MedicationDispense` | A | Query 1. `subject` (string) / 2. `?subject` (string), `?context` (uuid) / 3. `?subject` (string), `?prescription` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-dispense/#_detail_data)<br>`GET /fhir-r4/v1/MedicationDispense/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-dispense/#_penambahan_data)<br>`POST /fhir-r4/v1/MedicationDispense` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-dispense/#_pembaruan_data)<br>`PUT /fhir-r4/v1/MedicationDispense/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-dispense/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/MedicationDispense/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### MedicationRequest

[Panduan lokal](../payload/matriks-farmasi.md#medicationrequest)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-request/#_pencarian_data)<br>`GET /fhir-r4/v1/MedicationRequest` | A | Query `subject` (string), `encounter` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-request/#_detail_data)<br>`GET /fhir-r4/v1/MedicationRequest/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-request/#_penambahan_data)<br>`POST /fhir-r4/v1/MedicationRequest` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-request/#_pembaruan_data)<br>`PUT /fhir-r4/v1/MedicationRequest/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-request/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/MedicationRequest/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Observation

[Panduan lokal](../payload/matriks-rawat-jalan.md#observation)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/#_pencarian_data)<br>`GET /fhir-r4/v1/Observation` | A | Query 1. `subject` (string), `encounter` (string) / 2. `?subject` (string), `?based-on` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/#_detail_data)<br>`GET /fhir-r4/v1/Observation/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/#_penambahan_data)<br>`POST /fhir-r4/v1/Observation` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Observation/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Observation/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### PractitionerRole

[Panduan lokal](../alur/penjadwalan-dan-janji-temu.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/#_pencarian_data)<br>`GET /fhir-r4/v1/PractitionerRole` | A | Query 1. `practitioner` (string) / 2. `?practitioner` (string), `?organization` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/#_detail_data)<br>`GET /fhir-r4/v1/PractitionerRole/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/#_penambahan_data)<br>`POST /fhir-r4/v1/PractitionerRole` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/#_pembaruan_data)<br>`PUT /fhir-r4/v1/PractitionerRole/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/PractitionerRole/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Procedure

[Panduan lokal](../payload/matriks-rawat-jalan.md#procedure)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/procedure/#_pencarian_data)<br>`GET /fhir-r4/v1/Procedure` | A | Query `subject` (string), `encounter` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/procedure/#_detail_data)<br>`GET /fhir-r4/v1/Procedure/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/procedure/#_penambahan_data)<br>`POST /fhir-r4/v1/Procedure` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/procedure/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Procedure/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/procedure/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Procedure/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### QuestionnaireResponse

[Panduan lokal](../payload/matriks-farmasi.md#questionnaireresponse)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/questionnaire-response/#_pencarian_data)<br>`GET /fhir-r4/v1/QuestionnaireResponse` | A | Query `?patient` (string), `?encounter` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/questionnaire-response/#_detail_data)<br>`GET /fhir-r4/v1/QuestionnaireResponse/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/questionnaire-response/#_penambahan_data)<br>`POST /fhir-r4/v1/QuestionnaireResponse` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/questionnaire-response/#_pembaruan_data)<br>`PUT /fhir-r4/v1/QuestionnaireResponse/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### RelatedPerson

[Panduan lokal](../alur/data-kelahiran-dan-akta.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/#_http_verbmethod)<br>`GET /fhir-r4/v1/RelatedPerson` | A | Query `?identifier` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/#_http_verbmethod_2)<br>`POST /fhir-r4/v1/RelatedPerson` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/#_http_verbmethod_3)<br>`PUT /fhir-r4/v1/RelatedPerson/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan sebagian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/#_http_verbmethod_4)<br>`PATCH /fhir-r4/v1/RelatedPerson/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### ServiceRequest

[Panduan lokal](../payload/matriks-rawat-jalan.md#servicerequest)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/#_pencarian_data)<br>`GET /fhir-r4/v1/ServiceRequest` | A | Query 1. `subject` (string), `encounter` (uuid) / 2. `?subject` (string), `?identifier` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/#_detail_data)<br>`GET /fhir-r4/v1/ServiceRequest/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/#_penambahan_data)<br>`POST /fhir-r4/v1/ServiceRequest` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/#_pembaruan_data)<br>`PUT /fhir-r4/v1/ServiceRequest/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/ServiceRequest/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Slot

[Panduan lokal](../alur/penjadwalan-dan-janji-temu.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/#_detail_data)<br>`GET /fhir-r4/v1/Slot/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/#_penambahan_data)<br>`POST /fhir-r4/v1/Slot` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Slot/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Slot/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Specimen

[Panduan lokal](../alur/laboratorium-rujukan-spesimen.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/specimen/#_pencarian_data)<br>`GET /fhir-r4/v1/Specimen` | A | Query 1. `subject` (string) / 2. `?subject` (string), `?collector` (string) / 3. `?subject` (string), `?collected` (date) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/specimen/#_detail_data)<br>`GET /fhir-r4/v1/Specimen/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/specimen/#_penambahan_data)<br>`POST /fhir-r4/v1/Specimen` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/specimen/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Specimen/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/specimen/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Specimen/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Location

[Panduan lokal](onboarding-fhir.md#lokasi-pelayanan)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#_pencarian_data)<br>`GET /fhir-r4/v1/Location` | A | Query 1. `?identifier` (string) / 2. `?name` (string) / 3. `?organization` (uuid) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#_detail_data)<br>`GET /fhir-r4/v1/Location/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#_penambahan_data)<br>`POST /fhir-r4/v1/Location` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Location/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Location/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Organization

[Panduan lokal](onboarding-fhir.md#suborganisasi)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/#_pencarian_data)<br>`GET /fhir-r4/v1/Organization` | A | Query 1. `?name` (string) / 2. `?partof` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/#_detail_data)<br>`GET /fhir-r4/v1/Organization/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/#_penambahan_data)<br>`POST /fhir-r4/v1/Organization` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/#_pembaruan_data)<br>`PUT /fhir-r4/v1/Organization/:id` | A + J | Path `*:id` (uuid) | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Organization/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Patient

[Panduan lokal](master-data-pasien.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/#_pencarian_data)<br>`GET /fhir-r4/v1/Patient` | A | Query 1. `?identifier` (string) / 2. `?name` (string), `?birthdate` (date), `?nik` (string) / 3. `?identifier` (string) / 4. `?name` (string), `?birthdate` (date), `?gender` (string) | Tanpa body · Pencarian sesuai FHIR. Contoh balikan tidak tercantum pada bagian orientasi ini | Lihat panduan orientasi dan MPI |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/#_detail_data)<br>`GET /fhir-r4/v1/Patient/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/#_penambahan_data)<br>`POST /fhir-r4/v1/Patient` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Patient/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Practitioner

[Panduan lokal](onboarding-fhir.md#practitioner)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Pencarian](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/practitioner/#_pencarian_data)<br>`GET /fhir-r4/v1/Practitioner` | A | Query 1. `?identifier` (string) / 2. `?name` (string), `?birthdate` (date), `?gender` (string) | Tanpa body · Pencarian sesuai FHIR. Contoh balikan tidak tercantum pada bagian orientasi ini | Lihat panduan orientasi dan MPI |
| [Detail](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/practitioner/#_detail_data)<br>`GET /fhir-r4/v1/Practitioner/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

## Token, validasi identitas, dan master data

### OAuth

[Panduan lokal](onboarding-fhir.md#oauth)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Mendapatkan Token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/#_mendapatkan_token)<br>`POST /oauth2/v1/accesstoken` | F | Query `*grant_type` (string)<br>Form `*client_id` (string), `*client_secret` (string) | Form URL-encoded · `2xx` Token OAuth | `4xx` OperationOutcome · `5xx` `text/plain` |

### Verifikasi KYC

[Panduan lokal](kyc.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [3. Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/#apis-token-kyc)<br>`POST /oauth2/v1/accesstoken` | F | Query `*grant_type` (string)<br>Form `*client_id` (string), `*client_secret` (string) | Form URL-encoded · `2xx` Token OAuth | `4xx` OperationOutcome · `5xx` `text/plain` |
| [4.1. Generate - URL Validasi ( Encrypted )](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/#kyc-api-generate-validation-encrypted-url)<br>`POST /kyc/v1/generate-url` | A + T | — | Pesan terenkripsi (teks) · `2xx` Pesan terenkripsi | `4xx` menurut modul · `5xx` `text/plain` |
| [4.2. Generate - Kode Verifikasi](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/#kyc-api-generate-verification)<br>`POST /kyc/v1/challenge-code` | A + J | — | JSON sesuai modul · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |

### KFA dan ALKES

[Panduan lokal](master-data-kfa.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [3. Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#apis-token-kfa)<br>`POST /oauth2/v1/accesstoken` | F | Query `*grant_type` (string)<br>Form `*client_id` (string), `*client_secret` (string) | Form URL-encoded · `2xx` Token OAuth | `4xx` OperationOutcome · `5xx` `text/plain` |
| [4.1. Price - Mendapatkan Harga Produk JKN](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-farmalkes-price-jkn-price)<br>`GET /kfa/farmalkes-price-jkn` | A | Query `*page` (number), `*limit` (number), `*kfa_code` (string), `region_code` (string), `document_ref` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [5.1. Products - Mendapatkan Detail Produk](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-products-detail)<br>`GET /kfa-v2/products` | A | Query `*identifier` (string), `*code` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [5.2. Products - Pencarian Produk dengan Paginasi](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-products-pagination)<br>`GET /kfa-v2/products/all` | A | Query `*page` (number), `*size` (number), `*product_type` (string), `from_date` (string), `to_date` (string), `farmalkes_type` (string), `keyword` (string), `template_code` (string), `packaging_code` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [6.1. Alkes Produk Varian](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-alkes-variant)<br>`POST /kfa-v3/alkes/products` | A | — | JSON sesuai modul · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [6.2. Alkes Produk Template](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-alkes-template)<br>`POST /kfa-v3/alkes/template` | A | — | JSON sesuai modul · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |

### Master Patient Index

[Panduan lokal](master-data-pasien.md)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [Mendapatkan Token](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/#akses-token-mpi)<br>`POST /oauth2/v1/accesstoken` | F | Query `*grant_type` (string)<br>Form `*client_id` (string), `*client_secret` (string) | Form URL-encoded · `2xx` Token OAuth | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pencarian Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/#_pencarian_data)<br>`GET /fhir-r4/v1/Patient` | A | Query 1. `?identifier` (string) / 2. `?name` (string), `?birthdate` (date), `?nik` (string) / 3. `?identifier` (string) / 4. `?name` (string), `?birthdate` (date), `?gender` (string) | Tanpa body · `2xx` Bundle pencarian | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Detail Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/#_detail_data)<br>`GET /fhir-r4/v1/Patient/:id` | A + J | Path `*:id` (uuid) | Tanpa body · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Penambahan Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/#_penambahan_data)<br>`POST /fhir-r4/v1/Patient` | A + J | — | Resource FHIR (objek) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |
| [Pembaruan Sebagian Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/#_pembaruan_sebagian_data)<br>`PATCH /fhir-r4/v1/Patient/:id` | A + J | Path `*:id` (uuid) | JSON Patch (array) · `2xx` Resource FHIR | `4xx` OperationOutcome · `5xx` `text/plain` |

### Master Sarana Index

[Panduan lokal](master-data-sarana-wilayah.md#master-sarana-index)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [3. Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#apis-token-msi)<br>`POST /oauth2/v1/accesstoken` | F | Query `*grant_type` (string)<br>Form `*client_id` (string), `*client_secret` (string) | Form URL-encoded · `2xx` Token OAuth | `4xx` OperationOutcome · `5xx` `text/plain` |
| [4.1. Master Sarana Index - Multi Sarana](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#api-msi-multi)<br>`GET /masterdata/v1/mastersaranaindex/mastersarana` | A | Query `*limit` (number), `*page` (number), `*jenis_sarana` (number), `kode_satusehat` (number), `kode_sarana` (string), `nama` (string), `kode_provinsi` (string), `kode_kabkota` (string), `kode_kecamatan` (string), `status_aktif` (string), `status_sarana` (string), `sumber_identifier` (string), `identifier_kode_sarana` (string), `lower_bound_updated_at` (string), `upper_bound_updated_at` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.2. Master Sarana Index - Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#api-msi-rs)<br>`GET /masterdata/v1/mastersaranaindex/mastersarana` | A | Query `*limit` (number), `*page` (number), `*jenis_sarana` (number), `kode_satusehat` (number), `kode_sarana` (string), `nama` (string), `kode_provinsi` (string), `kode_kabkota` (string), `kode_kecamatan` (string), `status_aktif` (string), `status_sarana` (string), `sumber_identifier` (string), `identifier_kode_sarana` (string), `lower_bound_updated_at` (string), `upper_bound_updated_at` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.3. Master Sarana Index - Klinik](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#api-msi-klinik)<br>`GET /masterdata/v1/mastersaranaindex/mastersarana` | A | Query `*limit` (number), `*page` (number), `*jenis_sarana` (number), `kode_satusehat` (number), `kode_sarana` (string), `nama` (string), `kode_provinsi` (string), `kode_kabkota` (string), `kode_kecamatan` (string), `status_aktif` (string), `status_sarana` (string), `sumber_identifier` (string), `identifier_kode_sarana` (string), `lower_bound_updated_at` (string), `upper_bound_updated_at` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.4. Master Sarana Index - PUSKESMAS](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#api-msi-puskesmas)<br>`GET /masterdata/v1/mastersaranaindex/mastersarana` | A | Query `*limit` (number), `*page` (number), `*jenis_sarana` (number), `kode_satusehat` (number), `kode_sarana` (string), `nama` (string), `kode_provinsi` (string), `kode_kabkota` (string), `kode_kecamatan` (string), `status_aktif` (string), `status_sarana` (string), `sumber_identifier` (string), `identifier_kode_sarana` (string), `lower_bound_updated_at` (string), `upper_bound_updated_at` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.5. Master Sarana Index - Praktik Mandiri](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#api-msi-pm)<br>`GET /masterdata/v1/mastersaranaindex/mastersarana` | A | Query `*limit` (number), `*page` (number), `*jenis_sarana` (number), `kode_satusehat` (number), `kode_sarana` (string), `nama` (string), `kode_provinsi` (string), `kode_kabkota` (string), `kode_kecamatan` (string), `status_aktif` (string), `status_sarana` (string), `sumber_identifier` (string), `identifier_kode_sarana` (string), `lower_bound_updated_at` (string), `upper_bound_updated_at` (string) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |

### Master Wilayah

[Panduan lokal](master-data-sarana-wilayah.md#master-wilayah)

| Operasi dan path | Header | Parameter menurut variasi | Body dan respons sukses | Error pada katalog |
| --- | --- | --- | --- | --- |
| [3. Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#apis-token-wilayah)<br>`POST /oauth2/v1/accesstoken` | F | Query `*grant_type` (string)<br>Form `*client_id` (string), `*client_secret` (string) | Form URL-encoded · `2xx` Token OAuth | `4xx` OperationOutcome · `5xx` `text/plain` |
| [4.1. Master Wilayah - Provinsi](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv1-province)<br>`GET /masterdata/v1/provinces?codes` | A | Query `*codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.2. Master Wilayah - Kota/Kabupaten](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv1-cities)<br>`GET /masterdata/v1/cities?province_codes` | A | Query `*province_codes` (number), `codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.3. Master Wilayah - Kecamatan](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv1-district)<br>`GET /masterdata/v1/districts?city_codes` | A | Query `*city_codes` (number), `codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [4.4. Master Wilayah - Kelurahan/Desa](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv1-subdistrict)<br>`GET /masterdata/v1/sub-districts?district_codes` | A | Query `*district_codes` (number), `*codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [5.5. Master Wilayah - Provinsi](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv2-province)<br>`GET /masterdata/v2/provinces?current_page` | A | Query `*current_page` (number), `next` (number), `prev` (number), `codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [5.6. Master Wilayah - Kota/Kabupaten](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv2-cities)<br>`GET /masterdata/v2/cities?current_page` | A | Query `*current_page` (number), `next` (number), `prev` (number), `province_codes` (number), `codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [5.7. Master Wilayah - Kecamatan](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv2-district)<br>`GET /masterdata/v2/districts?current_page` | A | Query `*current_page` (number), `next` (number), `prev` (number), `city_codes` (number), `codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |
| [5.8. Master Wilayah - Kelurahan/Desa](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/#api-wilayahv2-subdistrict)<br>`GET /masterdata/v2/sub-districts?current_page` | A | Query `*current_page` (number), `next` (number), `prev` (number), `district_codes` (number), `codes` (number) | Tanpa body · `2xx` JSON sesuai modul | `4xx` menurut modul · `5xx` `text/plain` |

## Operasi dari Playbook dan panduan lain

Untuk operasi yang terdokumentasi di luar bagian katalog ini, gunakan [tabel operasi tambahan](inventaris-operasi-http.md#operasi-dari-panduan-modul-di-luar-katalog-fhir), [SSRME v2](../alur/ssrme.md), dan [inventaris Playbook](../referensi/inventaris-playbook.md).

Varian query dari koleksi program tersedia di [Kueri EpisodeOfCare](kueri-episode-of-care.md), [Kueri SHK](skrining-hipotiroid-kongenital.md#query-publik-dan-korelasi-hasil-shk) dan [Pencarian resep nasional](../alur/pelayanan-kefarmasian-lintas-fasyankes.md#dokumen-dan-item-resep-berdasarkan-nrn).

Status uji untuk endpoint ditentukan dari bukti, termasuk [OAuth, Location, dan Encounter awal](../pengujian/backlog-rawat-jalan-tanpa-resep.md#hasil-uji-rj-00-sampai-rj-05). Gunakan [skenario Sandbox](../pengujian/skenario-sandbox.md) untuk pencarian, create, kegagalan, dan koreksi yang masih perlu bukti.
