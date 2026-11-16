# Monitoring, rekonsiliasi, dan kanal aduan SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Dashboard Monitoring Integrasi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/) (disunting 2025-07-22) · [Format Aduan](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/) (disunting 2025-07-15) · [Ringkasan Transaksi FHIR](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/transaksi-fhir/) (disunting 2025-07-23)

[Indeks SATUSEHAT](../README.md) · [Operasional pengiriman](README.md)

Panduan ini mencakup observasi transaksi melalui Developer Portal, rekonsiliasi dengan catatan pengiriman Metta, dan persiapan bukti aduan. Kode API, OAuth dan izin portal mengikuti organisasi dan lingkungan yang benar. [Dashboard Monitoring](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/) · [Format Aduan](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/)

[Akses dan tujuan setiap tampilan](#akses-dan-tujuan-setiap-tampilan) · [Rekonsiliasi dari Metta ke SATUSEHAT](#rekonsiliasi-dari-metta-ke-satusehat) · [Kanal dan bukti aduan](#kanal-dan-bukti-aduan) · [Bukti yang sudah ada dan uji berikutnya](#bukti-yang-sudah-ada-dan-uji-berikutnya)

## Akses dan tujuan setiap tampilan

| Sumber | Scope dan cara membaca |
| --- | --- |
| Respons API pengiriman | Gunakan status HTTP, `OperationOutcome` bila ada, ID resource, dan ID transaksi/korelasi yang benar-benar tersedia. Baca balik berdasarkan ID untuk memastikan resource dan relasinya. [Validasi dan error](../validasi/respons-dan-error.md) |
| Ringkasan Transaksi FHIR | Masuk Developer Portal, pilih environment, lalu lihat **Beranda**. Ringkasan menampilkan transaksi sukses HTTP 200/201 per resource. Preset tanggal yang didokumentasikan 7, 14, 30 dan 90 hari atau rentang custom. Gunakan untuk mencocokkan tren dan volume. [Ringkasan Transaksi](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/transaksi-fhir/) |
| Log Transaksi FHIR | Buka **Log Transaksi FHIR** pada environment yang sesuai. Gunakan rentang tanggal, resource, status serta pencarian ID Resource. Tampilan default mencakup 90 hari. Panduan menyebut **Download Log Transaksi** sampai enam bulan, dengan bulan/tahun dan rentang tanggal. Catatan memuat waktu, fasyankes, resource/ID dan kode hasil. [Log Transaksi](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/log-fhir/) |
| SATUSEHAT Data | Untuk selisih status monitoring interoperabilitas, dokumentasikan tampilan indikator bersama contoh Encounter dan resource terkait yang telah diverifikasi. Akses, penghitungan dan ketersediaan indikator mengikuti dashboard yang berlaku. [Aduan monitoring SATUSEHAT Data](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/monitoring-ssd-case/) |

Panduan portal menyatakan akses Sandbox tersedia bagi fasyankes dan penyedia RME terverifikasi. Akses monitoring Production tersedia bagi fasyankes terverifikasi. Sesuaikan akun dan Organization sebelum membandingkan metrik. Dashboard merupakan kanal observasi. Snapshot publik ini belum memuat endpoint programatik untuk unduhan log portal, aturan latensi tampilan, atau SLA sinkronisasi volume. Jangan menyimpulkan transaksi gagal hanya karena indikator belum muncul. [Akses Dashboard](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/)

## Rekonsiliasi dari Metta ke SATUSEHAT

Metta mempunyai event domain `outbox_events` dengan `correlation_id`, tenant, unit dan waktu. Outbox mencatat fakta aplikasi. Bukti pengiriman perlu ditautkan ke percobaan HTTP dan ID eksternal. Kolom di bawah merupakan kebutuhan pencatatan integrasi dan bukti, serta perlu dipetakan ke penyimpanan pengirim sebelum integrasi dianggap terpasang. [Outbox Metta](../../../../src/platform/events/index.ts) · [Endpoint dan mekanisme kirim](../alur/rawat-jalan.md)

| Simpan | Kegunaan |
| --- | --- |
| Environment, tenant, Organization, operasi, timestamp UTC, ID event lokal dan kunci bisnis stabil | Membedakan resource, versi dan scope. |
| HTTP status, jumlah percobaan, kategori error, Rule Number, path yang terdampak, serta status rekonsiliasi | Menentukan tindak lanjut tanpa menyalin payload. |
| ID resource, jenis dan versi balikan bila ada, serta ID transaksi portal jika tersedia | Membaca balik resource yang tepat, memeriksa duplikasi dan membandingkan log portal. |
| Bukti baca balik | Tandai waktu verifikasi serta kecocokan identifier dan referensi. Akses data rinci melalui kanal audit yang terbatas. |

1. Mulai dari fakta lokal yang diharapkan dikirim. Cocokkan event, scope, timestamp dan endpoint dengan catatan percobaan pengiriman.
2. Jika create mendapatkan `2xx` dan ID, baca balik untuk operasi yang mendukung detail. Cocokkan tipe resource, Organization, identifier dan referensi ke resource pendahulu. Pada Bundle periksa hasil per entry sesuai tipe respons.
3. Jika timeout atau body tidak diterima, tandai hasil belum pasti. Cari resource menurut ID yang sudah dimiliki, query identifier yang didukung, atau korelasi pasien/Encounter yang diizinkan. Cocokkan kandidat dengan fakta lokal sebelum melakukan retry.
4. Jika ada `400`/`422`, baca issue dan koreksi sumber atau mapping. `401`/`403` ditelusuri ke token dan akses. `429`/`5xx` dapat diulang terbatas dengan jeda setelah hasil operasi tulis direkonsiliasi. [Penanganan error](../validasi/respons-dan-error.md)
5. Bandingkan response dengan Log Transaksi pada environment, Organization dan rentang yang sama. Catat status jika log belum terlihat atau tidak sesuai. Cocokkan rentang dan definisi sukses ketika melihat ringkasan volume. Jika perbedaan berulang untuk resource yang berhasil dibaca balik, siapkan aduan dengan sampel yang relevan.

### Contoh ringkasan investigasi tersamarkan

```json
{
  "environment": "sandbox",
  "correlationId": "METTA-FIXTURE-01",
  "operation": "POST Encounter",
  "sentAtUtc": "2026-11-16T04:30:00Z",
  "httpStatus": 201,
  "resourceId": "<ID_FIXTURE>",
  "readBack": {"httpStatus": 200, "referencesMatch": true},
  "portalLog": {"state": "pending-check"},
  "ruleNumber": null
}
```

Ini bentuk catatan internal yang diusulkan. Simpan ID operasional hanya pada tempat yang dibatasi. Keluarkan token, client secret, tautan SSRME, NIK, detail medis dan header otorisasi dari log umum. Untuk arsip portal, kelola hak baca dan retensi secara terpisah.

## Kanal dan bukti aduan

Pertanyaan umum dapat diperiksa di [FAQ SATUSEHAT Platform](https://faq.kemkes.go.id/category/satusehat-platform). Halaman format aduan memberi alamat operasional `helpdesk@kemkes.go.id` dan pola subjek `SATUSEHAT Platform (SSP) - <kendala>`. Isi data institusi, jenis fasyankes/vendor, kode registrasi, OrgID, nama sistem RME, alamat kontak, kronologi, lingkungan dan bukti yang relevan sesuai jenis kendala. Sertakan sampel sebatas field yang diminta melalui kanal berwenang. [Format Aduan](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/)

| Kendala | Sebelum aduan dan data tambahan |
| --- | --- |
| Registrasi RME belum terverifikasi | Panduan membuka aduan setelah lebih dari 14 hari kerja. Sertakan status registrasi, identitas institusi dan kronologi. [Registrasi RME](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/verification/) |
| Kode akses API Production belum muncul | Jika lebih dari 3 hari kerja, catat status di DFO, REGFASYANKES atau RS ONLINE. Sertakan bukti yang menyembunyikan kredensial. [Kode akses](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/satusehat-id-null/) |
| NIK/IHS pasien atau nakes tidak ditemukan | Cocokkan identitas dengan dokumen dan environment, gunakan jalur MPI/MNI sesuai kasus. Gunakan template NIK dari halaman aduan pada kanal resmi. Identitas mentah disimpan dalam penyimpanan terbatas. [Kendala IHS](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/nik-not-found/) |
| Kendala SDMK | Gunakan FAQ SDMK dan kanal registrasi profesi pada pedoman. Halaman membedakan dokter/dokter gigi, tenaga kesehatan lain, dan Ditjen Nakes. [Kendala SDMK](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/sdmk-case/) |
| Monitoring SATUSEHAT Data tidak sinkron | Tambahkan OrgID, sampel Encounter, resource yang terlihat bermasalah, contoh ID resource relevan, rentang UTC dan status baca balik. Lampirkan tangkapan yang disamarkan sesuai kebijakan. [Monitoring SATUSEHAT Data](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/monitoring-ssd-case/) |
| Kode obat KFA kosong atau duplikat | Gunakan formulir pelaporan KFA dan cek tautan tindak lanjut dari kanal tersebut. Simpan kode kandidat, metode pencarian, dan detail produk yang perlu dibedakan. [Aduan KFA](https://satusehat.kemkes.go.id/platform/docs/id/complaint-channel/kfa-case/) · [Formulir KFA](https://s.kemkes.go.id/LaporKodeKFAObat) |

## Bukti yang sudah ada dan uji berikutnya

Bukti Sandbox saat ini mencakup OAuth, identitas fixture, Location dan Encounter awal yang diterima serta dibaca balik. Belum ada bukti portal yang terkonfirmasi untuk merekonsiliasi setiap transaksi Metta. Uji satu create dan satu error validasi. Lulus jika proses dapat mencocokkan waktu, operasi, resource, status dan korelasi API dengan tampilan portal yang tersedia, serta menyiapkan bukti aduan tanpa data yang tidak diperlukan. [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
