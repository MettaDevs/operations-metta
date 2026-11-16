# Payload dan terminologi klaim BPJS

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Lampiran Terminologi Pembiayaan Kesehatan Klaim BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim-bpjs/) (disunting 2025-01-30) · [Pembiayaan Kesehatan Klaim BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim-bpjs/) (v1.3, rilis 2025-08-20, disunting 2026-09-10)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Klaim BPJS Kesehatan dan E-Klaim](../alur/klaim-bpjs.md)

## Payload dan terminologi

| Resource | Elemen yang mengikat alur |
| --- | --- |
| Coverage | `status`, `type`, `subscriberId`, `beneficiary`, `payor[]`, `period`, serta `class[]` untuk kelas atau jenis kepesertaan sesuai lampiran. Identitas pasien dan nomor kartu adalah nilai yang berbeda. `identifier[]` mengikuti system penjamin yang menerbitkan. |
| CoverageEligibilityRequest | Isi `status`, `purpose[]`, `patient`, `created`, `insurer`, `provider` bila ada, dan `insurance[].coverage` sesuai profil. Pertahankan konteks fasilitas, waktu pelayanan, diagnosis dan class. Q0006 memakai `https://fhir.kemkes.go.id/Questionnaire/Q0006`, `linkId` dan tipe jawaban sesuai label. |
| QuestionnaireResponse Q0006 | Rujukan adalah grup `2`. Asal rujukan pada `2.1` memakai `valueCoding` `FKTP` atau `FKRTL` dengan system `http://terminology.kemkes.go.id/CodeSystem/organization-type`; tanggal `2.2` memakai `valueDate`; nomor `2.3` memakai `valueString`. Cabang berikutnya memakai `linkId` resmi, termasuk PPK jika berlaku. |
| CoverageEligibilityResponse | Header mengikat `patient`, `insurer`, `request`, `status`, `purpose[]`, `created` dan `outcome` sesuai hasil. Simpan SEP di `identifier[]`, `insurance[].coverage` menautkan peserta, `disposition` bila ada penjelasan. Tabel SEP v2.0 memakai label coding yang tertukar dan menulis `identifier.use.coding`; pada FHIR R4, `identifier.use` adalah code `official` dan kode tipe `NIIP` berada di `identifier.type.coding`. Verifikasi profil aktif dengan contoh resmi sebelum penggunaan. |
| Account | `status`, `type.coding` `PBILLACCT` dari `http://terminology.hl7.org/CodeSystem/v3-ActCode`, `subject[]` ke Patient, `servicePeriod`, `coverage[].coverage` ke Coverage, `coverage[].priority` bila berlaku, dan `owner` ke pihak pengelola sesuai profil. |
| Encounter dan ChargeItem | Encounter menautkan Account. ChargeItem memuat status, kode tindakan/obat, subjek, konteks Encounter, kuantitas, waktu, petugas dan rincian harga sesuai profil. Petugas tindakan memakai peran dari lampiran. Isi kode berdasarkan sumber tindakan, dengan KPTL atau KFA sesuai jenis item. |
| Invoice | Isi `status`, Patient `subject`, `account`, `issuer` bila berlaku, serta `lineItem[].sequence` dan `lineItem[].chargeItemReference` untuk baris terkait. Contoh BPJS memakai `priceComponent[].type=surcharge`, kode KFA atau KPTL, `amount.currency=IDR` dan total net/gross sesuai tagihan. |
| Claim, ClaimResponse dan PurificationDecision | Lacak SEP, ID claim, fase purifikasi/verifikasi dan keputusan penjamin. Ikuti lampiran Kemenkes untuk kenaikan kelas, kelas tarif grouper, paket tambahan dan status klaim. Catat excess per item bila muncul. Detail pengiriman per aplikasi memerlukan kontrak mitra. |

