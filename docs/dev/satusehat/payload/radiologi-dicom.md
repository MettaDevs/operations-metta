# Payload dan pemetaan radiologi dan DICOM

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Lampiran Terminologi Kedokteran Nuklir & Teranostik Molekuler](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/nuklir/) (disunting 2026-01-22) · [Radiologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/radiologi/) (disunting 2025-12-02) · [ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/imaging-study/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Radiologi, DICOM Router, dan NIDR](../alur/radiologi-dicom.md) · [Endpoint dan respons radiologi dan DICOM](../endpoint/radiologi-dicom.md)

## Field payload dan sumber Metta

| Resource | Field atau relasi | Sumber dan celah |
| --- | --- | --- |
| ServiceRequest | `identifier[]` membawa nomor order dan ACSN sesuai alur, `status`, `intent`, `category`, kode permintaan di `code`, `subject`, `encounter`, `requester`, dan `authoredOn`. | Kunjungan, dokter, pasien dan konteks unit ada. Perlu kamus order radiologi, pemilik ACSN, namespace sesuai konfigurasi rilis, dan riwayat status order. |
| ImagingStudy | `identifier[]` untuk ACSN dan UID studi (`urn:dicom:uid`), `status`, `modality`, `subject`, `started`, `basedOn[].reference` ke ServiceRequest, `endpoint[]` untuk akses yang diterbitkan alur, `series[].uid`, `series[].modality`, `series[].instance[].uid`. | Sumber teknisnya router atau PACS. Simpan ID studi, ACSN dan status integrasi pada order lokal. Verifikasi pemetaan UID studi, seri, dan instance dengan hasil WADO-RS yang sama. |
| Observation | `status`, kode temuan, `subject`, `encounter`, `basedOn[]`, dan nilai bertipe sesuai profil temuan jika digunakan. | Perlu antarmuka hasil terstruktur dan penandatangan hasil. |
| DiagnosticReport | `status`, `code`, `subject`, `encounter`, `basedOn[]`, waktu laporan, `performer[]` dan `resultsInterpreter[]` sesuai alur, `imagingStudy[]`, `result[]`, `conclusion` atau temuan terstruktur bila tersedia. | Perlu sumber laporan yang final, referensi order, resolusi dokter pembaca, jejak revisi, dan pemetaan bacaan ke studi. |

