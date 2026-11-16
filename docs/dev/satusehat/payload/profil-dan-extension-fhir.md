# Profil dan extension FHIR R4 SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [SATUSEHAT FHIR R4 Implementation Guide](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Overview.page.md?version=current) (v0.1.0) · [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/) (disunting 2026-11-06) · [Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Profil resource portal](inventaris-profil-resource.md) · [Kompatibilitas payload](kompatibilitas-payload-fhir.md) · [Bukti Sandbox](../pengujian/skenario-sandbox.md)

Snapshot 16 November 2026 mencakup 40 halaman profil dan 10 halaman extension dengan identitas kanonis yang tercantum pada SATUSEHAT FHIR R4 Implementation Guide versi 0.1.0. Panduan ini melengkapi 57 profil resource di portal SATUSEHAT. Cocokkan kontrak jalur yang sedang dikerjakan dengan matriks Playbook, contoh request, peran pengirim, dan versi profil yang dipakai lingkungan tujuan. [SATUSEHAT FHIR R4 Implementation Guide](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Overview.page.md?version=current)

## Memakai profil dan extension

- `StructureDefinition.url` mengidentifikasi definisi. Pada JSON resource, `meta.profile[]` berisi identitas profil ketika kontrak meminta deklarasi profil. `extension[].url` berisi identitas extension. Host pengiriman, metode dan path memakai [kontrak per operasi](../endpoint/kontrak-operasi-api.md).
- Extension sederhana memakai satu `value[x]` dengan akhiran tipe JSON yang sesuai, misalnya `valueAddress`, `valueCode`, `valueDateTime` atau `valueReference`. Extension kompleks memakai `extension[]` anak dengan `url` relatif dan nilai masing-masing. Parent kompleks seperti `ServiceClass` dan `Package` mempunyai `value[x]` maksimum 0. [Aturan extension FHIR R4](https://hl7.org/fhir/R4/extensibility.html)
- Baca kardinalitas pada parent dan slice di profil resource yang dipilih. Contohnya `CollectorOrganization` berada di `Specimen.collection`, dan slice `transportedTime` berada di tingkat resource. Cocokkan waktu, ID referensi, CodeSystem serta peran fasyankes dengan [alur rujukan spesimen](../alur/laboratorium-rujukan-spesimen.md). [Profil Specimen](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Specimen.page.md?version=current)

## Extension yang diterbitkan

| Extension | URI kanonis di ringkasan IG | Posisi JSON | Nilai dan sumber |
| --- | --- | --- | --- |
| [AdministrativeCode](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/AdministrativeCode.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/administrativeCode` | `Address.extension[]` | Kompleks. Anak `province`, `city`, `district`, `village`, `rt`, `rw`. Contoh portal mengisi `valueCode` untuk masing-masing anak. Lihat perbedaan huruf dan kardinalitas di bawah. |
| [BirthPlace](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/BirthPlace.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/birthPlace` | `Patient.extension[]` untuk tempat lahir | `valueAddress` `1..1`. Alamat dapat mempunyai extension kode wilayah. Ambil kota atau kode wilayah dari fakta tempat lahir pasien. |
| [CitizenshipStatus](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/CitizenshipStatus.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/citizenshipStatus` | `Patient.extension[]` untuk status kewarganegaraan | `valueCode` (`0..1` pada definisi extension). Ambil status dari data identitas. Profil Patient juga memuat slice `citizenship` dengan URI `https://fhir.kemkes.go.id/r4/StructureDefinition/patient-citizenship` untuk data kewarganegaraan, dengan anak `code` dan `period`. |
| [CollectorOrganization](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/CollectorOrganization.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/CollectorOrganization` | `Specimen.collection.extension[]` | `valueReference` ke `Organization`. Isi IHS organisasi yang mengambil spesimen, dengan peran pengambil yang dicatat di order atau log koleksi. |
| [LocationServiceClass](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/LocationServiceClass.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/LocationServiceClass` | `Location.extension[]` | `valueCodeableConcept` untuk kelas yang melekat pada master ruangan. Ambil kelas dari master lokasi fasilitas. |
| [MedicationType](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/MedicationType.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType` | `Medication.extension[]` | `valueCodeableConcept` `1..1`. System contoh portal `https://terminology.kemkes.go.id/CodeSystem/medication-type`. Kode `NC` untuk non-racikan, `SD` untuk racikan d.t.d., `EP` untuk racikan non-d.t.d. berdasarkan jenis aktual. Buku v12.0 menulis system dengan `http://`, lihat catatan di bawah. |
| [Package](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/Package.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Package` | `Claim.extension[]` slice `package` | Kompleks. `tariffClass` dan `basePackage` masing-masing `1..1`. `additionalPackage` `0..*`. Pada tiap `basePackage` atau `additionalPackage`, anak `code` dan `value` masing-masing `1..1`. Ambil paket dan tarif yang diterbitkan pada jalur klaim terkait. |
| [PatientReligion](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/PatientReligion.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/patient-religion` | `Patient.extension[]` untuk agama | `valueCodeableConcept` menurut slice Patient. Pakai agama yang tercatat serta binding profil pasien yang berlaku. |
| [ServiceClass](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/ServiceClass.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/ServiceClass` | `Encounter.location[].extension[]` | Kompleks. Anak `value` dan `upgradeClassIndicator` masing-masing `0..1` pada definisi extension, keduanya `valueCodeableConcept`. Ambil kelas yang berlaku dan kejadian perubahan kelas dari histori lokasi kunjungan. |
| [TransportedTime](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Extensions/TransportedTime.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/TransportedTime` | `Specimen.extension[]` | `valueDateTime`. Profil Specimen pada panduan memberi slice `transportedTime` `1..1`. Isi waktu aktual pengiriman pada jalur yang menggunakan profil tersebut. Definisi extension sendiri memberi `value[x]` `0..1`. |

### Alamat dan perbedaan definisi AdministrativeCode

Contoh request `Location.address`, `Organization.address[]` dan `Patient.address[]` di portal memakai URI `https://fhir.kemkes.go.id/r4/StructureDefinition/administrativeCode` dengan huruf `a` kecil. Halaman ringkasan IG juga menampilkan bentuk itu. Fixed value di dalam definisi IG dan pada slice `Address`, `Patient.address[]` serta `BirthPlace.valueAddress` memakai `.../AdministrativeCode`. IG extension menampilkan slice `province` `1..1` dan `city` `0..1`. Profil Address dan Patient menampilkan `province` dan `city` `1..1` di dalam slice alamat administratif. Pada ketiga contoh portal, kedua anak ada dan bertipe `valueCode`. Ikuti payload portal untuk ketiga jalur tersebut. Simpan URI secara case-sensitive dan catat varian yang diterima jika validator profil dan server memberi hasil berbeda. Ambil kode sesuai hierarki alamat aktual dari [Master Wilayah](../endpoint/master-data-sarana-wilayah.md#master-wilayah). [Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) · [Organization](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/organization/) · [Patient](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/patient/) · [IG Address](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Address.page.md?version=current)

### Contoh kelas bangsal

Fragmen sintetis master ruangan. Sisipkan pada payload `Location` yang sudah mempunyai identifier, organisasi pengelola, dan field lain sesuai use case.

```json
{
  "extension": [
    {
      "url": "https://fhir.kemkes.go.id/r4/StructureDefinition/LocationServiceClass",
      "valueCodeableConcept": {
        "coding": [
          {
            "system": "http://terminology.kemkes.go.id/CodeSystem/locationServiceClass-Inpatient",
            "code": "2"
          }
        ]
      }
    }
  ]
}
```

Fragmen sintetis satu entry lokasi di dalam `Encounter`. Kelas ditetapkan dari riwayat penempatan. Contoh ini memakai kelas 2 dan indikator kelas tetap. Isi periode aktual pada entri lokasi sesuai profil.

```json
{
  "location": [
    {
      "location": {
        "reference": "Location/<LOCATION_IHS>"
      },
      "extension": [
        {
          "url": "https://fhir.kemkes.go.id/r4/StructureDefinition/ServiceClass",
          "extension": [
            {
              "url": "value",
              "valueCodeableConcept": {
                "coding": [
                  {
                    "system": "http://terminology.kemkes.go.id/CodeSystem/locationServiceClass-Inpatient",
                    "code": "2"
                  }
                ]
              }
            },
            {
              "url": "upgradeClassIndicator",
              "valueCodeableConcept": {
                "coding": [
                  {
                    "system": "http://terminology.kemkes.go.id/CodeSystem/locationUpgradeClass",
                    "code": "kelas-tetap"
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Portal Medication menunjukkan kode `NC` dengan system `https://terminology.kemkes.go.id/CodeSystem/medication-type`. Buku Standar Terminologi v12.0 bagian 7.7 mencantumkan kode `NC`, `SD` dan `EP` dengan system `http://terminology.kemkes.go.id/CodeSystem/medication-type`. Simpan pasangan yang dipakai pada contoh jalur sumber. Periksa hasil penerimaan dan baca balik sebelum menyamakan kedua URI. [Portal Medication](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication/) · [Standar Terminologi v12.0](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) · [Matriks farmasi](matriks-farmasi.md)

Untuk spesimen, profil IG memberi `valueContactDetail` pada slice `transportedPerson` dan `valueReference` ke Practitioner pada slice `receivedPerson`. URI kedua slice itu, `conditionHistory`, extension novelty SIRS, `Task.documentName` dan `Provenance.signature-provider` masih membutuhkan definisi atau payload jalur terkait. [Portal Specimen](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/) · [IG Specimen](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Specimen.page.md?version=current) · [Kontrak terminologi](../terminologi/kontrak-terminologi.md)

## Identitas profil yang diterbitkan

`Address` adalah tipe data. `List` mempunyai profil pada IG dan belum memiliki operasi SATUSEHAT yang teridentifikasi di [inventaris operasi](../endpoint/inventaris-operasi-http.md). Identitas untuk `RelatedPerson` mengikuti ejaan `RelatedPersn` pada kolom Canonical yang ditampilkan sumber. Catatan ini membantu mencocokkan deklarasi profil yang benar jika dipersyaratkan implementasi.

| Profil IG | URI kanonis |
| --- | --- |
| [Account](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Account.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Account` |
| [Address](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Address.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Address` |
| [AllergyIntolerance](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/AllergyIntolerance.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/AllergyIntolerance` |
| [CarePlan](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/CarePlan.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/CarePlan` |
| [ChargeItem](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/ChargeItem.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/ChargeItem` |
| [Claim](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Claim.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Claim` |
| [ClaimResponse](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/ClaimResponse.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/ClaimResponse` |
| [ClinicalImpression](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/ClinicalImpression.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/ClinicalImpression` |
| [Composition](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Composition.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Composition` |
| [Condition](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Condition.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Condition` |
| [Coverage](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Coverage.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Coverage` |
| [CoverageEligibilityRequest](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/CoverageEligibilityRequest.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/CoverageEligibilityRequest` |
| [CoverageEligibilityResponse](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/CoverageEligibilityResponse.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/CoverageEligibilityResponse` |
| [DiagnosticReport](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/DiagnosticReport.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/DiagnosticReport` |
| [Encounter](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Encounter.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Encounter` |
| [EpisodeOfCare](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/EpisodeOfCare.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/EpisodeOfCare` |
| [FamilyMemberHistory](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/FamilyMemberHistory.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/FamilyMemberHistory` |
| [HealthcareService](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/HealthcareService.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/HealthcareService` |
| [ImagingStudy](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/ImagingStudy.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/ImagingStudy` |
| [Immunization](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Immunization.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Immunization` |
| [Invoice](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Invoice.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Invoice` |
| [List](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/List.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/List` |
| [Location](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Location.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Location` |
| [Medication](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Medication.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Medication` |
| [MedicationAdministration](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/MedicationAdministration.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationAdministration` |
| [MedicationDispense](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/MedicationDispense.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationDispense` |
| [MedicationRequest](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/MedicationRequest.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationRequest` |
| [MedicationStatement](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/MedicationStatement.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationStatement` |
| [Observation](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Observation.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Observation` |
| [OperationOutcome](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/OperationOutcome.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/OperationOutcome` |
| [Organization](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Organization.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Organization` |
| [Patient](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Patient.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Patient` |
| [Practitioner](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Practitioner.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Practitioner` |
| [PractitionerRole](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/PractitionerRole.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/PractitionerRole` |
| [Procedure](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Procedure.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Procedure` |
| [Questionnaire](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Questionnaire.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Questionnaire` |
| [QuestionnaireResponse](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/QuestionnaireResponse.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/QuestionnaireResponse` |
| [RelatedPerson](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/RelatedPerson.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/RelatedPersn` |
| [ServiceRequest](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/ServiceRequest.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/ServiceRequest` |
| [Specimen](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/FHIRProfiles/Specimen.page.md?version=current) | `https://fhir.kemkes.go.id/r4/StructureDefinition/Specimen` |
