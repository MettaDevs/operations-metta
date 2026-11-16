# Radiologi, DICOM Router, dan NIDR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [DICOM Router](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/dicom-router/) (disunting 2026-08-26) · [Installer](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/installer-dicom/) (disunting 2024-09-09)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Endpoint dan respons radiologi dan DICOM](../endpoint/radiologi-dicom.md) · [Payload dan pemetaan radiologi dan DICOM](../payload/radiologi-dicom.md)

Panduan ini mencakup pertukaran order dan laporan FHIR serta pengiriman, pelacakan, dan pembacaan citra. Instalasi DICOM Router dan akun tujuan mengikuti onboarding fasyankes. Di Metta, sumber Patient, Practitioner, Encounter, Organization, dan Location sudah dipetakan untuk fixture rawat jalan. RIS, PACS, Modality Worklist (MWL), dan webhook DICOM masih perlu sumber dan penanggung jawab yang terverifikasi. [Playbook Rawat Jalan bab 11](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_11_pengiriman_data_pemeriksaan_penunjang_radiologi) · [Dokumentasi DICOM Router](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/dicom-router/) · [Panduan teknis radiologi, hlm. 10–22](https://drive.google.com/file/d/1KgEIaPOsPNIYvJe4snEe0vWjppE0SBBe/preview)

## Sistem dan flow

1. SIM klinik atau RIS menetapkan satu Accession Number (ACSN) untuk order, mengisi kode pemeriksaan, dan mengirim ServiceRequest dengan identitas kunjungan. Bila RIS menerbitkan ACSN, kembalikan ACSN ke rekam order sebelum sinkronisasi.
2. Modality memperoleh detail order dari MWL melalui DICOM C-FIND. Pada MWL internal, router menyiapkan data dari order yang tersedia. Pada MWL eksternal, server MWL fasyankes yang melayani modality. Uji bahwa modality mengembalikan ACSN yang sama dalam objek citra.
3. Modality atau PACS mengirim objek DICOM ke AE Title, host, dan port router memakai C-STORE. Router mencocokkan ACSN dengan ServiceRequest dan Patient kemudian mengirim metadata dan citra.
4. Petugas radiologi memfinalisasi bacaan. SIM atau RIS mengirim DiagnosticReport yang menunjuk order dan, ketika tersedia, ImagingStudy serta Observation hasil yang dipakai laporan. Simpan status laporan klinis dan status pengiriman citra secara terpisah.
5. Untuk menampilkan citra, cari ImagingStudy dengan ACSN, ambil UID studi, seri, dan instance, lalu minta hasil rendered melalui WADO-RS.

### Urutan pengiriman metadata dan citra

| Sumber | Urutan yang dijelaskan |
| --- | --- |
| Diagram umum dan panduan teknis radiologi hlm. 15 dan 19–22 | Router cocokkan ACSN → `POST ImagingStudy` → unggah objek melalui STOW-RS. |
| Rincian MWL internal dan eksternal di halaman DICOM Router serta Playbook Rawat Jalan bab 11 | Router kirim citra → menerima URL WADO → kirim ImagingStudy dengan referensi akses citra. |

Saat menyiapkan router, catat versi rilis, jenis MWL, urutan yang benar-benar muncul, dan pihak yang membuat ImagingStudy. Korelasikan berdasarkan ACSN dan StudyInstanceUID. Selesaikan rekonsiliasi sebelum mengulang langkah yang menghasilkan resource baru. [Rincian MWL pada halaman DICOM Router](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/dicom-router/) · [Panduan teknis radiologi](https://drive.google.com/file/d/1KgEIaPOsPNIYvJe4snEe0vWjppE0SBBe/preview)

## Instalasi dan kriteria uji

1. Catat versi router, AE Title, sumber MWL, port C-STORE, host callback dan pemilik kredensial untuk lingkungan uji. Konfigurasi callback pada `webhook_url`, `webhook_user`, `webhook_password`. Simpan otorisasi di konfigurasi rahasia. [Installer](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/installer-dicom/) · [Docker](https://satusehat.kemkes.go.id/platform/docs/id/dicom-system/docker-dicom/)
2. Kirim satu order fixture dengan ACSN unik dan satu studi sintetis. Lulus ketika request FHIR dapat dibaca balik, ACSN cocok hingga webhook, dan tiga UID dari studi mengembalikan citra yang sama. Cek DiagnosticReport menunjuk order dan studi yang benar.
3. Uji ACSN tidak dikenal, kredensial webhook salah, unggah terputus setelah ImagingStudy terbentuk, dan webhook terkirim ulang. Lulus ketika kegagalan dapat dilacak sampai komponen asal, hasil ulangan terkorelasi dengan order yang sama, dan jumlah studi untuk pengiriman tersebut sesuai bukti baca balik.
4. Untuk bukti internal, simpan ID korelasi fixture, waktu, tahap, status HTTP dan kode error. Keluarkan header otorisasi, body citra, metadata pasien, dan UID klinis dari log umum.

Bukti uji DICOM Metta masih terbuka. [SB-08 Lab dan radiologi](../pengujian/skenario-sandbox.md#sb-08-lab-dan-radiologi) · [Sumber klinis Metta](../../../../modules/healthcare/README.md)
