# Skrining Penyakit Tidak Menular (PTM)

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/) (v1.4, rilis 2024-09-25, disunting 2025-12-02) · [Lampiran Terminologi Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/skrining-ptm/) (disunting 2024-11-19)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload Composition deteksi dini PTM](../payload/skrining-penyakit-tidak-menular.md)

Panduan ini mengikuti Playbook PTM v1.4 (25 September 2024). Alur mengirim faktor risiko, pengukuran dan pemeriksaan menurut jenis deteksi dini, membuka EpisodeOfCare terduga bila pemicu terpenuhi, lalu menerbitkan Composition skrining dengan referensi per bagian. [Field per bab](../payload/profil-field-ptm.md) · [Playbook PTM](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/) · [Terminologi PTM](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/skrining-ptm/)

## Data Metta dan prasyarat

Minta IHS Patient, Practitioner, Organization dan Location yang sesuai lingkungan, lalu buat Encounter. Metta sudah menyimpan demografi, berat, tinggi, tekanan darah, kunjungan, diagnosis dan tindakan. Perlu dataset eksplisit untuk jenis deteksi dini, instrumen dan versi, faktor risiko, riwayat keluarga, bilah usia dan metode, interpretasi klinisi, hasil penunjang, Charta Prediksi Risiko, dan korelasi ID nasional. Tanda skrining lokal tidak otomatis menentukan tipe episode. [Registrasi](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Kolom tanda vital](../../../../modules/healthcare/database/migrations/0048_vital_sign_codes.sql) · [Pemetaan identitas](../payload/matriks-identitas.md)

## Flow dan operasi

| Bab | Request dan urutan | Balikan yang disimpan |
| --- | --- | --- |
| 1–2 | Resolve Patient melalui MPI dan `POST /fhir-r4/v1/Encounter`. | IHS Patient, ID Encounter, Organization, Location dan petugas. |
| 3 | Jika hasil dan diagnosis klinis memenuhi pemicu program, kirim `POST /fhir-r4/v1/EpisodeOfCare` satu kali dengan `status=waitlist`. Tautkan episode ke `Encounter.episodeOfCare[]` sesuai alur. | ID episode dan `suspect-id` dari respons. Pastikan jenis dan fase sama pada kunjungan berikutnya. |
| 4 | `POST /fhir-r4/v1/Condition` untuk fakta yang sesuai, Observation dan QuestionnaireResponse Q0013 untuk faktor risiko. | ID diagnosis/riwayat/hasil serta canonical versi instrumen. |
| 5 | Kirim hasil deteksi yang benar-benar dilakukan. Gunakan `POST /fhir-r4/v1/Observation` dan QuestionnaireResponse. Untuk pemeriksaan lab, siapkan order, sampel, hasil dan DiagnosticReport sesuai profilnya. | Referensi per pemeriksaan. Gunakan kode tes yang tepat dan jaga hubungan Patient, Encounter dan sampel. |
| 6 | `POST /fhir-r4/v1/Composition` dengan bagian untuk jenis deteksi dan `section[].entry[]` menunjuk resource yang sudah ada. | Simpan ID Composition, identifier, jenis bagian dan rujukan yang dapat dibaca. |
| 7–14 | Kirim Condition, Procedure, terapi bila ada, ServiceRequest untuk tindak lanjut/rujuk, laporan keadaan dan cara keluar. Finalisasi `PUT /fhir-r4/v1/Encounter/{id}`. | ID setiap fakta; Encounter tetap memakai ID balikan dan merujuk data program yang sah. |

Gunakan OAuth Bearer dan format JSON FHIR sesuai [Kontrak HTTP](../endpoint/kontrak-fhir-http.md). Baca detail dengan `GET /fhir-r4/v1/{Resource}/{id}` bila tersedia. Query EpisodeOfCare publik generik menggunakan `subject`; selector tipe/status dan akses per program perlu diuji. Untuk ulang kirim, cocokkan Organization, Patient, Encounter, identifier, tanggal dan jenis skrining sebelum create baru. [Inventaris operasi](../endpoint/inventaris-operasi-http.md)

### Episode skrining

Empat tipe memakai `http://terminology.kemkes.go.id/CodeSystem/episodeofcare-type`. Kirim `status` sebagai code FHIR `waitlist`, `type[]`, `patient`, `managingOrganization`, serta periode dan histori sesuai profil. Tabel Playbook menulis turunan system/code pada status; gunakan bentuk FHIR R4. Simpan `suspect-id` dengan namespace yang benar-benar diterima. Sumber pemicu adalah hasil klinis yang disahkan dan definisi Playbook. [Bab Episode PTM](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_3_memulai_episode_perawatan_jantung_stroke_uronefrologi_dan_kanker)

| Tipe | Pemicu yang ditulis Playbook |
| --- | --- |
| `CAD` | Hipertensi pertama yang didiagnosis dengan ICD-10 dan Charta risiko sedang atau tinggi. |
| `CVD` | Charta menunjukkan risiko tinggi. |
| `CKD` | Diagnosis pertama hipertensi dan/atau diabetes dengan ICD-10. |
| `cancer` | Diagnosis pertama suspek/terduga kanker. |

### Instrumen skrining

Canonical mengikuti `https://fhir.kemkes.go.id/Questionnaire/`. Kirim grup `1` dan anak yang benar-benar dijawab. Buat Observation lebih dahulu saat jawaban berisi `valueReference`. Jangan gabungkan dua instrumen dengan canonical berbeda pada satu QuestionnaireResponse.

| Instrumen | Isi |
| --- | --- |
| `Q0013` | Riwayat dan faktor risiko PTM, termasuk kelompok `1` dan anak `1.1–1.11` sesuai modul. Status merokok dalam Observation memakai LOINC `72166-2` pada pemetaan yang sesuai. |
| `Q0021` | PUMA untuk PPOK. Kelompok `1`, anak `1.1–1.9`. Penggantian dari versi lama mengubah canonical dan nomor grup. |
| `Q0019` | Kuesioner kanker paru, kelompok `1`, anak `1.1–1.8`. |
| `Q0020` | Kuesioner kanker kolorektal, kelompok `1`, anak `1.1–1.3`. |

[Faktor risiko](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_4_pengiriman_data_riwayat_dan_faktor_risiko_ptm) · [Deteksi dini](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_5_pengiriman_data_skrining_ptm)

## Error, akses dan uji

`400`/`422` diperiksa melalui `OperationOutcome.issue[]`, khususnya namespace section, canonical, ID, jenis/format nilai, dan terminologi. `401`/`403` memerlukan pemeriksaan role/Organization. Pada gangguan sementara, retry terbatas setelah cari episode atau laporan yang mungkin sudah masuk. Gunakan korelasi target pemeriksaan, waktu dan identifier. Data diagnosis, risiko, hasil skrining dan formulir dibatasi untuk petugas yang berwenang. Log umum hanya menyimpan status, kode dan korelasi tersamarkan. [Validasi dan error](../validasi/respons-dan-error.md)

Uji skrining hipertensi saja dan gabungan diabetes/stroke; pastikan section hanya mewakili pemeriksaan yang dilakukan dan seluruh entry terbaca pada pasien yang sama. Uji episode `waitlist`, revisi formulir PPOK dan dua varian kanker, referensi laboratorium salah, akses lintas organisasi, dan respons create hilang. Lulus jika ID, tipe, scope dan korelasi tetap konsisten. Implementasi Metta dan bukti Sandbox alur PTM masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
