# Indeks contoh payload SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Kontrak per operasi](../endpoint/kontrak-operasi-api.md) · [Katalog profil dan field](inventaris-profil-resource.md)

Semua profil pada snapshot 16 November 2026 memiliki setidaknya satu contoh objek lokal. Tautan mengarah ke bagian dengan contoh input atau balikan. Paket contoh berisi fixture sintetis dan memakai placeholder untuk identitas, pengenal server, kode yang bergantung pada skenario, dan URL yang belum tersedia. Contoh bentuk FHIR diperiksa berdasarkan struktur dasarnya. Uji penerimaan mengikuti profil aktif, terminologi, hak akses dan prasyarat program.

Mulai dari jenis resource dan baca panduan skenario di sekitar contoh. Untuk langkah kirim yang melibatkan ID resource lain, buat atau resolve rujukan yang sah lebih dahulu. Pakai [bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti) untuk membedakan respons yang pernah diterima dari contoh sintetis.

[Paket contoh](#paket-contoh) · [Profil resource Kemenkes](#profil-resource-kemenkes) · [Tipe yang digunakan melalui katalog operasi atau panduan modul](#tipe-yang-digunakan-melalui-katalog-operasi-atau-panduan-modul) · [Payload dengan protokol khusus](#payload-dengan-protokol-khusus)

## Paket contoh

- [Rawat Jalan](contoh-rawat-jalan-dan-farmasi.md) memuat payload utama identitas kunjungan, pemeriksaan, tindakan, resume dan farmasi.
- [Layanan klinis](contoh-klinis.md) memuat riwayat, penilaian, rencana, diet, persetujuan, dan resep lensa.
- [Penunjang dan logistik](contoh-penunjang-dan-logistik.md) memuat sampel, citra, dokumen, alat dan pengiriman persediaan.
- [Pembiayaan dan klaim](contoh-pembiayaan.md) memuat kepesertaan, tarif, invoice, klaim, pembayaran dan data penjamin.

## Profil resource Kemenkes

| Resource | Contoh lokal | Bentuk |
| --- | --- | --- |
| `Account` | [Contoh](klaim-bpjs.md#matriks-q0006-dan-sumber-registrasi-sep) | FHIR R4 |
| `AllergyIntolerance` | [Contoh](contoh-klinis.md#allergyintolerance) | FHIR R4 |
| `BillingStatus` | [Contoh](contoh-pembiayaan.md#billingstatus) | Potongan JSON non-FHIR |
| `BiologicallyDerivedProduct` | [Contoh](contoh-penunjang-dan-logistik.md#biologicallyderivedproduct) | FHIR R4 |
| `BodyStructure` | [Contoh](contoh-klinis.md#bodystructure) | FHIR R4 |
| `CarePlan` | [Contoh](contoh-klinis.md#careplan) | FHIR R4 |
| `ChargeItem` | [Contoh](contoh-pembiayaan.md#chargeitem) | FHIR R4 |
| `ChargeItemDefinition` | [Contoh](contoh-pembiayaan.md#chargeitemdefinition) | FHIR R4 |
| `ChargeItemResponse` | [Contoh](contoh-pembiayaan.md#chargeitemresponse) | Potongan JSON non-FHIR |
| `Claim` | [Contoh](contoh-pembiayaan.md#claim) | FHIR R4 |
| `ClaimResponse` | [Contoh](contoh-pembiayaan.md#claimresponse) | FHIR R4 |
| `ClinicalImpression` | [Contoh](contoh-klinis.md#clinicalimpression) | FHIR R4 |
| `Composition` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#resume-medis) | FHIR R4 |
| `Condition` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#tanda-vital-dan-diagnosis) | FHIR R4 |
| `Consent` | [Contoh](contoh-klinis.md#consent) | FHIR R4 |
| `Coverage` | [Contoh](contoh-pembiayaan.md#coverage) | FHIR R4 |
| `CoverageEligibilityRequest` | [Contoh](klaim-bpjs.md#matriks-q0006-dan-sumber-registrasi-sep) | FHIR R4 |
| `CoverageEligibilityResponse` | [Contoh](klaim-bpjs.md#matriks-q0006-dan-sumber-registrasi-sep) | FHIR R4 |
| `Device` | [Contoh](contoh-penunjang-dan-logistik.md#device) | FHIR R4 |
| `DeviceDispense` | [Contoh](contoh-penunjang-dan-logistik.md#devicedispense) | FHIR R5 dasar |
| `DeviceRequest` | [Contoh](contoh-penunjang-dan-logistik.md#devicerequest) | FHIR R4 |
| `DeviceUseStatement` | [Contoh](contoh-penunjang-dan-logistik.md#deviceusestatement) | FHIR R4 |
| `DiagnosticReport` | [Contoh](../alur/hiv-dan-pemeriksaan-penunjang.md#order-sampel-dan-hasil) | FHIR R4 |
| `DocumentReference` | [Contoh](contoh-penunjang-dan-logistik.md#documentreference) | FHIR R4 |
| `Encounter` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#encounter-saat-registrasi) | FHIR R4 |
| `Endpoint` | [Contoh](contoh-penunjang-dan-logistik.md#endpoint) | FHIR R4 |
| `EpisodeOfCare` | [Contoh](../alur/hiv-dan-pemeriksaan-penunjang.md#episode-dan-questionnaireresponse) | FHIR R4 |
| `FamilyMemberHistory` | [Contoh](contoh-klinis.md#familymemberhistory) | FHIR R4 |
| `Goal` | [Contoh](contoh-klinis.md#goal) | FHIR R4 |
| `ImagingStudy` | [Contoh](contoh-penunjang-dan-logistik.md#imagingstudy) | FHIR R4 |
| `Immunization` | [Contoh](ghpr-rabies.md#matriks-payload-dan-terminologi) | FHIR R4 |
| `Invoice` | [Contoh](contoh-pembiayaan.md#invoice) | FHIR R4 |
| `Location` | [Contoh](../endpoint/onboarding-fhir.md#lokasi-pelayanan) | FHIR R4 |
| `Medication` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#resep-dan-penyerahan-obat) | FHIR R4 |
| `MedicationAdministration` | [Contoh](contoh-klinis.md#medicationadministration) | FHIR R4 |
| `MedicationDispense` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#resep-dan-penyerahan-obat) | FHIR R4 |
| `MedicationRequest` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#resep-dan-penyerahan-obat) | FHIR R4 |
| `MedicationStatement` | [Contoh](contoh-klinis.md#medicationstatement) | FHIR R4 |
| `NutritionOrder` | [Contoh](contoh-klinis.md#nutritionorder) | FHIR R4 |
| `Observation` | [Contoh](contoh-rawat-jalan-dan-farmasi.md#tanda-vital-dan-diagnosis) | FHIR R4 |
| `Organization` | [Contoh](../endpoint/onboarding-fhir.md#suborganisasi) | FHIR R4 |
| `Patient` | [Contoh](../endpoint/master-data-pasien.md#pencarian-dan-keputusan-pemetaan) | FHIR R4 |
| `PaymentNotice` | [Contoh](contoh-pembiayaan.md#paymentnotice) | FHIR R4 |
| `PaymentReconciliation` | [Contoh](contoh-pembiayaan.md#paymentreconciliation) | FHIR R4 |
| `Practitioner` | [Contoh](contoh-klinis.md#practitioner) | Potongan baca balik FHIR R4 |
| `Procedure` | [Contoh](contoh-klinis.md#procedure) | FHIR R4 |
| `Provenance` | [Contoh](tanda-tangan-elektronik-dan-consent.md#contoh-provenance-awal-dan-hasil-baca-task) | FHIR R4 |
| `PurificationDecision` | [Contoh](contoh-pembiayaan.md#purificationdecision) | Potongan JSON non-FHIR |
| `QuestionnaireResponse` | [Contoh](ghpr-rabies.md#matriks-payload-dan-terminologi) | FHIR R4 |
| `RelatedPerson` | [Contoh](contoh-klinis.md#relatedperson) | FHIR R4 |
| `RiskAssessment` | [Contoh](contoh-klinis.md#riskassessment) | FHIR R4 |
| `ServiceRequest` | [Contoh](radiologi-dicom.md#contoh-order-dengan-acsn) | FHIR R4 |
| `Specimen` | [Contoh](contoh-penunjang-dan-logistik.md#specimen) | FHIR R4 |
| `Substance` | [Contoh](contoh-penunjang-dan-logistik.md#substance) | FHIR R4 |
| `SupplyDelivery` | [Contoh](contoh-penunjang-dan-logistik.md#supplydelivery) | FHIR R4 |
| `SupplyRequest` | [Contoh](contoh-penunjang-dan-logistik.md#supplyrequest) | FHIR R4 |
| `Task` | [Contoh](data-kelahiran-dan-akta.md#contoh-request-dan-potongan-balikan) | FHIR R4 |

## Tipe yang digunakan melalui katalog operasi atau panduan modul

| Tipe | Contoh lokal | Penggunaan |
| --- | --- | --- |
| `Appointment` | [Contoh](penjadwalan-dan-janji-temu.md#contoh-janji-dan-respons) | Penjadwalan |
| `AppointmentResponse` | [Contoh](penjadwalan-dan-janji-temu.md#contoh-janji-dan-respons) | Penjadwalan |
| `HealthcareService` | [Contoh](penjadwalan-dan-janji-temu.md#contoh-sintesis-layanan-peran-schedule-dan-slot) | Penjadwalan |
| `PractitionerRole` | [Contoh](penjadwalan-dan-janji-temu.md#contoh-sintesis-layanan-peran-schedule-dan-slot) | Penjadwalan |
| `Schedule` | [Contoh](penjadwalan-dan-janji-temu.md#contoh-sintesis-layanan-peran-schedule-dan-slot) | Struktur dasar penjadwalan. Route perlu konfirmasi. |
| `Slot` | [Contoh](penjadwalan-dan-janji-temu.md#contoh-sintesis-layanan-peran-schedule-dan-slot) | Penjadwalan |
| `Bundle` | [Contoh](../endpoint/master-data-pasien.md#pencarian-dan-keputusan-pemetaan) | Pencarian dan transaksi menurut kontrak operasi. |
| `OperationOutcome` | [Contoh](../validasi/respons-dan-error.md#respons-fhir) | Validasi dan error. |
| `VisionPrescription` | [Contoh](contoh-klinis.md#visionprescription) | Resep lensa. POST tercatat di koleksi Mata. Operasi baca dan scope perlu konfirmasi. |
| `CommunicationRequest` | [Contoh](contoh-pembiayaan.md#communicationrequest) | Komunikasi klaim. Envelope dan route perlu konfirmasi. |
| `Communication` | [Contoh](contoh-pembiayaan.md#communication) | Komunikasi klaim. Envelope dan route perlu konfirmasi. |

## Payload dengan protokol khusus

| Alur | Contoh request dan respons |
| --- | --- |
| OAuth | [Token dan kredensial](../endpoint/onboarding-fhir.md#oauth) |
| KFA/ALKES | [Master data KFA](../endpoint/master-data-kfa.md) |
| MSI dan Wilayah | [Master Sarana dan Wilayah](../endpoint/master-data-sarana-wilayah.md) |
| KYC | [KYC, envelope dan enkripsi](../endpoint/kyc.md) |
| SSRME | [Akses riwayat nasional](../alur/ssrme.md) |
| DICOM | [Callback router dan WADO](../alur/radiologi-dicom.md) |
| e-Resep | [API e-Resep cek sisa](../endpoint/e-resep.md#api-e-resep-v2-untuk-cek-sisa) |
