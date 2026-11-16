# Payload tumbuh kembang dan gizi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/) (v4.0, rilis 2024-11-04, disunting 2025-10-02) · [Lampiran Terminologi Gizi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/gizi/) (disunting 2024-11-19) · [Tumbuh Kembang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/) (v3.0, rilis 2024-04-02, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Tumbuh Kembang, SDIDTK, dan pelayanan Gizi](../alur/tumbuh-kembang-dan-gizi.md)

## Antropometri dan temuan gizi

Kirim `Observation.status`, `code`, `subject`, `encounter`, `effective[x]`, pelaksana sesuai profil, dan pilih satu bentuk `value[x]`. Untuk `valueQuantity`, isi nilai, satuan dan `system=http://unitsofmeasure.org`. Z-score memakai nilai desimal dengan code UCUM `{Zscore}` sesuai Playbook. Kategori, `interpretation[]` dan `referenceRange[]` mengikuti profil, jenis kelamin/kelompok dan metode penilaian bila berlaku. Jaga satuan dan pertahankan data mentah yang dipakai. [Antropometri Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_pengiriman_data_antropometri) · [Lampiran interpretasi Gizi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/gizi/)

| Variabel | Coding dan nilai |
| --- | --- |
| Berat | LOINC `29463-7` dalam `g` atau `kg` menurut data. Berat lahir `8339-4` dalam `g`. |
| Tinggi atau panjang | LOINC `8302-2` tinggi, `8306-3` panjang telentang, `8308-9` tinggi berdiri, `89269-5` panjang lahir. Satuan `cm`. |
| Lingkar dan IMT | LOINC `9843-4` lingkar kepala, SNOMED CT `284473002` lingkar lengan atas, masing-masing `cm`. LOINC `39156-5` IMT dalam `kg/m2`. |
| Z-score berat dan tinggi | SNOMED CT `1153593003` BB/U, `1153590000` PB/U, `1153604005` TB/U, `1153598007` BB/PB, `1153600001` BB/TB. |
| Z-score lain | SNOMED CT `1153596006` IMT/U dan `1153594009` LK/U. |
| Konsumsi dan kondisi klinis | SNOMED CT `1145307003` ASI eksklusif, kode Kemenkes `OC000009` MPASI, LOINC `63895-7` status menyusui, SNOMED CT `284521000` pitting edema bilateral. Gunakan tipe dan coding nilai yang ditetapkan tiap variabel. |
| Hasil skrining malnutrisi | `OC000184` dari system Kemenkes sesuai pemetaan Gizi, `valueQuantity` dengan `{score}`. Isi interpretasi sesuai tabel untuk kelompok anak/ibu hamil atau dewasa. |

Kirim masalah gizi pada Condition dengan kategori `problem-list-item` dari `http://terminology.hl7.org/CodeSystem/condition-category` dan kode masalah pada lampiran. Untuk NutritionOrder, Playbook menandai `status`, `intent`, `patient`, `encounter`, dan `dateTime` wajib. Isi orderer, `oralDiet`, `supplement[]` atau `enteralFormula` sesuai tindakan; sumber nutrisinya memakai terminologi dan jumlah terukur sesuai aturan. [Masalah Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_6_pengiriman_data_masalah_gizi) · [Intervensi Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_7_pengiriman_data_intervensi_tatalaksana_gizi)

