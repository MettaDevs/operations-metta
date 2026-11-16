# Alur pengiriman rawat jalan

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Endpoint Information](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) (disunting 2024-11-08) · [Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Host, autentikasi, dan referensi FHIR](../endpoint/host-dan-autentikasi.md) · [Mekanisme pengiriman FHIR di Operations Metta](../operasional/pengiriman-fhir.md)

Halaman ini menjelaskan urutan pengiriman FHIR dari pendaftaran hingga resume medis di Operations Metta.

## Prasyarat

Selesaikan [pemetaan identitas](../payload/matriks-identitas.md) untuk pasien, nakes, fasyankes, dan lokasi. Siapkan [token dan endpoint](../endpoint/host-dan-autentikasi.md#endpoint-dan-autentikasi), lalu baca [matriks rawat jalan](../payload/matriks-rawat-jalan.md) untuk memilih resource yang berlaku pada kunjungan.

## Alur pengiriman rawat jalan

Endpoint FHIR di tabel ini relatif terhadap FHIR base URL. Pemicu pengiriman adalah usulan untuk Metta. Ketentuan isi mengikuti profil dan Playbook SATUSEHAT, termasuk field wajib, kode standar, referensi, dan aturan kondisional.

| Langkah | Endpoint | Data sumber dan dependensi |
| --- | --- | --- |
| Daftar kunjungan | `POST /Encounter` | Satu per NoReg, termasuk alur rujuk internal. Pakai referensi pasien, fasyankes, lokasi, dan pelaku yang diperlukan oleh skenario. Simpan `Encounter.id` yang dikembalikan. |
| Anamnesis | `POST /Condition`, `/FamilyMemberHistory`, `/AllergyIntolerance`, `/MedicationStatement` sesuai data | Keluhan dan riwayat yang dicatat, termasuk riwayat keluarga, alergi, dan riwayat pengobatan. Bedakan keluhan, diagnosis, dan riwayat berdasarkan pemetaan Playbook. |
| Pemeriksaan fisik dan fungsional | `POST /Observation` | Tanda vital, hasil pemeriksaan, waktu pengukuran, dan pemeriksa. Pakai LOINC, UCUM, atau terminologi yang ditentukan untuk masing-masing pengukuran. |
| Diagnosis | `POST /Condition` | Satu resource per diagnosis. Gunakan ICD-10 dan padanan SNOMED CT sesuai Playbook. Kaitkan diagnosis primer dan sekunder ke Encounter saat finalisasi. |
| Tindakan klinis | `POST /Procedure`. Gunakan `POST /ServiceRequest` dan `/Observation` bila skenarionya memerlukan permintaan atau hasil diagnostik. | Pakai tindakan klinis yang benar-benar dilakukan, kode yang sesuai, tanggal atau periode, pelaku, dan diagnosis terkait bila berlaku. Baris tarif hanya boleh menjadi sumber tambahan. |
| Resep yang dikirim dokter | `POST /MedicationRequest` dengan `Medication` pada `contained` | Satu paket per obat atau kepala racikan. Gunakan identitas resep dan baris, pasien, Encounter, dokter, dosis, rute, dan terminologi obat. Simpan ID `MedicationRequest` untuk penyerahan. |
| Pengkajian resep | `POST /QuestionnaireResponse` | Saat pengkajian dilakukan, isi sesuai formulir Kemenkes `Q0007`, termasuk jawaban yang sesuai dengan `linkId`. Alur pencatatan lengkapnya belum ditemukan di docs Metta. |
| Obat diserahkan | `POST /MedicationDispense` dengan `Medication` pada `contained` | Pakai fakta **Serahkan** dari Farmasi, jumlah aktual, satuan, pelaku, lokasi, waktu, dan resep asal. Untuk obat nonracikan, KFA penyerahan adalah produk aktual `93xxxxxx`. |
| Kondisi pulang dan rujukan | `POST /Condition` untuk kondisi klinis sesuai Playbook. `POST /ServiceRequest` untuk rencana tindak lanjut atau rujukan yang berlaku. | Petakan keadaan pasien, tujuan atau jenis rujukan, instruksi, dan transportasi jika relevan. Cara keluar juga dipetakan ke `Encounter.hospitalization.dischargeDisposition`. |
| Kunjungan selesai | `PUT /Encounter/{id}` | Pakai ID balikan saat membuat kunjungan. Kirim representasi lengkap sesuai profil, dengan waktu selesai, riwayat status, lokasi, diagnosis, kondisi, dan cara pulang sesuai tahap. |
| Resume medis | `POST /Composition` | Resume merujuk Encounter dan ID resource klinis yang sudah diterima. Susun referensi per `section` mengikuti Playbook. CPPT dapat menjadi sumber catatan klinis. |

Playbook juga mencakup perjalanan penyakit, prognosis dan rasional klinis (`ClinicalImpression`), tujuan (`Goal`), rencana rawat (`CarePlan`), penilaian risiko (`RiskAssessment`), lab (`ServiceRequest`, `Specimen`, `Observation`, `DiagnosticReport`), radiologi/DICOM (termasuk `ImagingStudy`), pemberian obat (`MedicationAdministration`), diet (`NutritionOrder`), edukasi, serta alat kesehatan. Catat siapa pemilik data dan aturan pengiriman masing-masing sesuai layanan fasyankes. Pemicu yang diusulkan berasal dari fakta pelayanan. Status lunas di Kasir tidak menentukan waktu tercatatnya pemeriksaan atau penyerahan obat. [Alur integrasi Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#alur-integrasi) · [Contoh payload Rawat Jalan](https://www.postman.com/satusehat/satusehat-public/documentation/42907689-421ae3ec-01ae-440d-873c-2d425f07ee4f) · [Batas layanan klinis dan Kasir](../../17-healthcare-finance-subledger.md)
