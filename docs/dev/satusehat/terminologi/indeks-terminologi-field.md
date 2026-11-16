# Indeks terminologi per field

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Standar Terminologi SATUSEHAT](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) (v12.0, rilis 2026-10-31) · [Standar Terminologi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) (disunting 2026-11-06)

[Indeks SATUSEHAT](../README.md) · [Terminologi](README.md) · [Cara memilih system dan code](kontrak-terminologi.md) · [Katalog profil](../payload/inventaris-profil-resource.md)

Snapshot 16 November 2026 dari Standar Terminologi v12.0 (31 Oktober 2026). Tabel menautkan path dengan bab dan nomor halaman tercetak, serta menyebut keluarga terminologi yang muncul pada bagian tersebut. Jika beberapa keluarga disebut, pilih berdasarkan cabang use case dan aturan pada panduan. Tanda — berarti keluarga terminologi tidak terdeteksi secara eksplisit pada bagian itu. Sumber dapat mengarahkan pembaca ke lampiran atau kode lokal. [Dokumen resmi dan riwayat perubahan](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) · [Buku v12.0](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview)

Nomor dan ejaan field mengikuti daftar isi sumber. Beberapa nomor subbab muncul lagi untuk field yang berbeda. Lihat resource, path dan halaman ketika mencocokkannya. Nomor halaman pada PDF viewer dapat bergeser satu dari nomor halaman tercetak. Periksa [Kompatibilitas payload](../payload/kompatibilitas-payload-fhir.md) untuk nama field JSON, tipe pilihan, dan representasi extension.

## Field dan keluarga terminologi

### Organization

Bab 1. Halaman mulai tercetak 43.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 1.1 | `Organization.identifier.use` | HL7 | 43 |
| 1.2 | `Organization.type` | — | 44 |
| 1.3 | `Organization.telecom.system` | HL7 | 45 |
| 1.4 | `Organization.telecom.use` | HL7 | 46 |
| 1.5 | `Organization.address.use` | HL7 | 46 |
| 1.6 | `Organization.address.type` | HL7 | 47 |
| 1.7 | `Organization.contact.purpose` | — | 47 |

### Location

Bab 2. Halaman mulai tercetak 48.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 2.1 | `Location.identifier.use` | HL7 | 48 |
| 2.2 | `Location.status` | HL7 | 49 |
| 2.3 | `Location.operationalStatus` | — | 49 |
| 2.4 | `Location.mode` | HL7 | 50 |
| 2.5 | `Location.type` | — | 50 |
| 2.6 | `Location.telecom.system` | HL7 | 53 |
| 2.7 | `Location.telecom.use` | HL7 | 54 |
| 2.8 | `Location.address.use` | HL7 | 54 |
| 2.9 | `Location.address.type` | HL7 | 55 |
| 2.10 | `Location.physicalType` | — | 55 |
| 2.11 | `Location.hoursOfOperation.daysOfWeek` | HL7 | 57 |
| 2.12 | `Location.extension.serviceClass` | — | 57 |

### Encounter

Bab 3. Halaman mulai tercetak 58.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 3.1 | `Encounter.identifier.use` | HL7 | 58 |
| 3.2 | `Encounter.status` | HL7 | 59 |
| 3.3 | `Encounter.statusHistory.status` | HL7 | 60 |
| 3.4 | `Encounter.class` | — | 61 |
| 3.5 | `Encounter.classHistory.class` | — | 62 |
| 3.7 | `Encounter.priority` | HL7 | 64 |
| 3.8 | `Encounter.participant.type` | — | 65 |
| 3.9 | `Encounter.hospitalization.admitSource` | — | 66 |
| 3.10 | `Encounter.hospitalization.reAdmission` | HL7 | 68 |
| 3.11 | `Encounter.hospitalization.dietPreference` | — | 68 |
| 3.12 | `Encounter.hospitalization.specialArrangement` | — | 69 |
| 3.13 | `Encounter.hospitalization.dischargeDisposition` | SNOMED CT | 70 |
| 3.14 | `Encounter.location.extension.serviceClass.value` | — | 72 |
| 3.15 | `Encounter.location.extension.serviceClass.upgradeClassIndicator` | — | 73 |
| 3.16 | `Encounter.hospitalization.specialCourtesy` | — | 74 |
| 3.17 | `Encounter.serviceType` | — | 75 |
| 3.18 | `Encounter.diagnosis.use` | HL7 | 75 |
| 3.19 | `Encounter.location.status` | HL7 | 76 |
| 3.20 | `Encounter.reasonCode` | SNOMED CT, Kemenkes | 76 |
| 3.21 | `Encounter.type` | SNOMED CT | 76 |
| 3.22 | `Encounter.extension.EncounterToFacility.valueCode` | Kemenkes | 77 |
| 3.23 | `Encounter.extension.EncounterToSpecialty.valueCode` | Kemenkes | 77 |
| 3.24 | `Encounter.extension.EncounterToEpisode.valueCode` | Kemenkes | 78 |

### AllergyIntolerance