Contoh rawat inap di koleksi mengirim objek NutritionOrder melalui Bearer dengan `status=active`, `intent=proposal`, serta `oralDiet` yang menautkan jenis diet dan kuantitas jika dicatat. Balikan contoh memuat `id`, `meta.versionId`, dan resource NutritionOrder. Gunakan intent yang mewakili tindakan dan profil skenario. Metode baca terpisah dan izin role untuk Gizi perlu bukti. [Contoh NutritionOrder dari koleksi Rawat Inap](https://www.postman.com/satusehat/satusehat-public/documentation/42907689-fcb0003a-e9ec-42f4-8c21-77ae19d83e25?entity=request-42907689-c426a5ee-e79c-4b4b-a5e7-63662760f64e)

## Formulir Tumbuh Kembang Q0003

Gunakan `https://fhir.kemkes.go.id/Questionnaire/Q0003`, dengan `status`, Patient dan Encounter sesuai alur. Kelompok `1` adalah SDIDTK dan kelompok `2` mencatat status pertumbuhan/perkembangan. Masukkan item sesuai instrumen yang benar-benar dilakukan. [SDIDTK](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_5_pengiriman_data_stimulasi_deteksi_dan_intervensi_dini_tumbuh_kembang_sdidtk)

| linkId | Nilai dan terminologi |
| --- | --- |
| `1.1` | Status diperiksa SDIDTK, `valueBoolean`. |
| `1.2` | KPSP, `valueCoding` `Ds`, `Dm` atau `Dp` dari `http://terminology.kemkes.go.id/Codesystem/kpsp` sesuai ejaan pada tabel. |
| `1.3–1.5`, `1.7` | Tes daya dengar, lihat, masalah perilaku/emosional, dan GPPH. Coding SNOMED CT `17621005` atau `410519009` sesuai interpretasi instrumen. |
| `1.6` | M-CHAT, coding SNOMED CT `723509005`, `410519009` atau `17621005` sesuai instrumen. |
| `2.1`, `2.2` | Status pertumbuhan atau perkembangan, `OI000016` atau `OI000017` dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term`. Simpan teks penjelasan bila diisi dalam format yang didukung. |

## Formulir Gizi

Semua canonical pada tabel berawalan `https://fhir.kemkes.go.id/Questionnaire/`. Gunakan tipe jawaban yang sesuai. Buat Observation hasil dahulu jika linkId hasil membutuhkan `valueReference`. [Skrining Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_pengiriman_data_skrining_gizi) · [Gizi bermasalah](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_9_pengiriman_data_gizi_bermasalah)

| Formulir | linkId utama | Data |
| --- | --- | --- |
| `Q0014` | `1–5` boolean, `6` reference | Skrining usia ≤18 tahun. Item merangkum keadaan gizi klinis, penurunan atau kenaikan berat, gejala/asupan, penyakit berisiko, dan referensi hasil skrining. |
| `Q0024` | `1` coding, `1.1` kondisional, `2` boolean, `3` reference | Skrining dewasa. Catat penurunan berat yang tidak diinginkan dan besarnya jika berlaku, asupan dan referensi hasil skrining. |
| `Q0025` | `1–4` boolean, `5` reference | Skrining ibu hamil. Catat asupan, gangguan metabolisme, pertambahan BB, temuan Hb/HCT sesuai instrumen, dan referensi hasil. |
| `Q0026` faktor determinan | `1.1–1.2` coding, `1.3–1.4` reference, `1.5` coding, `1.6` reference | Air/jamban, status merokok keluarga, kecacingan, gizi ibu hamil dan riwayat penyakit. |
| `Q0026` monitoring MPASI | `2.1` reference, `2.2` coding, `2.3` boolean | Pemberian, jenis dan frekuensi. Kaitkan Observation MPASI yang dipakai sebagai jawaban. |

Contoh potongan request Q0014. Lengkapi jawaban `2–5` sesuai hasil wawancara. `Observation/<HASIL_SKRINING>` adalah ID hasil yang sudah tersedia.

```json
{
  "resourceType": "QuestionnaireResponse",
  "questionnaire": "https://fhir.kemkes.go.id/Questionnaire/Q0014",
  "status": "completed",
  "subject": {"reference": "Patient/<ANAK>"},
  "encounter": {"reference": "Encounter/<KUNJUNGAN>"},
  "authored": "2026-11-16T02:00:00Z",
  "author": {"reference": "Practitioner/<NUTRISIONIS>"},
  "item": [
    {"linkId": "1", "answer": [{"valueBoolean": false}]},
    {"linkId": "6", "answer": [{"valueReference": {"reference": "Observation/<HASIL_SKRINING>"}}]}
  ]
}
```

Potongan hasil baca balik untuk menguji bentuk z-score.

```json
{
  "resourceType": "Observation",
  "id": "<HASIL_BBU>",
  "status": "final",
  "code": {"coding": [{"system": "http://snomed.info/sct", "code": "1153593003"}]},
  "subject": {"reference": "Patient/<ANAK>"},
  "valueQuantity": {"value": -1.2, "system": "http://unitsofmeasure.org", "code": "{Zscore}", "unit": "{Zscore}"}
}
```
