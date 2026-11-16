# Field bertanda wajib untuk program ibu dan bayi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Antenatal Care (ANC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/) (v2.5, rilis 2024-07-02, disunting 2025-10-02) · [Intranatal Care (INC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/) (v2.7, rilis 2024-09-10, disunting 2025-10-02) · [Postnatal Care (PNC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/) (v3.5, rilis 2024-07-19, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Cara membaca aturan](aturan-field-fhir.md#cara-membaca-matriks)

Snapshot 16 November 2026. Matriks menunjukkan field bertanda `*` per bab publik ANC, INC, PNC, Neonatus, Data Kelahiran, MPDN dan SHK. Field ditulis relatif terhadap resource pada kolom tengah. Tanda wajib dipakai sesuai tahap dan parent. Contohnya, field pada anggota `statusHistory[]` berlaku ketika item histori dipakai.

Untuk pemetaan yang mengambil definisi dari modul lain atau hadir dalam uraian biasa, baris mengarah ke kontrak internal. Validasi code system, pilihan `value[x]`, urutan referensi, dan akses terhadap kontrak use case. [Kunjungan dan program](../alur/program-kehamilan-persalinan-dan-neonatus.md) · [Kelahiran dan akta](../alur/data-kelahiran-dan-akta.md) · [MPDN dan SMPK](../alur/pelaporan-kematian-mpdn-dan-smpk.md) · [SHK](../alur/skrining-hipotiroid-kongenital.md)

