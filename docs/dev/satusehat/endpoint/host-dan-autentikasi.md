# Host, autentikasi, dan referensi FHIR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Endpoint Information](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) (disunting 2024-11-08) · [Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/) (disunting 2023-09-27) · [Pasien dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/) (disunting 2024-12-05)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Alur pengiriman rawat jalan](../alur/rawat-jalan.md)

## Endpoint dan autentikasi

| Lingkungan | OAuth base URL | FHIR base URL |
| --- | --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1` | `https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1` |
| Production | `https://api-satusehat.kemkes.go.id/oauth2/v1` | `https://api-satusehat.kemkes.go.id/fhir-r4/v1` |

Backend meminta token menggunakan OAuth 2.0 `client_credentials`. Token dipakai di header `Authorization: Bearer <access_token>` pada request FHIR dan SSRME. Untuk body JSON, ikuti `Content-Type: application/json` pada katalog endpoint SATUSEHAT. Simpan kredensial dan cache token per konfigurasi fasyankes dan lingkungan. Perbarui token menjelang kedaluwarsa sesuai `expires_in`. [Daftar endpoint](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) · [Kontrak akses token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/)

```http
POST /oauth2/v1/accesstoken?grant_type=client_credentials
Content-Type: application/x-www-form-urlencoded

client_id=<client-id-yang-di-encode>&client_secret=<client-secret-yang-di-encode>
```

### Identitas sebelum pengiriman

| Referensi | Endpoint atau sumber | Pemetaan di Metta |
| --- | --- | --- |
| `Patient/{ihs}` | `GET /Patient?identifier=...` lewat Master Patient Index. Untuk NIK, nilai pencarian adalah `https://fhir.kemkes.go.id/id/nik\|{nik}`, di-encode sebagai satu nilai query. | Tautkan pasien lokal ke nomor IHS setelah identitas cocok. Bila hasil kosong, ikuti alur MPI sesuai kasus pasien. `POST /Patient` hanya untuk alur registrasi MPI yang berlaku setelah pencarian. Bila hasil ambigu, selesaikan verifikasi sebelum mengirim data untuk pasien itu. |
| `Practitioner/{ihs}` | `GET /Practitioner?identifier=...` lewat Master Nakes Index. | Tautkan nakes lokal ke nomor IHS dan ambil nakes yang benar-benar mencatat atau melakukan layanan. Akun login Metta bisa berbeda dari identitas pelaku klinis. |
| `Organization/{id}` | ID organisasi induk dari onboarding SATUSEHAT. Gunakan `GET /Organization/{id}` untuk verifikasi dan `POST /Organization` untuk pendaftaran suborganisasi bila dibutuhkan. | Petakan legal entity dan unit yang dipakai ke fasyankes atau suborganisasi yang tepat sesuai konfigurasi. |
| `Location/{id}` | `GET /Location/{id}` untuk verifikasi. `POST /Location` untuk mendaftarkan lokasi bila diperlukan. | Petakan poli, ruangan, dan lokasi penyerahan obat ke `Location` di bawah organisasi yang sesuai. |

Simpan pemetaan dengan lingkup tenant, fasyankes, dan lingkungan SATUSEHAT yang sesuai. ID Sandbox dan Production dikelola terpisah. [MPI pasien dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/) · [Prasyarat organisasi, lokasi, dan nakes](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#alur-integrasi)
