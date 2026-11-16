# Payload Composition deteksi dini PTM

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/) (v1.4, rilis 2024-09-25, disunting 2025-12-02) · [Lampiran Terminologi Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/skrining-ptm/) (disunting 2024-11-19)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Skrining Penyakit Tidak Menular (PTM)](../alur/skrining-penyakit-tidak-menular.md)

## Composition dan bagian deteksi

`Composition.status=final`, `type.coding` code `COS000006` dari `http://terminology.kemkes.go.id/CodeSystem/composition-type`, `title`, `date`, `subject`, `encounter`, `author[]`, dan `identifier` system `http://sys-ids.kemkes.go.id/composition/{organization-id}`. Tabel bab 6 memberi nilai pengesahan `legal`. Bentuk wire FHIR memakainya di `attester[].mode`, dengan `party` bila berlaku. Jangan menambahkan field documentStatus yang sudah dihapus dari revisi. Setiap section memakai coding dari `http://terminology.kemkes.go.id/CodeSystem/composition-section`; kirim hanya bagian deteksi yang dilakukan dan referensinya. [Bab Composition](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_6_pengiriman_data_skrining_ptm_melalui_composition) · [FHIR R4 Composition](https://hl7.org/fhir/R4/composition.html)

| Bagian | Kode section | Referensi dan kode pemeriksaan utama |
| --- | --- | --- |
| Hipertensi | `COS000006` | Observation sistolik LOINC `8480-6`, diastolik `8462-4`, interpretasi SNOMED CT `268607006`. |
| Obesitas | `COS000007` | Observation berat LOINC `29463-7`, tinggi `8302-2`, IMT `39156-5`, lingkar pinggang SNOMED CT `276361009`. |
| Jantung | `COS000008` | ServiceRequest, Observation dan DiagnosticReport. EKG dari pemetaan Observation `34534-8`. |
| Diabetes | `COS000009` | ServiceRequest, Specimen, Observation dan DiagnosticReport. Glukosa dan HbA1c dengan kode LOINC dari pemeriksaan aktual, termasuk `2345-7`, `1558-6`, `1521-4`, `4548-4`. |
| Stroke | `COS000010` | ServiceRequest, Specimen, Observation dan DiagnosticReport. Lipid `2093-3`, `2085-9`, `2089-1`, `2571-8`; hasil skrining memakai kode Kemenkes `OC000004` atau `OC000173` sesuai variabel. |
| Asam urat | `COS000011` | ServiceRequest, Specimen, Observation dan DiagnosticReport. Hasil LOINC `3084-1`. |
| Kanker | `COS000012` | Observation dan QuestionnaireResponse. Pilih hasil sesuai metode skrining yang benar, serta Q0019 atau Q0020 bila dilakukan. |
| Talasemia | `COS000013` | ServiceRequest, Specimen, Observation dan DiagnosticReport; LOINC `718-7`, `30428-7`, `28539-5`, `789-8`, `788-0` sesuai hasil. |
| PPOK | `COS000014` | Observation, Condition dan QuestionnaireResponse Q0021. Catat status merokok dan hasil sesuai skenario; pemeriksaan spirometri mengikuti pemetaan bab 5. |
| Penglihatan | `COS000015` | Observation mata kanan/kiri dengan `bodySite` yang benar. Snellen `79882-7`/`79883-5`; pinhole `79892-6`/`79893-4`. |
| Pendengaran | `COS000016` | Observation telinga kanan/kiri. Tes bisik SNOMED CT `247301006`; coding/interpretasi mengikuti metode dan sisi pemeriksaan. |

Contoh Composition satu jenis skrining untuk fixture. Simpan Observation terlebih dahulu; jangan masukkan hasil yang belum tersedia.

```json
{
  "resourceType": "Composition",
  "identifier": {"system": "http://sys-ids.kemkes.go.id/composition/<ORG>", "value": "PTM-FIXTURE-01"},
  "status": "final",
  "type": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/composition-type", "code": "COS000006"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT_PTM>"},
  "author": [{"reference": "Practitioner/<PEMERIKSA>"}],
  "date": "2026-11-16T04:00:00Z",
  "title": "Form Skrining PTM",
  "attester": [{"mode": "legal", "party": {"reference": "Practitioner/<ATTESTER>"}}],
  "section": [{
    "title": "Deteksi Dini Hipertensi",
    "code": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/composition-section", "code": "COS000006"}]},
    "entry": [{"reference": "Observation/<SISTOLIK>"}, {"reference": "Observation/<DIASTOLIK>"}]
  }]
}
```

Potongan balikan yang dipakai untuk korelasi. Baca ulang dan cocokkan section serta ID hasil sebelum melanjutkan.

```json
{
  "resourceType": "Composition",
  "id": "<KIRIMAN_PTM>",
  "status": "final",
  "identifier": {"system": "http://sys-ids.kemkes.go.id/composition/<ORG>", "value": "PTM-FIXTURE-01"},
  "encounter": {"reference": "Encounter/<VISIT_PTM>"}
}
```