Bab 4. Halaman mulai tercetak 78.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 4.1 | `AllergyIntolerance.clinicalStatus` | — | 78 |
| 4.2 | `AllergyIntolerance.verificationStatus` | — | 79 |
| 4.3 | `AllergyIntolerance.type` | HL7 | 80 |
| 4.4 | `AllergyIntolerance.category` | HL7 | 81 |
| 4.5 | `AllergyIntolerance.criticality` | HL7 | 82 |
| 4.6 | `AllergyIntolerance.code` | SNOMED CT, KFA | 82 |
| 4.7 | `AllergyIntolerance.reaction.substance` | SNOMED CT, KFA | 83 |
| 4.8 | `AllergyIntolerance.reaction.manifestation` | SNOMED CT | 84 |
| 4.9 | `AllergyIntolerance.reaction.severity` | HL7 | 85 |

### Observation

Bab 5. Halaman mulai tercetak 86.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 5.1 | `Observation.status` | HL7 | 86 |
| 5.2 | `Observation.category` | — | 87 |
| 5.3 | `Observation.code` | SNOMED CT, LOINC | 89 |
| 5.4 | `Observation.valueQuantity` | UCUM | 91 |
| 5.5 | `Observation.valueCodeableConcept` | SNOMED CT, LOINC | 91 |
| 5.6 | `Observation.dataAbsentReason` | LOINC | 91 |
| 5.7 | `Observation.interpretation` | SNOMED CT | 94 |
| 5.8 | `Observation.referenceRangeType` | — | 94 |
| 5.9 | `Observation.bodySite` | SNOMED CT | 96 |
| 5.10 | `Observation.component.code` | SNOMED CT, LOINC | 96 |
| 5.11 | `Observation.component.valueCodeableConcept` | SNOMED CT, LOINC, Kemenkes | 97 |
| 5.12 | `Observation.method` | SNOMED CT | 97 |
| 5.13 | `Observation.component.interpretation` | SNOMED CT, LOINC | 98 |
| 5.14 | `Observation.interpretation.code` | SNOMED CT, LOINC | 98 |
| 5.15 | `Observation.component.valueQuantity` | UCUM | 98 |

### Procedure

Bab 6. Halaman mulai tercetak 99.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 6.1 | `Procedure.status` | HL7 | 99 |
| 6.2 | `Procedure.category` | SNOMED CT | 99 |
| 6.3 | `Procedure.code` | SNOMED CT, ICD-9-CM, Kemenkes, HL7 | 100 |
| 6.4 | `Procedure.reasonCode` | SNOMED CT, ICD-10 | 103 |
| 6.5 | `Procedure.outcome` | SNOMED CT | 104 |
| 6.6 | `Procedure.complication` | ICD-10, HL7 | 104 |
| 6.7 | `Procedure.bodySite` | SNOMED CT | 104 |
| 6.8 | `Procedure.focalDevice.action` | SNOMED CT | 105 |
| 6.9 | `Procedure.followUp` | SNOMED CT | 105 |
| 6.10 | `Procedure.performer.function` | SNOMED CT, Kemenkes | 105 |

### Medication

Bab 7. Halaman mulai tercetak 106.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 7.1 | `Medication.code` | KFA | 106 |
| 7.2 | `Medication.status` | HL7 | 106 |
| 7.3 | `Medication.form` | — | 106 |
| 7.4 | `Medication.ingredient.itemCodeableConcept` | KFA | 116 |
| 7.5 | `Medication.ingredient.strength.numerator` | UCUM | 117 |
| 7.6 | `Medication.ingredient.strength.denominator` | SNOMED CT, UCUM, HL7 | 117 |
| 7.7 | `Medication.extension:medicationType` | — | 132 |

### MedicationRequest

Bab 8. Halaman mulai tercetak 133.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 8.1 | `MedicationRequest.status` | HL7 | 133 |
| 8.2 | `MedicationRequest.statusReason` | HL7 | 134 |
| 8.3 | `MedicationRequest.intent` | HL7 | 135 |
| 8.4 | `MedicationRequest.category` | — | 136 |
| 8.5 | `MedicationRequest.priority` | HL7 | 137 |
| 8.6 | `MedicationRequest.reasonCode` | SNOMED CT, ICD-10, HL7 | 138 |
| 8.7 | `MedicationRequest.courseOfTherapyType` | HL7 | 138 |
| 8.8 | `MedicationRequest.dosageInstruction.timing.repeat.durationUnit` | UCUM | 139 |
| 8.9 | `MedicationRequest.dosageInstruction.timing.repeat.periodUnit` | UCUM | 140 |
| 8.10 | `MedicationRequest.dosageInstruction.timing.repeat.when` | HL7 | 141 |
| 8.11 | `MedicationRequest.dosageInstruction.timing.code` | — | 143 |
| 8.12 | `MedicationRequest.dosageInstruction.route` | — | 146 |
| 8.13 | `MedicationRequest.dosageInstruction.doseAndRate.type` | HL7 | 149 |
| 8.14 | `MedicationRequest.dosageInstruction.doseAndRate.doseRange` | — | 149 |
| 8.15 | `MedicationRequest.dosageInstruction.doseAndRate.doseQuantity` | — | 150 |
| 8.16 | `MedicationRequest.dosageInstruction.doseAndRate.rateRatio` | — | 150 |
| 8.17 | `MedicationRequest.dosageInstruction.doseAndRate.rateRange` | — | 150 |
| 8.18 | `MedicationRequest.dosageInstruction.doseAndRate.rateQuantity` | — | 150 |
| 8.19 | `MedicationRequest.dispenseRequest.dispenseInterval` | UCUM | 151 |
| 8.20 | `MedicationRequest.dispenseRequest.quantity` | — | 151 |
| 8.21 | `MedicationRequest.dispenseRequest.expectedSupplyDuration` | UCUM | 152 |
| 8.22 | `MedicationRequest.substitution.allowedCodeableConcept` | — | 152 |
| 8.23 | `MedicationRequest.substitution.reason` | — | 155 |
| 8.24 | `MedicationRequest.dosageInstruction.additionalInstruction` | SNOMED CT | 156 |
| 8.25 | `MedicationRequest.dosageInstruction.method` | SNOMED CT | 156 |

