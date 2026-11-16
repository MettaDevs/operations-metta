# Endpoint penjadwalan dan janji temu

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [HealthcareService](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/) (disunting 2023-09-27) · [PractitionerRole](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/) (disunting 2023-09-27) · [Slot](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Jadwal praktik, Slot, dan janji temu](../alur/penjadwalan-dan-janji-temu.md) · [Payload penjadwalan dan janji temu](../payload/penjadwalan-dan-janji-temu.md)

## Endpoint, query, header dan balikan

Basis Sandbox `https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1`, basis Production `https://api-satusehat.kemkes.go.id/fhir-r4/v1`. Semua request memakai `Authorization: Bearer <access_token>`. Kirim query GET tanpa body. Tabel GET detail mencantumkan `Content-Type: application/json`. POST dan PUT memakai body JSON resource, `Content-Type: application/json`. Untuk PATCH, tabel kelima resource mencantumkan `application/json`. Periksa format body dan media type yang diterima per route dari koleksi/Sandbox, termasuk standar JSON Patch yang memakai `application/json-patch+json`. [Kontrak HTTP FHIR](kontrak-fhir-http.md) · [FHIR R4 HTTP](https://hl7.org/fhir/R4/http.html#patch)

| Resource | Pencarian yang diterbitkan | Operasi detail dan mutasi |
| --- | --- | --- |
| HealthcareService | `GET /HealthcareService?specialty={kode-poli}`. Contoh query `S001.09`. | `GET /HealthcareService/{id}`, `POST /HealthcareService`, `PUT /HealthcareService/{id}`, `PATCH /HealthcareService/{id}`. |
| PractitionerRole | `GET /PractitionerRole?practitioner={ihs}`, atau `?practitioner={ihs}&organization={id}`. Keduanya diperlukan saat memakai variasi gabungan. | `GET /PractitionerRole/{id}`, `POST /PractitionerRole`, `PUT /PractitionerRole/{id}`, `PATCH /PractitionerRole/{id}`. |
| Slot | Operasi pencarian koleksi belum tercantum pada halaman Slot. Gunakan ID yang diperoleh melalui jalur yang sudah terbukti. | `GET /Slot/{id}`, `POST /Slot`, `PUT /Slot/{id}`, `PATCH /Slot/{id}`. |
| Appointment | `GET /Appointment?actor={id-healthcare-service}` sesuai contoh katalog. Dukungan filter Patient, Slot atau identifier perlu diverifikasi. | `GET /Appointment/{id}`, `POST /Appointment`, `PUT /Appointment/{id}`, `PATCH /Appointment/{id}`. |
| AppointmentResponse | `GET /AppointmentResponse?appointment={id-appointment}`. | `GET /AppointmentResponse/{id}`, `POST /AppointmentResponse`, `PUT /AppointmentResponse/{id}`, `PATCH /AppointmentResponse/{id}`. |
| Schedule | Standar Terminologi menjelaskan Schedule. Metode create/search/detail Schedule perlu didapat dari kontrak yang berlaku. | Slot memakai `schedule.reference`. Pastikan referensi Schedule yang sah sebelum mencoba create Slot. |

Gunakan ID server dari lingkungan yang sama, termasuk UUID pada path detail sesuai katalog. GET pencarian mengembalikan Bundle `searchset`. GET detail dan operasi tulis mengembalikan resource sesuai contoh sukses `2xx`. Simpan ID dan versi yang tersedia, lalu cocokkan status pada baca balik. Pada PUT sertakan ID yang sama dengan path. Contoh 4xx memakai `OperationOutcome` JSON dan contoh 5xx dapat berupa teks. [HealthcareService](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/) · [PractitionerRole](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/) · [Slot](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/) · [Appointment](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/) · [AppointmentResponse](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/)