[ANC v2.5](#anc-v25) · [INC v2.7](#inc-v27) · [PNC v3.5](#pnc-v35) · [Neonatus v2.6](#neonatus-v26) · [Data Kelahiran v1.0](#data-kelahiran-v10) · [MPDN v1.4](#mpdn-v14) · [SHK v2.1](#shk-v21) · [Sertifikat Medis Penyebab Kematian](#sertifikat-medis-penyebab-kematian)

## ANC v2.5

[Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_2_pendaftaran_kunjungan_pasien) | `Encounter` | `identifier[i]`, `status`, `statusHistory[i].status`, `statusHistory[i].period`, `class`, `subject`, `participant[i].type[i]`, `participant[i].individual`, `period`, `diagnosis[i].condition`, `diagnosis[i].use`, `diagnosis[i].rank`, `location[i]`, `serviceProvider` |
| [3. Memulai Episode Kehamilan saat Kunjungan ANC](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_3_memulai_episode_kehamilan_saat_kunjungan_anc) | `EpisodeOfCare` | `status`, `type[i]`, `patient`, `managingOrganization`, `period` |
| [4. Pengiriman Data Kondisi Pasien atau Status Obstetri](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_4_pengiriman_data_kondisi_pasien_atau_status_obstetri) | `Observation` | `status`, `code`, `subject`, `encounter`, `performer[i]` |
| [4. Pengiriman Data Kondisi Pasien atau Status Obstetri](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_4_pengiriman_data_kondisi_pasien_atau_status_obstetri) | `Immunization` | `status`, `vaccineCode`, `patient`, `encounter`, `occurenceDateTime`, `primarySource`, `expirationDate`, `performer[i]`, `performer[i].function`, `performer[i].actor` |
| [5. Pengiriman Data Kunjungan Kehamilan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_5_pengiriman_data_kunjungan_kehamilan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [6. Pengiriman Data Pelayanan Kehamilan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_6_pengiriman_data_pelayanan_kehamilan) | `QuestionnaireResponse` | `status`, `subject`, `encounter`, `author`, `source`, `item.item` |
| [6. Pengiriman Data Pelayanan Kehamilan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_6_pengiriman_data_pelayanan_kehamilan) | `Condition` | `code`, `subject`, `encounter` |
| [7. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_7_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [8. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_8_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [9. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_9_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [10. Pengiriman Data Tema Konseling/Temu Wicara/Edukasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_10_pengiriman_data_tema_konselingtemu_wicaraedukasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [11. Pengiriman Data Farmasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_11_pengiriman_data_farmasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [12. Pengiriman Data Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_12_pengiriman_data_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [13. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_13_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [16. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_16_pembaruan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [17. Menutup Episode Kehamilan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_17_menutup_episode_kehamilan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |

## INC v2.7

[Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [3. Menutup Episode Kehamilan ANC Saat Persalinan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_3_menutup_episode_kehamilan_anc_saat_persalinan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [4. Pengiriman Data Persalinan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_4_pengiriman_data_persalinan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [5. Pengiriman Data Pelayanan Persalinan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_5_pengiriman_data_pelayanan_persalinan) | `Observation` | `code.coding.system`, `code.coding.code`, `code.coding.display`, `category[i].coding[i].system`, `category[i].coding[i].code`, `category[i].coding[i].display` |
| [6. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_6_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [7. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_7_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [8. Pengiriman Data Farmasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_8_pengiriman_data_farmasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [9. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_9_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [10. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_10_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [11. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_11_pembaruan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |

## PNC v3.5

[Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_1_pendaftaran_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_2_pendaftaran_kunjungan_pasien) | `Encounter` | `identifier[i]`, `status`, `statusHistory[i].status`, `statusHistory[i].period`, `class`, `subject`, `participant[i].type`, `participant[i].individual`, `period`, `diagnosis[i].condition`, `diagnosis[i].use`, `diagnosis[i].rank`, `hospitalization.dischargeDisposition`, `location[i]`, `serviceProvider` |
| [3. Memulai Episode Nifas saat Kunjungan Pertama Kali PNC](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_3_memulai_episode_nifas_saat_kunjungan_pertama_kali_pnc) | `EpisodeOfCare` | `status`, `type`, `patient`, `managingOrganization`, `period` |
| [4. Pengiriman Data Persalinan dan Status Obstetri](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_4_pengiriman_data_persalinan_dan_status_obstetri) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [5. Pengiriman Data Pelayanan Nifas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_5_pengiriman_data_pelayanan_nifas) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [6. Pengiriman Data Pemeriksaan Penunjang Laboratorium](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_6_pengiriman_data_pemeriksaan_penunjang_laboratorium) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [7. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_7_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [8. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#tindakan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [9. Pengiriman Data Farmasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_9_pengiriman_data_farmasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [10. Pengiriman Data Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_10_pengiriman_data_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [11. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_11_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [12. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_12_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [13. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_13_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [14. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_14_pembaruan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [15. Menutup Episode Nifas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_15_menutup_episode_nifas) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |

## Neonatus v2.6

[Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_1_pendaftaran_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [3. Memulai Episode Neonatus Saat Kunjungan Neonatus Pertama Kali](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_3_memulai_episode_neonatus_saat_kunjungan_neonatus_pertama_kali) | `EpisodeOfCare` | `status`, `statusHistory.status`, `diagnosis.condition`, `patient` |
| [4. Pengiriman Data Bayi/Balita](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_4_pengiriman_data_bayibalita) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [5. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_5_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [6. Pengiriman Data Perawatan Neonatal Esensial](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_6_pengiriman_data_perawatan_neonatal_esensial) | `Observation` | `code.coding.system`, `code.coding.code`, `code.coding.display`, `category[i].coding[i].system`, `category[i].coding[i].code`, `category[i].coding[i].display` |
| [7. Pengiriman Data Pemeriksaan Fisik Head to Toe](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_7_pengiriman_data_pemeriksaan_fisik_head_to_toe) | `Observation` | `category.coding.display` |
| [8. Pengiriman Data Skrining Hipotiroid Kongenital (SHK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_8_pengiriman_data_skrining_hipotiroid_kongenital_shk) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [9. Pemeriksaan Berat Badan dan Pemberian ASI](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_9_pemeriksaan_berat_badan_dan_pemberian_asi) | `Observation` | `category[i].coding[i].system`, `category[i].coding[i].code`, `category[i].coding[i].display`, `code.coding.system`, `code.coding.code`, `code.coding.display` |
| [10. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_10_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [11. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_11_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [12. Pengiriman Data Farmasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_12_pengiriman_data_farmasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [13. Pengiriman Data Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_13_pengiriman_data_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [14. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_14_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [15. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_15_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [16. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_16_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [17. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_17_pembaruan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |
| [18. Menutup Episode Neonatus](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_18_menutup_episode_neonatus) | Pemetaan pada alur modul | [Kontrak internal](../alur/program-kehamilan-persalinan-dan-neonatus.md) |

## Data Kelahiran v1.0

[Kontrak internal](../alur/data-kelahiran-dan-akta.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_1_pendaftaran_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/data-kelahiran-dan-akta.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/data-kelahiran-dan-akta.md) |
| [3. Pengiriman Data Variabel dari Modul INC](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_3_pengiriman_data_variabel_dari_modul_inc) | Pemetaan pada alur modul | [Kontrak internal](../alur/data-kelahiran-dan-akta.md) |
| [4. Pengiriman Data Variabel dari Modul Neonatus](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_4_pengiriman_data_variabel_dari_modul_neonatus) | Pemetaan pada alur modul | [Kontrak internal](../alur/data-kelahiran-dan-akta.md) |
| [5. Pengiriman Data Variabel Data Kelahiran Lainnya](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_5_pengiriman_data_variabel_data_kelahiran_lainnya) | `RelatedPerson` | `patient`, `identifier.use`, `identifier.system`, `identifier.value`, `relationship.system`, `relationship.code`, `relationship.display` |
| [5. Pengiriman Data Variabel Data Kelahiran Lainnya](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_5_pengiriman_data_variabel_data_kelahiran_lainnya) | `DocumentReference` | `status`, `identifier` |
| [6. Pengiriman Data Task Akta Lahir](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_6_pengiriman_data_task_akta_lahir) | `Task` | `status`, `intent`, `encounter`, `input.type`, `input.value[x]`, `output.type`, `output.value[x]` |

## MPDN v1.4

[Kontrak internal](../alur/pelaporan-kematian-mpdn-dan-smpk.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pelaporan Kematian Ibu](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/#_1_pelaporan_kematian_ibu) | Pemetaan pada alur modul | [Kontrak internal](../alur/pelaporan-kematian-mpdn-dan-smpk.md) |
| [2. Pelaporan Kematian Bayi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/#_2_pelaporan_kematian_bayi) | Pemetaan pada alur modul | [Kontrak internal](../alur/pelaporan-kematian-mpdn-dan-smpk.md) |

## SHK v2.1

[Kontrak internal](../alur/skrining-hipotiroid-kongenital.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pembuatan Data Pasien Bayi Baru Lahir (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_1_pembuatan_data_pasien_bayi_baru_lahir_faskes_perujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [2. Pendaftaran Kunjungan Pasien (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pendaftaran-kunjungan-pasien) | `Encounter` | `identifier[i]`, `status`, `statusHistory[i].status`, `statusHistory[i].period`, `class`, `classHistory[i].class`, `classHistory[i].period`, `subject`, `participant[i].type`, `participant[i].individual`, `period`, `diagnosis[i].condition`, `diagnosis[i].use`, `diagnosis[i].rank`, `hospitalization.dischargeDisposition`, `location[i]`, `serviceProvider` |
| [3. Skema Pengiriman Data Terkait Pemeriksaan Penunjang Laboratorium](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_3_skema_pengiriman_data_terkait_pemeriksaan_penunjang_laboratorium) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [4. Pengiriman Data Permintaan Rujukan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-permintaan-rujukan) | `ServiceRequest` | `status`, `intent`, `code`, `subject`, `encounter`, `requester`, `performer[i]` |
| [4. Pengiriman Data Permintaan Rujukan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-permintaan-rujukan) | `Observation` | `status`, `code`, `subject`, `encounter`, `issued`, `performer`, `specimen` |
| [4. Pengiriman Data Permintaan Rujukan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-permintaan-rujukan) | `Condition` | `code`, `subject`, `encounter` |
| [4. Pengiriman Data Permintaan Rujukan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-permintaan-rujukan) | `Procedure` | `status`, `code`, `subject`, `encounter`, `performer[i].actor`, `focalDevice[i].manipulated` |
| [4. Pengiriman Data Permintaan Rujukan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-permintaan-rujukan) | `MedicationStatement` | `status`, `medication[x]`, `subject`, `context` |
| [5. Pengiriman Data Spesimen (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-spesimen) | `Specimen` | `type`, `subject`, `request`, `extension:transportedTime`, `extension:transportedPerson`, `extension:ReceivedPerson` |
| [6. Pencarian Data Permintaan Rujukan Pemeriksaan Laboratorium (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_6_pencarian_data_permintaan_rujukan_pemeriksaan_laboratorium_faskes_perujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [7. Pencarian Data Specimen (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_7_pencarian_data_specimen_faskes_perujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [8. Pencarian Data Permintaan Rujukan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_8_pencarian_data_permintaan_rujukan_pemeriksaan_skrining_hipotiroid_kongenital_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [9. Pencarian Data Spesimen Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_9_pencarian_data_spesimen_pemeriksaan_skrining_hipotiroid_kongenital_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [10. Pencarian Data Informasi Penunjang Skrining Hipotiroid Kongenital (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_10_pencarian_data_informasi_penunjang_skrining_hipotiroid_kongenital_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [11. Pembaharuan Data Spesimen Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_11_pembaharuan_data_spesimen_pemeriksaan_skrining_hipotiroid_kongenital_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [12. Pengiriman dan Pembaruan Data Kunjungan (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-dan-pembaharuan-data-kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [13. Pengiriman Data Hasil Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-hasil-pemeriksaan-shk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [14. Pengiriman Data Laporan Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#pengiriman-data-laporan-pemeriksaan-shk) | `DiagnosticReport` | `identifier`, `basedOn`, `status`, `code`, `subject`, `encounter`, `issued`, `performer`, `specimen`, `result` |
| [15. Pembaruan Data Kunjungan (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_15_pembaruan_data_kunjungan_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [16. Pencarian Data Hasil Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_16_pencarian_data_hasil_pemeriksaan_skrining_hipotiroid_kongenital_faskes_perujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [17. Pencarian Data Laporan Hasil Pemeriksaan Skrining Hipotiroid Kongenital (Faskes Perujuk)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_17_pencarian_data_laporan_hasil_pemeriksaan_skrining_hipotiroid_kongenital_faskes_perujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [18. Pencarian Data Pasien Bayi Baru Lahir untuk Tes Konfirmasi (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_18_pencarian_data_pasien_bayi_baru_lahir_untuk_tes_konfirmasi_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [19. Pendaftaran Kunjungan Pasien untuk Tes Konfirmasi (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_19_pendaftaran_kunjungan_pasien_untuk_tes_konfirmasi_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [20. Pengiriman Data Permintaan Tes Konfirmasi (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_20_pengiriman_data_permintaan_tes_konfirmasi_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [21. Pengiriman Spesimen Permintaan Tes Konfirmasi (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_21_pengiriman_spesimen_permintaan_tes_konfirmasi_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [22. Pengiriman Data Hasil Tes Konfirmasi (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_22_pengiriman_data_hasil_tes_konfirmasi_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [23. Pengiriman Data Laporan Hasil Tes Konfirmasi (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_23_pengiriman_data_laporan_hasil_tes_konfirmasi_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [24. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_24_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |
| [25. Pembaruan Data Kunjungan (Faskes Rujukan)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/#_25_pembaruan_data_kunjungan_faskes_rujukan) | Pemetaan pada alur modul | [Kontrak internal](../alur/skrining-hipotiroid-kongenital.md) |

## Sertifikat Medis Penyebab Kematian

SMPK dipublikasikan dalam buku PDF. Tahap dan field utamanya tercatat pada [Kontrak SMPK](../alur/pelaporan-kematian-mpdn-dan-smpk.md#smpk). [Buku publik v1.5](https://drive.google.com/file/d/1zJiGu4T99iv4I3mY67iyHZuqGPCIWqhN/preview)