Matriks ini menunjukkan kontrak yang dibutuhkan alur. Penanda kewajiban dan kondisi utama ada di [Matriks layanan kondisional](matriks-layanan-kondisional.md#lab-dan-radiologi). Gunakan kelompok kode permintaan untuk order dan kelompok hasil untuk temuan. [Profil ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/imaging-study/) · [Profil DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/diagnostic-report/)

### Contoh order dengan ACSN

```json
{
  "resourceType": "ServiceRequest",
  "identifier": [
    {"system": "http://sys-ids.kemkes.go.id/servicerequest/<ORGANIZATION>", "value": "RAD-FIXTURE-01"},
    {
      "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "ACSN"}]},
      "system": "http://sys-ids.kemkes.go.id/acsn/<ORGANIZATION>",
      "value": "ACSN-FIXTURE-01"
    }
  ],
  "status": "active",
  "intent": "original-order",
  "category": [{"coding": [{"system": "http://snomed.info/sct", "code": "363679005"}]}],
  "code": {"coding": [{"system": "http://loinc.org", "code": "<LOINC_PERMINTAAN>"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<ENCOUNTER>"},
  "requester": {"reference": "Practitioner/<PRACTITIONER>"},
  "authoredOn": "2026-11-16T03:00:00+00:00"
}
```

Isi placeholder dan data kondisional menurut order yang dipilih. Gunakan ACSN yang sama di MWL, objek DICOM dan korelasi callback. Nomor order lokal tetap tersedia untuk rekonsiliasi ServiceRequest.

### Contoh webhook kegagalan

```json
{
  "status": false,
  "message": "Unggah citra gagal",
  "data": {
    "imagingStudyId": "<ID_IMAGING_STUDY_SANDBOX>",
    "accessionNumber": "ACSN-FIXTURE-01",
    "studyInstanceUID": "<UID_STUDI_FIXTURE>"
  },
  "error": [{"code": "DICOM_PUSH_ERROR", "message": "Connection timeout"}],
  "stage": "dicom_send_failed"
}
```

```json
{
  "status": true,
  "message": "Hasil router tercatat",
  "data": {"id": "WEBHOOK-FIXTURE-01"},
  "error": []
}
```

Status respons kedua menandakan endpoint internal menerima pesan. Hasil proses router dilihat dari body pertama. Panduan mencatat tahap `received`, `metadata_lookup_failed`, `imagingstudy_create_failed`, `imagingstudy_post_failed`, `dicom_send_failed`, dan `dicom_sent`. `DICOM_PUSH_ERROR` berasal dari router. Error FHIR ditelusuri lewat status HTTP dan `OperationOutcome.issue[]`. [Panduan teknis radiologi, hlm. 10–12](https://drive.google.com/file/d/1KgEIaPOsPNIYvJe4snEe0vWjppE0SBBe/preview) · [Validasi dan error](../validasi/respons-dan-error.md)

## Kedokteran nuklir dan teranostik molekuler

Lampiran Kemenkes menempatkan 87 kode pencitraan pada sheet Pemeriksaan In Vivo dan delapan kode penunjang pada Pemeriksaan In Vitro. Pencitraan terdiri dari 74 entri NM, 10 PET + CT dan tiga SPECT. Kode dipilih dari metode, organ atau spesimen, radionuklida, radiofarmaka, dan tujuan. Ambil fakta pemeriksaan dari order Metta dan hasil aktual RIS/PACS atau LIS sebelum membentuk resource. Lampiran ini menetapkan pemetaan istilah. Operasi dan mekanisme transport mengikuti jalur radiologi atau lab yang dipakai pada kunjungan. [Lampiran Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/nuklir/) · [Workbook lampiran](https://docs.google.com/spreadsheets/d/1ggx90l2mkiVZ946Bs4wwyJIQMsWQRf4q/edit?gid=0)

| Jenis | Pemakaian pada permintaan dan hasil | Contoh |
| --- | --- | --- |
| Pencitraan in vivo | `ServiceRequest.code` untuk order, `ImagingStudy` untuk data studi DICOM, dan `DiagnosticReport.code` untuk laporan sesuai alur radiologi. Sheet memakai `http://loinc.org` untuk permintaan dan hasil. Pertahankan accession number dan Study Instance UID saat merekonsiliasi. | `39857-8` sidik adrenal dengan I-131 MIBG, `87907-2` PET + CT otak untuk amiloidosis, `39638-2` SPECT otak dengan I-123, `39818-0` sidik tulang seluruh tubuh. |
| Pemeriksaan in vitro | `ServiceRequest.code` untuk order dan `Observation.code` untuk hasil. Hubungkan `Specimen` dan `DiagnosticReport` bila diperlukan oleh Playbook. Sheet memberi cakupan order dan hasil untuk seluruh delapan kode nasional. Gunakan `http://terminology.kemkes.go.id/CodeSystem/examination` untuk kode Pemeriksaan Penunjang Nasional sesuai aturan portal. | Hasil kuantitatif memakai satuan aktual sebagai `valueQuantity`. Contoh satuan pada lampiran ikut metode dan spesimennya serta tetap perlu dicocokkan dengan data LIS. [Alur lab](../alur/laboratorium-rujukan-spesimen.md) · [Namespace pemeriksaan Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/radiologi/) |

| Kode nasional | Analit | Spesimen dan metode |
| --- | --- | --- |
| `X099290` | Antibodi T3 | Serum · RIA |
| `X099291` | Antibodi T4 (entri fT4) | Serum · RIA |
| `X099292` | Antibodi TSH (entri TSHs) | Serum · IRMA |
| `X099293` | Tiroglobulin (entri antibodi pada nama panjang) | Serum · IRMA |
| `X099294` | Tiroglobulin (entri antibodi pada nama panjang) | Aspirasi jarum halus jaringan · IRMA |
| `X099295` | Antibodi anti-tiroglobulin | Serum · RIA |
| `X099296` | Antibodi anti-TPO | Serum atau plasma · RIA |
| `X099297` | Antibodi reseptor TSH | Serum atau plasma · RIA |

Gunakan label, metode dan spesimen untuk memastikan kode mewakili hasil sebenarnya. Nama pendek seperti `fT4` atau `TSHs` bisa berbeda makna dari analit dalam nama panjang lampiran. Saat metode, spesimen atau analit belum diketahui, tahan pemetaan sampai petugas penunjang mengonfirmasi. Uji satu order pencitraan dan satu hasil in vitro. Lulus jika kode dan system terbaca balik, referensi order dan studi atau spesimen terhubung, serta pasangan system/code yang tidak sesuai tercatat melalui penanganan `OperationOutcome`. Uji ini belum dijalankan. [Contoh order dan laporan](#field-payload-dan-sumber-metta) · [Respons dan kesalahan](../endpoint/radiologi-dicom.md#endpoint-dan-respons) · [Penanganan error](../validasi/respons-dan-error.md)
