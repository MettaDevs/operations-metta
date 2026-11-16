# Klaim asuransi swasta, penjamin tambahan, dan bayar mandiri

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim/) (v1.3, rilis 2026-01-06, disunting 2025-12-02) · [Lampiran Terminologi Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim/) (disunting 2024-09-04)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload klaim swasta dan bayar mandiri](../payload/klaim-swasta-dan-bayar-mandiri.md)

Rujukan utama adalah Playbook Pembiayaan Kesehatan Klaim Asuransi Swasta/Non BPJS v1.3 (6 Januari 2026). Portal publik menandai modul tersedia di Sandbox selama pengembangan. Skenarionya mencakup primary payor, Asuransi Kesehatan Tambahan (AKT) sebagai secondary payor, dan Out of Pocket (OOP). [Playbook Klaim Swasta](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim/) · [Buku publik v1.3](https://drive.google.com/file/d/1Od2YIYiTUZIzf9R7CjkzRuHmIfcUeszL/preview)

[Prasyarat dan pemetaan Metta](#prasyarat-dan-pemetaan-metta) · [Primary payor](#primary-payor) · [Secondary payor dan OOP](#secondary-payor-dan-oop) · [Webhook, akses, dan respons gagal](#webhook-akses-dan-respons-gagal) · [Uji dan bukti](#uji-dan-bukti)

## Prasyarat dan pemetaan Metta

Siapkan Organization fasyankes, lokasi, pasien, nakes dan Organization penjamin atau Third Party Administrator (TPA) yang berwenang. Pencarian dan callback perlu hak akses antar-organisasi. Simpan penjamin dan nomor kartu yang dipakai pasien dari konteks registrasi. Pisahkan nomor polis, nomor peserta utama, nomor beneficiary, nomor SEP penjamin, dan ID resource. Metta sudah punya cara bayar, penjamin, kunjungan dan nilai tindakan. Hubungan polis/TPA, eligibilitas, persetujuan layanan, klaim, dan pembayaran dari penjamin masih perlu kontrak lokal. [Penjamin Metta](../../../../modules/healthcare/README.md#penjamin) · [Kunjungan Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Biaya tindakan](../../../../modules/healthcare/README.md#biaya-tindakan-dan-e-resep)

## Primary payor

Path FHIR relatif ke `/fhir-r4/v1`, gunakan Bearer dan JSON FHIR dari [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md). Buku publik menjelaskan operasi berdasarkan resource dan memberikan referensi koleksi. Path non-FHIR dan izin aktual dikonfirmasi per peran dengan contoh modul.

| Tahap | Request dan pemilik | Respons atau state yang dipakai |
| --- | --- | --- |
| 1.1–1.2 Kepesertaan | Penjamin menerbitkan `Coverage`, fasyankes mencari dengan `GET /Coverage?patient={patient-ihs}`. | Searchset dan Coverage terpilih, termasuk penerima manfaat, penjamin/TPA, nomor peserta, periode dan benefit terkait. |
| 1.3–1.5 Registrasi dan laporan awal | Fasyankes menyiapkan Encounter, Account dan RME awal. Account memuat Coverage dan prioritas; hubungkan Account ke Encounter. Laporan awal mengikuti profil pelayanan. | Simpan ID Encounter, Account dan data klinis awal. Pastikan dapat direferensikan untuk eligibilitas. |
| 1.6–1.9 Eligibilitas | Fasyankes `POST /CoverageEligibilityRequest` dengan Coverage dan `supportingInfo[]` ke Account, Encounter dan data yang diperlukan. Penjamin membaca request melalui notifikasi/pencarian, kemudian `POST /CoverageEligibilityResponse`. | Cocokkan respons ke ID request. Respons positif memakai SEP pada `identifier[].system=http://sys-ids.kemkes.go.id/claim-number/{organization-id}`. Jika tidak disetujui, SEP tidak diterbitkan. Simpan benefit, kelas, excess atau alasan yang diberikan penjamin. |
| 1.10–1.13 Billing dan persetujuan | Fasyankes mengirim `ChargeItem` untuk meminta persetujuan tarif. Penjamin memperoleh notifikasi dan dapat `GET /ChargeItem/{id}`. Penjamin mengirim JSON non-FHIR `ChargeItemResponse`. | Prosesor menambahkan hasil pada `ChargeItem.extension.chargeItemResponse`. Fasyankes membaca lewat webhook atau `GET /ChargeItem/{id}`. Urutan pertama memuat hasil primary payor. |
| 1.14–1.17 RME, invoice, klaim | Lengkapi data klinis dan kirim `Invoice` dengan baris ChargeItem. Fasyankes `POST /Claim`. Penjamin mendapat webhook dan dapat mencari Claim berdasarkan SEP atau memakai operasi `Claim Everything` untuk data pendukung sesuai akses. | Simpan ID Invoice, Claim, SEP dan referensi Encounter. Path `Claim Everything` dan parameter khusus pencarian SEP perlu bukti koleksi. |
| 1.18–1.19 Verifikasi | Penjamin `POST /ClaimResponse`. Fasyankes dapat `GET /ClaimResponse?request={claim-id}` atau mencari berdasarkan SEP sesuai koleksi. | `Claim.insurance[].claimResponse` dipasang prosesor pada klaim yang sesuai. Baca status, outcome, alasan, adjudication per item, total, excess dan pembayaran yang diberitahukan. |
| 1.20–1.21 Pembayaran | Penjamin mengirim `PaymentReconciliation` dan `PaymentNotice`. Fasyankes menerima notifikasi serta dapat mencari `GET /PaymentReconciliation?detail-request={claim-id}` dan `GET /PaymentNotice` menurut selector modul. | Cocokkan referensi request/response, jumlah, mata uang, tanggal, pihak penerima dan status pembayaran dengan rekonsiliasi kasir. |

## Secondary payor dan OOP

| Varian | Aturan dan urutan |
| --- | --- |
| AKT, bab 2.1–2.7 | Cari cakupan AKT seperti penjamin pertama, perbarui Account dengan prioritas yang sesuai, lalu buat CoverageEligibilityRequest untuk AKT dengan `supportingInfo[].sequence` dan `information` yang menunjuk ClaimResponse primary payor. AKT menanggapi melalui CoverageEligibilityResponse. |
| AKT, bab 2.8–2.16 | AKT mengirim ChargeItemResponse dan JSON non-FHIR `BillingStatus` untuk notifikasi billing. Hasil per penjamin muncul sebagai urutan terpisah di extension ChargeItem. Teruskan Invoice, Claim, ClaimResponse dan notifikasi pembayaran menurut alur AKT. Kaitkan hasil dengan coverage dan penjamin masing-masing. |
| OOP, bab 3 | Fasyankes mengirim Encounter, RME, Account, ChargeItem dan Invoice sesuai layanan; kemudian mencatat pembayaran melalui PaymentReconciliation dan PaymentNotice. Untuk OOP, `PaymentNotice.request` menunjuk Invoice. Rekonsiliasi terhadap transaksi bayar mandiri. |

## Webhook, akses, dan respons gagal

- Kemenkes meneruskan payload terenkripsi ke URL webhook yang diset di Developer Portal. Event dari fasyankes meliputi CoverageEligibilityRequest, ChargeItem, dan Claim. Event dari asuransi meliputi CoverageEligibilityResponse, ChargeItemResponse, BillingStatus, ClaimResponse, PaymentReconciliation dan PaymentNotice. Penerima memproses notifikasi dan mengirim respons melalui operasi sesuai peran.
- Bab 4.2 memberikan URL unduh paket melalui Bearer `GET https://api-satusehat.kemkes.go.id/webhook-fasyankes` dan `GET https://api-satusehat.kemkes.go.id/webhook-asuransi`. Respons unduh adalah ZIP terbatas untuk pihak berwenang. Contoh uji paket memakai `POST http://localhost:1234/webhook`. Host sandbox untuk unduh, format enkripsi dan header callback di lingkungan yang diaktifkan, skema ack, serta retry perlu ditelusuri dari paket dan konfigurasi mitra.
- Jika webhook terlambat, tarik resource dan verifikasi status terbaru berdasarkan ID atau selector terdokumentasi. Deduplikasi menurut organisasi, ID dan tahap. Terapkan kondisi yang menjaga hasil final saat callback lama datang sesudah hasil terbaru.
- Jika hasil FHIR berupa `OperationOutcome`, catat status HTTP, severity, code, expression dan Rule Number bila tersedia. Kelompokkan `401`/`403` sebagai akses, `400`/`422` sebagai validasi, dan `429`/`5xx` sebagai sementara sesuai respons. Jika timeout sesudah create, rekonsiliasi identifier sebelum retry. Penolakan eligibilitas, persetujuan nilai parsial, excess, dan hasil verifikasi negatif merupakan hasil bisnis.
- Simpan hanya korelasi internal yang diperlukan dalam log umum. Batasi akses terhadap nomor kartu, SEP, dokumen, data RME, nominal rinci dan payload terenkripsi maupun hasil dekripsinya. [Buku publik v1.3, bab 4](https://drive.google.com/file/d/1Od2YIYiTUZIzf9R7CjkzRuHmIfcUeszL/preview) · [Validasi dan error](../validasi/respons-dan-error.md)

## Uji dan bukti

| Skenario | Lulus ketika |
| --- | --- |
| Primary payor | Penjamin dan fasyankes memakai izin masing-masing. Eligibilitas, persetujuan ChargeItem, invoice, ClaimResponse dan pembayaran dapat dirunut sampai Encounter, nomor polis dan SEP fixture. |
| AKT | Coverage AKT berprioritas sesuai Account. Eligibilitas mereferensikan ClaimResponse utama, billing primer/sekunder dibaca sesuai urutannya, dan excess serta pembayaran direkonsiliasi per penjamin. |
| OOP | Pembayaran yang cocok dapat ditelusuri ke Invoice dan transaksi kasir. PaymentNotice menggunakan referensi Invoice sesuai bab OOP. |
| Komunikasi, callback, dan error | Pesan administratif terkait objek yang benar. Callback duplikat, webhook terputus, respons tanpa SEP, akses organisasi salah, dan error validasi menimbulkan status yang tepat serta dapat direkonsiliasi lewat baca balik. |

Modul klaim swasta, AKT, OOP dan komunikasi belum punya bukti Sandbox Metta. [Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
