# Payload odontogram dan indeks gigi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Gigi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/) (v1.5, rilis 2024-08-07, disunting 2025-10-02) · [Lampiran Terminologi Gigi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-jalan-gigi/) (disunting 2024-08-26)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Rawat jalan gigi dan odontogram](../alur/rawat-jalan-gigi-dan-odontogram.md)

## Observation odontogram dan indeks

Sertakan `status`, `category`, `code`, Patient, Encounter, dokter/pemeriksa serta waktu pemeriksaan sesuai profil. Kategori memakai `exam` dari `http://terminology.hl7.org/CodeSystem/observation-category` pada tabel indeks/odontogram. Rekam kondisi dan permukaan sesuai temuan, dan jumlahkan hanya berdasarkan catatan yang disahkan.

| Fakta | Path dan nilai |
| --- | --- |
| DI/CI/OHIS | Kode Kemenkes dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term`: `OC000062` DI per gigi, `OC000063` CI per gigi, `OC000056` total DI, `OC000057` total CI, `OC000058` total OHIS. Untuk skor total gunakan `valueQuantity` desimal dengan system UCUM dan code `{score}`. Untuk elemen per gigi pilih `bodySite` dan value coding sesuai lampiran. |
| Pemeriksaan odontogram | `code=OC000061` dari clinical-term, `valueBoolean` menandai fakta pemeriksaan. `bodySite` memakai konsep gigi SNOMED CT yang dipetakan dari FDI, misalnya FDI 11 ke `422653006`. Bab odontogram merujuk nomor lampiran berbeda dari daftar terbaru; cari bagian bernama Nomenklatur Gigi FDI. |
| Komponen permukaan dan keadaan | Komponen permukaan memakai LOINC `32889-8`. Tabel menukar code dan display; tempatkan code LOINC pada `coding.code`. Nilai permukaan dari lampiran, misalnya mesial SNOMED CT `710099007`. Kode komponen keadaan gigi SNOMED CT `278544002`, nilai contoh tanpa masalah `162005007`. |
| Komponen restorasi dan protesa | Kode komponen SNOMED CT `432680005` bahan restorasi, `251335007` restorasi, `256509009` bahan protesa, dan LOINC `34026-5` protesa. Gunakan `component[].valueCodeableConcept` dan daftar sesuai jenis. |
| Temuan lain | SNOMED CT `25272006` oklusi, torus palatinus `46752004` dan mandibularis `11625007`, palatum LOINC `32460-8`, diastema SNOMED CT `734009000`, anomali `81256000`, dan kondisi lain Kemenkes `OC000060`. |
| Hitung D/M/F | SNOMED CT `251319000` decayed, `251317003` missing, `251318008` filled. Tabel bab 5 memakai `valueString` untuk masing-masing jumlah; konfirmasi hasil validasi terhadap contoh Playbook. Jangan mengirim count tanpa sumber pemeriksaan. |

[Odontogram](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_5_pengiriman_data_pemeriksaan_odontogram) · [Nomenklatur gigi FDI](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-jalan-gigi/#lampiran-1-gigi) · [Permukaan gigi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-jalan-gigi/#lampiran-4-gigi)

Potongan request satu temuan odontogram. Isi komponen hanya sesuai fakta; contoh menampilkan keadaan gigi FDI 11.

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "exam"}]}],
  "code": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/clinical-term", "code": "OC000061"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT_GIGI>"},
  "performer": [{"reference": "Practitioner/<DOKTER_GIGI>"}],
  "effectiveDateTime": "2026-11-16T03:00:00Z",
  "bodySite": {"coding": [{"system": "http://snomed.info/sct", "code": "422653006"}]},
  "valueBoolean": true,
  "component": [{
    "code": {"coding": [{"system": "http://snomed.info/sct", "code": "278544002"}]},
    "valueCodeableConcept": {"coding": [{"system": "http://snomed.info/sct", "code": "162005007"}]}
  }]
}
```

Potongan baca ulang yang perlu dicocokkan dengan kejadian lokal.

```json
{
  "resourceType": "Observation",
  "id": "<HASIL_ODONTOGRAM>",
  "status": "final",
  "encounter": {"reference": "Encounter/<VISIT_GIGI>"},
  "bodySite": {"coding": [{"system": "http://snomed.info/sct", "code": "422653006"}]}
}
```
