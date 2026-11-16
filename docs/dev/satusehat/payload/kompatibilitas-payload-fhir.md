# Kompatibilitas bentuk payload SATUSEHAT dan FHIR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [HL7 FHIR R4](https://hl7.org/fhir/R4/downloads.html) (4.0.1) · [HL7 FHIR R5](https://hl7.org/fhir/R5/downloads.html) (5.0.0) · [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/) (disunting 2026-11-06)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Profil resource](inventaris-profil-resource.md) · [Kontrak per operasi](../endpoint/kontrak-operasi-api.md)

Snapshot 16 November 2026. Pemeriksaan membandingkan path unik yang tertulis di heading 57 profil SATUSEHAT dengan StructureDefinition dasar HL7 FHIR R4 4.0.1 dan R5 5.0.0. Indeks array dinormalisasi untuk pembandingan. Pilihan `[x]`, field turunan tipe kompleks, dan relasi struktur yang berulang diperiksa terhadap definisi dasar. Extension bernama dibiarkan sebagai catatan profil. Pemeriksaan ini memberikan bukti pencocokan bentuk path. Kardinalitas use case, coding, izin resource dan perilaku server membutuhkan pemeriksaan profil aktif dan bukti endpoint. [Unduhan FHIR R4](https://hl7.org/fhir/R4/downloads.html) · [Unduhan FHIR R5](https://hl7.org/fhir/R5/downloads.html) · [Katalog profil SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/)

[Hasil snapshot](#hasil-snapshot) · [Bentuk JSON R4 yang bisa dipastikan](#bentuk-json-r4-yang-bisa-dipastikan) · [Extension dan kontrak modul](#extension-dan-kontrak-modul) · [Path yang perlu diperiksa](#path-yang-perlu-diperiksa)

## Hasil snapshot

| Hasil pencocokan | Path unik | Cara memakai |
| --- | ---: | --- |
| Cocok dengan struktur dasar R4 | 2018 | Gunakan nama wire FHIR serta aturan modul dan kardinalitas induk. |
| Cocok dengan struktur dasar R5 | 30 | Verifikasi kontrak resmi sebelum membentuk payload pada basis API `/fhir-r4/v1`. |
| Perlu penafsiran bentuk atau extension | 65 | Cocokkan contoh, spelling JSON, extension URL atau versi. |
| Extension bernama pada heading | 7 | Gunakan canonical extension dan jenis `value[x]` yang diterbitkan untuk profil tersebut. |
| Bentuk non-FHIR pada modul | 24 | Ikuti kontrak modul per peran dan body yang didokumentasikan. |

## Bentuk JSON R4 yang bisa dipastikan

| Resource | Penulisan yang perlu diperiksa | Bentuk dasar R4 |
| --- | --- | --- |
| Account | `servicedPeriod` yang muncul pada sebagian tabel klaim | Pakai `servicePeriod`, berupa Period. Cocokkan waktu layanan dengan akun kunjungan. [FHIR Account](https://hl7.org/fhir/R4/account.html) |
| ClinicalImpression | `effective.effectiveDateTime`, `effective.effectivePeriod` dan turunannya | Pakai `effectiveDateTime` atau `effectivePeriod` langsung pada resource. Isi `start` dan `end` bila periode dipakai. |
| ClinicalImpression | `finding.item.CodeableConcept` | Gunakan `finding[].itemCodeableConcept`, lalu `coding[]` atau `text` sebagai bagian nilai. |
| Composition | `relatesTo.target.targetIdentifier` dan `relatesTo.target.targetReference` | Gunakan `relatesTo[].targetIdentifier` atau `relatesTo[].targetReference`. |
| DiagnosticReport | `resultInterpreter[i]` | Gunakan `resultsInterpreter[]`. |
| FamilyMemberHistory | `instantiatedUri[i]` | Gunakan `instantiatesUri[]`. |
| ImagingStudy | `procedureReferences` | Gunakan `procedureReference[]`. |
| Immunization | `occurenceDateTime` | Gunakan `occurrenceDateTime`. |
| MedicationDispense dan MedicationRequest | `dosageInstrution[i].patientInstruction` dan `maxDosePerLifeTime` | Gunakan `dosageInstruction[].patientInstruction` dan `dosageInstruction[].maxDosePerLifetime`. |
| Observation | `valueBooelean` dan `referenceRangeType.coding` | Gunakan `valueBoolean` dan `referenceRange[].type.coding[]` sesuai fakta. |
| Procedure | `note[i].note.time` dan `note[i].note.text` | Gunakan `note[].time` dan `note[].text`. |
| RiskAssessment | `occurence[x]`, `occurenceDateTime`, `occurencePeriod` | Pilih `occurrenceDateTime` atau `occurrencePeriod`. |
| ServiceRequest | `occurenceDateTime`, `occurencePeriod`, `occurenceTiming`, `autheredOn` | Pilih `occurrenceDateTime`, `occurrencePeriod` atau `occurrenceTiming`. Gunakan `authoredOn` untuk waktu dibuat, bila diperlukan. |
| Specimen | `accesssionIdentifier` | Gunakan `accessionIdentifier`. |

Heading `Period.start` dan `Period.end` membutuhkan parent yang benar. Contohnya, periode pemeriksaan dalam Observation dapat memakai `effectivePeriod` dan periode tindakan Procedure dapat memakai `performedPeriod`. Untuk Condition, pilih field waktu onset atau abatement yang memang mewakili fakta. Pastikan profil use case yang berlaku sebelum menentukan parent. [FHIR Data Types](https://hl7.org/fhir/R4/datatypes.html#Period) · [FHIR JSON](https://hl7.org/fhir/R4/json.html)

## Extension dan kontrak modul

Extension bernama ditulis sebagai `extension[]` dengan `url` kanonis yang diterbitkan. Gunakan satu `value[x]` atau array extension anak sesuai definisi. Pada primitive FHIR, metadata extension memakai property bernama sama dengan prefiks garis bawah sebagaimana FHIR JSON. Hindari membuat property baru dari label sidebar atau nama extension. Bentuk berikut menunjukkan envelope sintetis dan membutuhkan URI profil yang benar. [FHIR Extensibility](https://hl7.org/fhir/R4/extensibility.html) · [FHIR JSON](https://hl7.org/fhir/R4/json.html)

```json
{
  "extension": [{"url": "<CANONICAL_EXTENSION_URI>", "valueString": "Fixture"}]
}
```

| Kelompok | Hal yang perlu dibuktikan |
| --- | --- |
| Encounter dan Location | `LocationServiceClass` memakai `valueCodeableConcept`, sedangkan `ServiceClass` di `Encounter.location[]` memakai dua slice anak. Canonical dan contoh tersedia di [Profil dan extension FHIR R4](profil-dan-extension-fhir.md#contoh-kelas-bangsal). URI novelty SIRS masih perlu dikonfirmasi sesuai jalur. [Kontrak terminologi](../terminologi/kontrak-terminologi.md#nilai-yang-dibutuhkan-lintas-modul) |
| Coverage, CoverageEligibilityResponse dan ChargeItem | Buktikan extension penjamin, eligibility, biaya dan hasil persetujuan antar-peran dari koleksi yang berlaku. [Klaim swasta](../alur/klaim-swasta-dan-bayar-mandiri.md) |
| Medication, Patient dan Specimen | Referensi kanonis dan tipe untuk obat, alamat, tempat lahir, serta pengumpulan dan pengiriman spesimen tersedia di [Profil dan extension FHIR R4](profil-dan-extension-fhir.md#extension-yang-diterbitkan). Catat URI yang diterima dan hasil baca balik per jalur saat pengujian. [Farmasi](matriks-farmasi.md) · [MPI](../endpoint/master-data-pasien.md) · [Rujukan spesimen](../alur/laboratorium-rujukan-spesimen.md) |
| Task | Verifikasi canonical documentName dan format value sebelum create Task TTE. [TTE](../alur/tanda-tangan-elektronik-dan-consent.md) |
| BiologicallyDerivedProduct | Buktikan URL quantity, statusDetail dan destructionReason pada skenario yang benar, termasuk cara kirim dan hak akses. [Layanan kondisional](matriks-layanan-kondisional.md) |
| BillingStatus, ChargeItemResponse dan PurificationDecision | Gunakan kontrak non-FHIR. Buktikan envelope, cara autentikasi, path dan media type sesuai peran. [Klaim swasta](../alur/klaim-swasta-dan-bayar-mandiri.md) · [Klaim BPJS](../alur/klaim-bpjs.md) |

DeviceDispense adalah resource FHIR R5. Katalog Rawat Inap SATUSEHAT juga mencantumkan `context` dan `whenPrepared` pada profil DeviceDispense, sedangkan definisi dasar R5 memakai `encounter` dan `preparedDate`. Konfirmasi path, canonical profil dan versi yang diterima sebelum mengirim perangkat. NutritionOrder R4 memakai `patient`, dan aditif enteral berupa `enteralFormula.additiveType` dan `enteralFormula.additiveProductName`. Untuk elemen yang menyerupai R5, konfirmasi versi modul dan bentuk payload. [FHIR DeviceDispense R5](https://hl7.org/fhir/R5/devicedispense.html) · [FHIR NutritionOrder R4](https://hl7.org/fhir/R4/nutritionorder.html) · [Rawat Inap dan ALKES](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes)

## Path yang perlu diperiksa

Tabel di bawah mempertahankan ejaan heading resmi agar bisa dicari. Tanda asterik di dalam code span menandai field yang diberi asterik pada materi Kemenkes. Periksa scope dan skenario sebelum menganggapnya wajib.

### Path ditemukan pada R5

| Profil | Path di heading Kemenkes |
| --- | --- |
| [DeviceDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-dispense/) | `identifier`, `*basedOn`, `partOf`, `*status`, `statusReason`, `category`, `*device`, `*subject`, `supportingInformation`, `performer`, `performer.function`, `performer.actor`, `location`, `type`, `quantity`, `whenHandedOver`, `destination`, `note`, `eventHistory` |
| [Goal](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/goal/) | `continuous` |
| [NutritionOrder](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/nutrition-order/) | `basedOn[i]`, `groupIdentifier`, `priority`, `*subject`, `enteralFormula.additive[i].type` |
| [PaymentNotice](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/payment-notice/) | `reporter` |
| [PaymentReconciliation](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/payment-reconciliation/) | `*type`, `kind`, `enterer`, `issuerType` |

### Path yang perlu penafsiran atau konfirmasi extension

| Profil | Path di heading Kemenkes |
| --- | --- |
| [BiologicallyDerivedProduct](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/biologically-derived-product/) | `extension.quantity.valueQuantity`, `extension.statusDetail`, `extension.destructionReason` |
| [ChargeItem](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item/) | `extension.unitPrice`, `extension.totalPrice`, `extension.chargeItemResponse.sequence`, `extension.chargeItemResponse.payor`, `extension.chargeItemResponse.identifier`, `extension.chargeItemResponse.coverage`, `extension.chargeItemResponse.status`, `extension.chargeItemResponse.unitPriceOverride`, `extension.chargeItemResponse.factorOverride`, `extension.chargeItemResponse.overrideReason`, `extension.chargeItemResponse.quantity`, `extension.chargeItemResponse.total`, `extension.chargeItemResponse.excess` |
| [ClinicalImpression](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/clinical-impression/) | `effective.effectiveDateTime`, `effective.effectivePeriod`, `effective.effectivePeriod.start`, `effective.effectivePeriod.end`, `finding.item.CodeableConcept.coding`, `finding.item.CodeableConcept.text` |
| [Composition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/composition/) | `relatesTo.target.targetIdentifier`, `relatesTo.target.targetReference` |
| [Condition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/) | `Period.start`, `Period.end` |
| [Coverage](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage/) | `extension.primaryCareProvider` |
| [CoverageEligibilityResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage-eligibility-response/) | `extension.eligibilityStatus`, `extension.policyClass`, `extension.excesspolicyClass`, `extension.excessStatement` |
| [DeviceDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-dispense/) | `context`, `whenPrepared` |
| [DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/diagnostic-report/) | `resultInterpreter[i]` |
| [Encounter](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/encounter/) | `extension.EncounterToFacility`, `extension.EncounterToSpecialty`, `extension.EncounterToEpisode` |
| [FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/family-member-history/) | `instantiatedUri[i]` |
| [ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/imaging-study/) | `procedureReferences` |
| [Immunization](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/immunization/) | `occurenceDateTime` |
| [Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) | `*extension.serviceClass` |
| [MedicationDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-dispense/) | `dosageInstrution[i].patientInstruction`, `dosageInstruction[i].maxDosePerLifeTime` |
| [MedicationRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-request/) | `dosageInstrution[i].patientInstruction`, `dosageInstruction[i].maxDosePerLifeTime` |
| [NutritionOrder](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/nutrition-order/) | `enteralFormula.additive[i].ProductName` |
| [Observation](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/) | `Period.start`, `Period.end`, `valueBooelean`, `referenceRangeType.coding` |
| [Procedure](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/procedure/) | `Period.start`, `Period.end`, `note[i].note.time`, `note[i].note.text` |
| [RiskAssessment](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/risk-assessment/) | `occurence[x]`, `occurenceDateTime`, `occurencePeriod` |
| [ServiceRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/service-request/) | `*occurenceDateTime`, `occurencePeriod`, `occurencePeriod.start`, `occurencePeriod.end`, `occurenceTiming`, `autheredOn` |
| [Specimen](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/) | `accesssionIdentifier` |
| [Task](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/task/) | `extension.documentName.valueString` |

### Extension bernama dalam heading

| Profil | Path di heading Kemenkes |
| --- | --- |
| [Encounter](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/encounter/) | `location.extension:serviceClass.value`, `location.extension:serviceClass.upgradeClassIndicator` |
| [Medication](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication/) | `*extension:medicationType` |
| [Patient](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/patient/) | `extension:birthPlace` |
| [Specimen](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/) | `*extension:transportedTime`, `extension:transportedPerson`, `extension:ReceivedPerson` |

### Kontrak non-FHIR pada modul

| Profil | Path di heading Kemenkes |
| --- | --- |
| [BillingStatus](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/billing-status/) | `identifier`, `status`, `insurer`, `recipient`, `subject`, `request` |
| [ChargeItemResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item-response/) | `identifier`, `chargeItem`, `coverage`, `subject`, `encounter`, `payor`, `unitPriceOverride`, `factorOverride`, `overrideReason`, `quantity`, `total`, `excess` |
| [PurificationDecision](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/purification-decision/) | `identifier`, `status`, `insurer`, `provider`, `claimResponse`, `created` |
