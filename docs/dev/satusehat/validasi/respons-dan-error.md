# Validasi dan penanganan error SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Validasi Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/) (disunting 2024-06-07) · [Kamus Rule Number Validasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/kamus-validasi/) (disunting 2026-01-22) · [Daftar Response Validasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/list-response/) (disunting 2024-09-09)

[Indeks SATUSEHAT](../README.md) · [Validasi dan error](README.md) · [Inventaris operasi HTTP](../endpoint/inventaris-operasi-http.md) · [Indeks Rule Number](kamus-rule-number.md) · [Skenario Sandbox](../pengujian/skenario-sandbox.md#sb-06-gagal-kirim-dan-pengulangan)

Gunakan status HTTP untuk menentukan hasil transport, lalu periksa bentuk respons dari kontrak endpoint. Endpoint FHIR dapat mengembalikan `OperationOutcome` dengan beberapa `issue`. Untuk setiap issue, periksa `severity`, `code`, `details.text`, dan `expression` jika tersedia. Simpan nomor aturan validasi jika dicantumkan. `issue.code` adalah kategori dan dapat sama untuk penyebab yang berbeda. [Proses dan struktur validasi Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/) · [Kamus Rule Number](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/kamus-validasi/)

## Respons FHIR

Contoh sintetis ketika terminologi yang dikirim belum dikenali.

```json
{
  "resourceType": "OperationOutcome",
  "issue": [
    {
      "severity": "error",
      "code": "value",
      "details": {"text": "<pesan validasi dan nomor aturan jika tersedia>"},
      "expression": ["Observation.code.coding[0].code"]
    }
  ]
}
```

Koreksi field berdasarkan `expression`, skenario, dan nomor aturan yang sebenarnya. Hindari mengandalkan teks pesan mentah sebagai pemicu otomatis karena contoh Kemenkes memakai kategori yang sama untuk beberapa kondisi.

| Kategori pada contoh Kemenkes | Penyebab yang ditunjukkan | Tindakan di Metta |
| --- | --- | --- |
| `duplicate` | Resource sejenis sudah terdaftar | Cari resource yang sesuai metode pencarian yang didukung, cocokkan identitas dan organisasi, lalu gunakan ID yang sama jika sudah terbukti. Tahan bila ada lebih dari satu kecocokan. |
| `value` | Kode tidak ditemukan atau sistem coding salah | Cocokkan pasangan `system` dan `code` dengan terminologi use case. Perbarui mapping sumber. |
| `format` atau `value` | Timestamp salah format atau nilainya di luar ketentuan | Periksa tipe data, offset, periode, dan urutan waktu dari sumber. Untuk Rawat Jalan, gunakan bentuk UTC sebagaimana Playbook. |
| `value` | Reference wajib belum ada | Selesaikan identitas atau pengiriman resource pendahulu, lalu isi reference dari ID server yang sudah diperiksa. |
| `value` | Elemen tidak dikenal, identifier system salah, angka dikirim sebagai string, atau teks kosong | Cocokkan struktur resource dan kardinalitas. Gunakan namespace yang benar dan tipe JSON sesuai kontrak. |
| `value` | Path atau bentuk PATCH Location tidak sesuai | Cocokkan path yang diizinkan pada kontrak PATCH Location dan contoh skenario yang berlaku. |

[Contoh respons validasi Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/list-response/) · [Kontrak Location](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/)

## Tindakan berdasarkan HTTP dan hasil operasi

Tabel ini adalah cara penanganan yang diusulkan untuk pengirim Metta. Periksa respons spesifik endpoint sebelum menyimpulkan penyebab dari status HTTP saja.

| Hasil | Tindakan yang disarankan | Bukti yang perlu dicatat |
| --- | --- | --- |
| `2xx` untuk create | Periksa bentuk respons dan ID balikan yang dijanjikan kontrak. Jika memungkinkan, baca balik dengan ID dan cocokkan identity/reference. Untuk Bundle, evaluasi entri sesuai bentuk respons. | Resource, status, ID yang disimpan, dan hasil baca balik. |
| `2xx` untuk pencarian | Periksa tipe respons, jumlah hasil, dan kecocokan dengan kriteria. Hasil kosong atau ambigu ditangani sebagai status pemetaan. | Kriteria yang disamarkan, jumlah hasil, keputusan pemetaan. |
| `400` atau `422` | Simpan issue relevan. Perbaiki data atau mapping, lalu antrekan versi yang telah dikoreksi. | Kode issue, field, nomor aturan jika tersedia, dan perubahan yang dilakukan. |
| `401` | Periksa environment dan masa berlaku OAuth. Jika token kedaluwarsa, ambil token baru dan jalankan ulang sekali setelah penyebabnya jelas. | Environment dan hasil refresh tanpa token atau kredensial. |
| `403` atau `404` | Periksa scope organisasi, ID referensi, hak akses, dan bentuk endpoint. Untuk SSRME, tangani `CONSENT_REQUIRED` sesuai alur consent. | Endpoint dan kategori penyebab yang bisa ditindaklanjuti. |
| `409` atau indikasi duplikat | Rekonsiliasi berdasarkan identifier dan referensi yang sesuai. Gunakan versi yang benar bila layanan mengembalikan konflik perubahan. | Hasil pencarian, status rekonsiliasi, dan keputusan atas ID. |
| `429` atau kegagalan jaringan/layanan | Gunakan jeda bertambah dan `Retry-After` jika tersedia. Untuk POST yang hasilnya tidak pasti, rekonsiliasi sebelum mengirim ulang. | Kunci lokal, jumlah percobaan, waktu percobaan berikut, dan hasil rekonsiliasi. |

Gunakan Log Transaksi FHIR untuk mencocokkan environment, waktu, resource, status, serta nomor aturan jika tersedia. Bukti pengiriman utama berasal dari respons API dan ID balikan yang tersimpan pada scope yang benar. [Monitoring dan kanal aduan](../operasional/monitoring-dan-aduan.md) · [Log Transaksi FHIR](https://satusehat.kemkes.go.id/platform/docs/id/monitoring-guide/log-fhir/)

Saring isi log. Simpan status dan korelasi yang diperlukan untuk investigasi. Tangani payload pasien, identitas mentah, token, dan tautan consent di jalur penyimpanan yang sesuai dengan akses petugas.