### MedicationDispense

Bab 9. Halaman mulai tercetak 157.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 9.1 | `MedicationDispense.status` | — | 157 |
| 9.2 | `MedicationDispense.category` | — | 158 |
| 9.3 | `MedicationDispense.performer.function` | — | 158 |
| 9.4 | `MedicationDispense.quantity` | SNOMED CT, HL7 | 159 |
| 9.5 | `MedicationDispense.dosageInstruction.timing.repeat.durationUnit` | UCUM | 174 |
| 9.6 | `MedicationDispense.daysSupply` | UCUM | 175 |
| 9.7 | `MedicationDispense.dosageInstruction.timing.repeat.periodUnit` | UCUM | 175 |
| 9.8 | `MedicationDispense.dosageInstruction.timing.repeat.when` | HL7 | 176 |
| 9.9 | `MedicationDispense.dosageInstruction.timing.code` | — | 178 |
| 9.10 | `MedicationDispense.dosageInstruction.route` | — | 181 |
| 9.11 | `MedicationDispense.dosageInstruction.doseAndRate.type` | HL7 | 184 |
| 9.12 | `MedicationDispense.dosageInstruction.doseAndRate.doseRange` | — | 184 |
| 9.13 | `MedicationDispense.dosageInstruction.doseAndRate.doseQuantity` | — | 185 |
| 9.14 | `MedicationDispense.dosageInstruction.doseAndRate.rateRatio` | — | 185 |
| 9.15 | `MedicationDispense.dosageInstruction.doseAndRate.rateRange` | — | 185 |
| 9.16 | `MedicationDispense.substitution.type` | — | 185 |
| 9.17 | `MedicationDispense.substitution.reason` | — | 187 |
| 9.18 | `MedicationDispense.dosageInstruction.additionalInstruction.coding.code` | SNOMED CT | 189 |
| 9.19 | `MedicationDispense.identifier` | Kemenkes | 189 |

### Condition

Bab 10. Halaman mulai tercetak 190.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 10.1 | `Condition.clinicalStatus` | — | 190 |
| 10.2 | `Condition.verificationStatus` | — | 191 |
| 10.3 | `Condition.category` | — | 192 |
| 10.4 | `Condition.severity` | SNOMED CT | 192 |
| 10.5 | `Condition.code` | SNOMED CT, ICD-10, Kemenkes, HL7 | 193 |
| 10.6 | `Condition.bodySite` | SNOMED CT | 201 |
| 10.7 | `Condition.evidence` | SNOMED CT | 201 |
| 10.8 | `Condition.stage.summary` | SNOMED CT | 202 |
| 10.9 | `Condition.stage` | SNOMED CT | 203 |

### Composition

Bab 11. Halaman mulai tercetak 204.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 11.1 | `Composition.status` | HL7 | 204 |
| 11.2 | `Composition.type` | SNOMED CT, LOINC | 205 |
| 11.3 | `Composition.category` | LOINC | 205 |
| 11.4 | `Composition.confidentiality` | — | 210 |
| 11.5 | `Composition.attester.mode` | HL7 | 211 |
| 11.6 | `Composition.relatesTo.code` | HL7 | 212 |
| 11.7 | `Composition.section.code` | LOINC | 212 |
| 11.8 | `Composition.section.text.status` | HL7 | 212 |
| 11.9 | `Composition.section.mode` | HL7 | 213 |
| 11.10 | `Composition.section.orderedBy` | — | 214 |
| 11.11 | `Composition.section.emptyReason` | — | 215 |
| 11.12 | `Composition.contained.location.type` | — | 215 |
| 11.13 | `Composition.type.coding` | LOINC, Kemenkes | 216 |
| 11.13 | `Composition.section.section.code` | LOINC, Kemenkes | 217 |

### ClinicalImpression

Bab 12. Halaman mulai tercetak 218.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 12.1 | `ClinicalImpression.status` | HL7 | 218 |
| 12.2 | `Clinicallimpression.finding.itemCodeableConcept` | ICD-10, HL7 | 218 |
| 12.3 | `Clinicallimpression.prognosisCodeableConcept` | SNOMED CT, Kemenkes | 219 |
| 12.4 | `ClinicalImpression.investigation.code` | SNOMED CT | 220 |

