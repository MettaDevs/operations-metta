# Upaya Berhenti Merokok (UBM)

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Upaya Berhenti Merokok (UBM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/ubm/) (v1.1, rilis 2025-06-17, disunting 2026-09-10)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload dan terminologi upaya berhenti merokok](../payload/upaya-berhenti-merokok.md)

Playbook UBM mencakup konseling awal, program intensif, program lanjutan, pemeriksaan penunjang, target perawatan, farmakoterapi dan follow-up. Portal mencantumkan v1.1 tanggal 17 Juni 2025, termasuk variasi rujukan Brief Advice. Header buku pada tanggal yang sama masih menulis v1.0, sementara tabel perubahan buku memuat v1.1. Portal menandai modul tersedia di Sandbox selama pengembangan. [Halaman UBM](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/ubm/) · [Buku UBM, 17 Juni 2025](https://drive.google.com/file/d/1DIzkdl8Oo6cm45CfBbAO1kn9q-4pApqE/preview)

## Prasyarat dan data Metta

Resolve Patient, Practitioner, Organization dan Location. Siapkan tanggal, kanal dan sumber rujukan, status merokok, jawaban kuesioner, pemeriksaan dan keputusan program. Metta punya data demografi, registrasi/pemeriksaan, penanggung jawab, diagnosis, tindakan dan resep. Perlu pencatatan versi instrumen, pengukuran CO/kotinin, kesiapan berhenti, Goal, CarePlan, seri konseling, rujukan lanjutan, dan status hasil per program. Untuk riwayat sederhana pada kegiatan Posyandu ikuti [PKPR](pkpr-luar-gedung.md). [Kunjungan Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan)

## Flow dan operasi

| Bab | Request / fungsi | Data yang disimpan |
| --- | --- | --- |
| 1–2 | Resolve MPI dan `POST /fhir-r4/v1/Encounter`. Isi kelas sesuai kanal, `hospitalization.admitSource` untuk konseling awal, dan `basedOn[]` untuk kunjungan intensif/lanjutan dari order konseling. | ID dan korelasi Encounter asal, lokasi, kanal dan order, bila berlaku. |
| 3.1–3.3 | Kirim fakta fisik, sosial dan konseling awal. Pakai Observation, Condition, MedicationStatement dan `POST /fhir-r4/v1/QuestionnaireResponse` Q0029 sesuai fakta. | ID pemeriksaan, canonical formulir, versi, jawaban dan pelaku. |
| 3.4–3.5 | Kirim follow-up program intensif (Q0030) atau lanjutan (Q0031) per sesi; referensikan hasil CO, kotinin atau pengobatan jika menjadi jawaban modul. | Encounter, waktu sesi, instrumen dan ID hasil. Data hasil baru dicatat saat diperiksa, dengan hubungan ke rencana. |
| 4 | Kirim ServiceRequest, Specimen, Observation dan DiagnosticReport untuk kotinin bila dilakukan. | ID order/sampel/hasil/laporan. Gunakan referensi pada jawaban yang meminta hasil. |
| 5–6 | Kirim Goal dan CarePlan ketika keputusan klinis dicatat. Kaitkan Goal ke CarePlan dan order sesi berikut melalui `CarePlan.activity[].reference` bila ada. | Simpan ID Goal dan CarePlan. Kaitkan dengan pasien, Encounter/kunjungan dan fase. Baca balik `CarePlan.status` setelah perubahan. |
| 7–9 | Kirim Condition dan Procedure menurut temuan. Untuk anjuran farmakoterapi, `POST /fhir-r4/v1/MedicationRequest` memakai `intent=proposal` dengan Medication contained. Pengeluaran obat mengikuti profil layanan bila terjadi. | Kode diagnosis, tindakan, ID rekomendasi/resep dan ID pemberian/penyerahan bila dicatat. |
| 10–12 | Buat ServiceRequest konseling lanjutan, isi kondisi dan tindak lanjut, finalisasi `PUT /fhir-r4/v1/Encounter/{id}`. | Simpan ID ServiceRequest sebagai `Encounter.basedOn[]` pada kunjungan berikut sesuai program. |

FHIR memakai Bearer dan basis URL per environment. Gunakan `GET /fhir-r4/v1/{Resource}/{id}` untuk detail bila didukung. `GET /QuestionnaireResponse` mendukung filter pasien/Encounter sesuai katalog. Pastikan query CarePlan, status pembaruan, dan izin per role sesuai katalog dan contoh UBM. [Kontrak HTTP](../endpoint/kontrak-fhir-http.md) · [Inventaris operasi](../endpoint/inventaris-operasi-http.md)

## Error, keamanan dan uji

`400`/`422` diperiksa dari HTTP, `OperationOutcome.issue[]`, path dan Rule Number. `401`/`403` memerlukan pemeriksaan role dan lingkungan. Untuk timeout atau gangguan sementara, baca balik ID, identifier, fase dan Encounter sebelum retry. Gunakan kunci lokal per sesi. Log umum mencatat korelasi tersamarkan, waktu, status dan kode error. Batasi akses pada riwayat perilaku, hasil pemeriksaan dan payload. [Penanganan error](../validasi/respons-dan-error.md)

Uji konseling awal, slot intensif melalui order lanjut, transisi ke program lanjutan, CO/kotinin bila dilakukan, Goal/CarePlan, dan anjuran farmakoterapi. Lulus ketika ID dan request saling terkait, status program dapat dibaca balik, formulir sesuai fase, dan kegagalan akses atau respons yang hilang bisa ditangani tanpa duplikasi. Bukti Sandbox Metta masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
