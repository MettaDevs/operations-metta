# Endpoint dan respons SSRME

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Juknis SSRME](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) (v2.0, rilis 2026-09-01) · [Panduan SDM Kesehatan](https://docs.google.com/presentation/d/1KQ8T9xGq3IQLB1u81hlU_O1kr3-kdTpPuUUI0jtDjdk/edit) (tanggal revisi tidak tercantum) · [Postman SATUSEHAT RME](https://www.postman.com/satusehat/satusehat-public/collection/3la2mhe/satusehat-rme?sideView=agentMode) (Overview menampilkan 2026-09-04)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Akses riwayat nasional lewat SSRME](../alur/ssrme.md) · [Payload dan matriks field SSRME](../payload/ssrme.md)

## Endpoint dan prasyarat

| Lingkungan | Base URL SSRME v2 | Metode dan path relatif |
| --- | --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id/ssrme/v2` | `POST /ntl/chl` dan `POST /ntl/shl` |
| Production | `https://api-satusehat.kemkes.go.id/ssrme/v2` | `POST /ntl/chl` dan `POST /ntl/shl` |

Request memakai `Authorization: Bearer <access_token>` dan `Content-Type: application/json` sesuai contoh Juknis v2.0. OAuth mengikuti [endpoint autentikasi](host-dan-autentikasi.md#endpoint-dan-autentikasi). Cocokkan kredensial dengan environment dan Organization pada payload. Koleksi Postman memakai objek JSON langsung untuk CHLink dan SHLink di Sandbox. Juknis juga menampilkan ilustrasi pesan terenkripsi. Penerimaan format wire perlu dibuktikan pada uji kontrak. [Juknis SSRME v2.0, slide 24–27 dan 34–37](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) · [Koleksi Postman SSRME v2](https://www.postman.com/satusehat/satusehat-public/collection/3la2mhe/satusehat-rme?sideView=agentMode)

Prasyarat Juknis mencakup sistem RME yang sudah terintegrasi, data pelayanan tersedia, KYC SATUSEHAT Mobile untuk alur normal, identitas pasien dan nakes, SIP nakes yang berlaku untuk fasyankes terkait, serta Organization sesuai kredensial. Verifikasi hak akses petugas dalam konteks kunjungan yang dilayani. [Juknis, slide 12 dan 45](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) · [Panduan SDM Kesehatan, slide 9–12](https://docs.google.com/presentation/d/1KQ8T9xGq3IQLB1u81hlU_O1kr3-kdTpPuUUI0jtDjdk/edit)

## Cakupan koleksi Postman

Pemeriksaan Overview dan ekspor publik pada 2026-11-16 menemukan tiga request dan delapan contoh respons. Tanggal yang tampil pada Overview adalah 2026-09-04. Urutan layanan, persetujuan pasien, dan akses darurat dicatat pada [alur SSRME](../alur/ssrme.md). Alur darurat bersumber dari Juknis. Ekspor Postman tidak memuat request darurat tersendiri. [Koleksi Postman SATUSEHAT RME](https://www.postman.com/satusehat/satusehat-public/collection/3la2mhe/satusehat-rme?sideView=agentMode)

| Request Postman | Operasi | Contoh respons yang tersimpan |
| --- | --- | --- |
| Generate Token | `POST /oauth2/v1/accesstoken?grant_type=client_credentials`, form `client_id` dan `client_secret` | HTTP 200 dengan `access_token`, `token_type`, dan `expires_in`. [Kontrak OAuth](host-dan-autentikasi.md#endpoint-dan-autentikasi) |
| Membuat consent health link | `POST /ssrme/v2/ntl/chl` | HTTP 200 berhasil, tiga contoh HTTP 400, dan satu contoh HTTP 500. [Field request](../payload/ssrme.md) |
| Membuka RME Nasional | `POST /ssrme/v2/ntl/shl` | HTTP 200 berhasil dan HTTP 403 `CONSENT_REQUIRED`. [Field request](../payload/ssrme.md) |

## Respons dan penanganan

| Hasil | Bentuk dari Juknis dan Postman | Tindakan di Metta |
| --- | --- | --- |
| CHLink berhasil | HTTP 200. `success` benar, `data.shlinkId`, `data.verificationUrl`, `data.expiredAt`, dan `request_id` | Gunakan tautan verifikasi untuk kasus yang sama dalam batas masa berlaku. Status lokal masih menunggu persetujuan sampai SHLink bisa dibuat atau ada bukti persetujuan yang sesuai kontrak. |
| SHLink berhasil | HTTP 200. `success` benar, `data.consentId`, `data.shlinkUrl`, `data.expiredAt`. Contoh Juknis juga memuat `partial` dan `warnings` | Periksa masa berlaku dan petugas berwenang. Jika respons memuat `partial` atau peringatan, uji arti dan cara menampilkannya sebelum menganggap riwayat lengkap. |
| Persetujuan diperlukan | HTTP 403 dengan `data.code=CONSENT_REQUIRED` | Kembali ke alur persetujuan sesuai konteks pasien. Jangan menampilkan tautan lama atau melakukan retry otomatis SHLink. |
| Token tidak sah | HTTP 401 atau fault autentikasi pada contoh Juknis | Periksa token dan konfigurasi, perbarui token kedaluwarsa, dan catat korelasi yang aman. |
| Organization salah saat membuat CHLink | HTTP 400. Contoh Postman memuat `success=false`, `code=400`, dan `data` berupa string `wrong organization`. Contoh itu tidak memuat `request_id`. | Cocokkan Organization pada payload dengan fasyankes dan kredensial aktif. |
| Patient tidak ditemukan saat membuat CHLink | HTTP 400. Contoh Postman memakai `message` dan `request_id`. | Verifikasi Patient IHS pada konteks kunjungan dan environment. Ulangi setelah pemetaan benar. |
| Practitioner tidak ditemukan saat membuat CHLink | HTTP 400. Contoh Postman memakai `message` dan `request_id`. | Verifikasi Practitioner IHS nakes yang berwenang pada kunjungan. Ulangi setelah pemetaan benar. |
| Layanan gagal membuat CHLink | HTTP 500. Contoh Postman memakai `status`, `error`, `message`, `meta`, dan `request_id`. `meta` dapat memuat identitas dari request. | Gunakan status HTTP aktual dan korelasi yang aman. Hindari mencatat `meta` mentah. Pastikan konteks dan status persetujuan masih sesuai ketika petugas mencoba lagi. |

Simpan token di backend sesuai desain autentikasi. Gunakan HTTPS untuk layanan SSRME, perlakukan tautan verifikasi dan akses sebagai data sensitif, serta hindari menyalin kode akses pasien, URL, payload identitas, atau raw body kegagalan ke log umum. Contoh tersimpan di Postman belum menjadi bukti eksekusi oleh Metta. [Juknis, slide 28–41 dan 43–45](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) · [Skenario SB-10](../pengujian/skenario-sandbox.md#sb-10-akses-ssrme)