### ServiceRequest

Bab 13. Halaman mulai tercetak 220.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 13.1 | `ServiceRequest.status` | HL7 | 220 |
| 13.2 | `ServiceRequest.intent` | HL7 | 222 |
| 13.3 | `ServiceRequest.category` | SNOMED CT | 224 |
| 13.4 | `ServiceRequest.priority` | HL7 | 224 |
| 13.5 | `ServiceRequest.code` | SNOMED CT, LOINC | 225 |
| 13.6 | `ServiceRequest.asNeededCodeableConcept` | ICD-10, HL7 | 225 |
| 13.7 | `ServiceRequest.locationCode` | HL7 | 225 |
| 13.8 | `ServiceRequest.reasonCode` | SNOMED CT, ICD-10, HL7 | 226 |
| 13.9 | `ServiceRequest.bodySite` | SNOMED CT | 226 |
| 13.10 | `ServiceRequest.orderDetail` | SNOMED CT | 227 |
| 13.11 | `ServiceRequest.code.coding` | SNOMED CT, LOINC | 227 |
| 13.12 | `ServiceRequest.identifier` | Kemenkes | 228 |
| 13.13 | `ServiceRequest.performerType` | SNOMED CT | 228 |

### Specimen

Bab 14. Halaman mulai tercetak 228.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 14.1 | `Specimen.status` | HL7 | 228 |
| 14.2 | `Specimen.type` | SNOMED CT | 229 |
| 14.3 | `Specimen.collection.method` | SNOMED CT | 229 |
| 14.4 | `Specimen.collection.fastingStatusCodeableConcept` | — | 230 |
| 14.5 | `Specimen.condition` | — | 231 |
| 14.6 | `Specimen.collection.bodySite` | SNOMED CT | 232 |
| 14.7 | `Specimen.container.additive` | — | 232 |
| 14.8 | `Specimen.processing.procedure.CodeableConcept` | SNOMED CT | 238 |
| 14.9 | `Specimen.extension.conditionHistory.extension.status` | Kemenkes | 238 |
| 14.10 | `Specimen.extension.conditionHistory.extension.condition.valueCodeableConcept` | SNOMED CT, Kemenkes | 239 |
| 14.11 | `Specimen.type.coding` | SNOMED CT | 239 |

### DiagnosticReport

Bab 15. Halaman mulai tercetak 240.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 15.1 | `DiagnosticReport.status` | HL7 | 240 |
| 15.2 | `DiagnosticReport.category` | HL7 | 242 |
| 15.3 | `DiagnosticReport.code` | LOINC, HL7 | 245 |
| 15.4 | `DiagnosticReport.conclusionCode` | SNOMED CT | 245 |

### EpisodeOfCare

Bab 16. Halaman mulai tercetak 245.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 16.1 | `EpisodeOfCare.status` | HL7 | 245 |
| 16.2 | `EpisodeOfCare.statusHistory.status` | HL7 | 246 |
| 16.3 | `EpisodeOfCare.type` | HL7 | 247 |
| 16.4 | `EpisodeOfCare.diagnosis.role` | HL7 | 248 |

### Immunization

Bab 17. Halaman mulai tercetak 249.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 17.1 | `Immunization.status` | HL7 | 249 |
| 17.2 | `Immunization.statusReason` | — | 249 |
| 17.3 | `Immunization.vaccineCode` | KFA, HL7 | 250 |
| 17.4 | `Immunization.reportOrigin` | — | 264 |
| 17.5 | `Immunization.site` | HL7 | 264 |
| 17.6 | `Immunization.route` | — | 265 |
| 17.7 | `Immunization.performer.function` | HL7 | 268 |
| 17.8 | `Immunization.reasonCode` | — | 268 |
| 17.9 | `Immunization.fundingSource` | — | 271 |

### QuestionnaireResponse

Bab 18. Halaman mulai tercetak 271.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 18.1 | `QuestionnaireResponse.status` | HL7 | 271 |
| 18.2 | `QuestionnaireResponse.item.item.answer.valueCoding` | SNOMED CT | 272 |
| 18.3 | `QuestionnaireResponse.item.answer.valueCoding` | SNOMED CT | 272 |
| 18.4 | `QuestionnaireResponse.questionnaire` | — | 272 |
| 18.5 | `QuestionnaireResponse.item.answer.item.answer.valueCoding` | SNOMED CT, LOINC | 273 |
| 18.6 | `QuestionnaireResponse.item.valueCoding` | SNOMED CT | 273 |

### CarePlan

Bab 19. Halaman mulai tercetak 273.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 19.1 | `CarePlan.status` | HL7 | 273 |
| 19.2 | `CarePlan.intent` | HL7 | 275 |
| 19.3 | `CarePlan.category` | SNOMED CT | 276 |
| 19.4 | `CarePlan.activity.detail.kind` | HL7 | 277 |
| 19.5 | `CarePlan.activity.detail.code.coding` | — | 277 |

### MedicationStatement

Bab 20. Halaman mulai tercetak 277.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 20.1 | `MedicationStatement.status` | HL7 | 277 |
| 20.2 | `MedicationStatement.medicationCodeableConcept` | KFA | 278 |
| 20.3 | `MedicationStatement.category` | HL7 | 278 |

