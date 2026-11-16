# Endpoint, respons, dan hasil uji IGD dan rawat inap

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Instalasi Gawat Darurat (IGD)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/) (v5.2, rilis 2025-10-30, disunting 2025-12-02) · [Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/) (v6.0, rilis 2026-01-10, disunting 2026-08-06)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Pelayanan IGD dan rawat inap](../alur/igd-dan-rawat-inap.md)

## HTTP, respons, error dan bukti

| Tahap | Operasi dan pemeriksaan |
| --- | --- |
| Create | Pakai `POST /fhir-r4/v1/{Resource}` dengan Bearer dan JSON FHIR untuk operasi yang tersedia dalam katalog. Simpan ID balikan dan identifier lokal yang merujuk kunjungan/record. Jika payload menyertakan contained, rujukan `#id` hanya berlaku di resource itu. |
| Baca balik | Gunakan `GET /fhir-r4/v1/{Resource}/{id}` bila tersedia. Cocokkan Patient, Encounter, Organization serta referensi klinis. Untuk Encounter yang respons create-nya tidak diterima, cek identifier lokal melalui pencarian yang didukung sebelum mengulang. |
| Pembaruan dan finalisasi | `PUT /fhir-r4/v1/Encounter/{id}`, body memakai ID server yang sama. Pertahankan histori dan data lama yang masih berlaku. Simpan hasil baca balik dan verifikasi urutan waktu. |
| Respons gagal | `400`/`422` mengarah ke validasi dan `OperationOutcome.issue[]`; catat kode, diagnosa error dan Rule Number aktual bila tersedia. `401`/`403` mengarah ke token, scope atau izin organisasi. Lacak `429`/`5xx` dan timeout lewat ID korelasi serta retry terbatas setelah rekonsiliasi. |

Uji terpisah untuk satu triase `arrived → triaged → in-progress`, transisi `EMER → OBSENC`, dan satu admisi `IMP` dengan pindah ruang serta perubahan DPJP. Lulus jika class/period yang dibaca ulang konsisten, temuan menunjuk Encounter yang tepat, resume memuat referensi yang benar, dan retry tidak membuat resource ganda. Tambahkan skenario alergi, lab/radiologi, diet, ALKES dan pemberian obat sesuai fakta fixture. Bukti kerja dapat menyimpan ID korelasi dan hasil operasi yang disamarkan. Batasi akses pada identitas pasien, tingkat triase, diagnosis, room history dan narasi klinis. [Inventaris HTTP](inventaris-operasi-http.md) · [Validasi dan error](../validasi/respons-dan-error.md) · [Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
