# Tuberkulosis, SITB, dan EpisodeOfCare

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/) (v4.3, rilis 2024-11-05, disunting 2024-12-15) · [Lampiran Terminologi Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/tuberkulosis/) (disunting 2024-09-08)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload tuberkulosis dan SITB](../payload/tuberkulosis-dan-sitb.md)

Kontrak ini mengikuti Playbook Tuberkulosis v4.3 (5 November 2024). Halaman resmi mencantumkan akses modul di Sandbox selama pengembangan. Pastikan peran fasyankes, laboratorium dan program TB diaktifkan untuk akun yang digunakan. [Playbook TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/) · [Terminologi TB](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/tuberkulosis/)

## Prasyarat dan sumber Metta

Resolve Patient IHS, Practitioner IHS, Organization, Location dan Encounter sesuai pintu masuk. Metta menyimpan registrasi, pemeriksaan, anamnesis, tanda vital, diagnosis, tindakan, resep dan data penyerahan. Diperlukan data program untuk status terduga, klasifikasi TB-SO/TB-RO, kode surveilans/SITB, tautan order dan spesimen, hasil metode lab, rencana pengobatan dan hasil akhir. Korelasikan ID lokal episode, identifier nasional, pasien, organisasi dan lingkungan. [Registrasi Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Rekam medis](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Farmasi](../payload/matriks-farmasi.md)

## Operasi dan urutan klinis

| Bab | Operasi atau payload | Balikan yang disimpan |
| --- | --- | --- |
| 1–4 | Lookup Patient, buat Encounter, kirim anamnesis dan pemeriksaan. Pertahankan riwayat pengobatan, paparan dan temuan yang tercatat. | Patient, Encounter, Organization dan ID tiap fakta. |
| 5–7 | `POST /QuestionnaireResponse` Q0001 untuk klasifikasi terduga. `POST /Observation` untuk register terduga. Buat `POST /EpisodeOfCare` satu kali dengan status `waitlist` dan kaitkan Encounter. | ID EpisodeOfCare serta nomor surveilans `suspect-id` dari respons. Simpan nilai balik dan namespace aktual dari respons. |
| 8–10 | Kirim order ServiceRequest, Specimen atau ImagingStudy bila berlaku, lalu Observation, DiagnosticReport, Procedure dan Condition berdasarkan fakta. Jika pasien berasal dari rujukan, resolve identitas dan order asal sesuai [Rujukan Pasien](rujukan-pasien.md) serta [Rujukan Spesimen](laboratorium-rujukan-spesimen.md). | ID order dan hasil, tautan ke Encounter serta keputusan diagnosis dari nakes. Simpan klasifikasi dari hasil uji kepekaan beserta referensinya. |
| 11 | Setelah TB terkonfirmasi, `PATCH /EpisodeOfCare/{id}` ke `active`. Bila klinisi menetapkan bukan TB, PATCH ke `cancelled`. Bila jenis terkonfirmasi berubah dari jenis terduga, tutup episode awal sebagai `cancelled` dan `POST /EpisodeOfCare` dengan jenis yang terkonfirmasi dan status `active`. | Perubahan ke `active` terkait balikan `register-id`. Pertahankan hubungan episode awal dan aktif di Metta pada jalur perubahan jenis. Baca ulang ID dan identifier setelah setiap operasi. |
| 12–14 | `POST /Observation`, Immunization untuk status terkait yang dipetakan, dan `POST /CarePlan` untuk paduan pengobatan. Resep OAT membawa ID CarePlan menurut pemetaan program. Kirim pengkajian dan penyerahan sesuai skenario. | ID CarePlan, dokumentasi kode regimen, ID resep dan penyerahan. Untuk lookup pakai ID tersimpan atau `GET /CarePlan` dengan filter pasien yang didukung. |
| 15–17 | Catat kondisi dan cara keluar serta finalisasi `PUT /Encounter/{id}`. | Encounter dan seluruh rujukan dapat dibaca ulang dengan ID yang sama. |
| 18–19 | `PATCH /CarePlan/{id}` ke `completed` dengan outcome yang sah. `PATCH /EpisodeOfCare/{id}` ke `finished`, isi akhir periode perawatan dan histori status. | Bukti hasil akhir dan waktu penutupan. Penutupan mengikuti hasil aktual, termasuk selesai, meninggal, atau loss to follow-up dengan kriteria program berlaku. |

Path singkat relatif terhadap `/fhir-r4/v1`. Gunakan OAuth Bearer dan media type sesuai [Kontrak HTTP](../endpoint/kontrak-fhir-http.md). Pada `GET /fhir-r4/v1/EpisodeOfCare`, contoh TB memakai `patient={patient}&type=TB-SO&status=waitlist` atau `status=active` dengan pilihan `organization` sesuai koleksi. Untuk TB-RO dan akses antar-Organization, uji dengan akun dan fixture program. Cocokkan `type`, status, periode dan pengelola sebelum memilih episode. [Kueri EpisodeOfCare](../endpoint/kueri-episode-of-care.md) · [Mulai episode](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_7_memulai_episode_perawatan_tb) · [Pembaruan episode](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_11_pembaharuan_episode_perawatan_tb)

## Rekonsiliasi, error, dan Sandbox

- Saat respons create/patch hilang, cari episode pasien yang sesuai dan baca kembali status sebelum retry. Untuk perpindahan tipe, simpan langkah `cancelled` dan ID episode pengganti agar proses yang terputus dapat dilanjutkan. Pada referensi Encounter baru, pakai episode aktif yang benar.
- `400`/`422` ditelusuri melalui `OperationOutcome.issue[]`, path dan kode aturan aktual. `401`/`403` memerlukan pemeriksaan role, scope dan lingkungan. Gunakan retry terbatas untuk `429`/`5xx` atau timeout setelah rekonsiliasi. Jangan catat identitas pasien, SITB mentah, klasifikasi pasien atau data terapi pada log umum. [Validasi dan error](../validasi/respons-dan-error.md)
- Uji skenario `waitlist → active → finished`, `waitlist → cancelled`, dan perubahan tipe SO ke RO. Lulus ketika nomor surveilans/register bisa dikorelasikan, hasil klinis merujuk sampel serta episode yang benar, resep mengarah ke CarePlan dan status akhir terbaca. Tambahkan uji akses lain Organization dan replay operasi. Akses program dan bukti Sandbox Metta masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
