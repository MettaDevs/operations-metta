# Akses riwayat nasional lewat SSRME

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Juknis SSRME](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) (v2.0, rilis 2026-09-01) · [Panduan SDM Kesehatan](https://docs.google.com/presentation/d/1KQ8T9xGq3IQLB1u81hlU_O1kr3-kdTpPuUUI0jtDjdk/edit) (tanggal revisi tidak tercantum) · [Postman SATUSEHAT RME](https://www.postman.com/satusehat/satusehat-public/collection/3la2mhe/satusehat-rme?sideView=agentMode) (Overview menampilkan 2026-09-04)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Endpoint dan respons SSRME](../endpoint/ssrme.md) · [Payload dan matriks field SSRME](../payload/ssrme.md)

Dokumen ini mencakup CHLink dan SHLink v2. Kontrak berasal dari Juknis dan Postman, sedangkan hasil uji langsung untuk kedua endpoint tersebut masih tercatat sebagai belum diuji. [Pemetaan identitas](../payload/matriks-identitas.md) · [Skenario akses Sandbox](../pengujian/skenario-sandbox.md#sb-10-akses-ssrme) · [Referensi dan versi](../referensi/cakupan-rawat-jalan-dan-ssrme.md#referensi-dan-penggunaannya)

Persetujuan klinis dan kebijakan yang dicatat melalui resource FHIR Consent dibahas pada panduan TTE. Hak akses riwayat mengikuti hasil persetujuan SSRME v2. [TTE dan Consent](../payload/tanda-tangan-elektronik-dan-consent.md#fhir-consent-persetujuan-klinis-dan-akses-ssrme)

## Prasyarat

Sistem RME sudah terintegrasi dan data pelayanan tersedia. Alur normal memerlukan KYC pasien. Identitas pasien, nakes, SIP yang berlaku, organisasi, serta wewenang petugas mengikuti [persyaratan Juknis](../endpoint/ssrme.md#endpoint-dan-prasyarat).

## Alur akses

1. Dari kunjungan yang sedang dilayani, pastikan petugas berwenang dan pasien, nakes penanggung jawab, serta organisasi punya identitas SATUSEHAT yang sesuai. KYC pasien dan SIP nakes mengikuti Juknis SSRME.
2. Backend memperoleh token OAuth. Panggil `POST /ssrme/v2/ntl/chl` dengan konteks pasien, nakes, dan organisasi untuk mendapatkan `data.verificationUrl` serta masa berlakunya.
3. Pada alur normal, pasien membuat kode akses di SATUSEHAT Mobile dan memberikannya kepada admisi atau perawat berwenang untuk dipakai pada tautan verifikasi. Panduan SDM menyebut masa berlaku kode akses pasien 24 jam. Masa berlaku tautan CHLink dan SHLink dibaca dari `expiredAt` masing-masing respons.
4. Panggil `POST /ssrme/v2/ntl/shl` untuk mendapatkan `data.shlinkUrl`. Petugas membuka tautan itu dari konteks kunjungan. Bila `403` dengan `CONSENT_REQUIRED`, tampilkan status persetujuan dan arahkan ke proses consent.

Pada alur darurat, petugas berwenang mencatat alasan serta data pengantar atau wali pada alur persetujuan darurat. Juknis menunjukkan `type_medical_summary: "EMERGENCY"` untuk permintaan CHLink dalam alur ini. Validasi penggunaan field itu pada setiap request yang berlaku di SB-10. Dokter membuka riwayat saat memberikan layanan dan akses tercatat dalam riwayat pasien sesuai panduan SDM. [Juknis, slide 14 dan 42–48](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) · [Panduan SDM, slide 11–12 dan 20–22](https://docs.google.com/presentation/d/1KQ8T9xGq3IQLB1u81hlU_O1kr3-kdTpPuUUI0jtDjdk/edit)