### Coverage

Bab 21. Halaman mulai tercetak 279.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 21.1 | `Coverage.status` | HL7 | 279 |
| 21.2 | `Coverage.type` | HL7 | 279 |
| 21.3 | `Coverage.relationship` | HL7 | 283 |
| 21.4 | `Coverage.class.type` | HL7 | 283 |
| 21.5 | `Coverage.class.value` | SNOMED CT | 284 |
| 21.6 | `Coverage.costToBeneficiary.type` | HL7 | 286 |
| 21.7 | `Coverage.costToBeneficiary.exception.type` | HL7 | 287 |

### CoverageEligibilityRequest

Bab 22. Halaman mulai tercetak 288.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 22.1 | `CoverageEligibilityRequest.status` | HL7 | 288 |
| 22.2 | `CoverageEligibilityRequest.priority` | HL7 | 288 |
| 22.3 | `CoverageEligibilityRequest.purpose` | HL7 | 289 |
| 22.4 | `CoverageEligibilityRequest.item.category` | HL7 | 289 |
| 22.5 | `CoverageEligibilityRequest.item.productOrService` | HL7 | 291 |
| 22.6 | `CoverageEligibilityRequest.item.modifier` | HL7 | 293 |

### CoverageEligibilityResponse

Bab 23. Halaman mulai tercetak 294.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 23.1 | `CoverageEligibilityResponse.identifier.type` | HL7 | 294 |
| 23.2 | `CoverageEligibilityResponse.status` | HL7 | 295 |
| 23.3 | `CoverageEligibilityResponse.purpose` | HL7 | 296 |
| 23.4 | `CoverageEligibilityResponse.outcome` | HL7 | 296 |
| 23.5 | `CoverageEligibilityResponse.insurance.item.category` | HL7 | 297 |
| 23.6 | `CoverageEligibilityResponse.insurance.item.productOrService` | HL7 | 299 |
| 23.7 | `CoverageEligibilityResponse.insurance.item.modifier` | HL7 | 301 |
| 23.8 | `CoverageEligibilityResponse.insurance.item.network` | HL7 | 301 |
| 23.9 | `CoverageEligibilityResponse.insurance.item.unit` | HL7 | 302 |
| 23.10 | `CoverageEligibilityResponse.insurance.item.term` | HL7 | 302 |
| 23.11 | `CoverageEligibilityResponse.insurance.item.benefit.type` | HL7 | 303 |
| 23.12 | `CoverageEligibilityResponse.insurance.item.authorizationSupporting` | HL7 | 304 |
| 23.13 | `CoverageEligibilityResponse.error.code` | HL7 | 305 |

### Account

Bab 24. Halaman mulai tercetak 305.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 24.1 | `Account.status` | HL7 | 305 |
| 24.2 | `Account.type` | HL7 | 306 |

### ChargeItem

Bab 25. Halaman mulai tercetak 306.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 25.1 | `ChargeItem.identifier` | Kemenkes | 306 |
| 25.2 | `ChargeItem.status` | HL7 | 308 |
| 25.3 | `ChargeItem.code` | KFA | 309 |
| 25.4 | `ChargeItem.extension.chargeItemResponse.status` | Kemenkes | 311 |

### Invoice

Bab 26. Halaman mulai tercetak 311.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 26.1 | `Invoice.status` | HL7 | 311 |
| 26.2 | `Invoice.lineItem.priceComponent.type` | HL7 | 312 |
| 26.3 | `Invoice.lineItem.priceComponent.code` | Kemenkes | 312 |

### Claim

Bab 27. Halaman mulai tercetak 313.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 27.1 | `Claim.status` | HL7 | 313 |
| 27.2 | `Claim.type` | HL7 | 313 |
| 27.3 | `Claim.subType` | HL7 | 313 |
| 27.4 | `Claim.use` | HL7 | 314 |
| 27.5 | `Claim.priority` | HL7 | 314 |
| 27.6 | `Claim.fundsReserve` | HL7 | 314 |
| 27.7 | `Claim.related.relationship` | HL7 | 315 |
| 27.8 | `Claim.payee.type` | HL7 | 315 |
| 27.9 | `Claim.careTeam.role` | HL7 | 315 |
| 27.10 | `Claim.careTeam.qualification` | HL7 | 316 |
| 27.11 | `Claim.supportingInfo.category` | Kemenkes, HL7 | 316 |
| 27.12 | `Claim.supportingInfo.code` | Kemenkes, HL7 | 318 |
| 27.13 | `Claim.diagnosis.type` | HL7 | 318 |
| 27.14 | `Claim.extension.package.tariffClass.valueCodeableConcept` | Kemenkes | 319 |
| 27.15 | `Claim.extension.package.basePackage.valueCodeableConcept` | — | 321 |
| 27.16 | `Claim.extension.package.additionalPackage.valueCodeableConcept` | — | 321 |

### ClaimResponse

