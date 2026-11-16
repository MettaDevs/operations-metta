# Payload pemeriksaan dan resume MCU

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Medical Check Up (MCU)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mcu/) (v1.0, rilis 2026-10-06, disunting 2026-10-05) · [Lampiran Terminologi Medical Check Up (MCU)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mcu/) (disunting 2026-10-05)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Medical Check Up (MCU)](../alur/medical-check-up.md)

## Elemen klinis dan penunjang

| Bagian | Field dan kode utama |
| --- | --- |
| Sosial dan kunjungan | Observation pendidikan LOINC `82589-3`, status bekerja `67875-5`, dan jenis/kategori MCU `TK000659` dari `http://terminology.kemkes.go.id` dengan `valueCodeableConcept` menurut lampiran. Isi nama instansi, satuan kerja, masa kerja dan catatan hanya bila tersedia. |
| Anamnesis | Skrining gejala menggunakan `https://fhir.kemkes.go.id/Questionnaire/Q0045`. Pisahkan riwayat pribadi, keluhan, skor/riwayat merokok dan pajanan fisika, kimia, biologi, ergonomi dan psikososial. Isi Observation dan `component[]` menurut kode pajanan pada lampiran. |
| Pemeriksaan fisik | Gunakan Observation tanda vital dan fisik. Pilih metode, sisi, tipe `value[x]`, nilai dan satuan sesuai variabel. Penglihatan, pemeriksaan gigi dan pendengaran memakai data masing-masing dari bab 4 dan lampiran. |
| Kesehatan jiwa | Canonical `https://fhir.kemkes.go.id/Questionnaire/Q0033` untuk SRQ-20. Isi `item[].linkId` dan jawaban sesuai instrumen, lalu kaitkan ke Encounter. Gunakan hasil/interpretasi dari petugas yang menilai. |
| Penunjang non-lab | Buku memetakan temuan dan komponen per metode, termasuk audiometri, spirometri, EKG dan treadmill. Gunakan kode metode dan hasil yang berbeda bila tabel memetakannya. Simpan nilai, sisi, unit serta `interpretation[]` saat berlaku. |
| Lab/radiologi | Kaitkan `basedOn[]`, `specimen[]`, `result[]` dan `imagingStudy[]` menurut jenis. Gunakan panel/tes yang benar dan code system metode. [Lab](../alur/laboratorium-rujukan-spesimen.md) · [DICOM/Radiologi](../alur/radiologi-dicom.md) |
| Diagnosis dan tindakan | Condition mencatat diagnosis aktual dengan kode ICD-10 sesuai skema layanan. Procedure memakai kode tindakan sesuai Playbook dan keadaan aktual. CarePlan memasukkan tindak lanjut yang memang ditentukan. |

## Resume MCU dan kelaikan

`Composition.type` memakai `TK000706` dari `http://terminology.kemkes.go.id`. Kategori report memakai LOINC `LP173421-1`. Isi status, Patient, author, Encounter, title, time dan identifier sesuai profil Composition. Referensikan ID yang sudah dibuat pada `section[].entry[]` atau `section[].section[]` sesuai bagian. [Buku MCU, bab 14](https://drive.google.com/file/d/1rnKE0RjZX8FiYhP_Ftr3PLCcW8qhrMWf/preview)

| Bagian | Kode section | Referensi |
| --- | --- | --- |
| Anamnesis | Kemenkes `TK000003` | Condition dan QuestionnaireResponse/Observation skrining/riwayat. Subsection LOINC `10154-3` keluhan dan `11348-0` riwayat penyakit dahulu. |
| Fisik | Kemenkes `TK000007` | Observation termasuk vital LOINC `8716-3` dan review sistem `10187-3` pada subsection. |
| Kesehatan jiwa | LOINC `34786-4` | QuestionnaireResponse dan/atau fakta hasil sesuai profil. |
| Rencana | LOINC `18776-5` | CarePlan. |
| Penunjang | Kemenkes `TK000009` | Subsection non-lab `TK000707`, lab LOINC `11502-2`, radiologi LOINC `18782-3`. Tautkan hasil dan laporan yang benar. |
| Diagnosis dan tindakan | Kemenkes `TK000004` dan `TK000005` | Condition dan Procedure, dengan subsection diagnosis akhir LOINC `78375-3`. |
| Hubungan pekerjaan | Kemenkes `TK000708` | Observation dengan kode sama dan `valueBoolean`. |
| Status kesehatan | SNOMED CT `406221003` | Observation dengan kode sama; buku menukar kolom code/display di bagian ini. Nilai Kemenkes `TK000710` sampai `TK000713` sesuai penilaian. |
| Kelaikan | SNOMED CT `901681000000103` | Observation dengan kode sama, kategori `exam`. Isi `valueCodeableConcept` yang disahkan, termasuk SNOMED CT `160926000` laik, `225891002` dengan pembatasan, `160910001` tidak laik, atau Kemenkes `TK000714` tidak laik sementara. |

Potongan request resume MCU. Contoh menggunakan satu bagian yang sudah dinilai pada fixture. Tambahkan section sesuai paket dan hasil yang ada.

```json
{
  "resourceType": "Composition",
  "status": "final",
  "type": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000706"}]},
  "category": [{"coding": [{"system": "http://loinc.org", "code": "LP173421-1"}]}],
  "title": "Resume MCU fixture",
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<MCU>"},
  "author": [{"reference": "Practitioner/<PEMERIKSA>"}],
  "date": "2026-11-16T05:00:00Z",
  "section": [{
    "title": "Status Kelaikan",
    "code": {"coding": [{"system": "http://snomed.info/sct", "code": "901681000000103"}]},
    "entry": [{"reference": "Observation/<HASIL_KELAIKAN>"}]
  }]
}
```

Potongan hasil baca balik yang dikorelasikan ke section kelaikan. Coding nilai pada contoh hanya untuk fixture yang dinilai laik.

```json
{
  "resourceType": "Observation",
  "id": "<HASIL_KELAIKAN>",
  "status": "final",
  "code": {"coding": [{"system": "http://snomed.info/sct", "code": "901681000000103"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<MCU>"},
  "valueCodeableConcept": {"coding": [{"system": "http://snomed.info/sct", "code": "160926000"}]}
}
```
