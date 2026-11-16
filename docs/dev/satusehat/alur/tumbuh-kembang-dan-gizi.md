# Tumbuh Kembang, SDIDTK, dan pelayanan Gizi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tumbuh Kembang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/) (v3.0, rilis 2024-04-02, disunting 2025-10-02) · [Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/) (v4.0, rilis 2024-11-04, disunting 2025-10-02) · [Lampiran Terminologi Gizi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/gizi/) (disunting 2024-11-19)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload tumbuh kembang dan gizi](../payload/tumbuh-kembang-dan-gizi.md)

Panduan ini mencakup Tumbuh Kembang v3.0 (2 April 2024) dan Gizi v4.0 (4 November 2024). Tumbuh Kembang merekam antropometri serta hasil pemantauan atau deteksi dini melalui Q0003. Gizi mencakup skrining sesuai populasi, asesmen, masalah, intervensi dan evaluasi. Hasil ukur, interpretasi dan rencana terapi memiliki sumber klinis masing-masing. [Playbook Tumbuh Kembang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/) · [Playbook Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/)

## Prasyarat dan sumber Metta

| Data | Sumber dan gap |
| --- | --- |
| Identitas, usia, kunjungan, dan kelompok | Healthcare menyimpan pasien, tanggal lahir, registrasi, klaster ILP dan jenis layanan. Gunakan usia pada tanggal evaluasi sesuai instrumen, serta konteks kehamilan bila relevan. [Klaster ILP Metta](../../../../modules/healthcare/README.md#klaster-dan-siklus-hidup-ilp) |
| Pengukuran | Berat dan tinggi tersimpan di registrasi dan pemeriksaan fisik. Gunakan nilai dan waktu dari pengukuran yang dipakai klinisi. Panjang telentang, tinggi berdiri, lingkar kepala/lengan, z-score dan metode penilaian perlu sumber terstruktur yang dapat ditelusuri. [Kolom tanda vital](../../../../modules/healthcare/database/migrations/0048_vital_sign_codes.sql) |
| Hasil skrining dan intervensi | Panel rekam medis umum menyediakan gejala/diagnosis/tindakan; perlu jawaban per linkId, versi instrumen, hasil yang dinilai, rencana diet, monitoring dan catatan determinan/MPASI. Data tersebut harus terhubung ke pelaku dan peristiwa layanan. [Rekam medis](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) |

## Alur HTTP dan dependensi

| Tahap | Operasi utama | Hubungan dan hasil |
| --- | --- | --- |
| Identitas dan kunjungan | Resolve Patient melalui MPI, buat Encounter sesuai pintu masuk. | Simpan ID Patient, Encounter, Organization, nakes dan lokasi yang berlaku. |
| Anamnesis dan asesmen | Buat Condition dan resource riwayat sesuai profil layanan. `POST /fhir-r4/v1/Observation` untuk berat, tinggi, nilai z-score, status nutrisi, konsumsi dan fakta yang benar-benar dicatat. | ID hasil ukur dan Observation penilaian. Kalau tersedia, tautkan sumber pemeriksaan dan hasil sebelumnya sesuai profil. |
| Instrumen skrining | `POST /fhir-r4/v1/QuestionnaireResponse` memakai Q0003, Q0014, Q0024, Q0025 atau Q0026 sesuai program. | Simpan ID setiap respons, canonical Questionnaire dan versi instrumen lokal. Untuk jawaban `valueReference`, pastikan Observation atau Condition sudah tersedia. |
| Masalah dan intervensi | `POST /fhir-r4/v1/Condition` untuk masalah gizi yang ditetapkan, `POST /fhir-r4/v1/NutritionOrder` untuk intervensi sesuai alur, dan Procedure untuk tindakan/edukasi yang tercatat. | Pisahkan hasil skrining, penilaian klinis serta order diet. Simpan ID atau rujukan dari respons, dan pastikan role akun diizinkan. [Contoh POST NutritionOrder](https://www.postman.com/satusehat/satusehat-public/documentation/42907689-fcb0003a-e9ec-42f4-8c21-77ae19d83e25?entity=request-42907689-c426a5ee-e79c-4b4b-a5e7-63662760f64e) |
| Monitoring | Tulis pengukuran lanjutan yang benar-benar dilakukan sebagai Observation baru dengan tanggal aktual. Gunakan alur asesmen untuk pemantauan asupan, antropometri, temuan lab dan perkembangan. | Korelasikan intervensi dan hasil sebelum/sesudah. Penunjang mengikuti [Kontrak Lab](laboratorium-rujukan-spesimen.md). |
| Tindak lanjut dan selesai | Gunakan ServiceRequest untuk rujukan/tindak lanjut, Condition dan Encounter untuk keadaan atau cara keluar sesuai alur, lalu `PUT /fhir-r4/v1/Encounter/{id}`. | Baca balik hasil dan pastikan seluruh referensi tepat. Untuk rawat inap/IGD, ikuti disposition pintu masuk. |

Gunakan OAuth Bearer, basis URL per environment, dan media type sesuai [Kontrak FHIR](../endpoint/kontrak-fhir-http.md). Baca detail dengan `GET /fhir-r4/v1/Observation/{id}` dan `GET /fhir-r4/v1/QuestionnaireResponse/{id}` bila akses tersedia. Search sesuai [Inventaris HTTP](../endpoint/inventaris-operasi-http.md), termasuk pasien/Encounter untuk QuestionnaireResponse dan filter Observation yang didokumentasikan. Cocokkan `subject`, `encounter`, `status` dan `questionnaire`, plus ID hasil yang dirujuk.

## Error, akses dan Sandbox

- Untuk `400`/`422` periksa `OperationOutcome.issue[]`, terutama code system, struktur `item[]`, tipe nilai atau reference. Konfirmasi token, scope dan Organization saat `401`/`403`. Pada timeout, cari hasil dengan ID/identifier atau korelasi Encounter sebelum mengulang. Gunakan retry terbatas untuk error sementara. [Validasi dan error](../validasi/respons-dan-error.md)
- Uji data mentah dan z-score pada umur yang sesuai, pilihan instrumen anak/dewasa/hamil, Q0003 lengkap, korelasi hasil Q0014, NutritionOrder dan pemantauan MPASI. Skenario negatif memeriksa ukuran yang salah satuan, hasil berupa ID yang salah, layanan berulang dan dua hasil pada waktu berbeda.
- Lulus jika resource dapat dibaca balik dengan subjek, kode, nilai/interpretasi, linkId serta referensi yang tepat tanpa kehilangan pengukuran awal karena retry. Simpan kode respons, korelasi fixture dan bukti tersamarkan. Batasi akses identitas, data keluarga, hasil penilaian dan lampiran klinis.

Belum ada bukti Sandbox Metta untuk kedua program. [Field program anak](../payload/profil-field-imunisasi-dan-anak.md) · [Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