Bab 28. Halaman mulai tercetak 322.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 28.1 | `ClaimResponse.status` | HL7 | 322 |
| 28.2 | `ClaimResponse.type` | HL7 | 322 |
| 28.3 | `ClaimResponse.subType` | HL7 | 322 |
| 28.4 | `ClaimResponse.use` | HL7 | 323 |
| 28.5 | `ClaimResponse.outcome` | HL7 | 323 |
| 28.6 | `ClaimResponse.payeeType` | HL7 | 324 |
| 28.7 | `ClaimResponse.adjudication.category` | SNOMED CT, Kemenkes, HL7 | 324 |
| 28.8 | `ClaimResponse.adjudication.reason` | Kemenkes | 325 |
| 28.9 | `ClaimResponse.item.adjudication.category` | Kemenkes | 326 |

### FamilyMemberHistory

Bab 29. Halaman mulai tercetak 326.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 29.1 | `FamilyMemberHistory.status` | HL7 | 326 |
| 29.2 | `FamilyMemberHistory.relationship` | — | 326 |
| 29.3 | `FamilyMemberHistory.condition.code` | SNOMED CT, Kemenkes | 327 |

### DocumentReference

Bab 30. Halaman mulai tercetak 327.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 30.1 | `DocumentReference.content.format` | Kemenkes | 327 |
| 30.1 | `DocumentReference.type` | LOINC, Kemenkes | 328 |

### NutritionOrder

Bab 31. Halaman mulai tercetak 328.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 31.1 | `NutritionOrder.enteralFormula.baseFormulaType` | SNOMED CT | 328 |
| 31.2 | `NutritionOrder.enteralFormula.routeofAdministration` | HL7 | 329 |
| 31.3 | `NutritionOrder.oralDiet.nutrient.modifier` | SNOMED CT | 330 |
| 31.4 | `NutritionOrder.oralDiet.type` | SNOMED CT | 330 |
| 31.5 | `NutritionOrder.enteralFormula.administration.quantity` | UCUM | 330 |
| 31.6 | `NutritionOrder.enteralFormula.administration.rateQuantity` | UCUM | 331 |
| 31.7 | `NutritionOrder.enteralFormula.administration.rateRatio` | UCUM | 331 |
| 31.8 | `NutritionOrder.enteralFormula.caloricDensity` | UCUM | 331 |
| 31.9 | `NutritionOrder.enteralFormula.maxVolumeToDeliver` | UCUM | 331 |
| 31.10 | `NutritionOrder.oralDiet.nutrient.amount` | UCUM | 332 |
| 31.11 | `NutritionOrder.oralDiet.texture.modifier` | SNOMED CT | 332 |

### RelatedPerson

Bab 32. Halaman mulai tercetak 332.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 32.1 | `RelatedPerson.relationship` | Kemenkes, HL7 | 332 |
| 32.2 | `RelatedPerson.telecom.system` | HL7 | 332 |
| 32.2 | `RelatedPerson.telecom.use` | HL7 | 333 |

### Substance

Bab 33. Halaman mulai tercetak 333.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 33.1 | `Substance.status` | HL7 | 333 |
| 33.2 | `Substance.category.CodeableConcept` | HL7 | 333 |
| 33.3 | `Substance.code.CodeableConcept` | SNOMED CT | 334 |

### VisionPrescription

Bab 34. Halaman mulai tercetak 334.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 34.1 | `VisionPrescription.lensSpecification.eye` | HL7 | 334 |
| 34.2 | `VisionPrescription.lensSpecification.product` | HL7 | 334 |

### Patient

Bab 35. Halaman mulai tercetak 335.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 35.1 | `Patient.extension.disability.valueCodeableConcept.coding` | SNOMED CT, HL7 | 335 |
| 35.2 | `Patient.extension.education.level.valueCodeableConcept` | SNOMED CT, Kemenkes | 336 |
| 35.3 | `Patient.adress.use` | HL7 | 336 |
| 35.4 | `Patient.gender` | HL7 | 336 |
| 35.5 | `Patient.extension.occupation.valueCodeableConcept.coding` | — | 337 |
| 35.6 | `Patient.extension:Religion.valueCodeableConcept` | SNOMED CT, HL7 | 337 |
| 35.7 | `Patient.contact.relationship.coding` | HL7 | 338 |
| 35.8 | `Patient.contact.name.use` | HL7 | 338 |
| 35.9 | `Patient.contact.telecom.system` | HL7 | 338 |
| 35.10 | `Patient.contact.telecom.use` | HL7 | 339 |
| 35.11 | `Patient.maritalStatus` | HL7 | 339 |

### Bundle

Bab 36. Halaman mulai tercetak 339.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 36.1 | `Bundle.meta.tag` | Kemenkes | 339 |

### Task

Bab 37. Halaman mulai tercetak 340.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 37.1 | `Task.code.coding` | SNOMED CT, Kemenkes | 340 |
| 37.2 | `Task.input.type.coding` | SNOMED CT, Kemenkes | 340 |
| 37.3 | `Task.input.valueCoding` | SNOMED CT, ICD-10, ICD-9-CM, Kemenkes, HL7 | 341 |
| 37.4 | `Task.output.type.coding` | Kemenkes, HL7 | 343 |
| 37.5 | `Task.output.valueCoding` | HL7 | 343 |
| 37.6 | `Task.output.extension.providerAtribute.distance.valueQuantity.unit` | UCUM, Kemenkes | 343 |

