# Field dan rujukan per bab Skrining PTM

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Skrining Penyakit Tidak Menular (PTM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/) (v1.4, rilis 2024-09-25, disunting 2025-12-02)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Cara membaca aturan](aturan-field-fhir.md#cara-membaca-matriks)

Snapshot 16 November 2026. Matriks menunjukkan field bertanda `*` dan rujukan per bab Playbook Skrining PTM. Field ditulis relatif terhadap resource pada kolom tengah. Terapkan sesuai tahap, fakta pelayanan dan struktur induk.

Untuk pemetaan yang mengambil definisi dari modul lain atau hadir dalam uraian biasa, baris mengarah ke kontrak internal. Validasi code system, pilihan `value[x]`, urutan referensi, dan akses terhadap kontrak use case. [Kontrak Skrining PTM](../alur/skrining-penyakit-tidak-menular.md) · [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md)

## Skrining PTM v1.4

[Kontrak internal](../alur/skrining-penyakit-tidak-menular.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_2_pendaftaran_kunjungan_pasien) | `RelatedPerson` | `identifier[i]`, `patient`, `relationship[i]`, `communication.language` |
| [3. Memulai Episode Perawatan Jantung, Stroke, Uronefrologi, dan Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_3_memulai_episode_perawatan_jantung_stroke_uronefrologi_dan_kanker) | `EpisodeOfCare` | `status`, `type[i]`, `patient`, `managingOrganization`, `period` |
| [4. Pengiriman Data Riwayat dan Faktor Risiko PTM](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_4_pengiriman_data_riwayat_dan_faktor_risiko_ptm) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [5. Pengiriman Data Skrining PTM](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_5_pengiriman_data_skrining_ptm) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [6. Pengiriman Data Skrining PTM melalui Composition](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_6_pengiriman_data_skrining_ptm_melalui_composition) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [7. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_7_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [8. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_8_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [9. Pengiriman Data Tatalaksana](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_9_pengiriman_data_tatalaksana) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [10. Pengiriman Data Rencana Tindak Lanjut dan Sarana Transportasi untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_10_pengiriman_data_rencana_tindak_lanjut_dan_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [11. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_11_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [12. Pengiriman Data Kondisi Saat Meninggalkan Fasyankes](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_12_pengiriman_data_kondisi_saat_meninggalkan_fasyankes) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [13. Pengiriman Data Cara Keluar dari Fasyankes](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_13_pengiriman_data_cara_keluar_dari_fasyankes) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
| [14. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/skrining-ptm/#_14_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-penyakit-tidak-menular.md) |
