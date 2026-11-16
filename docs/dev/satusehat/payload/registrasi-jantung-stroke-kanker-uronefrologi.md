# Payload registrasi Jantung, Stroke, Kanker, dan Uronefrologi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Simplifikasi Registrasi Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/) (v1.0, rilis 2026-08-13, disunting 2026-10-13) · [Simplifikasi Registrasi Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/) (v1.0, rilis 2026-10-05, disunting 2026-10-13) · [Registrasi Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/) (v1.0, rilis 2026-04-01, disunting 2026-07-30)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Registrasi Jantung, Stroke, Kanker, dan Uronefrologi](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md)

## Field program yang memerlukan sumber tambahan

| Program | Field dan kode |
| --- | --- |
| Jantung | Untuk kasus yang dipetakan, Observation statistik GRACE `OC000169`, Killip `OC000168`, dan pencegahan sekunder PJR `OC000176` dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term`; detail obat pencegahan `OC000178` pada komponen. Isi kode hasil EKG, ekokardiografi, tanda vital, dan tindakan sesuai metode. |
| Stroke | Observation NIHSS admisi LOINC `72089-6` dan disfagia SNOMED CT `431765005`. Varian waktu onset/riwayat memakai pemetaan anamnesis dan klinis. Perlu skor yang ditetapkan nakes, riwayat waktu, penunjang dan tindakan pada konteks kejadian. |
| Kanker | Condition dengan diagnosis ICD-10 (satu diagnosis per resource), TNM klinis `CC000003` dari clinical-term sesuai skenario, serta `stage[].type.coding` SNOMED CT `254292007` dan `stage[].summary` dari lampiran. Pemetaan patologi, waktu diagnosis dan stadium membutuhkan hasil yang disahkan. |
| Uronefrologi | Observation batu saluran kemih SNOMED CT `95566004` setelah penunjang yang dibutuhkan selesai, `bodySite` sesuai lokasi, komponen `OC000173` derajat hidronefrosis dan `OC000175` keparahan dari clinical-term. Riwayat hipertensi/diabetes, hasil penunjang dan kondisi ginjal dicatat sesuai tabel modul. |

[Prosedur Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_9_pengiriman_data_tindakan_prosedur_medis) · [Neurologis Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_6_pengiriman_data_pemeriksaan_neurologis_penyakit_stroke) · [Diagnosis Tumor](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_7_pengiriman_data_diagnosis_tumor) · [Pemeriksaan Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_7_pengiriman_data_pemeriksaan_uronefrologi)

## Composition registri

`Composition.type.coding.system` dan coding section menggunakan `http://terminology.kemkes.go.id` pada keempat modul. Identifier memakai `http://sys-ids.kemkes.go.id/composition/{organization-id}`. Isi `status`, `subject`, `encounter`, `author[]`, `title`, `date` dan rujukan section yang relevan. Tabel Jantung dan Uronefrologi memuat legal attestation; wire FHIR memakai `attester[].mode=legal`. Tabel Uronefrologi juga menulis `documentStatus` dengan nilai `final`. URI extension serta bentuk khususnya perlu diverifikasi sebelum digunakan. [FHIR R4 Composition](https://hl7.org/fhir/R4/composition.html)

| Registri | Tipe Composition | Bagian tambahan dan perbedaan |
| --- | --- | --- |
| Jantung | `TK000001` | Tindakan mengikat Procedure dan Observation GRACE/Killip, EKG/ekokardiografi atau pencegahan sekunder bila sesuai. |
| Stroke | `TK000006` | `TK000008` pemeriksaan neurologis ke Observation. Bagian obat dapat memuat MedicationDispense/MedicationAdministration selain MedicationRequest pada layanan yang melakukan prosesnya. |
| Kanker | `TK000012` | Diagnosis merujuk Condition yang mencakup fakta ICD-10 dan stadium/TNM sesuai profil. |
| Uronefrologi | `TK000014` | `TK000015` hasil pemeriksaan uronefrologi ke Observation. Bagian diagnosis dapat memuat Condition dan Observation. |

| Bagian umum | Kode | Target |
| --- | --- | --- |
| Episode | `TK000002` | EpisodeOfCare program. |
| Anamnesis | `TK000003` | Condition dan, menurut registri dan jenis fakta, Observation. |
| Pemeriksaan fisik | `TK000007` | Observation. |
| Penunjang | `TK000009` | Observation hasil lab/radiologi. |
| Diagnosis | `TK000004` | Condition serta referensi tambahan sesuai tabel registri. |
| Tindakan | `TK000005` | Procedure dan hasil Observation yang dipetakan bila berlaku. |
| Obat | `TK000013` | MedicationRequest dan data farmasi kondisional menurut registri. |

[Composition Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_18_pengiriman_data_registrasi_jantung_melalui_composition) · [Composition Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_18_pengiriman_data_registrasi_stroke_melalui_composition) · [Composition Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_17_pengiriman_data_registrasi_kanker_melalui_composition) · [Composition Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_18_pengiriman_data_registrasi_uronefrologi_melalui_composition)

Potongan request untuk skrining yang telah menjadi registrasi stroke. Tambahkan section lain dengan referensi yang telah dikirim sesuai skenario.

```json
{
  "resourceType": "Composition",
  "identifier": {"system": "http://sys-ids.kemkes.go.id/composition/<ORG>", "value": "STROKE-FIXTURE-01"},
  "status": "final",
  "type": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000006"}]},
  "title": "Data Registrasi Stroke",
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT>"},
  "author": [{"reference": "Practitioner/<AUTHOR>"}],
  "date": "2026-11-16T05:00:00Z",
  "section": [
    {"code": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000002"}]}, "entry": [{"reference": "EpisodeOfCare/<EPISODE>"}]},
    {"code": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000008"}]}, "entry": [{"reference": "Observation/<NIHSS>"}]}
  ]
}
```

Potongan baca balik episode. Simpan juga identifier server dan histori pada bukti pengujian aktual.

```json
{
  "resourceType": "EpisodeOfCare",
  "id": "<EPISODE>",
  "status": "active",
  "type": [{"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/episodeofcare-type", "code": "CVD"}]}],
  "patient": {"reference": "Patient/<PATIENT>"}
}
```