### PractitionerRole

Bab 38. Halaman mulai tercetak 344.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 38.1 | `PractitionerRole.identifier.system` | — | 344 |
| 38.2 | `PractitionerRole.identifier.use` | HL7 | 344 |
| 38.3 | `PractitionerRole.code.coding` | SNOMED CT | 344 |
| 38.4 | `PractitionerRole.specialty.coding` | SNOMED CT | 345 |
| 38.5 | `PractitionerRole.telecom.system` | HL7 | 345 |
| 38.6 | `PractitionerRole.telecom.use` | HL7 | 345 |
| 38.7 | `PractitionerRole.availableTime.daysOfWeek` | HL7 | 346 |
| 38.8 | `PractitionerRole.extension.workStatus.valueCodeableConcept.coding` | SNOMED CT, Kemenkes | 346 |
| 38.9 | `PractitionerRole.identifier.type.coding` | Kemenkes | 347 |
| 38.10 | `PractitionerRole.extension.education.major.valueCodeableConcept.coding` | — | 347 |
| 38.11 | `PractitionerRole.extension.education.university.valueCodeableConcept.coding` | — | 348 |
| 38.12 | `PractitionerRole.extension.education.degree.valueCodeableConcept.coding` | — | 348 |

### HealthcareService

Bab 39. Halaman mulai tercetak 348.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 39.1 | `HealthcareService.type` | — | 348 |
| 39.2 | `HealthcareService.specialty` | — | 348 |
| 39.3 | `HealthcareService.characteristic` | Kemenkes | 349 |
| 39.4 | `HealthcareService.telecom.use` | HL7 | 349 |
| 39.5 | `HealthcareService.telecom.system` | HL7 | 349 |

### Schedule

Bab 40. Halaman mulai tercetak 350.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 40.1 | `Schedule.serviceType.coding` | — | 350 |
| 40.2 | `Schedule.specialty.coding` | — | 350 |
| 40.3 | `Schedule.actor` | — | 350 |

### Slot

Bab 41. Halaman mulai tercetak 350.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 41.1 | `Slot.status` | HL7 | 350 |
| 41.2 | `Slot.appoinmentType` | HL7 | 351 |

### Appointment

Bab 42. Halaman mulai tercetak 351.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 42.1 | `Appointment.status` | HL7 | 351 |
| 42.2 | `Appointment.serviceType` | — | 352 |
| 42.3 | `Appointment.appointmentType` | HL7 | 352 |
| 42.4 | `Appointment.participant.status` | HL7 | 352 |

### AppointmentResponse

Bab 43. Halaman mulai tercetak 353.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 43.1 | `AppointmentResponse.participantStatus` | HL7 | 353 |

### Device

Bab 44. Halaman mulai tercetak 353.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 44.1 | `Device.type` | KFA, Kemenkes | 353 |
| 44.2 | `Device.contact.system` | HL7 | 353 |
| 44.3 | `Device.status` | HL7 | 354 |
| 44.4 | `Device.statusReason` | HL7 | 354 |
| 44.5 | `Device.deviceName.type` | HL7 | 355 |

### DeviceDispense

Bab 45. Halaman mulai tercetak 355.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 45.1 | `DeviceDispense.status` | HL7 | 355 |

### DeviceRequest

Bab 46. Halaman mulai tercetak 355.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 46.1 | `DeviceRequest.status` | HL7 | 355 |
| 46.2 | `DeviceRequest.intent` | HL7 | 356 |
| 46.3 | `DeviceRequest.priority` | HL7 | 356 |

### DeviceUseStatement

Bab 46. Halaman mulai tercetak 356.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 46.1 | `DeviceUseStatement.status` | HL7 | 356 |

### SupplyRequest

Bab 47. Halaman mulai tercetak 357.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 47.1 | `SupplyRequest.status` | HL7 | 357 |
| 47.2 | `SupplyRequest.category` | HL7 | 357 |
| 47.3 | `SupplyRequest.priority` | HL7 | 357 |
| 47.4 | `SupplyRequest.reasonCode` | HL7 | 358 |

### Communication

Bab 48. Halaman mulai tercetak 358.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 48.1 | `Communication.status` | HL7 | 358 |
| 48.2 | `Communication.category` | HL7 | 358 |

### CommunicationRequest

Bab 49. Halaman mulai tercetak 359.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 49.1 | `CommunicationRequest.status` | HL7 | 359 |
| 49.2 | `CommunicationRequest.category` | HL7 | 359 |

### Consent

Bab 50. Halaman mulai tercetak 360.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 50.1 | `Consent.status` | HL7 | 360 |
| 50.2 | `Consent.scope.coding` | Kemenkes, HL7 | 360 |
| 50.3 | `Consent.category.coding` | LOINC, Kemenkes, HL7 | 361 |
| 50.4 | `Consent.policyRule.coding` | HL7 | 362 |
| 50.5 | `Consent.provision.type` | HL7 | 364 |
| 50.6 | `Consent.provision.action.coding` | HL7 | 364 |
| 50.7 | `Consent.provision.securityLabel.coding` | — | 365 |
| 50.8 | `Consent.provision.purpose.coding` | — | 365 |
| 50.9 | `Consent.provision.data.meaning` | HL7 | 365 |
| 50.10 | `Consent.provision.actor.role` | — | 366 |

