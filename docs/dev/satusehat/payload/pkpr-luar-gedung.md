# Payload dan terminologi PKPR luar gedung

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Kesehatan Peduli Remaja (PKPR) Luar Gedung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/) (v1.1, rilis 2024-05-29, disunting 2025-10-02) · [Lampiran Terminologi Pelayanan Kesehatan Peduli Remaja (PKPR) Luar Gedung](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/pkpr-luar-gedung/) (disunting 2024-11-12)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Pelayanan Kesehatan Peduli Remaja (PKPR) luar gedung](../alur/pkpr-luar-gedung.md)

## Field, nilai, dan terminologi

| Fakta | Pemetaan |
| --- | --- |
| Disabilitas | Observation dengan `subject`, `encounter`, status, waktu, dan nilai sesuai jenis pemeriksaan. `code` SNOMED CT `268391007` mental, `406135009` sensorik, `165220001` fisik, `110359009` intelektual. Isi `value[x]` menurut profil identifikasi masing-masing. |
| Berat, tinggi, IMT/U, tekanan darah | LOINC `29463-7`, `8302-2`, `8480-6` sistolik, `8462-4` diastolik. IMT/U SNOMED CT `1153596006`. Gunakan UCUM sesuai variabel. Interpretasi hipertensi SNOMED CT `268607006` pada pemetaan modul. |
| Mata | Snellen kanan/kiri memakai LOINC `79882-7`/`79883-5`. Ishihara memakai `79732-4`, nilai SNOMED CT `45089002` atau `193683001` sesuai hasil. |
| Telinga | Tes bisik SNOMED CT `247301006`; `bodySite` kanan `25577004`, kiri `89644007`. Pemeriksaan telinga luar `225670007`; `bodySite` kanan `69838001`, kiri `49521004`. Isi hasil dengan nilai yang dipetakan sesuai tes. |
| Kebugaran dan gigi | Kebugaran 1.000 m dan 1.600 m memakai `OC000124` dan `OC000125` dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term`. Pemeriksaan gigi memakai LOINC `32478-0`. |
| Jiwa dan NAPZA | Observation memakai kategori dan nilai berdasarkan instrumen. Jenis fakta dalam tabel antara lain gejala emosional `386816005`, perilaku `277843001`, hiperaktivitas `44548000`, risiko NAPZA `70545002` (SNOMED CT) serta kategori `survey` untuk risiko NAPZA. |
| Anemia dan TTD | Procedure `PC000015` dari clinical-term untuk dilakukan pemeriksaan Hb. Hasil Hb memakai LOINC `30352-9`, kategori `laboratory`; gejala klinis `OC000155` kategori `exam`; jumlah TTD yang dikonsumsi pada periode tertentu `OC000127`. MedicationStatement mengikuti profil obat yang benar-benar dikonsumsi. |

[Identifikasi disabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_3_identifikasi_disabilitas) · [Pemeriksaan UKS](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_4_pemeriksaan_kesehatan_untuk_usia_sekolah_dan_remaja_di_uks) · [Posyandu](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_5_pemeriksaan_kesehatan_untuk_usia_sekolah_dan_remaja_di_posyandu_oleh_nakes_dan_kader)

### Q0012 tentang merokok dan pajanan

Gunakan `https://fhir.kemkes.go.id/Questionnaire/Q0012`. `1` riwayat merokok dan `4` pajanan asap bulan terakhir memakai `valueBoolean`. `2` jumlah batang per hari memakai `valueInteger`. `3` durasi merokok memakai `valueQuantity` dengan `unit`/ `code` `a` dari `http://unitsofmeasure.org`. Isi detail berdasarkan jawaban aktual. [Pemeriksaan Posyandu](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_5_pemeriksaan_kesehatan_untuk_usia_sekolah_dan_remaja_di_posyandu_oleh_nakes_dan_kader)

Contoh request sintetis, dengan jawaban yang sesuai fixture pengguna.

```json
{
  "resourceType": "QuestionnaireResponse",
  "status": "completed",
  "questionnaire": "https://fhir.kemkes.go.id/Questionnaire/Q0012",
  "subject": {"reference": "Patient/<PESERTA>"},
  "encounter": {"reference": "Encounter/<KUNJUNGAN_POSYANDU>"},
  "authored": "2026-11-16T02:00:00Z",
  "author": {"reference": "Practitioner/<PETUGAS>"},
  "item": [
    {"linkId": "1", "answer": [{"valueBoolean": false}]},
    {"linkId": "4", "answer": [{"valueBoolean": true}]}
  ]
}
```

Pada respons sukses simpan `id`, jenis formulir, korelasi kegiatan dan hasil. Potongan hasil baca balik yang diperlukan untuk korelasi.

```json
{
  "resourceType": "QuestionnaireResponse",
  "id": "<ID_Q0012>",
  "status": "completed",
  "questionnaire": "https://fhir.kemkes.go.id/Questionnaire/Q0012",
  "subject": {"reference": "Patient/<PESERTA>"},
  "encounter": {"reference": "Encounter/<KUNJUNGAN_POSYANDU>"}
}
```
