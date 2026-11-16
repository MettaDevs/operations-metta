# Contoh payload FHIR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [MedicationDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-dispense/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md)

Contoh pengiriman dan pemicu ada di [Endpoint dan pengiriman](../alur/rawat-jalan.md). Siapkan nilai dari [Matriks rawat jalan](matriks-rawat-jalan.md) dan [Matriks farmasi](matriks-farmasi.md).

Nilai dalam `<...>` adalah placeholder. Isi dari fixture yang diizinkan dan lengkapi field sesuai tahap dan profil sebelum mengirim. Contoh waktu memakai UTC `+00:00`. Bentuk Encounter awal pernah dipakai untuk uji kontrak dengan empat referensi Sandbox. Contoh finalisasi, resume, dan obat masih merupakan rancangan payload. [Bukti Encounter awal](../pengujian/backlog-rawat-jalan-tanpa-resep.md#bukti-uji-encounter-awal-di-sandbox) · [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)

[Encounter saat registrasi](#encounter-saat-registrasi) · [Encounter saat finalisasi](#encounter-saat-finalisasi) · [Tanda vital dan diagnosis](#tanda-vital-dan-diagnosis) · [Resep dan penyerahan obat](#resep-dan-penyerahan-obat) · [Resume medis](#resume-medis)

## Encounter saat registrasi

`POST /Encounter` mengirim NoReg sebagai `identifier.value` dengan namespace yang memakai ID organisasi SATUSEHAT. Poli yang disimpan di Metta diterjemahkan ke `Location/{id}`. Pada tahap selesai, gunakan `PUT` dengan `id` yang sama, tambah diagnosis, waktu akhir dan perubahan status, serta pertahankan isi yang masih berlaku. Cek `serviceType`, status pengunjung, status kunjungan spesialisasi, dan episode pelayanan terhadap v7.0. [Pemetaan waktu dan peserta di Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Profil Encounter](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_2_pendaftaran_kunjungan_pasien)

```json
{
  "resourceType": "Encounter",
  "identifier": [{
    "system": "http://sys-ids.kemkes.go.id/encounter/<organization-id>",
    "value": "RJ-CONTOH-001"
  }],
  "status": "arrived",
  "statusHistory": [{"status": "arrived", "period": {"start": "2026-11-16T01:00:00+00:00"}}],
  "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB"},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "participant": [{
    "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "code": "ATND"}]}],
    "individual": {"reference": "Practitioner/<practitioner-ihs>"}
  }],
  "period": {"start": "2026-11-16T01:00:00+00:00"},
  "location": [{"location": {"reference": "Location/<poli-id>"}}],
  "serviceProvider": {"reference": "Organization/<organization-id>"}
}
```

## Encounter saat finalisasi

Gunakan `PUT /Encounter/{id}` dengan `id` pada URI dan body sama dengan ID balikan POST. Mulai dari Encounter yang sudah tersimpan, pertahankan data dan extension yang masih berlaku, lalu tambahkan waktu akhir, histori status, diagnosis yang sudah diterima, dan informasi pulang dari fakta aktual. Contoh ini menggambarkan satu diagnosis dan satu lokasi. Pilih kode cara pulang yang berlaku menurut Playbook. Jangan membuat periode layanan yang tidak ada pada Metta. [Playbook bab 26–28](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_28_pembaharuan_data_kunjungan)

```json
{
  "resourceType": "Encounter",
  "id": "<encounter-id>",
  "identifier": [{
    "system": "http://sys-ids.kemkes.go.id/encounter/<organization-id>",
    "value": "RJ-CONTOH-001"
  }],
  "status": "finished",
  "statusHistory": [
    {"status": "arrived", "period": {"start": "2026-11-16T01:00:00+00:00", "end": "2026-11-16T01:08:00+00:00"}},
    {"status": "in-progress", "period": {"start": "2026-11-16T01:08:00+00:00", "end": "2026-11-16T01:35:00+00:00"}}
  ],
  "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB"},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "participant": [{
    "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "code": "ATND"}]}],
    "individual": {"reference": "Practitioner/<practitioner-ihs>"}
  }],
  "period": {"start": "2026-11-16T01:00:00+00:00", "end": "2026-11-16T01:35:00+00:00"},
  "location": [{"location": {"reference": "Location/<poli-id>"}}],
  "serviceProvider": {"reference": "Organization/<organization-id>"},
  "diagnosis": [{"condition": {"reference": "Condition/<condition-id>"}, "rank": 1}],
  "hospitalization": {
    "dischargeDisposition": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/discharge-disposition", "code": "home"}]}
  }
}
```

Kode `home` pada contoh berlaku untuk pulang dengan persetujuan dokter. Isi `diagnosis[].use` dan `rank` berdasarkan peran dan urutan diagnosis yang benar. Skenario dengan keluhan utama, diagnosis sekunder, kondisi saat meninggalkan fasyankes, rujukan, atau kelas layanan mengikuti matriks sesuai data kunjungan. [Matriks Encounter](matriks-rawat-jalan.md#encounter) · [Playbook cara keluar](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_27_pengiriman_data_cara_keluar_dari_rumah_sakit)

## Tanda vital dan diagnosis

Contoh `POST /Observation` untuk frekuensi napas. Kode dan satuan tiap pengukuran ada di [migration tanda vital](../../../../modules/healthcare/database/migrations/0048_vital_sign_codes.sql). Gunakan waktu pengukuran dan identitas pemeriksa yang tersimpan. Untuk diagnosis lewat `POST /Condition`, petakan `code.coding` ke ICD-10 dan padanan SNOMED CT, `subject` ke pasien, `encounter` ke kunjungan, serta `clinicalStatus`, `category`, dan field lainnya sesuai jenis Condition. Simpan ID `Condition` agar dapat dirujuk Encounter, tindakan, resep, dan resume bila sesuai. [Playbook Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_4_pengiriman_data_hasil_pemeriksaan_fisik) · [Playbook Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_13_pengiriman_data_diagnosis)

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs"}]}],
  "code": {"coding": [{"system": "http://loinc.org", "code": "9279-1"}]},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "encounter": {"reference": "Encounter/<encounter-id>"},
  "effectiveDateTime": "2026-11-16T01:10:00+00:00",
  "performer": [{"reference": "Practitioner/<pemeriksa-ihs>"}],
  "valueQuantity": {"value": 18, "unit": "/min", "system": "http://unitsofmeasure.org", "code": "/min"}
}
```

Contoh berikut untuk `POST /Condition` diagnosis kunjungan. Pakai kode ICD-10 yang dipilih pada pemeriksaan dan padanan SNOMED CT sesuai pemetaan Kemenkes. Simpan ID Condition balikan sebelum menambahkan referensinya ke Encounter atau resume.

```json
{
  "resourceType": "Condition",
  "category": [{"coding": [{
    "system": "http://terminology.hl7.org/CodeSystem/condition-category",
    "code": "encounter-diagnosis"
  }]}],
  "code": {"coding": [
    {"system": "http://hl7.org/fhir/sid/icd-10", "code": "<kode-icd10>"},
    {"system": "http://snomed.info/sct", "code": "<kode-snomed-ct-yang-sepadan>"}
  ]},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "encounter": {"reference": "Encounter/<encounter-id>"}
}
```

## Resep dan penyerahan obat

Contoh `POST /MedicationRequest` untuk satu obat nonracikan dengan keputusan eksplisit bahwa substitusi tidak diizinkan. Obat yang diresepkan dapat memakai KFA produk virtual `92xxxxxx` atau produk aktual `93xxxxxx` sesuai Playbook. `MedicationRequest.medicationReference` menunjuk `Medication` di dalam `contained`. Untuk racikan, isi bentuk sediaan dan komponen sesuai aturan racikan `SD` atau `EP`. Kolom pemetaan seperti KFA, kode bentuk sediaan, dan satuan dapat masih kosong di Metta. Periksa kelengkapan sebelum pengiriman resource yang membutuhkannya. [Docs E-Resep](../../../../modules/healthcare/README.md#biaya-tindakan-dan-e-resep) · [Playbook Peresepan Obat](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_16_pengiriman_data_peresepan_obat)

```json
{
  "resourceType": "MedicationRequest",
  "contained": [{
    "resourceType": "Medication",
    "id": "obat-1",
    "identifier": [{"system": "http://sys-ids.kemkes.go.id/medication/<organization-id>", "value": "OBAT-CONTOH-01"}],
    "code": {"coding": [{"system": "http://sys-ids.kemkes.go.id/kfa", "code": "<kode-kfa-resep>"}]},
    "extension": [{
      "url": "https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType",
      "valueCodeableConcept": {"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/medication-type", "code": "NC"}]}
    }]
  }],
  "identifier": [
    {"system": "http://sys-ids.kemkes.go.id/prescription/<organization-id>", "value": "RESEP-CONTOH-001"},
    {"system": "http://sys-ids.kemkes.go.id/prescription-item/<organization-id>", "value": "RESEP-CONTOH-001-1"}
  ],
  "status": "active",
  "intent": "order",
  "medicationReference": {"reference": "#obat-1"},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "encounter": {"reference": "Encounter/<encounter-id>"},
  "authoredOn": "2026-11-16T01:20:00+00:00",
  "requester": {"reference": "Practitioner/<dokter-ihs>"},
  "dosageInstruction": [{
    "timing": {"repeat": {"frequency": 1, "period": 1, "periodUnit": "d", "boundsDuration": {"value": 3, "system": "http://unitsofmeasure.org", "code": "d"}}},
    "route": {"coding": [{"system": "<sistem-kode-rute-playbook>", "code": "<kode-rute-playbook>"}]},
    "doseAndRate": [{"doseQuantity": {"value": 1, "system": "http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm", "code": "TAB"}}]
  }],
  "dispenseRequest": {"quantity": {"value": 3, "system": "http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm", "code": "TAB"}},
  "substitution": {"allowedBoolean": false}
}
```

Untuk `POST /MedicationDispense`, bangun `contained` dari obat yang benar-benar diserahkan. Gunakan identitas resep dan baris sesuai Playbook, `status` sesuai keadaan, `medicationReference` ke obat tersebut, `subject`, `context` ke Encounter, dan `authorizingPrescription` ke ID `MedicationRequest` SATUSEHAT. Petakan `performer`, `location`, `quantity`, `whenPrepared`, `whenHandedOver`, dan penerima sesuai profil. Batch yang benar-benar keluar dapat menjadi sumber `Medication.batch`. Tetapkan aturan ketika satu baris memakai beberapa batch dan saat terjadi retur sebelum mengaktifkan alur itu. [Data penyerahan Metta](../../../../modules/pharmacy/README.md#obat-diserahkan-event-ke-layanan-kesehatan) · [Playbook Pengeluaran Obat](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_18_pengiriman_data_pengeluaran_obat) · [Profil MedicationDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-dispense/)

```json
{
  "resourceType": "MedicationDispense",
  "contained": [{
    "resourceType": "Medication",
    "id": "obat-diserahkan",
    "identifier": [{"system": "http://sys-ids.kemkes.go.id/medication/<organization-id>", "value": "OBAT-AKTUAL-CONTOH-01"}],
    "code": {"coding": [{"system": "http://sys-ids.kemkes.go.id/kfa", "code": "<kode-kfa-aktual-93xxxxxx>"}]},
    "batch": {"lotNumber": "BATCH-CONTOH-01", "expirationDate": "2027-11-30"},
    "extension": [{
      "url": "https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType",
      "valueCodeableConcept": {"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/medication-type", "code": "NC"}]}
    }]
  }],
  "identifier": [
    {"system": "http://sys-ids.kemkes.go.id/prescription/<organization-id>", "value": "RESEP-CONTOH-001"},
    {"system": "http://sys-ids.kemkes.go.id/prescription-item/<organization-id>", "value": "RESEP-CONTOH-001-1"}
  ],
  "status": "completed",
  "medicationReference": {"reference": "#obat-diserahkan"},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "context": {"reference": "Encounter/<encounter-id>"},
  "performer": [{"actor": {"reference": "Practitioner/<apoteker-ihs>"}}],
  "location": {"reference": "Location/<farmasi-id>"},
  "authorizingPrescription": [{"reference": "MedicationRequest/<medication-request-id>"}],
  "quantity": {"value": 3, "system": "http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm", "code": "TAB"},
  "whenPrepared": "2026-11-16T01:28:00+00:00",
  "whenHandedOver": "2026-11-16T01:33:00+00:00",
  "receiver": [{"reference": "Patient/<patient-ihs>"}]
}
```

Sebelum pengeluaran obat, pengkajian yang dilakukan petugas memakai `POST /QuestionnaireResponse` dengan canonical `https://fhir.kemkes.go.id/Questionnaire/Q0007`. Isi pemeriksa dan sumber jawaban, kaitkan Patient dan Encounter, lalu isi `item[].item[]` dari jawaban yang benar-benar dicatat. Untuk pertanyaan yang memakai istilah sesuai/tidak sesuai, Playbook memberi `valueCoding` di sistem `http://terminology.kemkes.go.id/CodeSystem/clinical-term` dengan kode `OV000052` atau `OV000053`. Pertanyaan klinis tentang duplikasi, alergi, kontraindikasi, dan interaksi mengikuti tipe jawaban pada tabel. Gunakan `item[].answer.valueReference` untuk resep yang dikaji dengan `linkId` yang berlaku. Verifikasi susunan grup serta `linkId` pada kontrak Q0007 sebelum membuat fixture penuh. [Matriks pengkajian resep](matriks-farmasi.md#questionnaireresponse) · [Playbook bab 17](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_17_pengiriman_data_pengkajian_resep)

