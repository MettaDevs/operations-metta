# Payload dan matriks field SSRME

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Juknis SSRME](https://docs.google.com/presentation/d/1Rs1quod5brLXnp8ToCQd_-9lw3XFLr_Obi8zC6n7bwQ/edit) (v2.0, rilis 2026-09-01) · [Panduan SDM Kesehatan](https://docs.google.com/presentation/d/1KQ8T9xGq3IQLB1u81hlU_O1kr3-kdTpPuUUI0jtDjdk/edit) (tanggal revisi tidak tercantum) · [Postman SATUSEHAT RME](https://www.postman.com/satusehat/satusehat-public/collection/3la2mhe/satusehat-rme?sideView=agentMode) (Overview menampilkan 2026-09-04)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Akses riwayat nasional lewat SSRME](../alur/ssrme.md) · [Endpoint dan respons SSRME](../endpoint/ssrme.md)

## Matriks field akses SSRME

Matriks ini untuk API membuka RME nasional. Sumber variabel adalah contoh request dan response dari Juknis v2.0 dan koleksi Postman SSRME di atas.

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| Request `patient_id` | W untuk CHLink dan SHLink | `sim_m_pasien` dan hasil pencarian MPI | Mapping Patient IHS dan verifikasi identitas belum terverifikasi. |
| Request `patient_name` | W untuk CHLink dan SHLink | `parties.name` dari pasien pada kunjungan | Gunakan nama dari konteks kunjungan dan pastikan pasangan ID dan nama cocok. |
| Request `practitioner_id` | W untuk CHLink dan SHLink | Nakes penanggung jawab dari fakta kunjungan dan hasil Master Nakes Index | Resolve IHS, kewenangan, dan SIP sesuai fasyankes. |
| Request `practitioner_name` | W untuk CHLink dan SHLink | `parties.name` dari nakes terkait | Pastikan nama sesuai nakes yang dipilih sebagai penanggung jawab. |
| Request `organization_id` | W untuk CHLink dan SHLink | Legal entity kunjungan dan konfigurasi fasyankes | Gunakan ID yang sesuai kredensial SATUSEHAT. Mapping belum terverifikasi. |
| Request `organization_name` | W untuk CHLink dan SHLink | Nama organisasi pada konfigurasi fasyankes | Validasi nama identitas organisasi sesuai Juknis. |
| Request `type_medical_summary` | K pada alur darurat sesuai endpoint dan versi Juknis | Konteks kunjungan dan keputusan akses darurat petugas | Belum ada alur pengisian alasan, wali atau pengantar, dan audit akses darurat yang terverifikasi. Jangan otomatis menyamakan skrining warna dengan otorisasi darurat. |
| Response CHLink `data.verificationUrl`, `data.expiredAt` | W pada penggunaan tautan ketika request berhasil | Balikan API SSRME | Hubungkan ke konteks permintaan dan tampilkan sebelum kedaluwarsa. Tautan bersifat sensitif. |
| Response SHLink `data.shlinkUrl`, `data.expiredAt` | W pada penggunaan tautan ketika request berhasil | Balikan API SSRME | Entry point di layar dan pembatasan petugas yang dapat membuka tautan belum terverifikasi. |
| Response `data.code` untuk `CONSENT_REQUIRED`, `request_id` | K sesuai hasil | Balikan API SSRME | Tangani alur persetujuan secara eksplisit dan simpan ID korelasi yang aman. |

## Contoh request

Body JSON sintetis untuk alur normal memuat identitas berikut.

```json
{
  "patient_id": "<patient-ihs>",
  "patient_name": "Pasien Contoh",
  "practitioner_id": "<practitioner-ihs>",
  "practitioner_name": "Nakes Contoh",
  "organization_id": "<organization-id>",
  "organization_name": "Klinik Contoh"
}
```
