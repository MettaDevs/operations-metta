# Integrasi SATUSEHAT Operations Metta

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Selamat Datang](https://satusehat.kemkes.go.id/platform/docs/id/playbook/) (disunting 2025-07-23) · [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Juknis SSRME](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) (v2.0, rilis 2026-09-01)

> **Status pengujian 16 November 2026.** OAuth, pemetaan identitas fixture, pembuatan Location, dan Encounter awal `arrived` sudah terbukti di Sandbox. Pengiriman dari transaksi Metta, finalisasi Encounter, Composition, farmasi, dan SSRME masih menunggu uji. [Status bukti Sandbox](pengujian/skenario-sandbox.md#status-bukti)

Metta menyimpan data klinis, sebagian kode SATUSEHAT, dan event internal. RJ-00 mencatat transaksi klinis dan outbox Operations sebagai dasar desain. Pemicu pengiriman setelah commit dan penyimpanan ID balikan masih perlu dibuktikan dari transaksi aplikasi. [README Healthcare](../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Event dan outbox](../../../src/platform/events/index.ts) · [Hasil RJ-00](pengujian/backlog-rawat-jalan-tanpa-resep.md#hasil-uji-rj-00-sampai-rj-05)

Pekerjaan awal Rawat Jalan membedakan dua jalur integrasi.

| Jalur | Tujuan | Pemicu |
| --- | --- | --- |
| **Pengiriman FHIR R4** | Metta mengirim data layanan yang terjadi di fasyankes ke SATUSEHAT Platform. | Registrasi, hasil klinis yang telah dikonfirmasi, pengiriman resep, serah obat, dan kunjungan selesai. |
| **Akses riwayat nasional (SSRME)** | Petugas berwenang membuka riwayat nasional pasien dari halaman pelayanan Metta. | Petugas meminta akses. Persetujuan pasien atau prosedur darurat mengikuti Juknis SSRME. |

Permenkes 24/2022 Pasal 21 menetapkan interoperabilitas RME dengan platform Kementerian Kesehatan. Untuk menentukan field wajib, gunakan penanda dan ketentuan pada Playbook serta halaman resource untuk skenario yang berlaku. Misalnya, kunjungan tanpa resep tidak menghasilkan `MedicationRequest`. Fitur akses SSRME memiliki prasyarat sendiri, termasuk fasyankes yang sudah mengirim data layanan. [Permenkes 24/2022](https://jdih.kemkes.go.id/common/dokumen/2022permenkes024.pdf) · [Playbook Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) · [Juknis SSRME](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit)

## Peta dokumen

| Bagian | Isi |
| --- | --- |
| [Alur layanan](alur/README.md) | Pemicu, peran, prasyarat, urutan transaksi, rujukan, dan penyelesaian. |
| [Endpoint dan respons](endpoint/README.md) | Environment, autentikasi, metode, path, header, query, kode HTTP, dan bentuk respons. |
| [Payload dan pemetaan](payload/README.md) | Resource, field wajib atau kondisional, kardinalitas, sumber data Operations, dan contoh JSON. |
| [Terminologi](terminologi/README.md) | CodeSystem, ValueSet, ECL, dan pemetaan kode per field. |
| [Validasi dan error](validasi/README.md) | OperationOutcome, Rule Number, penyebab penolakan, dan tindakan koreksi. |
| [Pengujian dan backlog](pengujian/README.md) | Skenario Sandbox, bukti, prioritas, dependensi, dan kriteria lulus. |
| [Operasional pengiriman](operasional/README.md) | Pengiriman setelah commit, retry, rekonsiliasi, monitoring, dan aduan. |
| [Referensi dan pemeliharaan dokumen](referensi/README.md) | Cakupan, sumber resmi, versi dan tanggal, standar struktur, serta riwayat revisi. |

## Mulai dari kebutuhan Anda

- Siapkan rawat jalan dari [alur pengiriman](alur/rawat-jalan.md#alur-pengiriman-rawat-jalan), lalu cek [host dan token](endpoint/host-dan-autentikasi.md#endpoint-dan-autentikasi), [matriks field](payload/matriks-rawat-jalan.md), [contoh payload](payload/contoh-rawat-jalan-dan-farmasi.md), dan [backlog kunjungan pertama](pengujian/backlog-rawat-jalan-tanpa-resep.md).
- Untuk akses riwayat nasional, mulai dari [alur SSRME](alur/ssrme.md), kemudian lihat [endpoint](endpoint/ssrme.md#endpoint-dan-prasyarat) dan [payload](payload/ssrme.md#matriks-field-akses-ssrme).
- Untuk membaca arti field wajib dan kardinalitas, buka [aturan field FHIR](payload/aturan-field-fhir.md).
- Untuk memeriksa pembaruan, buka [inventaris sumber resmi](referensi/inventaris-sumber-resmi.md), [standar dokumentasi](referensi/standar-dokumentasi.md), dan [riwayat revisi](referensi/riwayat-perubahan.md).
