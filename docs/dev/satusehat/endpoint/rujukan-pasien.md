# Kontrak HTTP rujukan pasien

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Rujukan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan/) (v6.1, rilis 2026-08-21, disunting 2026-08-24)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Rujukan pasien](../alur/rujukan-pasien.md) · [Matriks resource dan data rujukan pasien](../payload/rujukan-pasien.md)

## HTTP, payload, respons dan error

| Kapabilitas | Kontrak request | Balikan yang perlu diperiksa |
| --- | --- | --- |
| Tahap kandidat dan keputusan | Resource `Task` pada basis `/fhir-r4/v1`. Juknis menyebut `GET Task` untuk ketersediaan tempat tidur dan `PATCH Task` untuk keputusan. Konfirmasi metode create/selector kandidat dan URI profil ekstensi terhadap koleksi rujukan saat onboard. | Task atau Bundle pencarian. Periksa `basedOn`, requester/owner, `status`, tipe input/output dan keputusan per tahap. |
| Transaksi Bundle | `POST /fhir-r4/v1` menggunakan pola transaksi FHIR. Gunakan `fullUrl` dan referensi antar-entry. Susunan entri dan tag skenario mengikuti Juknis serta contoh rujukan. | Bundle respons transaksi. Baca `entry[].response.status`, lokasi/ID dan payload outcome jika ada. Asosiasikan setiap ID dengan entri asal. |
| Buat rujukan dan cari data pendukung | `POST /fhir-r4/v1/ServiceRequest` untuk pembuatan langsung. Cari melalui `GET /fhir-r4/v1/ServiceRequest?identifier={system}%7C{nomor}`. Panduan menyebut pencarian dengan SupportingInfo dan CarePlan. Skrip uji harus merekam query `_include` dan dukungan masing-masing selector yang terbukti. | ID resource dan identifier nasional dalam namespace sesuai jalur; saat search, Bundle berisi order serta referensi yang dapat diakses. |
| Registrasi tujuan | `POST /fhir-r4/v1/Encounter` dengan profil kunjungan yang sesuai. Tautkan `basedOn[]`. | ID Encounter tujuan. Baca ulang dan cocokkan Patient, Organization dan ServiceRequest. |

Gunakan OAuth Bearer dan format body dari [Kontrak HTTP FHIR](kontrak-fhir-http.md). Contoh bentuk PATCH keputusan berbasis RFC 6902. Operasi di bawah menambah array `output` saat belum ada. Jika sudah ada output lain, baca Task dahulu dan susun patch yang mempertahankan data sebelumnya. Verifikasi dukungan media type dan struktur dari profil yang diaktifkan.

```json
[
  {
    "op": "add",
    "path": "/output",
    "value": [{
      "type": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "response-referral-task"}]},
      "valueCoding": {"system": "http://hl7.org/fhir/task-status", "code": "accepted"}
    }]
  }
]
```

| Hasil | Tindak lanjut Metta |
| --- | --- |
| Pencarian sukses tanpa kandidat | Simpan hasil pencarian kosong dan tampilkan agar petugas dapat memperbaiki kriteria atau mengikuti alur pelayanan yang berlaku. |
| Keputusan `rejected` | Simpan keputusan bisnis beserta Task, waktu dan alasan yang tersedia. Petugas menindaklanjuti pilihan tujuan. |
| `400` atau `422` | Evaluasi `OperationOutcome.issue[]`; perbaiki kode, referensi, profil atau kardinalitas berdasarkan Rule Number bila ada. |
| `401` atau `403` | Cek token, lingkungan, Organization dan akses peran sebelum meneruskan transaksi. |
| Timeout, `429`, `5xx` | Cari resource atau Task dengan korelasi yang sudah disimpan sebelum retry. Gunakan kebijakan retry terbatas pada respons sementara. |

Kategori HTTP di atas berasal dari kontrak error umum. Simpan kode yang benar-benar dikembalikan server pada bukti per tahap. [Inventaris operasi HTTP](inventaris-operasi-http.md) · [Validasi dan error](../validasi/respons-dan-error.md)
