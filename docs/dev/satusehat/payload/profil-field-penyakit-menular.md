# Field dan tahapan program penyakit menular

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/) (v4.3, rilis 2024-11-05, disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Cara membaca aturan](aturan-field-fhir.md#cara-membaca-matriks)

Snapshot 16 November 2026. Matriks TB mengambil field bertanda `*` per bab. Field ditulis relatif terhadap resource pada kolom tengah. Baca tanda wajib bersama tahap klinis dan struktur induk. Field pada anggota statusHistory berlaku ketika item histori dikirim.

Untuk pemetaan yang mengambil definisi dari modul lain atau hadir dalam uraian biasa, baris mengarah ke kontrak internal. Validasi code system, pilihan `value[x]`, urutan referensi, dan akses terhadap kontrak use case. [TB dan SITB](../alur/tuberkulosis-dan-sitb.md) · [Pemeriksaan HIV](../alur/hiv-dan-pemeriksaan-penunjang.md) · [GHPR/Rabies](../alur/ghpr-rabies.md)

## Tuberkulosis v4.3

[Kontrak internal](../alur/tuberkulosis-dan-sitb.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#pendaftaran-kunjungan-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [3. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_3_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [4. Pengiriman Data Hasil Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_4_pengiriman_data_hasil_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [5. Pengiriman Data Klasifikasi Kasus Terduga TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_5_pengiriman_data_klasifikasi_kasus_terduga_tb) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [6. Pengiriman Data Register Terduga TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_6_pengiriman_data_register_terduga_tb) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [7. Memulai Episode Perawatan TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_7_memulai_episode_perawatan_tb) | `EpisodeOfCare` | `status`, `type`, `patient`, `managingOrganization`, `period` |
| [8. Pengiriman Data Terkait Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_8_pengiriman_data_terkait_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [9. Pengiriman Tindakan/ Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_9_pengiriman_tindakan_prosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [10. Pengiriman Data Diagnosis Tuberkulosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_10_pengiriman_data_diagnosis_tuberkulosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [11. Pembaharuan Episode Perawatan TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_11_pembaharuan_episode_perawatan_tb) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [12. Pengiriman Data Kasus TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_12_pengiriman_data_kasus_tb) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [13. Pengiriman Data Pengobatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_13_pengiriman_data_pengobatan) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [14. Pengiriman Data Rencana Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_14_pengiriman_data_rencana_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [15. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_15_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [16. Pengiriman Data Cara Keluar dari Fasyankes](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_16_pengiriman_data_cara_keluar_dari_fasyankes) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [17. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_17_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [18. Pengiriman Data Hasil Akhir Perawatan TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_18_pengiriman_data_hasil_akhir_perawatan_tb) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |
| [19. Menutup Episode Perawatan TB](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tuberkulosis/#_19_menutup_episode_perawatan_tb) | Pemetaan pada alur modul | [Kontrak internal](../alur/tuberkulosis-dan-sitb.md) |

## Playbook yang diterbitkan sebagai buku PDF

| Modul dan versi buku | Bab | Elemen utama dan kontrak internal |
| --- | --- | --- |
| HIV v1.3 | 1–2 | Patient, data sosial demografi dan Encounter. [Alur HIV](../alur/hiv-dan-pemeriksaan-penunjang.md#bab-110-dan-dependensi) |
| HIV v1.3 | 3 | EpisodeOfCare menandai `status`, `type`, `patient`, `managingOrganization` dan `period` wajib. [Episode dan Q0023](../alur/hiv-dan-pemeriksaan-penunjang.md#episode-dan-questionnaireresponse) |
| HIV v1.3 | 4 | Condition, AllergyIntolerance, MedicationStatement, Observation dan QuestionnaireResponse Q0023. [Episode dan Q0023](../alur/hiv-dan-pemeriksaan-penunjang.md#episode-dan-questionnaireresponse) |
| HIV v1.3 | 5–10 | Order, sampel, hasil, laporan, Condition, follow-up dan pembaruan Encounter. [Penunjang HIV](../alur/hiv-dan-pemeriksaan-penunjang.md#order-sampel-dan-hasil) |
| GHPR/Rabies v1.0 | 1–4 | Patient, Encounter, Condition, Observation dan QuestionnaireResponse Q0028. [Flow GHPR/Rabies](../alur/ghpr-rabies.md#alur-dan-operasi) |
| GHPR/Rabies v1.0 | 5–8 | Immunization VAR, Condition, Procedure, Medication dan pemberian SAR bila tercatat. [Payload GHPR/Rabies](ghpr-rabies.md#matriks-payload-dan-terminologi) |
| GHPR/Rabies v1.0 | 9–13 | Follow-up, rujukan, kondisi keluar dan pembaruan Encounter. [Flow GHPR/Rabies](../alur/ghpr-rabies.md#alur-dan-operasi) |

[Buku HIV](https://drive.google.com/file/d/1pALbwPhb68fql_pC4j8PstfQ2TKPVc5u/preview) · [Buku GHPR/Rabies](https://drive.google.com/file/d/1OehqrvXbsBsdi8fnUa4DoQrOTcSmB_Ev/preview)