## Resume medis

`POST /Composition` memakai tipe resume rawat jalan LOINC `88645-7` sesuai Playbook. Isi `status`, `subject`, `encounter`, `date`, `author`, `title`, dan seluruh bagian yang berlaku. Contoh berikut memperlihatkan struktur section bertingkat untuk tanda vital dan diagnosis akhir.

```json
{
  "resourceType": "Composition",
  "status": "final",
  "type": {"coding": [{"system": "http://loinc.org", "code": "88645-7"}]},
  "subject": {"reference": "Patient/<patient-ihs>"},
  "encounter": {"reference": "Encounter/<encounter-id>"},
  "date": "2026-11-16T01:40:00+00:00",
  "author": [{"reference": "Practitioner/<dokter-ihs>"}],
  "title": "Resume medis rawat jalan",
  "section": [
    {
      "title": "Pemeriksaan Fisik",
      "code": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000007"}]},
      "section": [{
        "title": "Tanda Vital",
        "code": {"coding": [{"system": "http://loinc.org", "code": "8716-3"}]},
        "entry": [{"reference": "Observation/<observation-id>"}]
      }]
    },
    {
      "title": "Diagnosis",
      "code": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000004"}]},
      "section": [{
        "title": "Diagnosis Akhir",
        "code": {"coding": [{"system": "http://loinc.org", "code": "78375-3"}]},
        "entry": [{"reference": "Condition/<condition-id>"}]
      }]
    }
  ]
}
```

Untuk koreksi resume, periksa aturan versi, pengesahan, dan referensi dokumen asal sebelum memilih operasi pembaruan. [Playbook Resume Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_29_pengiriman_data_resume_medis)
