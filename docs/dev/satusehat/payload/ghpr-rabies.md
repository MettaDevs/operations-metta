# Payload dan terminologi GHPR dan rabies

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Zoonosis - Gigitan Hewan Penular Rabies (GHPR)/Rabies](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/zoonosis-rabies/) (v1.0, rilis 2024-11-16, disunting 2024-12-08) · [Immunization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Zoonosis GHPR/Rabies dan pencatatan VAR/SAR](../alur/ghpr-rabies.md)

## Matriks payload dan terminologi

| Fakta | Field dan kode |
| --- | --- |
| Riwayat pajanan | Observation pekerjaan LOINC `85658-3`, jenis hewan `95376-0`, waktu gigitan sebelumnya `TK000122` dengan `valueDateTime` dan provokasi hewan `TK000123` dengan `valueBoolean`, sesuai system pada tabel. Riwayat dan kejadian saat ini punya waktu dan sumber masing-masing. |
| Cuci luka mandiri | `QuestionnaireResponse.questionnaire=https://fhir.kemkes.go.id/Questionnaire/Q0028`. Kelompok `1`: `1.1` boolean tentang durasi/metode, `1.2` dateTime saat dilakukan, `1.3` coding kategori `TK000124` atau `TK000125` dari `http://terminology.kemkes.go.id` menurut hasil. |
| Skrining luka | Observation `TK000116` dengan nilai boolean, `bodySite` sesuai lampiran. Komponen `TK000117` kategori luka, nilai `TK000118`/ `TK000119`/ `TK000120`; komponen luka multipel memakai SNOMED CT `57028002` dengan boolean. Location kejadian memakai tipe `LT000012` dari `http://terminology.kemkes.go.id/CodeSystem/location-type` sesuai bab 4. |
| Immunization VAR | Isi `status=completed`, `patient`, `encounter`, `vaccineCode`, lot, waktu `occurrenceDateTime`, `recorded`, `primarySource`, pelaksana, rute dan `site` sesuai fakta. Kode produk KFA pada lampiran 5 antara lain `93022865`, `93022991`, `93023058`, `93001589`, `93020790`. Pilih produk yang diberikan. Nomor sesi dosis memakai `protocolApplied[].doseNumberPositiveInt`; buku menulis `doseNumberPositiveInteger` pada tabel. `doseQuantity` memakai UCUM `mL`. |
| Kategori, peran, rute | `reasonCode[]` memakai `IM-Khusus`/ `IM-Pilihan` dari `http://terminology.kemkes.go.id/CodeSystem/immunization-reason`. Performer `OP`, `AP`, `EP` dari `http://terminology.hl7.org/CodeSystem/v2-0443`. Tabel rute memakai `inj.intramuscular` atau `inj.subcutaneous` dari `https://www.whocc.no/atc`. Konfirmasi coding rute yang diterima pada profil aktif. |
| Diagnosis dan tindakan | Condition ICD-10 `Z20.3` untuk kontak/pajanan atau `A82.9` sesuai diagnosis dokter. Procedure cuci luka `225150002` (SNOMED CT), tindakan VAR `99.44` (ICD-9-CM), SAR `117085001` atau `99.29` sesuai terminologi pada bab 7. Catat `status` serta waktu aktual, dan data penyerahan/pemberian obat bila dilakukan. |
| SAR dan akhir kunjungan | Produk SAR gunakan KFA lampiran 7, misalnya `93001637` atau `93014521` jika cocok produk. Observation waktu meninggal menggunakan LOINC `81956-5` bila berlaku. |

[Buku GHPR/Rabies, bab 3–8 dan lampiran 4–7](https://drive.google.com/file/d/1OehqrvXbsBsdi8fnUa4DoQrOTcSmB_Ev/preview) · [FHIR R4 Immunization](https://hl7.org/fhir/R4/immunization.html)

Contoh request riwayat cuci luka. Isi cabang tanggal atau kategori bila tersedia sesuai fakta yang tercatat.

```json
{
  "resourceType": "QuestionnaireResponse",
  "questionnaire": "https://fhir.kemkes.go.id/Questionnaire/Q0028",
  "status": "completed",
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT_RABIES>"},
  "authored": "2026-11-16T03:00:00Z",
  "item": [{"linkId": "1", "item": [{"linkId": "1.1", "answer": [{"valueBoolean": false}]}]}]
}
```

Potongan hasil baca balik VAR yang perlu cocok dengan pasien, kunjungan dan sesi.

```json
{
  "resourceType": "Immunization",
  "id": "<VAR_SITE_01>",
  "status": "completed",
  "vaccineCode": {"coding": [{"system": "http://sys-ids.kemkes.go.id/kfa", "code": "93022865"}]},
  "patient": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT_RABIES>"},
  "protocolApplied": [{"doseNumberPositiveInt": 1}]
}
```
