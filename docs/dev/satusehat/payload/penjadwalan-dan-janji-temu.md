# Payload penjadwalan dan janji temu

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) (disunting 2024-10-03) · [Standar Terminologi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) (disunting 2026-11-06) · [Standar Terminologi SATUSEHAT](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) (v12.0, rilis 2026-10-31)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Jadwal praktik, Slot, dan janji temu](../alur/penjadwalan-dan-janji-temu.md) · [Endpoint penjadwalan dan janji temu](../endpoint/penjadwalan-dan-janji-temu.md)

## Field, kode dan permintaan

Kolom field wajib mengikuti kardinalitas atau invariant dasar FHIR R4 yang disebut. Katalog HTTP Kemenkes menunjuk koleksi untuk contoh body. Validasi tambahan endpoint dan scope per resource perlu dibuktikan pada lingkungan program.

| Resource | Field penting dan ketentuan |
| --- | --- |
| HealthcareService | `identifier[]` dari layanan lokal, `active`, `providedBy` Organization, `type[]` jenis pelayanan, `specialty[]` Poli Tujuan, `location[]`, `name`, `appointmentRequired`, kontak serta `availableTime[]` dari jadwal bila dipakai. Untuk visibilitas, Standar Terminologi memberi `characteristic[]` `public`/`private` dari `https://terminology.kemkes.go.id/CodeSystem/service-visibility`. |
| PractitionerRole | `practitioner`, `organization`, `code[]` profesi/peran, `specialty[]`, `location[]`, `healthcareService[]`, `period`, `active`, kontak dan ketersediaan menurut fakta. Bab 38.4 memberi SNOMED CT di bawah ECL `< 394658006` untuk spesialisasi PractitionerRole. Kode poli HealthcareService mengikuti lampiran terpisah. |
| Schedule | Wajib `actor[]` minimal satu referensi yang didukung FHIR R4. Isi `identifier[]`, `active`, `serviceCategory[]`, `serviceType[]`, `specialty[]`, dan `planningHorizon` sesuai data. Standar Terminologi menautkan aktor/jadwal ke data layanan dan menyebut SIRS RL 3.2/RL 3.5. Referensi yang diizinkan oleh profil program perlu verifikasi. |
| Slot | Wajib `schedule`, `status`, `start`, `end`. Gunakan `identifier[]` internal, `serviceType[]`, `specialty[]`, `appointmentType` dan `overbooked` bila benar-benar dicatat. Status `free`, `busy`, `busy-unavailable`, `busy-tentative`, `entered-in-error`. |
| Appointment | Wajib `status` dan minimal satu `participant[]` dengan `status`. Per peserta, isi `type` atau `actor`. `start` dan `end` harus keduanya ada atau keduanya kosong. Menurut invariant R4, waktu bisa kosong pada `proposed`, `cancelled`, atau `waitlist`. Simpan `identifier[]`, `slot[]`, jenis pelayanan dan `appointmentType`, `created`, serta `cancelationReason` pada skenario yang diizinkan. Jangan menyamakan `Appointment.status` dengan status setiap peserta. |
| AppointmentResponse | Wajib `appointment` dan `participantStatus`, plus `participantType` atau `actor`. `start`/`end` bisa dipakai untuk usulan waktu jika alur mendukung. Simpan identitas pemberi respons, waktu, status dan `comment` bila diperlukan. |

Kode Appointment/Slot `appointmentType` memakai `http://terminology.hl7.org/CodeSystem/v2-0276` dengan `CHECKUP`, `EMERGENCY`, `FOLLOWUP`, `ROUTINE` atau `WALKIN` menurut fakta. Status Appointment ditulis sebagai code `proposed`, `pending`, `booked`, `arrived`, `fulfilled`, `cancelled`, `noshow`, `entered-in-error`, `checked-in` atau `waitlist`. `Appointment.participant[].status` dan `AppointmentResponse.participantStatus` memakai `accepted`, `declined`, `tentative` atau `needs-action`. [FHIR Appointment](https://hl7.org/fhir/R4/appointment.html) · [FHIR AppointmentResponse](https://hl7.org/fhir/R4/appointmentresponse.html) · [FHIR Slot](https://hl7.org/fhir/R4/slot.html) · [FHIR Schedule](https://hl7.org/fhir/R4/schedule.html) · [FHIR HealthcareService](https://hl7.org/fhir/R4/healthcareservice.html) · [FHIR PractitionerRole](https://hl7.org/fhir/R4/practitionerrole.html)

### Contoh sintesis layanan, peran, Schedule dan Slot

Ganti ID dan namespace contoh dengan data fixture yang disetujui. Objek Schedule menunjukkan hubungan FHIR dasar. Pengiriman Schedule membutuhkan route yang diterbitkan untuk instalasi. Untuk uji Slot gunakan Schedule yang sudah sah.

```json
{
  "resourceType": "HealthcareService",
  "active": true,
  "providedBy": {"reference": "Organization/<ORG>"},
  "name": "Poli fixture",
  "location": [{"reference": "Location/<POLI>"}],
  "appointmentRequired": true,
  "characteristic": [{"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/service-visibility", "code": "public"}]}]
}
```

```json
{
  "resourceType": "PractitionerRole",
  "active": true,
  "practitioner": {"reference": "Practitioner/<DOKTER>"},
  "organization": {"reference": "Organization/<ORG>"},
  "location": [{"reference": "Location/<POLI>"}],
  "healthcareService": [{"reference": "HealthcareService/<LAYANAN>"}]
}
```

```json
{
  "resourceType": "Schedule",
  "active": true,
  "actor": [{"reference": "PractitionerRole/<ROLE>"}, {"reference": "HealthcareService/<LAYANAN>"}],
  "planningHorizon": {"start": "2026-11-17T01:00:00Z", "end": "2026-11-17T05:00:00Z"}
}
```

```json
{
  "resourceType": "Slot",
  "schedule": {"reference": "Schedule/<JADWAL>"},
  "status": "free",
  "start": "2026-11-17T02:00:00Z",
  "end": "2026-11-17T02:20:00Z"
}
```

### Contoh janji dan respons

Contoh Appointment setelah lokasi, layanan dan Slot tersedia. Isi respons aktor setelah kejadian konfirmasi yang sah.

```json
{
  "resourceType": "Appointment",
  "identifier": [{"system": "https://example.invalid/metta/appointment", "value": "APT-FIXTURE-001"}],
  "status": "pending",
  "appointmentType": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0276", "code": "ROUTINE"}]},
  "start": "2026-11-17T02:00:00Z",
  "end": "2026-11-17T02:20:00Z",
  "slot": [{"reference": "Slot/<SLOT>"}],
  "participant": [
    {"actor": {"reference": "Patient/<PATIENT>"}, "status": "needs-action"},
    {"actor": {"reference": "HealthcareService/<LAYANAN>"}, "status": "accepted"}
  ]
}
```

```json
{
  "resourceType": "AppointmentResponse",
  "appointment": {"reference": "Appointment/<JANJI>"},
  "actor": {"reference": "Patient/<PATIENT>"},
  "participantStatus": "accepted"
}
```

Potongan balikan baca detail setelah keputusan pemesanan dikonfirmasi dan Appointment memang diperbarui.

```json
{
  "resourceType": "Appointment",
  "id": "<JANJI>",
  "status": "booked",
  "slot": [{"reference": "Slot/<SLOT>"}],
  "participant": [
    {"actor": {"reference": "Patient/<PATIENT>"}, "status": "accepted"},
    {"actor": {"reference": "HealthcareService/<LAYANAN>"}, "status": "accepted"}
  ]
}
```
