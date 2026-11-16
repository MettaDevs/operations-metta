# Zoonosis GHPR/Rabies dan pencatatan VAR/SAR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Zoonosis - Gigitan Hewan Penular Rabies (GHPR)/Rabies](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/zoonosis-rabies/) (v1.0, rilis 2024-11-16, disunting 2024-12-08) · [Immunization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload dan terminologi GHPR dan rabies](../payload/ghpr-rabies.md)

Playbook ini mencakup pencatatan gigitan atau pajanan, skrining luka, imunisasi Vaksin Anti Rabies (VAR), tindakan, dan Serum Anti Rabies (SAR) bila tercatat. Portal memberi rilis v1.0 tanggal 16 November 2024 dan menandai modul tersedia di Sandbox selama pengembangan. Buku v1.0 yang ditautkan bertanggal 30 Oktober 2024 dan menjadi acuan pemetaan di bawah. [Halaman GHPR/Rabies](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/zoonosis-rabies/) · [Buku GHPR/Rabies v1.0](https://drive.google.com/file/d/1OehqrvXbsBsdi8fnUa4DoQrOTcSmB_Ev/preview)

## Prasyarat dan data Metta

Resolve Patient, Encounter, Practitioner, Organization dan Location. Metta menyimpan data pasien, kunjungan, anamnesis, pemeriksaan, diagnosis, tindakan, obat dan batch farmasi tertentu. Perlu form khusus untuk waktu dan lokasi pajanan, jenis hewan, hasil penilaian luka, riwayat VAR, sesi dan titik injeksi, produk aktual, nomor lot, status tindakan, serta korelasi SAR. Ambil data vaksin dan serum dari sumber pemberian klinis. [Rekam medis](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Penyerahan dan batch](../payload/matriks-farmasi.md) · [Pemetaan imunisasi umum](imunisasi-dan-kipi.md)

## Alur dan operasi

| Bab | Operasi | Balikan dan korelasi |
| --- | --- | --- |
| 1–2 | Resolve IHS pasien dan buat `POST /fhir-r4/v1/Encounter` sesuai pintu masuk. | Patient, Organization, Location, Encounter dan petugas yang tepat. |
| 3 | Kirim keluhan dan riwayat sebagai Condition/Observation serta cuci luka mandiri melalui QuestionnaireResponse Q0028. Riwayat VAR dapat dicari melalui Immunization dengan filter pasien/tanggal yang didukung. | ID fakta, waktu pajanan, informasi hewan dan hasil lookup riwayat. |
| 4 | `POST /fhir-r4/v1/Observation` untuk skrining luka dan komponennya. Kirim lokasi kejadian melalui alur Location yang ditetapkan buku. | ID skrining dan representasi lokasi. Verifikasi path referensi contained sesuai contoh modul dan rules profil. |
| 5 | `POST /fhir-r4/v1/Immunization` untuk VAR yang diberikan, sesuai produk dan administrasi aktual. | Simpan ID, sesi, lot, rute serta titik tubuh. Untuk sesi dengan dua vial di titik berbeda, buku memberi contoh dua Immunization dengan nomor sesi dosis yang sama. Gunakan kunci lokal per kejadian pemberian agar retry satu titik tidak menggandakan titik lain. |
| 6–8 | `POST /fhir-r4/v1/Condition` untuk diagnosis/konteks pajanan, Procedure untuk cuci luka/VAR/SAR sesuai tabel. Tatalaksana SAR mengikuti Medication dan resource farmasi menurut fakta layanan. | Simpan ID Procedure, kode SAR, ID terkait administrasi, dan link ke Encounter. |
| 9–13 | Catat follow-up dan rujukan melalui ServiceRequest, kondisi/cara keluar dalam Encounter sesuai pintu masuk. Bila berlaku, catat Observation waktu meninggal. Finalisasi `PUT /fhir-r4/v1/Encounter/{id}`. | Baca balik Encounter serta seluruh fakta terkait. Pertahankan ID dan histori operasi. |

Operasi FHIR memakai OAuth Bearer dan host sesuai environment. `GET /fhir-r4/v1/Immunization?patient={ihs}` mendukung pencarian pasien dan filter `date` menurut katalog. Baca detail memakai `GET /fhir-r4/v1/Immunization/{id}` atau Observation/Procedure berdasarkan ID. Uji seleksi riwayat VAR dan akses antar-fasyankes sebelum implementasi. [Katalog Immunization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/) · [Kontrak HTTP](../endpoint/kontrak-fhir-http.md)

## Error, akses dan penerimaan

Catat HTTP status, `OperationOutcome.issue[]` dan Rule Number aktual saat ada kegagalan validasi. `401`/`403` memerlukan penelusuran akun dan scope. Untuk timeout, `429` atau `5xx`, rekonsiliasi per kejadian, sesi dan titik tubuh, lalu ulang secara terbatas bila sesuai. Batasi akses pasien, koordinat/alamat kejadian, data program dan hasil klinis. Log umum memakai ID yang disamarkan. [Validasi dan error](../validasi/respons-dan-error.md)

Uji Q0028, skrining dan lokasi kejadian, sejarah VAR, pemberian di dua titik pada sesi yang sama, rujuk, serta tindakan/SAR bila benar-benar disimulasikan. Lulus bila semua hasil terbaca dengan korelasi yang tepat, kode produk sesuai fixture dan retry tidak membuat imunisasi atau tindakan ganda. Bukti Sandbox Metta masih terbuka. [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