Istilah kode dari modul spesifik lebih menentukan daripada istilah label pengguna. Misalnya, pola `NIIP` harus dikirim sebagai kode, dengan display bila dipakai. [FHIR R4 Identifier](https://hl7.org/fhir/R4/datatypes.html#Identifier) · [Terminologi klaim BPJS](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim-bpjs/)

### Matriks Q0006 dan sumber registrasi SEP

Field di bawah berada pada `QuestionnaireResponse.item`. Item dengan nomor bertitik merupakan isi dari `item[]` pada grup induk. Isi jawaban sesuai kejadian dan kelengkapan dari V-Klaim. [Buku BPJS v2.0, tabel 3](https://drive.google.com/file/d/1uavv0iKT-UPnyRkfO9nIMdRRL-X_wqQ0/preview)

| linkId | Nilai | Sumber atau gap |
| --- | --- | --- |
| `1` | Jenis Pelayanan, `valueCoding` dari `http://terminology.hl7.org/CodeSystem/v3-ActCode`, `IMP` rawat inap atau `AMB` rawat jalan dalam tabel Q0006. | Kelas layanan kunjungan. Konfirmasi jenis lain dengan V-Klaim untuk konteks SEP. |
| `2`, `2.1–2.4` | Grup rujukan, dengan asal `valueCoding` FKTP/FKRTL, tanggal `valueDate`, nomor `valueString` dan PPK `valueCoding` dari namespace `http://sys-ids.kemkes.go.id/organization/{id-satusehat}` sesuai tabel. | Perlu sumber dokumen rujukan dan pemetaan organisasi asal. |
| `3` | Catatan peserta, `valueString`. | Isian yang memang dicatat pada proses eligibilitas. |
| `4`, `4.1–4.2` | Grup poli, tujuan `valueCoding` dari `http://terminology.kemkes.go.id/CodeSystem/clinical-speciality` dan status eksekutif `valueBoolean`. | Poli dari registrasi. Perlu mapping kode spesialisasi dan layanan eksekutif. |
| `5`, `6`, `7` | CoB, katarak dan jaminan kecelakaan lalu lintas, masing-masing `valueBoolean`. | Simpan keputusan aktual pada SEP. |
| `8`, `9`, `10` | Penjamin kecelakaan `valueReference`, tanggal `valueDate`, keterangan `valueString`. | Perlu penjamin dan kejadian yang terstruktur saat skenario berlaku. |
| `11`, `12` | Suplesi `valueBoolean`, nomor SEP suplesi `valueString`. | Dari keputusan/riwayat SEP. |
| `13`, `13.1–13.3` | Grup lokasi kecelakaan. Kode provinsi, kabupaten dan kecamatan menggunakan `valueCoding` dari `http://sys-ids.kemkes.go.id/administrative-area`. Tabel menulis label PPK Rujukan di baris `13.3`; judul kelompok dan tipe kode menunjukkan kecamatan. | Perlu lokasi kejadian dan kode [Master Wilayah](../endpoint/master-data-sarana-wilayah.md). Verifikasi label `13.3` terhadap Questionnaire yang aktif. |
| `14`, `14.1–14.2` | Grup SKDP. Nomor surat kontrol `valueString`, DPJP `valueReference` ke Practitioner. | Perlu sumber surat kontrol dan lookup DPJP. |

Nomor kartu pada request memakai identifier dengan system `https://sys-ids.kemkes.go.id/insurance-number/{organization-id}` menurut tabel 3. Kelas berasal dari Coverage, diagnosis awal dari `item[].diagnosis[].diagnosisCodeableConcept`, PPK pelayanan dari `facility` yang menunjuk Location, nomor telepon dari Patient dan petugas pembuat SEP dari `enterer` yang menunjuk Practitioner.

Contoh hubungan Q0006 di dalam request. Ganti placeholder dengan fixture yang sesuai dan tambahkan jawaban kondisional untuk skenario terpilih. Buku v2.0 memetakan Q0006 sebagai `contained`. Pada contoh, `supportingInfo[].information` menunjuk ID lokal contained dengan awalan `#`.

```json
{
  "resourceType": "CoverageEligibilityRequest",
  "status": "active",
  "purpose": ["validation"],
  "patient": {"reference": "Patient/<PATIENT>"},
  "created": "2026-11-16T03:00:00Z",
  "insurer": {"reference": "Organization/<BPJS>"},
  "provider": {"reference": "Organization/<FASYANKES>"},
  "facility": {"reference": "Location/<LAYANAN>"},
  "insurance": [{"coverage": {"reference": "Coverage/<COVERAGE_BPJS>"}}],
  "supportingInfo": [{"sequence": 1, "information": {"reference": "#q0006-fixture"}}],
  "contained": [{
    "resourceType": "QuestionnaireResponse",
    "id": "q0006-fixture",
    "status": "completed",
    "questionnaire": "https://fhir.kemkes.go.id/Questionnaire/Q0006",
    "item": [{
      "linkId": "1",
      "text": "Jenis Pelayanan",
      "answer": [{"valueCoding": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB"}}]
    }]
  }]
}
```

Contoh create akun pasien setelah Coverage diperoleh. Ganti ID dengan fixture dari environment yang sama.

```json
{
  "resourceType": "Account",
  "status": "active",
  "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "PBILLACCT"}]},
  "subject": [{"reference": "Patient/<PATIENT>"}],
  "servicePeriod": {"start": "2026-11-16T03:00:00Z"},
  "coverage": [{"coverage": {"reference": "Coverage/<COVERAGE_BPJS>"}, "priority": 1}],
  "owner": {"reference": "Organization/<FASYANKES>"}
}
```

Potongan hasil eligibilitas untuk korelasi. Isi contoh menggambarkan response resource, sementara field runtime mengikuti hasil V-Klaim dan profil aktif.

```json
{
  "resourceType": "CoverageEligibilityResponse",
  "id": "<ELIGIBILITY_RESPONSE>",
  "request": {"reference": "CoverageEligibilityRequest/<ELIGIBILITY_REQUEST>"},
  "identifier": [{"use": "official", "system": "http://sys-ids.kemkes.go.id/jkn-claim-number", "value": "SEP-FIXTURE-01"}],
  "insurance": [{"coverage": {"reference": "Coverage/<COVERAGE_BPJS>"}}]
}
```
