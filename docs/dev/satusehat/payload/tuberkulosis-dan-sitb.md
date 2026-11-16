# Payload tuberkulosis dan SITB

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/) (v4.3, rilis 2024-11-05, disunting 2024-12-15) · [Lampiran Terminologi Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/tuberkulosis/) (disunting 2024-09-08)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Tuberkulosis, SITB, dan EpisodeOfCare](../alur/tuberkulosis-dan-sitb.md)

## Field, kode dan dependensi

| Resource atau skenario | Field dan terminologi |
| --- | --- |
| EpisodeOfCare | `status`, `type[]`, `patient`, `managingOrganization`, `period` dan histori sesuai profil. Identifier terduga lokal memakai `http://sys-ids.kemkes.go.id/episode-of-care/{organization-id}`. Tipe `TB-SO` atau `TB-RO` dari `https://terminology.kemkes.go.id/CodeSystem/episodeofcare-type`. Simpan ID resource, nomor surveilans, dan nomor register sebagai pengenal terpisah. |
| QuestionnaireResponse | Canonical `https://fhir.kemkes.go.id/Questionnaire/Q0001`. Grup `1`, anak `1.1` kriteria dengan `QRI000001` (terduga SO) atau `QRI000002` (terduga RO) dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term`. Anak `1.2` riwayat terapi; `1.3` kriteria RO saat dipilih; `1.4` lokasi anatomis dengan SNOMED CT `154283005` atau `423997002` sesuai fakta. |
| Observation register | Status HIV memakai LOINC `55277-8`, riwayat DM `33248-6`. Pekerjaan memakai LOINC `85658-3` mulai v4.3. Skoring anak memakai code `OC000191`; klasifikasi uji kepekaan `OC000192` memakai referensi `derivedFrom[]` ke hasil yang sah. |
| Lab dan radiologi | Foto toraks `24648-8`, mikroskopi `11545-1`. TCM pada sumber memakai Observation `88874-3` dan DiagnosticReport `89371-9`. TCM XDR, LPA, kultur dan tes kepekaan memakai kode metode dalam tabel modul. TCM identifier contoh memakai `http://sys-ids.kemkes.go.id/sitb/{organization-id}`. Cocokkan `basedOn[]`, `specimen[]` dan `result[]` antara order, sampel, hasil serta laporan. |
| CarePlan | Kategori `TB-SO`/`TB-RO` dari `http://terminology.kemkes.go.id/CodeSystem/careplan-category`. Kode aktivitas `CP000006` paduan OAT, `CP000004` bentuk OAT, dan `CP000005` paduan pengobatan dari clinical-term. Pilih `activity[].detail.productCodeableConcept` sesuai lampiran dan fakta regimen. Di akhir program simpan outcome melalui `activity[].outcomeCodeableConcept[]` sesuai lampiran 21. |
| Encounter dan Condition | Encounter mengikat `episodeOfCare[]`. Condition memakai diagnosis dan status klinis yang benar. Perbarui Encounter menggunakan ID balikan, periode dan konteks awal yang masih berlaku. |

[Klasifikasi terduga](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_5_pengiriman_data_klasifikasi_kasus_terduga_tb) · [Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_8_pengiriman_data_terkait_pemeriksaan_penunjang) · [Field per bab program menular](profil-field-penyakit-menular.md)

### Kode metode penunjang dan hasil akhir

Untuk `DiagnosticReport.code`, tabel bab 8 membedakan TCM `89371-9`, toraks `24648-8`, dan mikroskopi `11545-1` dari LOINC. Metode pada terminologi pemeriksaan Kemenkes mencakup TCM XDR `X099379`, LPA lini 1 dan 2 `X099380` dan `X099381`, kultur LJ/MGIT `X099389` dan `X099390`, paket kepekaan `X099383`, MTB Rif INH BD Max `MK099926`, serta PCR Open System `MK099927`. Gunakan kode hasil individual yang sesuai di Observation, terutama jika satu pemeriksaan menghasilkan panel. [Penunjang TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_8_pengiriman_data_terkait_pemeriksaan_penunjang)

| Hasil akhir | `CarePlan.activity[].outcomeCodeableConcept[].coding[]` |
| --- | --- |
| Sembuh | SNOMED CT `371001000` |
| Terapi lengkap | SNOMED CT `182992009` |
| Gagal | `CP000094` pada `http://terminology.kemkes.go.id/CodeSystem/clinical-term` |
| Meninggal | SNOMED CT `419099009` |
| Putus berobat | SNOMED CT `399307001` |
| Tidak dievaluasi atau pindah | `CP000096` pada clinical-term Kemenkes |

Terapkan hasil yang sudah ditetapkan untuk pasien tersebut. Cari ID CarePlan asli sebelum mengirim pembaruan. [Terminologi hasil akhir TB](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/tuberkulosis/#lampiran-21-tuberkulosis)

Contoh request episode terduga TB-SO. Ganti ref dan identifier dengan data fixture yang sama untuk semua transaksi.

```json
{
  "resourceType": "EpisodeOfCare",
  "identifier": [{"system": "http://sys-ids.kemkes.go.id/episode-of-care/<ORGANIZATION>", "value": "TB-LOCAL-FIXTURE-01"}],
  "status": "waitlist",
  "type": [{"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/episodeofcare-type", "code": "TB-SO"}]}],
  "patient": {"reference": "Patient/<PATIENT>"},
  "managingOrganization": {"reference": "Organization/<ORGANIZATION>"},
  "period": {"start": "2026-11-16"}
}
```

Potongan hasil baca balik setelah konfirmasi dengan tipe yang sama. Simpan pula identifier yang muncul pada respons aktual.

```json
{
  "resourceType": "EpisodeOfCare",
  "id": "<EPISODE_TB>",
  "status": "active",
  "type": [{"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/episodeofcare-type", "code": "TB-SO"}]}],
  "patient": {"reference": "Patient/<PATIENT>"}
}
```
