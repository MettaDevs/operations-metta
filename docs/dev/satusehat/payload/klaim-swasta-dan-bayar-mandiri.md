# Payload klaim swasta dan bayar mandiri

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Lampiran Terminologi Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim/) (disunting 2024-09-04) · [Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim/) (v1.3, rilis 2026-01-06, disunting 2025-12-02)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Klaim asuransi swasta, penjamin tambahan, dan bayar mandiri](../alur/klaim-swasta-dan-bayar-mandiri.md)

## Elemen, status, dan relasi

| Resource | Elemen untuk implementasi |
| --- | --- |
| Coverage | `status`, `type`, `beneficiary`, `payor[]`, `subscriber`, `subscriberId`, `relationship`, `period`, dan `class[]` bila berlaku. `identifier[]` beneficiary perlu dipetakan bila berbeda dari subscriber; bandingkan namespace dan aturan relasi TPA pada modul. |
| Account, Encounter dan laporan awal | Akun pasien menautkan `subject[]`, `coverage[].coverage`, `coverage[].priority`, `servicePeriod` dan `owner` sesuai profil. Encounter membawa `account[]`. Sertakan fakta klinis dan rujukan di laporan awal sesuai layanan. |
| CoverageEligibilityRequest | Field inti `status`, `purpose[]`, `patient`, `created`, `provider`, `insurer`, `insurance[].coverage`; `insurance[].focal` saat relevan. `supportingInfo[]` memakai `sequence` dan `information`. Hubungkan questionnaire, diagnosis dan data kamar menurut skenario, termasuk AKT. |
| CoverageEligibilityResponse | `status`, `purpose[]`, `patient`, `created`, `request`, `outcome`, `insurer` dan `insurance[].coverage`. Catat `disposition`, SEP, policy class dan excess policy class sesuai respons. |
| ChargeItem dan ChargeItemResponse | Tagihan memuat layanan, Patient, Encounter, jumlah, harga dan pelaksana. Dalam ChargeItemResponse catat `identifier`, `status` (CodeableConcept), `chargeItem`, `coverage`, `subject`, `encounter`, `payor`, dan `unitPriceOverride` bila ada. Simpan status per penjamin. |
| BillingStatus | Cocokkan `identifier`, `status`, `insurer`, `recipient`, `subject`, dan `request` yang menunjuk permintaan eligibilitas. Simpan status per permintaan dan penjamin. |
| Invoice, Claim dan ClaimResponse | Invoice mengacu ke Account dan ChargeItem. Claim memuat `identifier[]`, `status`, `type`, `use`, `patient`, `created`, `provider`, `priority`, `insurance[]` serta item dan supportingInfo sesuai skenario. Simpan korelasi antar entry. ClaimResponse membawa `request`, `outcome`, `disposition`, `insurance[]`, adjudication dan total/pembayaran. |
| PaymentReconciliation dan PaymentNotice | Rekonsiliasi memiliki `detail[].request`, referensi response dan nilai pembayaran. Notice mengikat `request`, `response`, `payment`, `created`, `recipient`, `amount` dan status bayar sesuai konteks. |
| CommunicationRequest dan Communication | Bab 5 menambahkan pertukaran administratif. Permintaan memuat `status`, `category`, `about[]`, `payload[].contentString`, pengirim/penerima dan kapan pesan diperlukan. Status mencakup `draft`, `active`, `on-hold`, `revoked`, `completed`, `entered-in-error`, `unknown`. Kategori HL7 `alert`, `notification`, `reminder`, `instruction`. Kaitkan tanggapan ke permintaan atau konteks pembiayaan melalui referensi sesuai modul. Buku juga menyebut format JSON komunikasi non-FHIR. Konfirmasi path dan media type koleksi sebelum mengaktifkan kirim. |

[Terminologi klaim swasta](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim/) memuat daftar benefit, tipe Coverage, jenis pelayanan, peran pelaksana, dan alasan adjudication. Gunakan kode benefit dari polis fixture dan kelas yang disetujui. [Buku publik v1.3, bab 1–5](https://drive.google.com/file/d/1Od2YIYiTUZIzf9R7CjkzRuHmIfcUeszL/preview)

### Contoh supportingInfo pada eligibilitas AKT

Contoh ini menunjukkan permintaan dengan Account, Encounter dan ClaimResponse primary payor. Tambahkan field kondisional dan data pendukung sesuai polis serta layanan yang diuji.

```json
{
  "resourceType": "CoverageEligibilityRequest",
  "status": "active",
  "purpose": ["validation"],
  "patient": {"reference": "Patient/<PATIENT>"},
  "created": "2026-11-16T04:00:00Z",
  "provider": {"reference": "Organization/<FASYANKES>"},
  "insurer": {"reference": "Organization/<AKT>"},
  "insurance": [{"focal": true, "coverage": {"reference": "Coverage/<COVERAGE_AKT>"}}],
  "supportingInfo": [
    {"sequence": 1, "information": {"reference": "Account/<ACCOUNT>"}},
    {"sequence": 2, "information": {"reference": "Encounter/<ENCOUNTER>"}},
    {"sequence": 3, "information": {"reference": "ClaimResponse/<PRIMARY_CLAIM_RESPONSE>"}}
  ]
}
```

Bagian respons yang dipakai untuk membaca nomor eligibilitas dan rujukannya.

```json
{
  "resourceType": "CoverageEligibilityResponse",
  "id": "<RESPONSE>",
  "request": {"reference": "CoverageEligibilityRequest/<REQUEST>"},
  "identifier": [{"system": "http://sys-ids.kemkes.go.id/claim-number/<ORG_PENJAMIN>", "value": "SEP-SWASTA-FIXTURE-01"}],
  "insurance": [{"coverage": {"reference": "Coverage/<COVERAGE_AKT>"}}]
}
```
