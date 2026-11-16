# Field dan rujukan per bab registrasi, gigi, dan MCU

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Simplifikasi Registrasi Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/) (v1.0, rilis 2026-08-13, disunting 2026-10-13) · [Simplifikasi Registrasi Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/) (v1.0, rilis 2026-10-05, disunting 2026-10-13) · [Registrasi Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/) (v1.0, rilis 2026-04-01, disunting 2026-07-30)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Cara membaca aturan](aturan-field-fhir.md#cara-membaca-matriks)

Snapshot 16 November 2026. Matriks menunjukkan field bertanda `*` per bab pada Playbook Jantung, Stroke, Kanker, Uronefrologi, dan Gigi. Field ditulis relatif terhadap resource pada kolom tengah. Isi sesuai tahap, kejadian dan struktur induk.

Untuk pemetaan yang mengambil definisi dari modul lain atau hadir dalam uraian biasa, baris mengarah ke kontrak internal. Validasi code system, pilihan `value[x]`, urutan referensi, dan akses terhadap kontrak use case. [Jantung, Stroke, Kanker, Uronefrologi](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) · [Gigi](../alur/rawat-jalan-gigi-dan-odontogram.md) · [Mata dan Telinga](../alur/registrasi-mata-dan-telinga.md) · [MCU](../alur/medical-check-up.md)

[Jantung v1.0](#jantung-v10) · [Stroke v1.0](#stroke-v10) · [Kanker v1.0](#kanker-v10) · [Uronefrologi v1.5](#uronefrologi-v15) · [Gigi v1.5](#gigi-v15) · [Playbook yang diterbitkan sebagai buku PDF](#playbook-yang-diterbitkan-sebagai-buku-pdf)

## Jantung v1.0

[Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Identitas Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#pendaftaran-identitas-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [3. Memulai Episode Perawatan Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_3_memulai_episode_perawatan_jantung) | `EpisodeOfCare` | `status`, `type[i]`, `patient`, `managingOrganization`, `period` |
| [4. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_4_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [5. Pengiriman Data Hasil Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_5_pengiriman_data_hasil_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [6. Pengiriman Data Hasil Pemeriksaan Psikologis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_6_pengiriman_data_hasil_pemeriksaan_psikologis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [7. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_7_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [8. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_8_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [9. Pengiriman Data Tindakan/ Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_9_pengiriman_data_tindakan_prosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [10. Pengiriman Data Tatalaksana](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_10_pengiriman_data_tatalaksana) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [11. Pengiriman Data Prognosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_11_pengiriman_data_prognosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [12. Pengiriman Data Rencana Tindak Lanjut dan Sarana Transportasi untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_12_pengiriman_data_rencana_tindak_lanjut_dan_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [13. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_13_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [16. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_16_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [17. Menutup Episode Perawatan Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_17_menutup_episode_perawatan_jantung) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [18. Pengiriman Data Registrasi Jantung melalui Composition](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_18_pengiriman_data_registrasi_jantung_melalui_composition) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |

## Stroke v1.0

[Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Identitas Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_1_pendaftaran_identitas_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [3. Memulai Episode Perawatan Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_3_memulai_episode_perawatan_stroke) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [4. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_4_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [5. Pengiriman Data Hasil Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_5_pengiriman_data_hasil_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [6. Pengiriman Data Pemeriksaan Neurologis Penyakit Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_6_pengiriman_data_pemeriksaan_neurologis_penyakit_stroke) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [7. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_7_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [8. Pengiriman Data Diagnosis Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_8_pengiriman_data_diagnosis_stroke) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [9. Pengiriman Data Tindakan/ Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_9_pengiriman_data_tindakan_prosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [10. Pengiriman Data Tatalaksana](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_10_pengiriman_data_tatalaksana) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [11. Pengiriman Data Prognosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_11_pengiriman_data_prognosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [12. Pengiriman Data Rencana Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_12_pengiriman_data_rencana_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [13. Pengiriman Data Instruksi untuk Tindak Lanjut dan Sarana Transportasi untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_13_pengiriman_data_instruksi_untuk_tindak_lanjut_dan_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [16. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_16_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [17. Menutup Episode Perawatan Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_17_menutup_episode_perawatan_stroke) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [18. Pengiriman Data Registrasi Stroke melalui Composition](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_18_pengiriman_data_registrasi_stroke_melalui_composition) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |

## Kanker v1.0

[Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Identitas Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [3. Memulai Episode Perawatan Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_3_memulai_episode_perawatan_kanker) | `EpisodeOfCare` | `status`, `type`, `patient`, `managingOrganization`, `period` |
| [4. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_4_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [5. Pengiriman Data Hasil Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_5_pengiriman_data_hasil_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [6. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_6_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [7. Pengiriman Data Diagnosis Tumor](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_7_pengiriman_data_diagnosis_tumor) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [8. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_8_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [9. Pengiriman Data Tatalaksana](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_9_pengiriman_data_tatalaksana) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [10. Pengiriman Data Prognosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_10_pengiriman_data_prognosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [11. Pengiriman Data Rencana Tindak Lanjut dan Sarana Transportasi untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_11_pengiriman_data_rencana_tindak_lanjut_dan_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [12. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_12_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [13. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_13_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [14. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_14_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [15. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_15_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [16. Menutup Episode Perawatan Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_16_menutup_episode_perawatan_kanker) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [17. Pengiriman Data Registrasi Kanker melalui Composition](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_17_pengiriman_data_registrasi_kanker_melalui_composition) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |

## Uronefrologi v1.5

[Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [3. Memulai Episode Perawatan Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_3_memulai_episode_perawatan_uronefrologi) | `EpisodeOfCare` | `status`, `type`, `patient`, `managingOrganization`, `period` |
| [4. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_4_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [5. Pengiriman Data Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_5_pengiriman_data_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [6. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_6_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [7. Pengiriman Data Pemeriksaan Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_7_pengiriman_data_pemeriksaan_uronefrologi) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [8. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_8_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [9. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_9_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [10. Pengiriman Data Tatalaksana](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_10_pengiriman_data_tatalaksana) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [11. Pengiriman Data Prognosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_11_pengiriman_data_prognosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [12. Pengiriman Data Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_12_pengiriman_data_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [13. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_13_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [16. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_16_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [17. Menutup Episode Perawatan Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_17_menutup_episode_perawatan_uronefrologi) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |
| [18. Pengiriman Data Registrasi Uronefrologi melalui Composition](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_18_pengiriman_data_registrasi_uronefrologi_melalui_composition) | Pemetaan pada alur modul | [Kontrak internal](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) |

## Gigi v1.5

[Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [3. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_3_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [4. Pengiriman Data Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_4_pengiriman_data_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [5. Pengiriman Data Pemeriksaan Odontogram](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_5_pengiriman_data_pemeriksaan_odontogram) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [6. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_6_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [7. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_7_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [8. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_8_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [9. Pengiriman Data Edukasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_9_pengiriman_data_edukasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [10. Pengiriman Data Farmasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_10_pengiriman_data_farmasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [11. Pengiriman Data Prognosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_11_pengiriman_data_prognosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [12. Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_12_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [13. Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_13_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |
| [16. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-jalan-gigi/#_16_pembaruan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/rawat-jalan-gigi-dan-odontogram.md) |

## Playbook yang diterbitkan sebagai buku PDF

| Modul | Cakupan bab | Rujukan field internal dan sumber |
| --- | --- | --- |
| Mata v1.0 | 1–19 | [Episode, hasil per mata, resep lensa dan registrasi](../alur/registrasi-mata-dan-telinga.md#registrasi-mata) · [Buku Mata](https://drive.google.com/file/d/1oWFHZ2-hTO4RIBc6C0CtsVPHZKvGzq4N/preview) |
| Telinga v1.0 | 1–26 | [Episode, audiologi, CarePlan dan registrasi](../alur/registrasi-mata-dan-telinga.md#registrasi-telinga) · [Buku Telinga](https://drive.google.com/file/d/1CPbTLCLuG9YckkhYsQxLHjESP4l9Gx_w/preview) |
| MCU v1.0 | 1–14 | [Kunjungan MCU, hasil, resume dan kelaikan](../alur/medical-check-up.md) · [Buku MCU](https://drive.google.com/file/d/1rnKE0RjZX8FiYhP_Ftr3PLCcW8qhrMWf/preview) |