### Provenance

Bab 51. Halaman mulai tercetak 366.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 51.1 | `Provenance.reason.coding` | — | 366 |
| 51.2 | `Provenance.activity.coding` | — | 366 |
| 51.3 | `Provenance.agent.type.coding` | HL7 | 366 |
| 51.4 | `Provenance.agent.role.coding` | — | 367 |
| 51.5 | `Provenance.entity.role` | HL7 | 367 |
| 51.6 | `Provenance.signature.targetFormat` | — | 368 |
| 51.7 | `Provenance.signature.sigFormat` | — | 368 |
| 51.8 | `Provenance.signature.type` | — | 369 |
| 51.9 | `Provenance.extension.signature-provider.valueCodeableConcept.coding` | Kemenkes | 369 |

### BiologicallyDerivedProduct

Bab 52. Halaman mulai tercetak 370.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 52.1 | `BiologicallyDerivedProduct.identifier` | — | 370 |
| 52.2 | `BiologicallyDerivedProduct.status` | HL7 | 370 |
| 52.3 | `BiologicallyDerivedProduct.productCategory` | HL7 | 370 |
| 52.4 | `BiologicallyDerivedProduct.productCode` | — | 371 |
| 52.5 | `BiologicallyDerivedProduct.collection.source` | — | 371 |
| 52.6 | `BiologicallyDerivedProduct.extension.quantity.valueQuantity` | UCUM | 371 |
| 52.7 | `BiologicallyDerivedProduct.extension.statusDetail` | SNOMED CT | 372 |
| 52.8 | `BiologicallyDerivedProduct.extension.destructionReason` | SNOMED CT, Kemenkes | 372 |

### BodyStructure

Bab 53. Halaman mulai tercetak 373.

| Subbab | Field di sumber | Keluarga yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 53.1 | `BodyStructure.location` | — | 373 |
| 53.2 | `BodyStructure.locationQualifier` | SNOMED CT, LOINC, HL7 | 373 |

## Akar konsep pada bagian ECL

Operator dan concept ID di bawah adalah penanda lokasi ekspresi pada buku. Beberapa ekspresi memakai kombinasi, filter atribut, atau pengecualian. Gunakan ekspresi lengkap dan edisi SNOMED CT yang dinyatakan di sumber untuk menilai keanggotaan.

| Subbab | Field | Operator dan akar konsep yang disebut | Halaman tercetak |
| --- | --- | --- | ---: |
| 4.6 | `AllergyIntolerance.code` | `< 105590001`, `<< 410942007`, `<< 787859002`, `<< 716186003` | 82 |
| 4.7 | `AllergyIntolerance.reaction.substance` | `< 105590001`, `<< 410942007`, `<< 787859002`, `<< 716186003` | 83 |
| 5.9 | `Observation.bodySite` | `< 123037004` | 96 |
| 6.3 | `Procedure.code` | `< 71388002`, `< 416940007` | 100 |
| 6.7 | `Procedure.bodySite` | `< 123037004` | 104 |
| 8.6 | `MedicationRequest.reasonCode` | `< 404684003` | 138 |
| 8.24 | `MedicationRequest.dosageInstruction.additionalInstruction` | `< 419492006` | 156 |
| 9.18 | `MedicationDispense.dosageInstruction.additionalInstruction.coding.code` | `< 419492006` | 189 |
| 10.5 | `Condition.code` | `< 404684003`, `< 417662000`, `< 443508001`, `< 416471007`, `< 300893006`, `< 116336009` | 193 |
| 10.6 | `Condition.bodySite` | `< 123037004` | 201 |
| 11.2 | `Composition.type` | `< 71388002` | 205 |
| 13.5 | `ServiceRequest.code` | `< 71388002` | 225 |
| 13.9 | `ServiceRequest.bodySite` | `< 123037004` | 226 |
| 13.11 | `ServiceRequest.code.coding` | `< 71388002` | 227 |
| 14.2 | `Specimen.type` | `< 123038009` | 229 |
| 14.6 | `Specimen.collection.bodySite` | `< 123037004` | 232 |
| 14.8 | `Specimen.processing.procedure.CodeableConcept` | `< 9265001` | 238 |
| 15.4 | `DiagnosticReport.conclusionCode` | `< 404684003` | 245 |
| 19.3 | `CarePlan.category` | `< 734163000` | 276 |
| 31.1 | `NutritionOrder.enteralFormula.baseFormulaType` | `< 346415002` | 328 |
| 31.3 | `NutritionOrder.oralDiet.nutrient.modifier` | `< 226355009` | 330 |
| 31.4 | `NutritionOrder.oralDiet.type` | `< 41829006` | 330 |
| 33.3 | `Substance.code.CodeableConcept` | `< 105590001` | 334 |
| 38.3 | `PractitionerRole.code.coding` | `< 223366009` | 344 |
| 38.4 | `PractitionerRole.specialty.coding` | `< 394658006` | 345 |

[Buku Standar Terminologi v12.0](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview)
