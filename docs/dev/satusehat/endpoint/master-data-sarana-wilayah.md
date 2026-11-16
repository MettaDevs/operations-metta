# Master Sarana Index dan Master Wilayah

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/) (disunting 2025-10-02) · [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/) (disunting 2025-10-02) · [Location](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Identitas](../payload/matriks-identitas.md) · [Master data KFA](master-data-kfa.md)

Kontrak berikut berasal dari katalog publik Kemenkes yang diperiksa 16 November 2026. Status pada saat pemeriksaan adalah **terdokumentasi**. Uji Organization dan Location FHIR untuk fixture rawat jalan sudah ada, sedangkan API Master Sarana dan Master Wilayah belum dipanggil dari Metta. [Bukti pemetaan fixture](../pengujian/backlog-rawat-jalan-tanpa-resep.md#pemetaan-fixture-sebelum-uji-encounter)

[Akses dan format umum](#akses-dan-format-umum) · [Master Sarana Index](#master-sarana-index) · [Master Wilayah](#master-wilayah) · [Error, retry, dan verifikasi](#error-retry-dan-verifikasi)

## Akses dan format umum

| Environment | Host |
| --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id` |
| Production | `https://api-satusehat.kemkes.go.id` |

Gunakan token OAuth `client_credentials` dari environment dan Organization yang sesuai. Sertakan `Authorization: Bearer <access_token>` dan gunakan `Accept: application/json`. Operasi di halaman ini menggunakan GET dengan parameter query dan body kosong. Simpan kode wilayah dan kode sarana sebagai string di pemetaan internal agar tidak kehilangan nol di depan. Bentuk query dikonversi sesuai kontrak API. [Autentikasi](host-dan-autentikasi.md#endpoint-dan-autentikasi) · [ReST API MSI](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/) · [ReST API Master Wilayah](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/)

## Master Sarana Index

MSI dipakai untuk menemukan kode nasional, identitas, dan status suatu fasyankes. Gunakan hasil untuk pemetaan tujuan rujukan dan verifikasi fasyankes. Untuk membentuk `Organization/{id}` pada FHIR, baca kembali Organization yang akan dirujuk dan cocokkan dengan fasyankes serta kredensial. Sumber lokal untuk fasyankes sendiri adalah legal entity dan unit, sedangkan rujukan menyimpan konteks fasyankes tujuan. Pemetaan tetap dibatasi tenant dan environment. [Matriks Organization](../payload/matriks-identitas.md#organization) · [Rujukan Rawat Jalan](../payload/matriks-rawat-jalan.md#servicerequest) · [Master Sarana Index](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/)

### Request MSI

Gunakan `GET /masterdata/v1/mastersaranaindex/mastersarana`. Semua varian jenis sarana menggunakan path yang sama. Kirim `jenis_sarana` beberapa kali jika mencari lebih dari satu jenis.

| Query | Tipe pada sumber | Kondisi |
| --- | --- | --- |
| `page`, `limit` | number | Wajib untuk membatasi hasil per halaman. |
| `jenis_sarana` | number | Wajib. `101` praktik mandiri, `102` Puskesmas, `103` klinik, dan `104` rumah sakit. |
| `kode_satusehat`, `kode_sarana`, `nama` | number untuk kode SATUSEHAT, string untuk kode sumber dan nama | Gunakan bila pencarian diarahkan ke kode atau nama tertentu. |
| `kode_provinsi`, `kode_kabkota`, `kode_kecamatan` | string | Filter wilayah sesuai kode administratif yang berlaku. |
| `status_aktif`, `status_sarana` | string | Gunakan bila perlu membatasi status. Cocokkan nilai yang dikembalikan sebelum menyimpan tujuan rujukan. |
| `sumber_identifier`, `identifier_kode_sarana` | string | Gunakan sebagai pasangan bila mencari kode dari sumber tertentu, misalnya `yankes_klinik`, `yankes_rs`, atau `puskesmas_pusdatin_baru`. |
| `lower_bound_updated_at`, `upper_bound_updated_at` | string tanggal `YYYY-MM-DD` | Filter rentang perubahan. Jaga filter sama untuk setiap halaman. |

Contoh pencarian klinik dan Puskesmas dalam satu permintaan.

```http
GET /masterdata/v1/mastersaranaindex/mastersarana?page=1&limit=10&jenis_sarana=103&jenis_sarana=102
Authorization: Bearer <access_token>
Accept: application/json
```

[Query Multi Sarana](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-sarana-index/rest-api-msi/#api-msi-multi)

### Respons dan pemetaan MSI

Contoh sukses sumber memakai `status_code`, `message`, `page`, `total_page`, dan daftar `data`. Gunakan `kode_satusehat` bersama jenis, kode sumber, status, dan wilayah untuk mencocokkan kandidat. Ada juga data kontak, koordinat, status operasional, dan detail administratif. Ambil hanya yang diperlukan untuk pemetaan.

```json
{
  "status_code": 200,
  "message": "<hasil-pencarian>",
  "page": 1,
  "total_page": 1,
  "data": [
    {
      "kode_satusehat": "<kode-nasional-sarana>",
      "kode_sarana": "<kode-sumber-sarana>",
      "nama": "Klinik Contoh",
      "status_aktif": true
    }
  ]
}
```

Jika hasil kosong atau ada beberapa sarana dengan nama serupa, cocokkan kode sumber, jenis, dan wilayah lebih dulu. Jangan memilih berdasarkan posisi baris. Untuk penarikan berhalaman, cocokkan `page` dan `total_page`, gunakan kunci fasilitas yang sudah diverifikasi, serta simpan filter dan checkpoint sampai semua halaman berhasil. Rentang perubahan tidak menggantikan penanganan status nonaktif.

## Master Wilayah

Master Wilayah menyediakan kode administratif provinsi hingga desa atau kelurahan. Gunakan kode yang berhubungan dengan alamat aktual pada extension `administrativeCode` FHIR Metta. Sumber lokal adalah relasi alamat pada `postal_addresses` dan referensi wilayah platform. Cocokkan kode nasional, jenis tingkat wilayah, dan induknya sebelum membentuk payload. Contoh portal memakai URI dengan akhiran `/administrativeCode` dan anak `valueCode`. [Perbedaan URI AdministrativeCode](../payload/profil-dan-extension-fhir.md#alamat-dan-perbedaan-definisi-administrativecode) · [Sumber alamat Metta](../../../../src/platform/address-book/party-address.service.ts) · [Profil Location dan administrativeCode](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/location/) · [ReST API Master Wilayah](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/)

### Route v1 dan v2

Seluruh route berikut memakai metode GET. Versi 1 mengambil berdasarkan kode, sedangkan versi 2 menambahkan paginasi. Tabel ini mengikuti penanda wajib pada sumber per versi.

| Tingkat | Path v1 dan query | Path v2 dan filter khusus |
| --- | --- | --- |
| Provinsi | `GET /masterdata/v1/provinces`. `codes` wajib. | `GET /masterdata/v2/provinces`. Filter `codes` opsional. |
| Kabupaten/kota | `GET /masterdata/v1/cities`. `province_codes` wajib, `codes` opsional. | `GET /masterdata/v2/cities`. Filter `province_codes`, `codes` opsional. |
| Kecamatan | `GET /masterdata/v1/districts`. `city_codes` wajib, `codes` opsional. | `GET /masterdata/v2/districts`. Filter `city_codes`, `codes` opsional. |
| Kelurahan/desa | `GET /masterdata/v1/sub-districts`. Tabel sumber menandai `district_codes` dan `codes` wajib. | `GET /masterdata/v2/sub-districts`. Filter `district_codes`, `codes` opsional. |

Untuk semua route v2 kirim `current_page` numerik dan gunakan `next` atau `prev` bila melanjutkan sesuai respons. Tabel parameter memberi tipe numerik untuk `next` dan `prev`, tetapi contoh berisi token string dari `meta.cursors`. Pertahankan cursor sebagai nilai opaque yang di-URL-encode. Uji kontrak paginasi dengan satu perpindahan halaman sebelum mengandalkan perulangan otomatis.

Contoh baca kabupaten/kota dan bentuk respons v2. Objek `meta` hanya ditampilkan sebagian.

```http
GET /masterdata/v2/cities?current_page=1&province_codes=<kode-provinsi>
Authorization: Bearer <access_token>
Accept: application/json
```

```json
{
  "status": 200,
  "error": false,
  "message": "<hasil-pencarian>",
  "data": [
    {"code": "<kode-kabupaten>", "parent_code": "<kode-provinsi>", "bps_code": "<kode-bps>", "name": "Kabupaten Contoh"}
  ],
  "meta": {"item_count": 1, "page": {"current": 1}, "cursors": {"next": "<cursor-jika-ada>"}}
}
```

Untuk v1 gunakan `status`, `error`, `message`, dan `data[]`. Untuk v2 periksa juga `meta.page` dan `meta.cursors`. Di kedua versi, `code` adalah kode yang ditautkan ke wilayah, `parent_code` menjaga hubungan antar tingkat, dan `bps_code` merupakan kode alternatif. Jangan mengganti kode Kemendagri pada extension dengan kode BPS hanya karena nama wilayah sama. [Kontrak v1 dan v2](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-wilayah/rest-api-wilayah/)

## Error, retry, dan verifikasi

| Hasil | Tindakan |
| --- | --- |
| `2xx` dengan `data` kosong | Periksa filter dan kode induk. Untuk MSI, cocokkan jenis dan identitas fasilitas. Untuk wilayah, cocokkan rantai induk sebelum memetakan. |
| Kontrak MSI atau wilayah ditolak | Contoh error memakai `status_code`, `message`, dan `data: null`. Baca pesan dan koreksi kode, scope, atau pagination. Jangan menyimpulkan satu kode HTTP sebagai satu penyebab tetap. |
| Token tidak sah | Periksa scope dan environment terlebih dulu, perbarui token bila kedaluwarsa, lalu ulangi GET. |
| Gangguan sementara | Ulangi GET dengan batas percobaan. Pertahankan filter, halaman, atau cursor dari checkpoint terakhir. Gabungkan hasil berdasarkan kode yang terverifikasi. |

Sebelum menyatakan MSI siap, uji satu sarana yang dapat dibaca kembali di Organization, dua tipe dalam satu query, batas halaman, hasil kosong, dan kode sumber yang ambigu. Untuk wilayah, uji satu rantai provinsi hingga desa, pencarian berdasarkan kode, lintas halaman tanpa kehilangan baris, dan alamat yang kode induknya tidak cocok. Catat environment, query yang disamarkan, status HTTP, jumlah hasil, dan keputusan mapping. [Validasi dan error](../validasi/respons-dan-error.md) · [Format bukti Sandbox](../pengujian/skenario-sandbox.md#catatan-hasil)
