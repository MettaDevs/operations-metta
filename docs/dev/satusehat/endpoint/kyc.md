# Verifikasi profil SATUSEHAT Mobile

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Panduan Integrasi](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-it-fasyankes/) (disunting 2024-11-05) · [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/) (disunting 2025-10-02) · [Panduan Implementasi Proses Verifikasi Profil](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/unduh-lampiran/) (disunting 2024-07-29)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Identitas](../payload/matriks-identitas.md) · [SSRME](../alur/ssrme.md)

Verifikasi Profil atau KYC membantu petugas fasyankes memproses verifikasi identitas pengguna SATUSEHAT Mobile dari SIM fasyankes. API mendokumentasikan cara menghasilkan tautan verifikasi untuk disematkan dan cara meminta kode verifikasi per NIK. Uji autentikasi FHIR yang sudah ada di Metta dapat menjadi bukti koneksi awal, sedangkan akses dan respons API KYC masih perlu diuji sesuai scope kredensial. [Panduan Integrasi KYC](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-it-fasyankes/) · [Kontrak ReST API KYC](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/)

[Endpoint](#endpoint) · [Generate URL](#generate-url) · [Challenge code](#challenge-code) · [Respons gagal dan kriteria uji](#respons-gagal-dan-kriteria-uji)

## Endpoint

| Environment | Host API |
| --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id` |
| Production | `https://api-satusehat.kemkes.go.id` |

| Fungsi | Metode dan path | Body dan header |
| --- | --- | --- |
| Mendapatkan token | `POST /oauth2/v1/accesstoken?grant_type=client_credentials` | `Content-Type: application/x-www-form-urlencoded`, berisi `client_id` dan `client_secret`. |
| Menghasilkan URL verifikasi | `POST /kyc/v1/generate-url` | `Authorization: Bearer <access_token>`, `Content-Type: text/plain`. Body adalah pesan terenkripsi. |
| Meminta kode verifikasi | `POST /kyc/v1/challenge-code` | `Authorization: Bearer <access_token>`, `Content-Type: application/json`. Body berisi metode dan identitas pasien. |

Token mengikuti [autentikasi SATUSEHAT](host-dan-autentikasi.md#endpoint-dan-autentikasi). Pastikan kredensial memiliki akses untuk layanan yang akan dipanggil. [Akses token dan API KYC](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/)

## Generate URL

1. Siapkan identitas petugas yang berwenang, konfigurasi lingkungan, dan material kunci sesuai panduan integrasi KYC.
2. Bentuk objek logis yang memuat `agent_name`, `agent_nik`, dan `public_key`. Ambil nama dan NIK petugas dari sumber yang disetujui. Kelola kunci menurut library KYC yang berlaku pada environment.
3. Enkripsi payload dengan library KYC sebelum mengirimnya. Kontrak mendokumentasikan ciphertext Base64 dalam pembungkus teks berikut dan pemisah baris CRLF. Base64 adalah encoding setelah enkripsi.

```text
-----BEGIN ENCRYPTED MESSAGE-----
<ciphertext-base64>
-----END ENCRYPTED MESSAGE-----
```

4. Dekripsi respons sukses menggunakan library yang sesuai. Contoh bentuk logis setelah didekripsi ada di bawah.

```json
{
  "metadata": {"code": "200", "message": "<pesan-hasil>"},
  "data": {
    "agent_name": "<nama-petugas-uji>",
    "agent_nik": "<nik-petugas-uji>",
    "token": "<token-iframe>",
    "url": "<url-verifikasi>"
  }
}
```

5. Gunakan URL respons dalam alur verifikasi tersemat. Buktikan bahwa akses terikat pada petugas, konteks yang sesuai, dan lingkungan tujuan. Kontak operasional serta versi library dan distribusinya dicatat saat pengujian karena perlu diselaraskan dengan lampiran Kemenkes. [Kontrak Generate URL](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/#kyc-api-generate-validation-encrypted-url) · [Lampiran KYC](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/unduh-lampiran/)

## Challenge code

Untuk permintaan per NIK, gunakan `metadata.method=request_per_nik` serta NIK dan nama pasien yang sudah cocok dengan konteks. Contoh sintetis berikut mengikuti bentuk request yang dijelaskan Kemenkes.

```json
{
  "metadata": {"method": "request_per_nik"},
  "data": {"nik": "<nik-pasien-uji>", "name": "<nama-pasien-uji>"}
}
```

Respons sukses memuat identitas, IHS, kode verifikasi, dan waktu pembuatan serta kedaluwarsa. Contoh tipe data dari sumber adalah string.

```json
{
  "metadata": {"code": "200", "message": "<pesan-hasil>"},
  "data": {
    "nik": "<nik-pasien-uji>",
    "name": "<nama-pasien-uji>",
    "ihs_number": "<patient-ihs>",
    "challenge_code": "<kode-verifikasi>",
    "created_timestamp": "<waktu-pembuatan-dari-api>",
    "expired_timestamp": "<waktu-kedaluwarsa-dari-api>"
  }
}
```

Periksa kecocokan identitas dan masa berlaku. Simpan status proses seperlunya dan saring kode, NIK, token, atau URL verifikasi dari log umum. Rujuk panduan operasional untuk kegagalan pencocokan atau verifikasi pengguna. [Kontrak Challenge Code](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/#kyc-api-generate-verification) · [Panduan kegagalan verifikasi](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/guide-operational/guide-ops-failure/)

## Respons gagal dan kriteria uji

| Hasil | Penanganan |
| --- | --- |
| Token ditolak | Katalog mencontohkan fault dengan `fault.faultstring` dan `fault.detail.errorcode`. Periksa environment, masa berlaku, dan izin layanan sebelum mengulang. |
| Input proses ditolak | Periksa struktur body, tipe media, dan kecocokan identitas. Untuk generate URL, periksa versi library, kunci, serta pembungkus pesan. |
| Layanan gagal atau respons tidak dapat diproses | Catat status dan konteks yang sudah disaring. Respons kegagalan server dapat berupa teks. Periksa hasil percobaan sebelum meminta kode atau tautan baru. |
| Kode atau tautan kedaluwarsa | Gunakan masa berlaku yang terdokumentasi oleh layanan dan minta ulang sesuai alur yang berlaku. |

Uji dengan fixture yang sesuai scope Sandbox. Bukti minimal mencakup perolehan token, URL yang bisa didekripsi, kode yang merujuk pasien uji yang benar, kedaluwarsa, penolakan akses, dan log yang sudah disaring. Sumber Metta untuk identitas pasien dan nakes mengikuti [matriks identitas](../payload/matriks-identitas.md). Pencatatan status KYC, identitas petugas berwenang, dan implementasi library masih perlu diputuskan saat sambungan dibangun. [Contoh respons API KYC](https://satusehat.kemkes.go.id/platform/docs/id/kyc/kyc-doc/rest-api-kyc/) · [Penanganan error umum](../validasi/respons-dan-error.md)
