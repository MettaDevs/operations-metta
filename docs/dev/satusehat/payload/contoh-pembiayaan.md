# Contoh payload pembiayaan dan klaim

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Coverage](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage/) (disunting 2024-12-15) · [ChargeItem](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item/) (disunting 2024-12-15) · [ChargeItemDefinition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item-definition/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Peta contoh](indeks-contoh-payload.md) · [BPJS dan E-Klaim](../alur/klaim-bpjs.md) · [Klaim swasta dan OOP](../alur/klaim-swasta-dan-bayar-mandiri.md)

Angka, identitas dan ID fixture hanya untuk memahami hubungan. Gunakan contoh bersama alur dan peran resmi. Untuk tipe non-FHIR, objek ini memetakan field yang dipublikasikan. Format transport lengkap dan kode aktual tetap perlu bukti kontrak mitra.

### Coverage

Contoh dasar coverage peserta yang diterbitkan penjamin. Gunakan beneficiary, payor, identifier dan periode sebenarnya. Perhatikan aturan peran fasyankes serta penjamin. [Klaim BPJS](../alur/klaim-bpjs.md#alur-dan-operasi) · [Profil Coverage](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage/)

```json
{
  "resourceType": "Coverage",
  "identifier": [
    {
      "system": "https://sys-ids.kemkes.go.id/insurance-subscriber/<PENJAMIN>",
      "value": "<NOMOR_PESERTA_FIXTURE>"
    }
  ],
  "status": "active",
  "beneficiary": {
    "reference": "Patient/<PATIENT>"
  },
  "subscriberId": "<NOMOR_PESERTA_FIXTURE>",
  "payor": [
    {
      "reference": "Organization/<PENJAMIN>"
    }
  ],
  "period": {
    "start": "2026-01-01"
  }
}
```

### ChargeItem

Contoh dasar baris tarif pelayanan. Gunakan kode, status billable, kuantitas, pelaku dan Encounter dari fakta yang dibukukan. Biaya yang masih direncanakan mengikuti alur persetujuan penjamin. [Pola klaim swasta](../alur/klaim-swasta-dan-bayar-mandiri.md#primary-payor) · [Profil ChargeItem](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item/)

```json
{
  "resourceType": "ChargeItem",
  "identifier": [
    {
      "system": "https://example.invalid/metta/charge-item",
      "value": "CHARGE-FIXTURE-01"
    }
  ],
  "status": "billable",
  "code": {
    "coding": [
      {
        "system": "<SYSTEM_KODE_TARIF>",
        "code": "<KODE_TARIF>"
      }
    ]
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "context": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "occurrenceDateTime": "2026-11-16T04:00:00Z",
  "performer": [
    {
      "actor": {
        "reference": "Practitioner/<PRACTITIONER>"
      }
    }
  ],
  "quantity": {
    "value": 1
  }
}
```

### ChargeItemDefinition

Contoh dasar definisi harga per item. Isi URL kanonis dan harga sesuai kebijakan produk. Dalam alur farmasi terdapat pemakaian contained pada MedicationDispense. Periksa scope dan profil lama/baru sebelum menggunakan bentuk contained atau mandiri. [Kefarmasian lintas fasyankes](kefarmasian-lintas-fasyankes.md#dokumen-resep-biaya-dan-substitusi) · [Profil ChargeItemDefinition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item-definition/)

```json
{
  "resourceType": "ChargeItemDefinition",
  "url": "https://example.invalid/metta/charge-definition/fixture",
  "status": "active",
  "code": {
    "coding": [
      {
        "system": "<SYSTEM_KODE_TARIF>",
        "code": "<KODE_TARIF>"
      }
    ]
  },
  "propertyGroup": [
    {
      "priceComponent": [
        {
          "type": "base",
          "amount": {
            "value": 100000,
            "currency": "IDR"
          }
        }
      ]
    }
  ]
}
```

### Invoice

Contoh dasar invoice dari akun dan baris biaya. Nominal adalah fixture. Surcharge, total, serta pembulatan harus berasal dari tarif yang disahkan pada skenario penjamin. [Klaim BPJS](klaim-bpjs.md#payload-dan-terminologi) · [Profil Invoice](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/invoice/)

```json
{
  "resourceType": "Invoice",
  "identifier": [
    {
      "system": "https://example.invalid/metta/invoice",
      "value": "INV-FIXTURE-01"
    }
  ],
  "status": "issued",
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "date": "2026-11-16T04:00:00Z",
  "issuer": {
    "reference": "Organization/<FASYANKES>"
  },
  "account": {
    "reference": "Account/<ACCOUNT>"
  },
  "lineItem": [
    {
      "sequence": 1,
      "chargeItemReference": {
        "reference": "ChargeItem/<BIAYA>"
      },
      "priceComponent": [
        {
          "type": "surcharge",
          "amount": {
            "value": 100000,
            "currency": "IDR"
          }
        }
      ]
    }
  ],
  "totalNet": {
    "value": 100000,
    "currency": "IDR"
  },
  "totalGross": {
    "value": 100000,
    "currency": "IDR"
  }
}
```

### Claim

Contoh dasar struktur Claim, sebelum field tambahan verifikasi, grouper, nomor SEP atau aturan penjamin diterapkan. Untuk BPJS, pengiriman klaim sesuai peran E-Klaim. Untuk swasta, ikuti kontrak modul dan akses tenant. [Klaim BPJS](../alur/klaim-bpjs.md) · [Klaim swasta](../alur/klaim-swasta-dan-bayar-mandiri.md) · [Profil Claim](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/claim/)

```json
{
  "resourceType": "Claim",
  "identifier": [
    {
      "system": "https://example.invalid/metta/claim",
      "value": "CLAIM-FIXTURE-01"
    }
  ],
  "status": "active",
  "type": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/claim-type",
        "code": "institutional"
      }
    ]
  },
  "use": "claim",
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "created": "2026-11-16T04:00:00Z",
  "insurer": {
    "reference": "Organization/<PENJAMIN>"
  },
  "provider": {
    "reference": "Organization/<FASYANKES>"
  },
  "priority": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/processpriority",
        "code": "normal"
      }
    ]
  },
  "insurance": [
    {
      "sequence": 1,
      "focal": true,
      "coverage": {
        "reference": "Coverage/<COVERAGE>"
      }
    }
  ],
  "item": [
    {
      "sequence": 1,
      "productOrService": {
        "coding": [
          {
            "system": "<SYSTEM_KODE_TARIF>",
            "code": "<KODE_TARIF>"
          }
        ]
      },
      "unitPrice": {
        "value": 100000,
        "currency": "IDR"
      },
      "net": {
        "value": 100000,
        "currency": "IDR"
      },
      "encounter": [
        {
          "reference": "Encounter/<ENCOUNTER>"
        }
      ]
    }
  ],
  "total": {
    "value": 100000,
    "currency": "IDR"
  }
}
```

### ClaimResponse

Contoh bentuk balikan penjamin dengan adjudication pada baris yang mengacu ke urutan item Claim. Nilai dan kode yang betul mengikuti hasil penjamin. Simpan request serta fase purifikasi atau pembayaran sesuai modul. [Klaim swasta](../alur/klaim-swasta-dan-bayar-mandiri.md#primary-payor) · [Profil ClaimResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/claim-response/)

```json
{
  "resourceType": "ClaimResponse",
  "id": "<CLAIM_RESPONSE>",
  "status": "active",
  "type": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/claim-type",
        "code": "institutional"
      }
    ]
  },
  "use": "claim",
  "patient": {
    "reference": "Patient/<PATIENT>"
  },
  "created": "2026-11-16T04:00:00Z",
  "insurer": {
    "reference": "Organization/<PENJAMIN>"
  },
  "request": {
    "reference": "Claim/<CLAIM>"
  },
  "outcome": "complete",
  "item": [
    {
      "itemSequence": 1,
      "adjudication": [
        {
          "category": {
            "coding": [
              {
                "system": "http://terminology.hl7.org/CodeSystem/adjudication",
                "code": "benefit"
              }
            ]
          },
          "amount": {
            "value": 95000,
            "currency": "IDR"
          }
        }
      ]
    }
  ],
  "total": [
    {
      "category": {
        "coding": [
          {
            "system": "http://terminology.hl7.org/CodeSystem/adjudication",
            "code": "benefit"
          }
        ]
      },
      "amount": {
        "value": 95000,
        "currency": "IDR"
      }
    }
  ]
}
```

### PaymentReconciliation

Contoh dasar rekonsiliasi pembayaran oleh peran penjamin. Detail menunjuk Claim dan ClaimResponse. Untuk OOP, ikuti aturan korelasi Invoice dan kasir pada modul. [Klaim swasta/OOP](../alur/klaim-swasta-dan-bayar-mandiri.md#secondary-payor-dan-oop) · [Profil PaymentReconciliation](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/payment-reconciliation/)

```json
{
  "resourceType": "PaymentReconciliation",
  "identifier": [
    {
      "system": "https://example.invalid/metta/payment-reconciliation",
      "value": "PAY-REC-FIXTURE-01"
    }
  ],
  "status": "active",
  "created": "2026-11-16T04:00:00Z",
  "paymentIssuer": {
    "reference": "Organization/<PENJAMIN>"
  },
  "outcome": "complete",
  "paymentDate": "2026-11-16",
  "paymentAmount": {
    "value": 95000,
    "currency": "IDR"
  },
  "detail": [
    {
      "type": {
        "text": "Pembayaran klaim fixture"
      },
      "request": {
        "reference": "Claim/<CLAIM>"
      },
      "response": {
        "reference": "ClaimResponse/<CLAIM_RESPONSE>"
      },
      "payee": {
        "reference": "Organization/<FASYANKES>"
      },
      "amount": {
        "value": 95000,
        "currency": "IDR"
      }
    }
  ]
}
```

### PaymentNotice

Contoh dasar pemberitahuan pembayaran. Resolve PaymentReconciliation dan penerima sebelum memprosesnya. Posisi request pada OOP berbeda karena memakai Invoice. [Klaim swasta/OOP](../alur/klaim-swasta-dan-bayar-mandiri.md#secondary-payor-dan-oop) · [Profil PaymentNotice](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/payment-notice/)

```json
{
  "resourceType": "PaymentNotice",
  "status": "active",
  "created": "2026-11-16T04:00:00Z",
  "request": {
    "reference": "Claim/<CLAIM>"
  },
  "response": {
    "reference": "ClaimResponse/<CLAIM_RESPONSE>"
  },
  "payment": {
    "reference": "PaymentReconciliation/<REKONSILIASI>"
  },
  "paymentDate": "2026-11-16",
  "recipient": {
    "reference": "Organization/<FASYANKES>"
  },
  "amount": {
    "value": 95000,
    "currency": "IDR"
  }
}
```

### BillingStatus

Potongan **JSON non-FHIR** berdasarkan field profil, untuk korelasi status billing dengan permintaan eligibilitas. Kode status, envelope, endpoint, header dan otorisasi aktual perlu bukti per penjamin. [Klaim swasta/AKT](../alur/klaim-swasta-dan-bayar-mandiri.md#secondary-payor-dan-oop) · [Profil BillingStatus](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/billing-status/)

```json
{
  "identifier": {
    "system": "https://example.invalid/metta/billing-status",
    "value": "BILL-STATUS-FIXTURE"
  },
  "status": "<KODE_STATUS_BILLING>",
  "insurer": {
    "reference": "Organization/<PENJAMIN>"
  },
  "recipient": {
    "reference": "Organization/<FASYANKES>"
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "request": {
    "reference": "CoverageEligibilityRequest/<ELIGIBILITY_REQUEST>"
  }
}
```

### ChargeItemResponse

Potongan **JSON non-FHIR** persetujuan tindakan dan layanan. Rujuk ChargeItem dan coverage asli. Kode status dan bentuk wire operasional mengikuti koleksi yang diberikan kepada penjamin. [Klaim swasta](klaim-swasta-dan-bayar-mandiri.md#elemen-status-dan-relasi) · [Profil ChargeItemResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item-response/)

```json
{
  "identifier": {
    "system": "https://example.invalid/metta/charge-response",
    "value": "CHARGE-RESPONSE-FIXTURE"
  },
  "status": {
    "coding": [
      {
        "system": "<SYSTEM_STATUS_PERSETUJUAN>",
        "code": "<KODE_STATUS>"
      }
    ]
  },
  "chargeItem": {
    "reference": "ChargeItem/<BIAYA>"
  },
  "coverage": {
    "reference": "Coverage/<COVERAGE>"
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "payor": {
    "reference": "Organization/<PENJAMIN>"
  },
  "unitPriceOverride": {
    "value": 95000,
    "currency": "IDR"
  },
  "quantity": 1,
  "total": {
    "value": 95000,
    "currency": "IDR"
  }
}
```

### PurificationDecision

Potongan **JSON non-FHIR** tindak lanjut hasil purifikasi. Kaitkan ClaimResponse dari penjamin dan organisasi pemberi tindak lanjut. Path, envelope dan kode keputusan perlu kontrak mitra. [Klaim BPJS](../alur/klaim-bpjs.md#alur-dan-operasi) · [Profil PurificationDecision](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/purification-decision/)

```json
{
  "identifier": {
    "system": "https://example.invalid/metta/purification-decision",
    "value": "PURIF-FIXTURE-01"
  },
  "status": {
    "coding": [
      {
        "system": "<SYSTEM_KEPUTUSAN>",
        "code": "<KODE_KEPUTUSAN>"
      }
    ]
  },
  "insurer": {
    "reference": "Organization/<PENJAMIN>"
  },
  "provider": {
    "reference": "Organization/<FASYANKES>"
  },
  "claimResponse": {
    "reference": "ClaimResponse/<CLAIM_RESPONSE>"
  },
  "created": "2026-11-16T04:00:00Z"
}
```

### CommunicationRequest

Bentuk dasar FHIR R4 permintaan konfirmasi administratif antara penjamin dan fasyankes. Materi klaim juga memakai istilah JSON non-FHIR pada bagian komunikasi. Konfirmasi envelope, versi dan operasi aktual dengan koleksi sebelum pengiriman. [Komunikasi klaim](klaim-swasta-dan-bayar-mandiri.md#elemen-status-dan-relasi) · [FHIR R4 CommunicationRequest](https://hl7.org/fhir/R4/communicationrequest.html)

```json
{
  "resourceType": "CommunicationRequest",
  "status": "active",
  "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/communication-category", "code": "notification"}]}],
  "subject": {"reference": "Patient/<PATIENT>"},
  "about": [{"reference": "Claim/<CLAIM>"}],
  "requester": {"reference": "Organization/<PENJAMIN>"},
  "recipient": [{"reference": "Organization/<FASYANKES>"}],
  "payload": [{"contentString": "Mohon konfirmasi kelengkapan bukti klaim fixture."}]
}
```

### Communication

Bentuk dasar FHIR R4 pemberitahuan. Kaitkan permintaan dengan basedOn dan simpan waktu. Isi hanya informasi yang diperlukan pada kanal yang sah. [Komunikasi klaim](klaim-swasta-dan-bayar-mandiri.md#elemen-status-dan-relasi) · [FHIR R4 Communication](https://hl7.org/fhir/R4/communication.html)

```json
{
  "resourceType": "Communication",
  "status": "completed",
  "basedOn": [{"reference": "CommunicationRequest/<PERMINTAAN>"}],
  "subject": {"reference": "Patient/<PATIENT>"},
  "about": [{"reference": "Claim/<CLAIM>"}],
  "sender": {"reference": "Organization/<FASYANKES>"},
  "recipient": [{"reference": "Organization/<PENJAMIN>"}],
  "sent": "2026-11-16T05:00:00Z",
  "payload": [{"contentString": "Bukti fixture tersedia untuk diperiksa."}]
}
```
