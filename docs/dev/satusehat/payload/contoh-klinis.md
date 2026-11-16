# Contoh payload layanan klinis

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [AllergyIntolerance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/allergy-intolerance/) (disunting 2024-12-15) · [FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/family-member-history/) (disunting 2024-12-15) · [ClinicalImpression](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/clinical-impression/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Peta contoh](indeks-contoh-payload.md) · [Matriks layanan kondisional](matriks-layanan-kondisional.md) · [Kontrak HTTP](../endpoint/kontrak-operasi-api.md)

Gunakan ID, kode dan fakta fixture sesuai environment. Contoh dasar FHIR menjelaskan hubungan data. Untuk resource dengan endpoint terbatas atau belum ditemukan, periksa akses dan contoh yang diterbitkan sebelum pengiriman. Kebutuhan field kondisional tetap mengikuti skenario.

### AllergyIntolerance

Contoh create untuk alergi yang telah dicatat dan dikonfirmasi. Gunakan kode penyebab yang dipetakan. Jika mengisi reaction, tambahkan setidaknya manifestation sesuai catatan. [Matriks alergi](matriks-rawat-jalan.md#allergyintolerance) · [Profil AllergyIntolerance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/allergy-intolerance/)

```json
{
  "resourceType": "AllergyIntolerance",
  "clinicalStatus": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
        "code": "active"
      }
    ]
  },
  "verificationStatus": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
        "code": "confirmed"
      }
    ]
  },
  "category": [
    "food"
  ],
  "code": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "<KODE_ALERGEN>"
      }
    ]
  },
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "recordedDate": "2026-11-16T04:00:00Z",
  "recorder": {
    "reference": "Practitioner/<PRACTITIONER>"
  }
}
```

### FamilyMemberHistory

Contoh create. Metta perlu sumber hubungan keluarga, jenis kondisi dan status riwayat terstruktur. Kode diagnosis menggambarkan kondisi anggota keluarga yang tercatat. [Pemetaan riwayat keluarga](matriks-layanan-kondisional.md#familymemberhistory) · [Profil FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/family-member-history/)

```json
{
  "resourceType": "FamilyMemberHistory",
  "status": "completed",
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "relationship": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
        "code": "FTH"
      }
    ]
  },
  "date": "2026-11-16T04:00:00Z",
  "condition": [
    {
      "code": {
        "coding": [
          {
            "system": "http://hl7.org/fhir/sid/icd-10",
            "code": "E11.9"
          }
        ]
      }
    }
  ]
}
```

### ClinicalImpression

Contoh create untuk penilaian prognosis yang sudah diselesaikan. Gunakan assessment, waktu dan kode yang sesuai skenario penilaian. [Pemetaan ClinicalImpression](matriks-layanan-kondisional.md#clinicalimpression) · [Profil ClinicalImpression](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/clinical-impression/)

```json
{
  "resourceType": "ClinicalImpression",
  "status": "completed",
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "effectiveDateTime": "2026-11-16T04:00:00Z",
  "assessor": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "problem": [
    {
      "reference": "Condition/<CONDITION>"
    }
  ],
  "prognosisCodeableConcept": [
    {
      "coding": [
        {
          "system": "http://snomed.info/sct",
          "code": "170968001"
        }
      ]
    }
  ]
}
```

### Goal

Contoh dasar target pada program berhenti merokok. Uji peran dan operasi Goal sesuai koleksi modul. Hubungkan Goal ke CarePlan setelah ID diberikan. [Tujuan perawatan](upaya-berhenti-merokok.md#field-dan-terminologi) · [Profil Goal](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/goal/)

```json
{
  "resourceType": "Goal",
  "lifecycleStatus": "active",
  "description": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "160617001"
      }
    ]
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/goal-category",
          "code": "behavioral"
        }
      ]
    }
  ],
  "startDate": "2026-11-16",
  "expressedBy": {
    "reference": "Patient/<PATIENT>"
  }
}
```

### CarePlan

Contoh create rencana UBM. Goal dan ServiceRequest yang ditautkan sudah tersimpan. Bila mengisi activity.detail, lengkapi status activity sesuai profil. [UBM](upaya-berhenti-merokok.md#field-dan-terminologi) · [Profil CarePlan](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/care-plan/)

```json
{
  "resourceType": "CarePlan",
  "status": "active",
  "intent": "plan",
  "category": [
    {
      "coding": [
        {
          "system": "http://snomed.info/sct",
          "code": "710081004"
        }
      ]
    },
    {
      "coding": [
        {
          "system": "http://terminology.kemkes.go.id",
          "code": "program-intensif"
        }
      ]
    }
  ],
  "title": "Rencana konseling fixture",
  "description": "Konseling berikut mengikuti jadwal pada permintaan aktif.",
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "author": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "goal": [
    {
      "reference": "Goal/<GOAL>"
    }
  ],
  "activity": [
    {
      "reference": {
        "reference": "ServiceRequest/<ORDER>"
      }
    }
  ]
}
```

### RiskAssessment

Contoh dasar penilaian yang sudah diselesaikan. Gunakan prediction hanya bila risiko dan metode penilaian tersedia. Pemetaan kategori serta route RiskAssessment masih perlu diuji. [Penilaian risiko](matriks-layanan-kondisional.md#riskassessment) · [Profil RiskAssessment](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/risk-assessment/)

```json
{
  "resourceType": "RiskAssessment",
  "status": "final",
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "occurrenceDateTime": "2026-11-16T04:00:00Z",
  "performer": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "basis": [
    {
      "reference": "Observation/<HASIL_PENILAIAN>"
    }
  ]
}
```

### Procedure

Contoh create tindakan yang benar-benar tercatat. Ganti kode dengan kode ICD-9-CM dari tindakan fixture, lalu verifikasi pelaku dan periode. [Pemetaan Procedure](matriks-rawat-jalan.md#procedure) · [Profil Procedure](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/procedure/)

```json
{
  "resourceType": "Procedure",
  "status": "completed",
  "code": {
    "coding": [
      {
        "system": "http://hl7.org/fhir/sid/icd-9-cm",
        "code": "<KODE_TINDAKAN>"
      }
    ]
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "performedDateTime": "2026-11-16T04:00:00Z",
  "performer": [
    {
      "actor": {
        "reference": "Practitioner/<PRACTITIONER>"
      }
    }
  ],
  "reasonReference": [
    {
      "reference": "Condition/<CONDITION>"
    }
  ]
}
```

### MedicationStatement

Contoh dasar riwayat penggunaan yang dinyatakan pasien. Resolve Medication dan simpan sumber serta masa penggunaan. Route dan bentuk contained/reference bergantung profil layanan. [Riwayat obat](matriks-layanan-kondisional.md#medicationstatement) · [Profil MedicationStatement](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-statement/)

```json
{
  "resourceType": "MedicationStatement",
  "status": "active",
  "medicationReference": {
    "reference": "Medication/<MEDICATION>"
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "context": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "effectivePeriod": {
    "start": "2026-11-10"
  },
  "dateAsserted": "2026-11-16T04:00:00Z",
  "informationSource": {
    "reference": "Patient/<PATIENT>"
  }
}
```

### MedicationAdministration

Contoh dasar pemberian aktual. Gunakan Medication yang diketahui di lingkungan yang sama, Encounter dan obat yang benar-benar diberikan. Tambahkan dosis atau rute bila dicatat dan dipetakan. [Pemberian obat](matriks-layanan-kondisional.md#pemberian-obat-diet-dan-alat-kesehatan) · [Profil MedicationAdministration](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-administration/)

```json
{
  "resourceType": "MedicationAdministration",
  "status": "completed",
  "medicationReference": {
    "reference": "Medication/<MEDICATION>"
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "context": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "effectiveDateTime": "2026-11-16T04:00:00Z",
  "performer": [
    {
      "actor": {
        "reference": "Practitioner/<PRACTITIONER>"
      }
    }
  ],
  "request": {
    "reference": "MedicationRequest/<RESEP>"
  }
}
```

### NutritionOrder

Contoh dasar diet oral. FHIR R4 memakai patient, dan field encounter pada skenario Gizi wajib. Gunakan intent yang sesuai fakta. Koleksi Rawat Inap memberi POST dengan intent proposal pada skenarionya. [Tumbuh Kembang dan Gizi](tumbuh-kembang-dan-gizi.md#antropometri-dan-temuan-gizi) · [Profil NutritionOrder](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/nutrition-order/)

```json
{
  "resourceType": "NutritionOrder",
  "status": "active",
  "intent": "order",
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "dateTime": "2026-11-16T04:00:00Z",
  "orderer": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "oralDiet": {
    "type": [
      {
        "coding": [
          {
            "system": "http://snomed.info/sct",
            "code": "<KODE_DIET>"
          }
        ]
      }
    ]
  }
}
```

### Consent

Contoh bentuk persetujuan umum pada TTE. Pertahankan dasar persetujuan dan bukti dokumen, serta gunakan URI kebijakan yang sah. Endpoint Consent dan relasi dokumen memerlukan konfirmasi dari modul. [Consent dan TTE](tanda-tangan-elektronik-dan-consent.md#fhir-consent-persetujuan-klinis-dan-akses-ssrme) · [Profil Consent](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/consent/)

```json
{
  "resourceType": "Consent",
  "identifier": [
    {
      "system": "https://example.invalid/metta/consent",
      "value": "CONSENT-FIXTURE-01"
    }
  ],
  "status": "active",
  "scope": {
    "coding": [
      {
        "system": "http://terminology.kemkes.go.id",
        "code": "general-consent"
      }
    ]
  },
  "category": [
    {
      "coding": [
        {
          "system": "http://loinc.org",
          "code": "59284-0"
        }
      ]
    }
  ],
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "dateTime": "2026-11-16T04:00:00Z",
  "performer": [
    {
      "reference": "Patient/<PATIENT>"
    }
  ],
  "organization": [
    {
      "reference": "Organization/<ORGANIZATION>"
    }
  ],
  "sourceReference": {
    "reference": "DocumentReference/<BUKTI_PERSETUJUAN>"
  },
  "policy": [
    {
      "uri": "http://satusehat.kemkes.go.id/fhir/consent-policy"
    }
  ]
}
```

### BodyStructure

Contoh dasar untuk alur yang mereferensikan struktur anatomi tersendiri, dengan sisi kiri pada fixture. Jika lokasi merupakan bagian langsung dari temuan, isi bodySite sesuai profil resource. Metta menyimpan `bagian_tubuh` pada `sim_tr_pemeriksaan_anatomi`. Pemetaan SNOMED CT perlu ditentukan dari data aktual. Kontrak HTTP BodyStructure perlu konfirmasi. [Terminologi lokasi dan sisi](../terminologi/kontrak-terminologi.md#nilai-yang-dibutuhkan-lintas-modul) · [Skema anatomi Metta](../../../../modules/healthcare/database/migrations/0021_examination_record.sql) · [Profil BodyStructure](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/body-structure/)

```json
{
  "resourceType": "BodyStructure",
  "active": true,
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "location": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "<KODE_LOKASI_ANATOMI>"
      }
    ]
  },
  "locationQualifier": [
    {
      "coding": [
        {
          "system": "http://snomed.info/sct",
          "code": "7771000"
        }
      ]
    }
  ]
}
```

### Practitioner

Potongan balikan GET detail. ID ini dipakai untuk Encounter dan resource klinis lain. Identitas contoh menggunakan placeholder. [Orientasi Practitioner](../endpoint/onboarding-fhir.md#practitioner) · [Profil Practitioner](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/practitioner/)

```json
{
  "resourceType": "Practitioner",
  "id": "<PRACTITIONER>",
  "active": true,
  "name": [
    {
      "text": "Tenaga kesehatan fixture"
    }
  ]
}
```

### RelatedPerson

Contoh create relasi ibu terhadap bayi. Gunakan identitas dan peran yang diverifikasi. Lampirkan detail kontak hanya jika diperlukan skenario. [Data kelahiran](data-kelahiran-dan-akta.md#field-dan-sumber-di-metta) · [Profil RelatedPerson](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/related-person/)

```json
{
  "resourceType": "RelatedPerson",
  "identifier": [
    {
      "system": "https://fhir.kemkes.go.id/id/nik",
      "value": "<NIK_IBU_FIXTURE>"
    }
  ],
  "active": true,
  "patient": {
    "reference": "Patient/<BAYI>"
  },
  "relationship": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
          "code": "NMTH"
        }
      ]
    }
  ],
  "name": [
    {
      "text": "Ibu fixture"
    }
  ]
}
```

### VisionPrescription

Contoh dasar satu resep kacamata. Nilai lensa adalah fixture. Route POST dipublikasikan di koleksi Mata. Operasi baca, canonical profil dan izin akun mengikuti kontrak program. [Registrasi Mata](../alur/registrasi-mata-dan-telinga.md#registrasi-mata) · [FHIR R4 VisionPrescription](https://hl7.org/fhir/R4/visionprescription.html)

```json
{
  "resourceType": "VisionPrescription",
  "status": "active",
  "created": "2026-11-16T04:00:00Z",
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "dateWritten": "2026-11-16T04:00:00Z",
  "prescriber": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "lensSpecification": [
    {
      "product": {
        "coding": [
          {
            "system": "http://terminology.hl7.org/CodeSystem/ex-visionprescriptionproduct",
            "code": "lens"
          }
        ]
      },
      "eye": "right",
      "sphere": -1.25
    }
  ]
}
```
