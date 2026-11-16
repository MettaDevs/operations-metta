# Payload Q0011 dan Q0027 untuk MTBS

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Lampiran Terminologi Manajemen Terpadu Balita Sakit](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mtbs/) (disunting 2024-08-21) · [Manajemen Terpadu Balita Sakit (MTBS)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mtbs-prio/) (v1.0, rilis 2024-11-04, disunting 2024-12-08)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Manajemen Terpadu Balita Sakit (MTBS)](../alur/manajemen-terpadu-balita-sakit.md)

## Q0011 untuk usia 0 sampai kurang dari 2 bulan

Canonical `https://fhir.kemkes.go.id/Questionnaire/Q0011`. Kelompok berada pada `QuestionnaireResponse.item[]`. Anak seperti `1.1` berada pada `item[].item[]`. Ketika hasil anak mengikuti satu jawaban, lakukan nesting melalui `answer[].item[]` sebagaimana tabel. Kode dengan awalan OC memakai `http://terminology.kemkes.go.id/CodeSystem/clinical-term`; nilai hasil mengikuti value set terkait. [Buku MTBS, bab 5.2](https://drive.google.com/file/d/16sTSKmOoZjGz0LxQXd6H3If58haZefnF/preview) · [Lampiran terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mtbs/)

| Grup | linkId anak | Hasil Observation terkait |
| --- | --- | --- |
| `1` Infeksi | `1.1` status pemeriksaan boolean, `1.1.1` reference hasil | `OC000126` klasifikasi infeksi |
| `2` Ikterus | `2.1` boolean, `2.1.1` reference | `OC000129` |
| `3` Diare | `3.1` dan `3.1.1` boolean, `3.1.1.1` reference klasifikasi sesuai jawaban | `OC000098` |
| `4` HIV | `4.1` boolean, `4.1.1` reference | SNOMED CT `254387007` sesuai pemetaan |
| `5` Kemungkinan BB rendah menurut umur dan pemberian ASI | `5.1` boolean, `5.1.1` reference | `OC000085` |
| `6` Kemungkinan BB rendah menurut umur dan pemberian minum | `6.1` dan `6.2` boolean, `6.2.1` reference | `OC000086` |

## Q0027 untuk usia 2 bulan sampai 5 tahun

Canonical `https://fhir.kemkes.go.id/Questionnaire/Q0027`. Pilih item dari pemeriksaan yang memang dilakukan. Observasi klasifikasi klinis memakai coding dan interpretasi dari tabel/terminologi yang tepat. Untuk hasil z-score gunakan pengukuran, unit dan konteks usia yang sesuai. [Buku MTBS, bab 5.3](https://drive.google.com/file/d/16sTSKmOoZjGz0LxQXd6H3If58haZefnF/preview) · [Lampiran terminologi MTBS](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mtbs/)

| Grup | linkId anak | Hasil Observation terkait |
| --- | --- | --- |
| `1` Tanda bahaya | `1.1`, `1.1.1` | `OC000089` status kegawatan |
| `2` Batuk/sukar bernapas | `2.1`, `2.1.1`, `2.1.1.1` | `OC000091` |
| `3` Diare | `3.1`, `3.1.1`, `3.1.1.1` | `OC000098` |
| `4` Demam/malaria | `4.1`, `4.1.1`, `4.1.1.1–4.1.1.2` | `OC000100` dan unsur pemeriksaan sesuai bab |
| `5` Campak | `5.1`, `5.1.1`, `5.1.1.1` | `OC000102` |
| `6` Dengue | `6.1`, `6.1.1` | `OC000105` |
| `7` Telinga | `7.1`, `7.1.1` | `OC000107` |
| `8` Status gizi | `8.1`, `8.1.1` | `OC000108` |
| `9` Pertumbuhan | `9.1.1`, `9.1.2`, `9.1.3` | SNOMED CT `1153590000` PB/U atau `1153604005` TB/U, dan `1153594009` LK/U sesuai hasil. |
| `10` Anemia | `10.1`, `10.1.1` | `OC000111` |
| `11` HIV | `11.1`, `11.1.1` | SNOMED CT `254387007` |

Contoh bentuk request Q0011 setelah Observation klasifikasi infeksi sudah dibuat. Tambahkan kelompok lain yang dibutuhkan untuk hasil aktual.

```json
{
  "resourceType": "QuestionnaireResponse",
  "questionnaire": "https://fhir.kemkes.go.id/Questionnaire/Q0011",
  "status": "completed",
  "subject": {"reference": "Patient/<BAYI>"},
  "encounter": {"reference": "Encounter/<VISIT_MTBS>"},
  "authored": "2026-11-16T04:20:00Z",
  "author": {"reference": "Practitioner/<PETUGAS>"},
  "item": [{
    "linkId": "1",
    "item": [{
      "linkId": "1.1",
      "answer": [{
        "valueBoolean": true,
        "item": [{"linkId": "1.1.1", "answer": [{"valueReference": {"reference": "Observation/<KLASIFIKASI_INFEKSI>"}}]}]
      }]
    }]
  }]
}
```

Potongan respons baca balik Observation klasifikasi infeksi dengan pilihan yang benar-benar dicatat. Contoh menunjukkan sistem terminologi dan hubungan pemeriksaan, tanpa menyalin identitas pasien.

```json
{
  "resourceType": "Observation",
  "id": "<KLASIFIKASI_INFEKSI>",
  "status": "final",
  "code": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/clinical-term", "code": "OC000126"}]},
  "subject": {"reference": "Patient/<BAYI>"},
  "encounter": {"reference": "Encounter/<VISIT_MTBS>"},
  "valueCodeableConcept": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/clinical-term", "code": "<KODE_KLASIFIKASI>"}]}
}
```
