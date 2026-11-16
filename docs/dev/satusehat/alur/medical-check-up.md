# Medical Check Up (MCU)

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Medical Check Up (MCU)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mcu/) (v1.0, rilis 2026-10-06, disunting 2026-10-05) · [Lampiran Terminologi Medical Check Up (MCU)](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mcu/) (disunting 2026-10-05)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload pemeriksaan dan resume MCU](../payload/medical-check-up.md)

Playbook MCU v1.0 (6 Oktober 2026) mengatur kunjungan, data pekerjaan, anamnesis, pemeriksaan fisik dan jiwa, penunjang, diagnosis, serta resume kesehatan dan kelaikan. Gunakan hasil yang benar-benar tercatat dan ruang lingkup paket pemeriksaan yang dilakukan. [Halaman MCU](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mcu/) · [Buku MCU v1.0](https://drive.google.com/file/d/1rnKE0RjZX8FiYhP_Ftr3PLCcW8qhrMWf/preview) · [Terminologi MCU](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mcu/)

## Data Metta dan prasyarat

Siapkan IHS Patient dan Practitioner, Organization, Location, Encounter, izin modul dan hasil yang ditandatangani oleh petugas sesuai proses. Metta menyimpan registrasi, tipe pasien/penjamin, fisik, diagnosis, tindakan, obat dan tarif. Kategori jasa MCU pada master adalah data tarif; kategori kunjungan, tujuan MCU, paket pemeriksaan, pekerjaan/satuan kerja, risiko pajanan, persetujuan klinis dan observasi status kelaikan membutuhkan sumber yang dapat ditelusuri. Petakan hasil dari pemeriksaan unit atau LIS/RIS setelah validator mengesahkan. [Healthcare Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Penjamin](../../../../modules/healthcare/README.md#penjamin) · [Klaim swasta dan bayar mandiri](klaim-swasta-dan-bayar-mandiri.md)

## Urutan transaksi

| Bab | Request / fungsi | Hasil yang disimpan |
| --- | --- | --- |
| 1–2 | Resolve MPI dan `POST /fhir-r4/v1/Encounter`. Kirim `Encounter.serviceType.coding` dengan `TK000322` dari `http://terminology.kemkes.go.id`. Kirim sosial demografi dan tujuan MCU melalui Observation; Account jika dipakai untuk pembiayaan. | IHS Patient, Encounter, Organization/Location, ID fakta dan Account. Account memakai Coverage bila menggunakan asuransi; pembiayaan mandiri mengikuti aturan Account modul. |
| 3 | Condition keluhan dan riwayat, Observation merokok, alkohol, aktivitas fisik dan jenis pajanan, QuestionnaireResponse `Q0045` skrining gejala. | ID temuan, canonical dan hubungan ke kunjungan. |
| 4–5 | `POST /fhir-r4/v1/Observation` untuk hasil fisik menurut bab 4; `POST /fhir-r4/v1/QuestionnaireResponse` `Q0033` SRQ-20 bila dinilai, serta Observation hasil terkait kesehatan jiwa. | Simpan hasil mentah, sisi pemeriksaan, waktu, dan instrumen yang digunakan. |
| 6–8 | Order dan hasil penunjang non-lab, radiologi, dan lab mengikuti paket aktual. Kirim ServiceRequest, Specimen bila diperlukan, Observation dan DiagnosticReport. Untuk citra, kaitkan ImagingStudy jika berlaku. | ID order, sampel, hasil dan laporan termasuk rincian panel. Gunakan referensi sesuai profil penunjang, jangan menggabungkan hasil paket berbeda. |
| 9–13 | Kirim CarePlan jika ada rencana, Condition, Procedure sesuai fakta, status/cara keluar, dan `PUT /fhir-r4/v1/Encounter/{id}` untuk finalisasi. | Akhiri Encounter dengan ID yang sama. Pastikan semua fakta pada resume sudah tersedia. |
| 14 | Buat Observation hubungan pekerjaan, status kesehatan, dan kelaikan jika dinilai. Setelah ID tersedia, `POST /fhir-r4/v1/Composition` resume MCU. | Simpan ID, jenis resume, scope pengguna dan seluruh referensi. Baca balik Composition dan ID yang ditautkan. |

FHIR menggunakan OAuth Bearer, JSON FHIR dan host sesuai environment. Pencarian Patient, Observation, QuestionnaireResponse dan Encounter mengikuti filter yang tersedia di [Inventaris HTTP](../endpoint/inventaris-operasi-http.md). Gunakan `GET /fhir-r4/v1/{Resource}/{id}` jika tersedia untuk verifikasi. [Kontrak HTTP](../endpoint/kontrak-fhir-http.md)

## Privasi, error dan kriteria uji

`400`/`422` diperiksa melalui `OperationOutcome.issue[]`, kode aturan dan path, terutama instrumen, satuan, tipe dan referensi. `401`/`403` memerlukan pemeriksaan role/fasilitas dan akses per pengguna. Jika respons tidak diterima, cari identifier atau ID hasil sebelum retry terbatas. Rekonsiliasi per pasien, Encounter, paket, metode dan hasil. Batasi akses status kelaikan serta hasil klinis. Pengiriman ke pihak penjamin atau pemberi kerja harus mengikuti izin dan proses yang berlaku. Log umum hanya memuat waktu, status, kode dan korelasi fixture. [Validasi dan error](../validasi/respons-dan-error.md)

Uji MCU dengan paket tanpa radiologi dan paket yang mencakup lab/radiologi bila tersedia. Lulus jika kategori Encounter dan MCU, data Account, formulir, order dan hasil, serta Composition dapat dibaca ulang, dan status kelaikan merujuk Observation yang tepat. Uji pengiriman ganda setelah timeout, referensi beda pasien dan akses pihak luar. Kontrak akses serta bukti Sandbox Metta masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
