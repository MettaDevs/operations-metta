# Kamus Farmasi dan Alat Kesehatan

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/) (disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Matriks farmasi](../payload/matriks-farmasi.md) · [Master Sarana dan Wilayah](master-data-sarana-wilayah.md)

KFA menyediakan kode dan informasi produk untuk pemetaan obat dan alat kesehatan. Operations menyimpan kode pada `gd_m_barang.kode_kfa` dan membacanya melalui service barang. Konfirmasi kode KFA yang sesuai dengan produk, bentuk, kekuatan, dan satuan sebelum menggunakannya pada payload farmasi. Kode barang Metta, NIE BPOM, kode LKPP, kode virtual, kode aktual, dan kode kemasan memiliki fungsi yang berbeda. Pemetaan lokal perlu mencatat ruang lingkup pemakaiannya. [Service barang](../../../../src/foundation/inventory/item/item.service.ts) · [Kontrak KFA](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/)

Status dokumen per 16 November 2026 adalah **terdokumentasi**. Uji OAuth dan Encounter awal di Sandbox tidak mencakup request KFA maupun pengiriman resep.

[Akses dan route](#akses-dan-route) · [Detail dan pencarian produk v2](#detail-dan-pencarian-produk-v2) · [Harga produk JKN v1](#harga-produk-jkn-v1) · [Pencarian ALKES v3](#pencarian-alkes-v3) · [Error, sinkronisasi, dan pengujian](#error-sinkronisasi-dan-pengujian)

## Akses dan route

| Environment | Host |
| --- | --- |
| Sandbox | `https://api-satusehat-stg.dto.kemkes.go.id` |
| Production | `https://api-satusehat.kemkes.go.id` |

Gunakan `Authorization: Bearer <access_token>` dari Organization dan environment yang sesuai serta `Accept: application/json`. Untuk POST pencarian ALKES gunakan `Content-Type: application/json`. GET memakai query dan body kosong. Token diperoleh melalui [OAuth](host-dan-autentikasi.md#endpoint-dan-autentikasi).

| Fungsi | Metode dan path | Isi request |
| --- | --- | --- |
| Harga produk JKN v1 | `GET /kfa/farmalkes-price-jkn` | Query wajib `page`, `limit`, `kfa_code`. Query opsional `region_code`, `document_ref`. |
| Detail produk v2 | `GET /kfa-v2/products` | Query wajib `identifier` dan `code`. `identifier` merupakan sistem pencarian seperti `kfa`, `nie`, atau `lkpp`. |
| Pencarian produk v2 | `GET /kfa-v2/products/all` | Query wajib `page`, `size`, `product_type`. Filter opsional dirinci di bawah. |
| Pencarian produk varian ALKES | `POST /kfa-v3/alkes/products` | Body filter JSON untuk varian. Memuat `reference_code` jika mencari menggunakan NIE atau LKPP. |
| Pencarian produk template ALKES | `POST /kfa-v3/alkes/template` | Body filter JSON untuk template. Tabel sumber varian dan template berbeda pada `reference_code`. |

[Katalog KFA v1, v2, dan ALKES](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/)

## Detail dan pencarian produk v2

Untuk mencocokkan satu kode, kirim jenis identifier dan kode yang dicari. `identifier=kfa` mencari melalui kode KFA, `identifier=nie` mencari melalui nomor izin edar BPOM, dan `identifier=lkpp` mencari melalui kode LKPP. Periksa nilai `result.kfa_code`, `result.active`, `result.state`, kategori produk, bentuk sediaan, satuan, serta identifier produk sebelum memilih mapping.

```http
GET /kfa-v2/products?identifier=kfa&code=<kode-kfa>
Authorization: Bearer <access_token>
Accept: application/json
```

```json
{
  "search_code": "<kode-kfa>",
  "search_identifier": "kfa",
  "result": {
    "name": "Produk Uji Contoh",
    "kfa_code": "<kode-kfa>",
    "active": true,
    "state": "<status-produk-dari-KFA>"
  }
}
```

Untuk pencarian produk dengan paginasi, kirim `page` dan `size` sebagai angka, serta `product_type` sebagai string. Contoh Kemenkes memakai `product_type=farmasi`. Filter yang tersedia adalah `keyword`, `farmalkes_type`, `from_date`, `to_date`, `template_code`, dan `packaging_code`. Gunakan tanggal `YYYY-MM-DD`. Pertahankan filter antarhalaman agar katalog hasil dapat dibandingkan. Respons memuat `total`, `page`, `size`, dan `items.data[]`.

```http
GET /kfa-v2/products/all?page=1&size=10&product_type=farmasi&keyword=<kata-kunci>
Authorization: Bearer <access_token>
Accept: application/json
```

```json
{
  "total": 1,
  "page": 1,
  "size": 10,
  "items": {
    "data": [{"name": "Produk Contoh", "kfa_code": "<kode-kfa>", "active": true}]
  }
}
```

Virtual/template dan kemasan memiliki ruang kode yang berbeda. Contoh filter Kemenkes memakai prefix `92` untuk template farmasi dan `94` untuk kemasan farmasi, serta `82` dan `84` untuk padanannya pada ALKES. Pada kontrak pengeluaran obat nonracikan yang didokumentasikan untuk Metta, gunakan kode produk aktual `93xxxxxx` sesuai produk yang diserahkan. Ambil pilihan kode berdasarkan use case dan hasil lookup, bukan hanya prefix. [Detail produk](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-products-detail) · [Paginasi produk](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-products-pagination) · [Kontrak pengeluaran obat](../payload/matriks-farmasi.md#medicationdispense)

## Harga produk JKN v1

Endpoint harga mengembalikan data referensi produk per periode, satuan, dan wilayah. Gunakan produk template yang diminta oleh kontrak dan periksa periode tarif sebelum menggunakan hasil sebagai referensi. Contoh resmi memuat `total`, `page`, `limit`, dan `items.data[]`. Pada setiap baris, periksa `kfa_code`, `document_ref`, `active`, `region_code`, `start_date`, `end_date`, `price_unit`, `uom_name`, dan daftar `province` bila ada.

```http
GET /kfa/farmalkes-price-jkn?page=1&limit=10&kfa_code=<kode-kfa-template>
Authorization: Bearer <access_token>
Accept: application/json
```

```json
{
  "total": 1,
  "page": 1,
  "limit": 10,
  "items": {
    "data": [
      {
        "kfa_code": "<kode-kfa-template>",
        "document_ref": "<referensi-tarif>",
        "active": true,
        "region_code": "regional1",
        "start_date": "<YYYY-MM-DD>",
        "end_date": null,
        "price_unit": 1000.0,
        "uom_name": "<satuan>"
      }
    ]
  }
}
```

Filter `region_code` memakai kode regional yang diterbitkan katalog. Tabel sumber menampilkan `regional1` sampai `regional6` dan memuat provinsi yang muncul di lebih dari satu kelompok. Jika wilayah menentukan keputusan harga, konfirmasi baris tarif, periode, dan provinsi pada respons. Harga ini perlu dipisahkan dari harga jual, harga pengadaan, dan hasil klaim lokal sesuai kebutuhan proses. [Kontrak harga JKN](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-farmalkes-price-jkn-price)

## Pencarian ALKES v3

Kedua endpoint POST melakukan pencarian. `/alkes/products` mencari varian, sedangkan `/alkes/template` mencari template. Tabel penjelasan sumber menandai `page` wajib. Skema ringkas pada halaman yang sama menaruh penanda wajib pada filter lain. Uji body minimum dan kombinasi filter di Sandbox sebelum mengikat validasi form Metta.

| Field body | Tipe | Pemakaian |
| --- | --- | --- |
| `page`, `size` | integer | Navigasi halaman dan ukuran hasil. |
| `state`, `active` | string, boolean | Status produk seperti `draft` atau `valid`, dan filter aktivitas. Verifikasi arti dengan hasil yang dikembalikan. |
| `kfa_code`, `search` | string | Pencarian kode atau istilah. |
| `reference_code` | string | Filter varian berdasarkan kode seperti NIE/LKPP di `identifier_ids[]`. Sumber mendokumentasikan daftar dengan pemisah koma. |
| `updated_from_date`, `updated_to_date` | string tanggal | Rentang perubahan dalam format `YYYY-MM-DD`. |
| `farmalkes_type` | string | Filter tipe, didokumentasikan bisa berisi beberapa kode dipisahkan koma. |
| `category_code`, `sub_category_code`, `type_code`, `sub_type_code` | string | Filter hierarki kelompok sampai subjenis, dapat memakai kode dipisahkan koma. |

Contoh body pencarian varian berdasarkan kode referensi. Respons ALKES memakai `status`, `error`, `message`, `meta`, dan `data[]`. Periksa kode, status, referensi produk, serta relasi template atau pengganti jika tersedia.

```json
{
  "page": 1,
  "size": 10,
  "state": "valid",
  "active": true,
  "reference_code": "<nie-atau-kode-lkpp>"
}
```

Contoh respons pencarian ALKES yang disederhanakan.

```json
{
  "status": 200,
  "error": false,
  "message": "<hasil-pencarian>",
  "meta": {"item_count": 1, "page": {"current": 1}},
  "data": [{"kfa_code": "<kode-kfa-alkes>", "active": true}]
}
```

[Kontrak ALKES varian](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-alkes-variant) · [Kontrak ALKES template](https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/#products-api-alkes-template)

## Error, sinkronisasi, dan pengujian

| Hasil | Tindakan |
| --- | --- |
| Produk tidak ada, tidak aktif, atau diganti | Tahan mapping baru, periksa tipe dan identifier, serta pertahankan bukti pemetaan historis. Verifikasi pengganti sebelum mengubah produk lokal atau kode kirim. |
| `4xx` dengan `detail[]` | Contoh KFA v2 dan ALKES memuat `detail[].loc`, `.msg`, dan `.type`. Perbaiki parameter berdasarkan lokasi. Error ALKES juga dapat memakai envelope `status`, `error`, `message`, dan `data`. |
| `401`, `403`, atau scope layanan tidak sesuai | Periksa token, scope, dan environment. Token FHIR berhasil belum menjadi bukti akses semua versi KFA. |
| Kegagalan sementara | Pertahankan query dan checkpoint halaman. Ulangi pencarian dengan percobaan terbatas. POST pencarian ALKES boleh dievaluasi sebagai pencarian, berdasarkan kontrak fungsi dan status hasil. |

Mapping barang yang dipilih petugas perlu menyimpan kode dan periode atau sumber verifikasi yang relevan. Untuk sinkronisasi bertahap gunakan kunci kode KFA dan checkpoint tanggal/halaman. Cocokkan kembali status aktif dan perubahan produk. Saring token dan data nonpublik dari log.

Untuk verifikasi, uji detail produk dengan kode KFA dan NIE, pencarian dua halaman dengan filter sama, template versus varian ALKES, produk yang tidak aktif, satu respons error parameter, serta harga dengan periode atau regional berbeda. Cocokkan hasil dengan satu produk yang akan digunakan di [uji MedicationRequest dan MedicationDispense](../pengujian/skenario-sandbox.md#sb-04-resep-nonracikan-sampai-diserahkan). Pengambilan data, mapping, dan bukti uji KFA ini masih menjadi backlog integrasi. [Validasi dan error](../validasi/respons-dan-error.md)
