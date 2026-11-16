# Field dan terminologi skrining hipotiroid kongenital

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Skrining Hipotiroid Kongenital (SHK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/) (v2.1, rilis 2024-06-12, disunting 2025-12-02) · [Observation](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/) (disunting 2023-09-27) · [DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Skrining Hipotiroid Kongenital dan tes konfirmasi](../alur/skrining-hipotiroid-kongenital.md) · [Pencarian dan korelasi hasil skrining hipotiroid kongenital](../endpoint/skrining-hipotiroid-kongenital.md)

## Field dan terminologi

| Bagian | Field utama |
| --- | --- |
| ServiceRequest skrining | `identifier[]` lokal, `status=active`, `intent=original-order`, `priority` sesuai order, `requester`, `performer[]`, Patient pada `subject`, `encounter`, `specimen[]`, dan `code` yang sesuai. Untuk rujukan pemeriksaan laboratorium, kategori SNOMED CT `266753000` digunakan sesuai bab 4. |
| Specimen | `identifier[]`, `status`, `type`, Patient, `request[]`, `collection`, waktu, lokasi pengambilan, petugas, organisasi pengambil dan pengiriman. Gunakan jenis DBS atau spesimen konfirmasi sesuai pemeriksaan. Rekam penerimaan dan kondisi dengan extension yang diterbitkan profil. |
| Observation hasil DBS | `status`, `code` LOINC `29575-8`, kategori lab, `subject`, `encounter`, `basedOn[]`, `specimen`, `performer[]`, waktu hasil, `valueQuantity` dan `interpretation[]`. Playbook mencantumkan `m[IU]/L` (UCUM), kategori `N` untuk nilai di bawah 20 dan `H` mulai 20 pada konteks pemeriksaan tersebut. Gunakan keputusan lab sesuai profil dan pemeriksaan. |
| DiagnosticReport | `status`, `code` LOINC `29575-8` untuk TSH DBS, `subject`, `encounter`, `basedOn[]`, `specimen[]`, `result[]`, waktu dan validator sesuai pemetaan. |
| Tes konfirmasi | Untuk TSH serum/plasma, LOINC `3016-3` jika metode tidak diketahui, `11579-0` atau `11580-8` menurut limit deteksi pada tabel modul. Untuk FT4 serum/plasma, `3024-7` bila metode tidak diketahui atau bukan immunoassay, dan `83122-2` untuk immunoassay. Gunakan kode yang sama pada order, hasil dan laporan sesuai pemetaan. Tabel menulis deskripsi limit yang berbeda pada salah satu baris `11580-8`; konfirmasi terhadap terminologi aktif sebelum menetapkan coding. |
| Condition | `code` diagnosis ICD-10 yang dicatat, `subject`, `encounter`, serta kategori dan status sesuai profil klinis. Jangan turunkan diagnosis otomatis dari hasil skrining numerik. |

[Terminologi SHK](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-hasil-pemeriksaan-shk) · [Field wajib per bab](profil-field-program-ibu-dan-bayi.md)

Contoh hasil yang ditandai tinggi oleh lab. Ganti ID dan nilai dengan fixture pemeriksaan yang sesuai.

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]}],
  "code": {"coding": [{"system": "http://loinc.org", "code": "29575-8"}]},
  "subject": {"reference": "Patient/<BAYI>"},
  "encounter": {"reference": "Encounter/<LAB_RUJUKAN>"},
  "basedOn": [{"reference": "ServiceRequest/<ORDER_SHK>"}],
  "specimen": {"reference": "Specimen/<DBS>"},
  "effectiveDateTime": "2026-11-16T05:20:00Z",
  "performer": [{"reference": "Organization/<LAB>"}],
  "valueQuantity": {"value": 22, "unit": "m[IU]/L", "system": "http://unitsofmeasure.org", "code": "m[IU]/L"},
  "interpretation": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": "H"}]}]
}
```

Potongan laporan yang perlu dikorelasikan.

```json
{
  "resourceType": "DiagnosticReport",
  "id": "<LAPORAN_SHK>",
  "status": "final",
  "code": {"coding": [{"system": "http://loinc.org", "code": "29575-8"}]},
  "basedOn": [{"reference": "ServiceRequest/<ORDER_SHK>"}],
  "specimen": [{"reference": "Specimen/<DBS>"}],
  "result": [{"reference": "Observation/<HASIL_TSH_SHK>"}]
}
```
