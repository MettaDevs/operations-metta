# Inventaris sumber resmi SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](inventaris-sumber-resmi.md)
>
> **Acuan utama** [Selamat Datang](https://satusehat.kemkes.go.id/platform/docs/id/playbook/) (disunting 2025-07-23) · [Yang Baru di Versi 7.23](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/) (disunting 2026-04-01) · [Autentikasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/) (disunting 2024-04-23)

[Indeks SATUSEHAT](../README.md) · [Referensi dan pemeliharaan dokumen](README.md)

Snapshot tanggal 16 November 2026. Inventaris berawal dari halaman Playbook lalu menelusuri jalur internal portal berbahasa Indonesia yang ditemukan pada kategori di bawah. Ada 268 halaman kanonis yang dapat dibaca dan satu tautan navigasi dengan target rusak. Lampiran eksternal dan materi pengguna dilacak melalui dokumen sumber per integrasi. [Portal Playbook Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/playbook/) · [Rujukan pengguna dan Playbook Rawat Jalan](cakupan-rawat-jalan-dan-ssrme.md)

Gunakan daftar ini untuk menemukan sumber dan memeriksa adanya perubahan cakupan. Status kontrak tiap modul dilacak di inventaris Playbook dan status penurunan kontrak. Operasi HTTP dicatat sampai level metode dan path pada inventaris operasi. [Status penurunan kontrak](cakupan-integrasi.md#status-penurunan-kontrak)

| Kelompok | Halaman kanonis | Pelacakan internal |
| --- | ---: | --- |
| Katalog API | 37 | [Dokumen terkait](../endpoint/inventaris-operasi-http.md) |
| Panduan interoperabilitas | 37 | [Dokumen terkait](inventaris-playbook.md) |
| Indeks dan contoh Playbook | 4 | [Dokumen terkait](inventaris-playbook.md) |
| FHIR, profil resource, dan validasi | 65 | [Dokumen terkait](../endpoint/kontrak-fhir-http.md) |
| Terminologi dan lampiran kode | 50 | [Kontrak terminologi](../terminologi/kontrak-terminologi.md) · [Indeks per field](../terminologi/indeks-terminologi-field.md) |
| Master data | 12 | [Dokumen terkait](cakupan-integrasi.md#status-penurunan-kontrak) |
| Kode dan akses API | 3 | [Dokumen terkait](../endpoint/onboarding-fhir.md) |
| Panduan registrasi | 17 | [Dokumen terkait](../endpoint/onboarding-fhir.md) |
| Panduan perubahan profil | 8 | [Dokumen terkait](../endpoint/onboarding-fhir.md) |
| Workshop dan contoh API | 4 | [Dokumen terkait](cakupan-rawat-jalan-dan-ssrme.md) |
| Pemantauan | 3 | [Monitoring dan kanal aduan](../operasional/monitoring-dan-aduan.md) |
| Kanal dan format aduan | 7 | [Monitoring dan kanal aduan](../operasional/monitoring-dan-aduan.md#kanal-dan-bukti-aduan) |
| DICOM | 6 | [Dokumen terkait](../alur/radiologi-dicom.md) |
| KYC | 7 | [Dokumen terkait](../endpoint/kyc.md) |
| Perubahan katalog | 8 | [Dokumen terkait](cakupan-integrasi.md) |

## Halaman sumber

Kolom **Terakhir disunting** mengikuti tanggal yang ditampilkan pada halaman Kemenkes. Kolom **Versi dan tanggal rilis** berasal dari riwayat versi Playbook jika bentuk tabelnya dapat dikonfirmasi. Tanda — berarti versi atau tanggal rilis belum tercatat pada inventaris ini.

### Katalog API

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Autentikasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/) | `api-catalogue/authentication/` | 2024-04-23 | — |
| [Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/) | `api-catalogue/authentication/apis/token/` | 2023-09-27 | — |
| [Pengajuan dan Verifikasi Akses](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/registration/) | `api-catalogue/authentication/registration/` | 2024-09-09 | — |
| [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) | `api-catalogue/integrations/` | 2024-10-03 | — |
| [AllergyIntolerance](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/allergy-intolerance/) | `api-catalogue/integrations/apis/allergy-intolerance/` | 2023-09-27 | — |
| [AppointmentResponse](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment-response/) | `api-catalogue/integrations/apis/appointment-response/` | 2023-09-27 | — |
| [Appointment](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/appointment/) | `api-catalogue/integrations/apis/appointment/` | 2023-09-27 | — |
| [CarePlan](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/care-plan/) | `api-catalogue/integrations/apis/care-plan/` | 2023-09-27 | — |
| [ClinicalImpression](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/clinical-impression/) | `api-catalogue/integrations/apis/clinical-impression/` | 2023-09-27 | — |
| [Composition](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/composition/) | `api-catalogue/integrations/apis/composition/` | 2023-09-27 | — |
| [Condition](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/condition/) | `api-catalogue/integrations/apis/condition/` | 2023-09-27 | — |
| [DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/) | `api-catalogue/integrations/apis/diagnostic-report/` | 2023-09-27 | — |
| [Encounter](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/) | `api-catalogue/integrations/apis/encounter/` | 2023-09-27 | — |
| [EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/) | `api-catalogue/integrations/apis/episode-of-care/` | 2023-09-27 | — |
| [FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/family-member-history/) | `api-catalogue/integrations/apis/family-member-history/` | 2023-09-27 | — |
| [HealthcareService](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/healthcare-service/) | `api-catalogue/integrations/apis/healthcare-service/` | 2023-09-27 | — |
| [ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/) | `api-catalogue/integrations/apis/imaging-study/` | 2023-09-27 | — |
| [Immunization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/) | `api-catalogue/integrations/apis/immunization/` | 2023-09-27 | — |
| [MedicationDispense](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-dispense/) | `api-catalogue/integrations/apis/medication-dispense/` | 2023-09-27 | — |
| [MedicationRequest](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication-request/) | `api-catalogue/integrations/apis/medication-request/` | 2023-09-27 | — |
| [Medication](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/medication/) | `api-catalogue/integrations/apis/medication/` | 2023-09-27 | — |
| [Observation](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/) | `api-catalogue/integrations/apis/observation/` | 2023-09-27 | — |
| [PractitionerRole](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/practitioner-role/) | `api-catalogue/integrations/apis/practitioner-role/` | 2023-09-27 | — |
| [Procedure](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/procedure/) | `api-catalogue/integrations/apis/procedure/` | 2023-09-27 | — |
| [QuestionnaireResponse](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/questionnaire-response/) | `api-catalogue/integrations/apis/questionnaire-response/` | 2023-09-27 | — |
| [RelatedPerson](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/) | `api-catalogue/integrations/apis/related-person/` | 2023-11-16 | — |
| [ServiceRequest](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/) | `api-catalogue/integrations/apis/service-request/` | 2023-09-27 | — |
| [Slot](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/slot/) | `api-catalogue/integrations/apis/slot/` | 2023-09-27 | — |
| [Specimen](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/specimen/) | `api-catalogue/integrations/apis/specimen/` | 2023-09-27 | — |
| [Prerequisites](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/) | `api-catalogue/onboardings/` | 2024-11-08 | — |
| [Location](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/) | `api-catalogue/onboardings/apis/location/` | 2023-09-27 | — |
| [Organization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/organization/) | `api-catalogue/onboardings/apis/organization/` | 2023-09-27 | — |
| [Patient](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/) | `api-catalogue/onboardings/apis/patient/` | 2025-07-22 | — |
| [Practitioner](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/practitioner/) | `api-catalogue/onboardings/apis/practitioner/` | 2024-11-08 | — |
| [Validasi Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/) | `api-catalogue/validasi/` | 2024-06-07 | — |
| [Kamus Rule Number Validasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/kamus-validasi/) | `api-catalogue/validasi/kamus-validasi/` | 2026-01-22 | — |
| [Daftar Response Validasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/list-response/) | `api-catalogue/validasi/list-response/` | 2024-09-09 | — |

### Panduan interoperabilitas

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Panduan Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/) | `interoperability/` | 2026-10-12 | — |
| [Antenatal Care (ANC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/) | `interoperability/anc/` | 2025-10-02 | v2.5 (2024-07-02) |
| [Data Kelahiran](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/) | `interoperability/data-kelahiran/` | 2026-09-29 | v1.0 (2026-06-26) |
| [Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/) | `interoperability/gizi/` | 2025-10-02 | v4.0 (2024-11-04) |
| [Human Immunodeficiency Virus (HIV)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/hiv/) | `interoperability/hiv/` | 2024-12-08 | v1.0 (2024-08-10) |
| [Pelayanan Instalasi Gawat Darurat (IGD)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/) | `interoperability/igd/` | 2025-12-02 | v5.2 (2025-10-30) |
| [Imunisasi COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/) | `interoperability/imunisasi-covid/` | 2025-10-02 | v1.0 (2024-07-15) |
| [Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/) | `interoperability/imunisasi-new/` | 2025-10-02 | v2.6 (2024-05-27) |
| [Intranatal Care (INC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/) | `interoperability/inc/` | 2025-10-02 | v2.7 (2024-09-10) |
| [Registrasi Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/) | `interoperability/kanker/` | 2026-07-30 | v1.0 (2026-04-01) |
| [Pelayanan Kefarmasian](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/) | `interoperability/kefarmasian/` | 2024-12-15 | v1.3 (2024-11-28) |
| [Pembiayaan Kesehatan Klaim BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim-bpjs/) | `interoperability/klaim-bpjs/` | 2026-09-10 | v1.3 (2025-08-20) |
| [Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim/) | `interoperability/klaim/` | 2025-12-02 | v1.3 (2026-01-06) |
| [Registrasi Mata](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mata/) | `interoperability/mata/` | 2024-12-08 | v1.0 (2024-11-05) |
| [Medical Check Up (MCU)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mcu/) | `interoperability/mcu/` | 2026-10-05 | v1.0 (2026-10-06) |
| [Kematian Maternal dan Perinatal](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/) | `interoperability/mpdn/` | 2025-10-02 | v1.4 (2024-09-06) |
| [Manajemen Terpadu Balita Sakit (MTBS)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mtbs-prio/) | `interoperability/mtbs-prio/` | 2024-12-08 | v1.0 (2024-11-04) |
| [Neonatus](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/) | `interoperability/neonatus/` | 2025-10-02 | v2.6 (2024-09-10) |
| [Pelayanan Kesehatan Peduli Remaja (PKPR) Luar Gedung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/) | `interoperability/pkpr-luar-gedung/` | 2025-10-02 | v1.1 (2024-05-29) |
| [Postnatal Care (PNC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/) | `interoperability/pnc/` | 2025-10-02 | v3.5 (2024-07-19) |
| [Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/) | `interoperability/rawat-inap-new/` | 2026-08-06 | v6.0 (2026-01-10) |
| [Gigi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/) | `interoperability/rawat-jalan-gigi/` | 2025-10-02 | v1.5 (2024-08-07) |
| [Simplifikasi Registrasi Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/) | `interoperability/registrasi-jantung/` | 2026-10-13 | v1.0 (2026-08-13) |
| [Registrasi Telinga](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-telinga/) | `interoperability/registrasi-telinga/` | 2025-07-24 | v1.0 (2025-05-16) |
| [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) | `interoperability/rme-rawat-jalan/` | 2026-08-04 | v7.0 (2026-01-10) |
| [Rujukan Spesimen](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan-spesimen/) | `interoperability/rujukan-spesimen/` | 2025-10-02 | v1.0 (2024-12-16) |
| [Rujukan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan/) | `interoperability/rujukan/` | 2026-08-24 | v6.1 (2026-08-21) |
| [Skrining Hipotiroid Kongenital (SHK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/) | `interoperability/shk/` | 2025-12-02 | v2.1 (2024-06-12) |
| [Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/) | `interoperability/skrining-ptm/` | 2025-12-02 | v1.4 (2024-09-25) |
| [Sertifikat Medis Penyebab Kematian (SMPK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/smpk/) | `interoperability/smpk/` | 2026-09-10 | v1.5 (2026-09-09) |
| [Simplifikasi Registrasi Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/) | `interoperability/stroke/` | 2026-10-13 | v1.0 (2026-10-05) |
| [Tanda Tangan Elektronik (TTE)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/) | `interoperability/tanda-tangan-elektronik/` | 2026-10-30 | v1.1 (2026-10-19) |
| [Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/) | `interoperability/tuberkulosis/` | 2024-12-15 | v4.3 (2024-11-05) |
| [Tumbuh Kembang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/) | `interoperability/tumbuh-kembang-new/` | 2025-10-02 | v3.0 (2024-04-02) |
| [Upaya Berhenti Merokok (UBM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/ubm/) | `interoperability/ubm/` | 2026-09-10 | v1.1 (2025-06-17) |
| [Registrasi Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/) | `interoperability/uronefro/` | 2025-10-02 | v1.5 (2024-08-21) |
| [Zoonosis - Gigitan Hewan Penular Rabies (GHPR)/Rabies](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/zoonosis-rabies/) | `interoperability/zoonosis-rabies/` | 2024-12-08 | v1.0 (2024-11-16) |

### Indeks dan contoh Playbook

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Selamat Datang](https://satusehat.kemkes.go.id/platform/docs/id/playbook/) | `playbook/` | 2025-07-23 | — |
| [Apa itu SATUSEHAT?](https://satusehat.kemkes.go.id/platform/docs/id/playbook/introduction/) | `playbook/introduction/` | 2024-06-07 | — |
| [Pengantar Teknis](https://satusehat.kemkes.go.id/platform/docs/id/playbook/preface/) | `playbook/preface/` | 2023-09-25 | — |
| [Layanan SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/playbook/service/) | `playbook/service/` | 2024-09-09 | — |

### FHIR, profil resource, dan validasi

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [FHIR](https://satusehat.kemkes.go.id/platform/docs/id/fhir/) | `fhir/` | 2024-11-13 | — |
| [Umum](https://satusehat.kemkes.go.id/platform/docs/id/fhir/data-type/general/) | `fhir/data-type/general/` | 2024-09-09 | — |
| [Metadata](https://satusehat.kemkes.go.id/platform/docs/id/fhir/data-type/metadata/) | `fhir/data-type/metadata/` | 2024-09-09 | — |
| [Primitif](https://satusehat.kemkes.go.id/platform/docs/id/fhir/data-type/primitive/) | `fhir/data-type/primitive/` | 2025-07-22 | — |
| [Khusus](https://satusehat.kemkes.go.id/platform/docs/id/fhir/data-type/special/) | `fhir/data-type/special/` | 2024-09-09 | — |
| [Framework FHIR](https://satusehat.kemkes.go.id/platform/docs/id/fhir/framework/) | `fhir/framework/` | 2024-11-13 | — |
| [Orientasi/ Onboarding / Prerequisites](https://satusehat.kemkes.go.id/platform/docs/id/fhir/prerequisites/) | `fhir/prerequisites/` | 2024-11-13 | — |
| [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/) | `fhir/resources/` | 2026-11-06 | — |
| [Account](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/account/) | `fhir/resources/account/` | 2024-12-15 | — |
| [AllergyIntolerance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/allergy-intolerance/) | `fhir/resources/allergy-intolerance/` | 2024-12-15 | — |
| [BillingStatus](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/billing-status/) | `fhir/resources/billing-status/` | 2024-12-15 | — |
| [BiologicallyDerivedProduct](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/biologically-derived-product/) | `fhir/resources/biologically-derived-product/` | 2026-11-06 | — |
| [BodyStructure](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/body-structure/) | `fhir/resources/body-structure/` | 2026-11-06 | — |
| [CarePlan](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/care-plan/) | `fhir/resources/care-plan/` | 2024-12-15 | — |
| [ChargeItemDefinition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item-definition/) | `fhir/resources/charge-item-definition/` | 2024-12-15 | — |
| [ChargeItemResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item-response/) | `fhir/resources/charge-item-response/` | 2024-12-15 | — |
| [ChargeItem](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/charge-item/) | `fhir/resources/charge-item/` | 2024-12-15 | — |
| [ClaimResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/claim-response/) | `fhir/resources/claim-response/` | 2024-12-15 | — |
| [Claim](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/claim/) | `fhir/resources/claim/` | 2024-12-15 | — |
| [ClinicalImpression](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/clinical-impression/) | `fhir/resources/clinical-impression/` | 2024-12-15 | — |
| [Composition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/composition/) | `fhir/resources/composition/` | 2024-12-15 | — |
| [Condition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/) | `fhir/resources/condition/` | 2024-12-15 | — |
| [Consent](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/consent/) | `fhir/resources/consent/` | 2026-10-30 | — |
| [CoverageEligibilityRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage-eligibility-request/) | `fhir/resources/coverage-eligibility-request/` | 2024-12-15 | — |
| [CoverageEligibilityResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage-eligibility-response/) | `fhir/resources/coverage-eligibility-response/` | 2024-12-15 | — |
| [Coverage](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/coverage/) | `fhir/resources/coverage/` | 2024-12-15 | — |
| [DeviceDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-dispense/) | `fhir/resources/device-dispense/` | 2026-11-06 | — |
| [DeviceRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-request/) | `fhir/resources/device-request/` | 2026-11-06 | — |
| [DeviceUseStatement](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-use-statement/) | `fhir/resources/device-use-statement/` | 2026-11-06 | — |
| [Device](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device/) | `fhir/resources/device/` | 2026-10-30 | — |
| [DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/diagnostic-report/) | `fhir/resources/diagnostic-report/` | 2025-12-02 | — |
| [DocumentReference](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/document-reference/) | `fhir/resources/document-reference/` | 2024-12-15 | — |
| [Encounter](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/encounter/) | `fhir/resources/encounter/` | 2026-11-06 | — |
| [Endpoint](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/endpoint/) | `fhir/resources/endpoint/` | 2024-12-15 | — |
| [EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/episode-of-care/) | `fhir/resources/episode-of-care/` | 2024-12-15 | — |
| [FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/family-member-history/) | `fhir/resources/family-member-history/` | 2024-12-15 | — |
| [Goal](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/goal/) | `fhir/resources/goal/` | 2024-12-15 | — |
| [ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/imaging-study/) | `fhir/resources/imaging-study/` | 2024-12-15 | — |
| [Immunization](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/immunization/) | `fhir/resources/immunization/` | 2024-12-15 | — |
| [Invoice](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/invoice/) | `fhir/resources/invoice/` | 2024-12-15 | — |
| [Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) | `fhir/resources/location/` | 2024-12-15 | — |
| [MedicationAdministration](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-administration/) | `fhir/resources/medication-administration/` | 2024-12-15 | — |
| [MedicationDispense](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-dispense/) | `fhir/resources/medication-dispense/` | 2024-12-15 | — |
| [MedicationRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-request/) | `fhir/resources/medication-request/` | 2024-12-15 | — |
| [MedicationStatement](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-statement/) | `fhir/resources/medication-statement/` | 2024-12-15 | — |
| [Medication](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication/) | `fhir/resources/medication/` | 2024-12-15 | — |
| [NutritionOrder](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/nutrition-order/) | `fhir/resources/nutrition-order/` | 2024-12-15 | — |
| [Observation](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/) | `fhir/resources/observation/` | 2024-12-15 | — |
| [Organization](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/organization/) | `fhir/resources/organization/` | 2024-12-15 | — |
| [Patient](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/patient/) | `fhir/resources/patient/` | 2024-12-15 | — |
| [PaymentNotice](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/payment-notice/) | `fhir/resources/payment-notice/` | 2024-12-15 | — |
| [PaymentReconciliation](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/payment-reconciliation/) | `fhir/resources/payment-reconciliation/` | 2024-12-15 | — |
| [Practitioner](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/practitioner/) | `fhir/resources/practitioner/` | 2024-12-15 | — |
| [Procedure](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/procedure/) | `fhir/resources/procedure/` | 2024-12-15 | — |
| [Provenance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/provenance/) | `fhir/resources/provenance/` | 2026-10-30 | — |
| [PurificationDecision](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/purification-decision/) | `fhir/resources/purification-decision/` | 2024-12-15 | — |
| [QuestionnaireResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/questionnaire-response/) | `fhir/resources/questionnaire-response/` | 2024-12-15 | — |
| [RelatedPerson](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/related-person/) | `fhir/resources/related-person/` | 2024-12-15 | — |
| [RiskAssessment](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/risk-assessment/) | `fhir/resources/risk-assessment/` | 2024-12-15 | — |
| [ServiceRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/service-request/) | `fhir/resources/service-request/` | 2024-12-15 | — |
| [Specimen](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/) | `fhir/resources/specimen/` | 2024-12-15 | — |
| [Substance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/substance/) | `fhir/resources/substance/` | 2024-12-15 | — |
| [SupplyDelivery](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/supply-delivery/) | `fhir/resources/supply-delivery/` | 2026-11-06 | — |
| [SupplyRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/supply-request/) | `fhir/resources/supply-request/` | 2026-11-06 | — |
| [Task](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/task/) | `fhir/resources/task/` | 2026-10-30 | — |

### Terminologi dan lampiran kode

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/) | `terminology/` | 2026-10-08 | — |
| [ICD-10](https://satusehat.kemkes.go.id/platform/docs/id/terminology/icd/icd-10/) | `terminology/icd/icd-10/` | 2026-01-22 | — |
| [ICD-9 CM](https://satusehat.kemkes.go.id/platform/docs/id/terminology/icd/icd-9-cm/) | `terminology/icd/icd-9-cm/` | 2026-01-22 | — |
| [ICD-IM](https://satusehat.kemkes.go.id/platform/docs/id/terminology/icd/icd-im/) | `terminology/icd/icd-im/` | 2026-10-08 | — |
| [ICD-MM](https://satusehat.kemkes.go.id/platform/docs/id/terminology/icd/icd-mm/) | `terminology/icd/icd-mm/` | 2026-01-22 | — |
| [ICD-O](https://satusehat.kemkes.go.id/platform/docs/id/terminology/icd/icd-o/) | `terminology/icd/icd-o/` | 2026-01-22 | — |
| [ICD-PM](https://satusehat.kemkes.go.id/platform/docs/id/terminology/icd/icd-pm/) | `terminology/icd/icd-pm/` | 2026-01-22 | — |
| [Kode Pembiayaan Tindakan dan Layanan Kesehatan Nasional (KPTL)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/kptl/) | `terminology/kptl/` | 2026-01-22 | — |
| [Lampiran Daftar KPTL](https://satusehat.kemkes.go.id/platform/docs/id/terminology/kptl/daftar-kptl/) | `terminology/kptl/daftar-kptl/` | 2026-08-26 | — |
| [Lampiran Mapping Kode ICD 9 CM - KPTL](https://satusehat.kemkes.go.id/platform/docs/id/terminology/kptl/icd-9-cm-kptl/) | `terminology/kptl/icd-9-cm-kptl/` | 2026-08-28 | — |
| [Lampiran Terminologi ANC](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/anc/) | `terminology/lampiran-terminologi/anc/` | 2024-11-01 | — |
| [Lampiran Terminologi Data Kelahiran](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/data-kelahiran/) | `terminology/lampiran-terminologi/data-kelahiran/` | 2026-07-30 | — |
| [Lampiran Terminologi Pelayanan Kefarmasian](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/farmasi/) | `terminology/lampiran-terminologi/farmasi/` | 2024-11-01 | — |
| [Lampiran Terminologi Gizi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/gizi/) | `terminology/lampiran-terminologi/gizi/` | 2024-11-19 | — |
| [Lampiran Terminologi Pelayanan Instalasi Gawat Darurat (IGD)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/igd-fase-2/) | `terminology/lampiran-terminologi/igd-fase-2/` | 2024-06-26 | — |
| [Lampiran Terminologi Imunisasi COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/imunisasi-covid/) | `terminology/lampiran-terminologi/imunisasi-covid/` | 2024-07-08 | — |
| [Lampiran Terminologi Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/imunisasi-new/) | `terminology/lampiran-terminologi/imunisasi-new/` | 2024-08-29 | — |
| [Lampiran Terminologi INC](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/inc/) | `terminology/lampiran-terminologi/inc/` | 2024-10-14 | — |
| [Lampiran Terminologi Kanker](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/kanker/) | `terminology/lampiran-terminologi/kanker/` | 2026-07-30 | — |
| [Lampiran Terminologi Pembiayaan Kesehatan Klaim BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim-bpjs/) | `terminology/lampiran-terminologi/klaim-bpjs/` | 2025-01-30 | — |
| [Lampiran Terminologi Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim/) | `terminology/lampiran-terminologi/klaim/` | 2024-09-04 | — |
| [Lampiran Terminologi Medical Check Up (MCU)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mcu/) | `terminology/lampiran-terminologi/mcu/` | 2026-10-05 | — |
| [Lampiran Terminologi Kematian Maternal dan Perinatal](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mpdn/) | `terminology/lampiran-terminologi/mpdn/` | 2024-11-01 | — |
| [Lampiran Terminologi Manajemen Terpadu Balita Sakit](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mtbs/) | `terminology/lampiran-terminologi/mtbs/` | 2024-08-21 | — |
| [Lampiran Terminologi Neonatus](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/neonatus-prio/) | `terminology/lampiran-terminologi/neonatus-prio/` | 2024-11-01 | — |
| [Lampiran Terminologi Pelayanan Kesehatan Peduli Remaja (PKPR) Luar Gedung](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/pkpr-luar-gedung/) | `terminology/lampiran-terminologi/pkpr-luar-gedung/` | 2024-11-12 | — |
| [Lampiran Terminologi PNC Prioritas](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/pnc/) | `terminology/lampiran-terminologi/pnc/` | 2024-04-03 | — |
| [Lampiran Terminologi Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-inap-fase-2/) | `terminology/lampiran-terminologi/rawat-inap-fase-2/` | 2024-06-21 | — |
| [Lampiran Terminologi Gigi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-jalan-gigi/) | `terminology/lampiran-terminologi/rawat-jalan-gigi/` | 2024-08-26 | — |
| [Lampiran Terminologi Registrasi Stroke](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/registrasi-stroke/) | `terminology/lampiran-terminologi/registrasi-stroke/` | 2026-10-12 | — |
| [Lampiran Terminologi Resume Medis Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rme-rawat-jalan1/) | `terminology/lampiran-terminologi/rme-rawat-jalan1/` | 2024-10-07 | — |
| [Lampiran Terminologi Rujukan Spesimen](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rujukan-spesimen/) | `terminology/lampiran-terminologi/rujukan-spesimen/` | 2024-12-13 | — |
| [Lampiran Terminologi Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/skrining-ptm/) | `terminology/lampiran-terminologi/skrining-ptm/` | 2024-11-19 | — |
| [Lampiran Terminologi Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/tuberkulosis/) | `terminology/lampiran-terminologi/tuberkulosis/` | 2024-09-08 | — |
| [LOINC](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/) | `terminology/loinc/` | 2024-04-24 | — |
| [Laboratorium](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/laboratory/) | `terminology/loinc/laboratory/` | 2025-12-02 | — |
| [Lampiran Terminologi Mikrobiologi Klinik](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/laboratory/lampiran-mikrobiologi-klinik/) | `terminology/loinc/laboratory/lampiran-mikrobiologi-klinik/` | 2026-01-22 | — |
| [Lampiran Terminologi Parasitologi Klinik](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/laboratory/lampiran-parasitologi-klinik/) | `terminology/loinc/laboratory/lampiran-parasitologi-klinik/` | 2026-01-22 | — |
| [Lampiran Terminologi Patologi Anatomi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/laboratory/lampiran-patologi-anatomi/) | `terminology/loinc/laboratory/lampiran-patologi-anatomi/` | 2026-01-22 | — |
| [Lampiran Terminologi Patologi Klinik Bagian 1](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/laboratory/lampiran-patologi-klinik-bag-1/) | `terminology/loinc/laboratory/lampiran-patologi-klinik-bag-1/` | 2026-01-22 | — |
| [Lampiran Terminologi Patologi Klinik Bagian 2](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/laboratory/lampiran-patologi-klinik-bag-2/) | `terminology/loinc/laboratory/lampiran-patologi-klinik-bag-2/` | 2026-01-22 | — |
| [Lampiran Terminologi Kedokteran Nuklir & Teranostik Molekuler](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/nuklir/) | `terminology/loinc/nuklir/` | 2026-01-22 | — |
| [Radiologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/radiologi/) | `terminology/loinc/radiologi/` | 2025-12-02 | — |
| [Lampiran Terminologi Radiologi Bagian 1](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/radiologi/lampiran-bag1/) | `terminology/loinc/radiologi/lampiran-bag1/` | 2026-01-22 | — |
| [Lampiran Terminologi Radiologi Bagian 2](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/radiologi/lampiran-bag2/) | `terminology/loinc/radiologi/lampiran-bag2/` | 2026-01-22 | — |
| [Lampiran Terminologi Radiologi Gigi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/radiologi/lampiran-gigi/) | `terminology/loinc/radiologi/lampiran-gigi/` | 2026-01-22 | — |
| [SNOMED-CT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/snomed-ct/) | `terminology/snomed-ct/` | 2024-06-07 | — |
| [Affiliate License SNOMED-CT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/snomed-ct/affiliate-license/) | `terminology/snomed-ct/affiliate-license/` | 2024-09-09 | — |
| [Penggunaan SNOMED-CT pada SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/snomed-ct/guide/) | `terminology/snomed-ct/guide/` | 2024-04-03 | — |
| [Standar Terminologi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) | `terminology/standar-terminologi/` | 2026-11-06 | — |

### Master data

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Master Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/) | `master-data/` | 2024-09-09 | — |
| [Pendahuluan](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/preliminary/) | `master-data/kfa/preliminary/` | 2023-09-29 | — |
| [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/) | `master-data/kfa/rest-api-kfa/` | 2025-10-02 | — |
| [Pasien Bayi Baru Lahir](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-bayi/) | `master-data/master-patient-index/pasien-bayi/` | 2025-07-22 | — |
| [Pasien dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/) | `master-data/master-patient-index/pasien-nik/` | 2024-12-05 | — |
| [Pasien tanpa NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-no-nik/) | `master-data/master-patient-index/pasien-no-nik/` | 2024-09-09 | — |
| [Pendahuluan](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/preliminary/) | `master-data/master-patient-index/preliminary/` | 2024-11-08 | — |
| [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/) | `master-data/master-patient-index/rest-api-mpi/` | 2024-11-15 | — |
| [Pendahuluan](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/preliminary/) | `master-data/master-sarana-index/preliminary/` | 2023-09-29 | — |
| [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/) | `master-data/master-sarana-index/rest-api-msi/` | 2025-10-02 | — |
| [Pendahuluan](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/preliminary/) | `master-data/master-wilayah/preliminary/` | 2023-12-11 | — |
| [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/) | `master-data/master-wilayah/rest-api-wilayah/` | 2025-10-02 | — |

### Kode dan akses API

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Kode Akses API](https://satusehat.kemkes.go.id/platform/docs/id/api-code/) | `api-code/` | 2024-08-15 | — |
| [Kode Akses API ( Production )](https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-production/) | `api-code/access-production/` | 2024-08-15 | — |
| [Kode Akses API ( Sandbox )](https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-sandbox/) | `api-code/access-sandbox/` | 2026-01-22 | — |

### Panduan registrasi

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Panduan Registrasi](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/) | `registration-guide/` | 2025-07-16 | — |
| [Login](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/login/) | `registration-guide/login/` | 2024-12-14 | — |
| [Aktivasi Akun (Buat Kata Sandi) SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/password-user-dfo/) | `registration-guide/password-user-dfo/` | 2025-09-26 | — |
| [Atur Ulang Kata Sandi](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/password-user/) | `registration-guide/password-user/` | 2024-12-14 | — |
| [Fasyankes](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/) | `registration-guide/regis-institution/` | 2025-09-26 | — |
| [Sistem RME Mitra/Vendor ( partner system )](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/get-system-rme/) | `registration-guide/regis-institution/get-system-rme/` | 2025-07-18 | — |
| [Sistem RME Mandiri](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/regis-system-rme-mandiri/) | `registration-guide/regis-institution/regis-system-rme-mandiri/` | 2025-07-18 | — |
| [Menentukan Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/select-system-rme/) | `registration-guide/regis-institution/select-system-rme/` | 2025-07-18 | — |
| [Update Data Kontak SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/update-data-kontak-satusehat-yankes/) | `registration-guide/regis-institution/update-data-kontak-satusehat-yankes/` | 2024-07-26 | — |
| [Update Data Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/update-data-rme-yankes/) | `registration-guide/regis-institution/update-data-rme-yankes/` | 2025-09-26 | — |
| [Proses Pemuktahiran Data Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/update-system-rme/) | `registration-guide/regis-institution/update-system-rme/` | 2025-07-18 | — |
| [Registrasi Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-vendor/) | `registration-guide/regis-vendor/` | 2024-11-30 | — |
| [Data Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-vendor/data-rme-vendor/) | `registration-guide/regis-vendor/data-rme-vendor/` | 2024-03-16 | — |
| [Pilihan Kategori Institusi](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-vendor/kategori-institusi-vendor/) | `registration-guide/regis-vendor/kategori-institusi-vendor/` | 2024-06-07 | — |
| [Survei Keamanan](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-vendor/survei-vendor/) | `registration-guide/regis-vendor/survei-vendor/` | 2024-06-07 | — |
| [Daftar dan Aktivasi Akun](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/registration/) | `registration-guide/registration/` | 2024-12-14 | — |
| [Status Registrasi Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/status-verif/) | `registration-guide/status-verif/` | 2024-07-27 | — |

### Panduan perubahan profil

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Panduan Edit Profil](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/) | `edit-profile-guide/` | 2024-10-23 | — |
| [Edit Profil Institusi - Fasyankes](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/edit-institution/) | `edit-profile-guide/edit-institution/` | 2024-08-12 | — |
| [Edit Profil Pengguna](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/edit-profile-user/) | `edit-profile-guide/edit-profile-user/` | 2024-08-12 | — |
| [Edit Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/edit-sistem/) | `edit-profile-guide/edit-sistem/` | 2024-08-12 | — |
| [Ubah Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/edit-sistem/profile-fasyankes/) | `edit-profile-guide/edit-sistem/profile-fasyankes/` | 2024-08-12 | — |
| [Edit Profil Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/edit-sistem/profile-rme/) | `edit-profile-guide/edit-sistem/profile-rme/` | 2024-08-12 | — |
| [Edit Profil Informasi Pendukung Sistem RME](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/edit-support-information/) | `edit-profile-guide/edit-support-information/` | 2024-09-09 | — |
| [Status Verifikasi](https://satusehat.kemkes.go.id/platform/docs/id/edit-profile-guide/status-verifikasi/) | `edit-profile-guide/status-verifikasi/` | 2024-08-12 | — |

### Workshop dan contoh API

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Postman Collection](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/) | `postman-workshop/` | 2025-10-02 | — |
| [Endpoint Information](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) | `postman-workshop/endpoint-information/` | 2024-11-08 | — |
| [Panduan Forking](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/forking/) | `postman-workshop/forking/` | 2024-09-20 | — |
| [Panduan Import](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/import-new/) | `postman-workshop/import-new/` | 2025-10-02 | — |

### Pemantauan

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Dashboard Monitoring Integrasi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/) | `monitoring-guide/` | 2025-07-22 | — |
| [Log Transaksi FHIR](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/log-fhir/) | `monitoring-guide/log-fhir/` | 2025-07-23 | — |
| [Ringkasan Transaksi FHIR](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/transaksi-fhir/) | `monitoring-guide/transaksi-fhir/` | 2025-07-23 | — |

### Kanal dan format aduan

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Format Aduan](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/) | `complaint-channel/` | 2025-07-15 | — |
| [Kendala Pada Proses Pemappingan KFA](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/kfa-case/) | `complaint-channel/kfa-case/` | 2025-10-02 | — |
| [Kendala Pada Proses Monitoring Interoperabilitas SATUSEHAT di SATUSEHAT Data](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/monitoring-ssd-case/) | `complaint-channel/monitoring-ssd-case/` | 2025-07-15 | — |
| [NIK Pasien/Nakes Tidak Ditemukan](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/nik-not-found/) | `complaint-channel/nik-not-found/` | 2025-09-26 | — |
| [Kode Akses API (SatuSehat ID) Tidak Muncul](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/satusehat-id-null/) | `complaint-channel/satusehat-id-null/` | 2025-09-26 | — |
| [Kendala Pada Aplikasi SDMK](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/sdmk-case/) | `complaint-channel/sdmk-case/` | 2025-09-26 | — |
| [Registrasi Sistem RME Belum Terverifikasi](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/verification/) | `complaint-channel/verification/` | 2024-03-16 | — |

### DICOM

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Sistem DICOM](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/) | `dicom-system/` | 2023-09-12 | — |
| [Arsitektur](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/architecture/) | `dicom-system/architecture/` | 2025-07-22 | — |
| [DICOM Router](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/dicom-router/) | `dicom-system/dicom-router/` | 2026-08-26 | — |
| [Docker](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/docker-dicom/) | `dicom-system/docker-dicom/` | 2026-04-23 | — |
| [Instalasi DICOM Router](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/install-dicom/) | `dicom-system/install-dicom/` | 2024-06-19 | — |
| [Installer](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/installer-dicom/) | `dicom-system/installer-dicom/` | 2024-09-09 | — |

### KYC

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Verifikasi Profil - Know Your Customer (KYC)](https://satusehat.kemkes.go.id/platform/docs/id/kyc/) | `kyc/` | 2024-09-09 | — |
| [Panduan Integrasi](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-it-fasyankes/) | `kyc/kyc-doc/guide-it-fasyankes/` | 2024-11-05 | — |
| [Verifikasi Profil Pasien](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-operational/) | `kyc/kyc-doc/guide-operational/` | 2024-07-29 | — |
| [Panduan Proses Verifikasi Profil Pasien Belum Berhasil](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-operational/guide-ops-failure/) | `kyc/kyc-doc/guide-operational/guide-ops-failure/` | 2024-07-29 | — |
| [Kode Akses Profil Pasien](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-user-mobile/) | `kyc/kyc-doc/guide-user-mobile/` | 2024-09-09 | — |
| [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/) | `kyc/kyc-doc/rest-api-kyc/` | 2025-10-02 | — |
| [Panduan Implementasi Proses Verifikasi Profil](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/unduh-lampiran/) | `kyc/kyc-doc/unduh-lampiran/` | 2024-07-29 | — |

### Perubahan katalog

| Halaman resmi | Path di bawah `/platform/docs/id/` | Terakhir disunting | Versi dan tanggal rilis |
| --- | --- | --- | --- |
| [Yang Baru di Versi 7.23](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/) | `whats-new/` | 2026-04-01 | — |
| [Versi 1](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/1/) | `whats-new/1/` | 2023-09-29 | — |
| [Versi 2](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/2/) | `whats-new/2/` | 2023-09-29 | — |
| [Versi 3](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/3/) | `whats-new/3/` | 2025-10-02 | — |
| [Versi 4](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/4/) | `whats-new/4/` | 2025-09-26 | — |
| [Versi 5](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/5/) | `whats-new/5/` | 2024-08-15 | — |
| [Versi 6](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/6/) | `whats-new/6/` | 2024-08-12 | — |
| [Versi 7](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/7/) | `whats-new/7/` | 2026-04-02 | — |

## Tautan navigasi yang perlu ditinjau

Halaman impor Postman memiliki satu tautan relatif yang menghasilkan path `postman-workshop/import-new/s.kemkes.go.id/multi/Links/lists/PostmanSATUSEHAT/`. Target relatif itu tidak menghasilkan halaman kanonis. Bentuk absolut membuka aplikasi JavaScript s.link Kemenkes. Panduan impor juga memberi tautan langsung ke workspace publik. Koleksi yang diberikan pengguna tercatat pada rujukan SSRME internal. [s.link Kemenkes](https://s.kemkes.go.id/multi/Links/lists/PostmanSATUSEHAT/) · [Panduan impor](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/import-new/) · [Referensi dan cakupan](cakupan-rawat-jalan-dan-ssrme.md)

## Sumber di luar portal

| Sumber | Versi dan tanggal yang ditampilkan | Terakhir diperiksa |
| --- | --- | --- |
| [Juknis SSRME](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) | v2.0 (2026-09-01) | 2026-11-16 |
| [Panduan SDM Kesehatan](https://docs.google.com/presentation/d/1KQ8T9xGq3IQLB1u81hlU_O1kr3-kdTpPuUUI0jtDjdk/edit) | Tidak dicantumkan pada sumber yang diperiksa | 2026-11-16 |
| [Postman SATUSEHAT RME](https://www.postman.com/satusehat/satusehat-public/collection/3la2mhe/satusehat-rme?sideView=agentMode) | Overview menampilkan 2026-09-04. Nomor versi tidak tercantum. | 2026-11-16 |
| [Standar Terminologi SATUSEHAT](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) | v12.0 (2026-10-31) | 2026-11-16 |
| [SATUSEHAT FHIR R4 Implementation Guide](https://simplifier.net/guide/SATUSEHAT-FHIR-R4-Implementation-Guide/Home/Overview.page.md?version=current) | v0.1.0 | 2026-11-16 |
| [HL7 FHIR R4](https://hl7.org/fhir/R4/downloads.html) | 4.0.1 | 2026-11-16 |
| [HL7 FHIR R5](https://hl7.org/fhir/R5/downloads.html) | 5.0.0 | 2026-11-16 |
