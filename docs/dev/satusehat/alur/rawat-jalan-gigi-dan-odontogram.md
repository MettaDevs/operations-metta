# Rawat jalan gigi dan odontogram

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Gigi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/) (v1.5, rilis 2024-08-07, disunting 2025-10-02) · [Lampiran Terminologi Gigi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-jalan-gigi/) (disunting 2024-08-26)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload odontogram dan indeks gigi](../payload/rawat-jalan-gigi-dan-odontogram.md)

Panduan mengikuti Playbook Gigi v1.5 (7 Agustus 2024). Praktik umum gigi melaporkan Encounter, anamnesis dan pemeriksaan; temuan gigi terstruktur bisa ditambahkan melalui Observation odontogram serta indeks kebersihan. [Playbook Gigi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/) · [Lampiran terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/rawat-jalan-gigi/) · [Field per bab](../payload/profil-field-registrasi-dan-gigi.md)

## Prasyarat dan sumber Metta

Resolve IHS Patient dan Practitioner dokter gigi, Organization dan Location. Aktifkan panel Pemeriksaan Dasar Gigi pada section yang tepat. Metta menyimpan temuan ekstraoral/intraoral pada `sim_tr_pemeriksaan_gigi_dasar`, diagnosis ICD-10 dan posisi gigi berbentuk teks pada `sim_tr_pemeriksaan_diagnosa.posisi_gigi`, serta tindakan, resep, dan rujukan. Perlu pencatatan gigi FDI terstruktur, permukaan dan keadaan per gigi, restorasi atau protesa, hasil DI/CI/OHIS, hitung D/M/F, dan versi/koreksi odontogram. Posisi gigi pada diagnosis membantu korelasi setelah dipetakan. Isi teks bebas tidak cukup untuk menentukan seluruh odontogram. [Bagian pemeriksaan Metta](../../../../modules/healthcare/README.md#bagian-pemeriksaan-per-section) · [Identitas](../payload/matriks-identitas.md)

## Tahapan dan kontrak HTTP

| Bab | Request atau alur | Respons dan korelasi |
| --- | --- | --- |
| 1–3 | Resolve pasien, `POST /fhir-r4/v1/Encounter`; kirim keluhan, riwayat, obat dan alergi sesuai Rawat Jalan. | Simpan Patient, dokter, tempat, Encounter serta ID resource terkait. |
| 4–5 | `POST /fhir-r4/v1/Observation` untuk tanda vital, DI/CI/OHIS, odontogram dan temuan mulut yang dicatat. | Simpan ID per fakta atau pengukuran, kode gigi yang dinilai, waktu, versi dan pelaku. |
| 6 | Kirim order dan hasil penunjang yang dilakukan sesuai modul lab/radiologi. | Kaitkan order, Observation/DiagnosticReport dan Encounter. [Lab](laboratorium-rujukan-spesimen.md) · [Radiologi](radiologi-dicom.md) |
| 7–10 | `POST /Condition` dengan ICD-10 sesuai fakta; `POST /Procedure` untuk tindakan atau edukasi sesuai profil dan terminologi. Buat MedicationRequest, pengkajian dan penyerahan bila terjadi. | Simpan Condition, Procedure, resep dan dokter. Peta kondisi/tindakan ke gigi yang tepat bila profil dan data mendukungnya. [Farmasi](../payload/matriks-farmasi.md) |
| 11–16 | Gunakan data prognosis, rencana/rujukan dan cara keluar dari alur pelayanan, lalu `PUT /fhir-r4/v1/Encounter/{id}` membawa ID yang sama. | Baca ulang periode, status dan fakta yang direferensikan. |

Gunakan OAuth Bearer dan host sesuai lingkungan. Path singkat relatif terhadap `/fhir-r4/v1`. Untuk periksa kembali gunakan `GET /fhir-r4/v1/Observation/{id}`, `GET /fhir-r4/v1/Encounter/{id}`, atau query yang didukung katalog untuk hasil berdasarkan Patient dan Encounter. Cocokkan status, subjek, gigi dan waktu sebelum retry. [Kontrak HTTP](../endpoint/kontrak-fhir-http.md) · [Inventaris HTTP](../endpoint/inventaris-operasi-http.md)

## Error, ulang kirim dan uji

Saat `400`/`422` baca `OperationOutcome.issue[]`, kode validasi, dan path. Cek salah system/kode FDI, tipe komponen, konteks dan reference. Untuk `401`/`403` periksa izin unit, role dan Organization. Gunakan retry terbatas setelah lookup jika ada timeout, `429`, atau `5xx`. Kunci korelasi setidaknya membedakan Encounter, gigi, fakta, waktu dan versi. Log umum memuat status dan korelasi tersamarkan. [Validasi dan error](../validasi/respons-dan-error.md)

Uji kunjungan gigi umum, dua gigi/permukaan berbeda, indeks OHIS, D/M/F, perubahan diagnosis dan tindakan. Lulus jika kode, lokasi gigi, status, referensi dan hasil baca balik cocok dengan data fixture. Uji retry serta akses unit untuk menghindari duplikasi dan pengungkapan data klinis. Bukti Sandbox alur Gigi masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
