# Field bertanda wajib untuk imunisasi dan kesehatan anak

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/) (v2.6, rilis 2024-05-27, disunting 2025-10-02) · [Imunisasi COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/) (v1.0, rilis 2024-07-15, disunting 2025-10-02) · [Tumbuh Kembang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/) (v3.0, rilis 2024-04-02, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Cara membaca aturan](aturan-field-fhir.md#cara-membaca-matriks)

Snapshot 16 November 2026. Matriks menunjukkan field bertanda `*` per bab publik Imunisasi, Imunisasi COVID-19, Tumbuh Kembang, Gizi, dan PKPR Luar Gedung. Field ditulis relatif terhadap resource pada kolom tengah. Tanda wajib dipakai sesuai tahap, fakta pelayanan dan struktur induk.

Pemetaan Imunisasi mempertahankan ejaan sumber `occurenceDateTime` untuk penelusuran. Dalam payload, pakai `occurrenceDateTime` atau pilihan FHIR yang sesuai. Blok seperti `reportOrigin` dan `expirationDate` mengikuti tabel variasi pemberian, penolakan dan riwayat. [Pemetaan payload Imunisasi](imunisasi-dan-kipi.md#payload-dan-terminologi-imunisasi-umum)

Untuk pemetaan yang mengambil definisi dari modul lain atau hadir dalam uraian biasa, baris mengarah ke kontrak internal. Validasi code system, pilihan `value[x]`, urutan referensi, dan akses terhadap kontrak use case. [Imunisasi dan KIPI](../alur/imunisasi-dan-kipi.md) · [Tumbuh Kembang dan Gizi](../alur/tumbuh-kembang-dan-gizi.md) · [Manajemen Terpadu Balita Sakit](../alur/manajemen-terpadu-balita-sakit.md) · [PKPR Luar Gedung](../alur/pkpr-luar-gedung.md)

[Imunisasi v2.6](#imunisasi-v26) · [Imunisasi COVID-19 v1.0](#imunisasi-covid-19-v10) · [Tumbuh Kembang v3.0](#tumbuh-kembang-v30) · [Gizi v4.0](#gizi-v40) · [PKPR Luar Gedung v1.1](#pkpr-luar-gedung-v11) · [Manajemen Terpadu Balita Sakit](#manajemen-terpadu-balita-sakit)

## Imunisasi v2.6

[Kontrak internal](../alur/imunisasi-dan-kipi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#pendaftaran-kunjungan) | `Encounter` | `identifier[i]`, `status`, `statusHistory[i].status`, `statusHistory[i].period`, `class`, `classHistory[i].class`, `classHistory[i].period`, `subject`, `participant[i].type`, `participant[i].individual`, `period`, `diagnosis[i].condition`, `location[i]`, `serviceProvider` |
| [3. Pengiriman Data Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#pengiriman-data-imunisasi) | `Immunization` | `status`, `vaccineCode`, `patient`, `encounter`, `occurenceDateTime`, `occurrenceString`, `recorded`, `primarySource`, `expirationDate`, `performer[i]`, `performer[i].function`, `performer[i].actor`, `vaccineCode.coding.system`, `vaccineCode.coding.code`, `vaccineCode.coding.display`, `reportOrigin`, `performer` |
| [4. Pengiriman Data Gejala KIPI dan Status Pasien Saat Diberikan Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#_4_pengiriman_data_gejala_kipi_dan_status_pasien_saat_diberikan_imunisasi) | `Observation` | `status`, `code`, `subject`, `encounter`, `performer` |
| [5. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#pengiriman-data-diagnosis) | `Condition` | `clinicalStatus`, `category`, `code`, `subject`, `encounter` |
| [6. Pengiriman Data Tindakan Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#_6_pengiriman_data_tindakan_imunisasi) | `Procedure` | `status`, `code`, `subject`, `encounter`, `performer[i].actor`, `focalDevice[i].manipulated` |
| [7. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#pembaharuan-data-kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |

## Imunisasi COVID-19 v1.0

[Kontrak internal](../alur/imunisasi-dan-kipi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [3. Pengiriman Data Penentuan Verifikasi Identitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_3_pengiriman_data_penentuan_verifikasi_identitas) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [4. Pengiriman Data Penentuan Sasaran](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_4_pengiriman_data_penentuan_sasaran) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [5. Pengiriman Data Skrining](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_5_pengiriman_data_skrining) | `Observation` | `code.coding.system`, `code.coding.code`, `code.coding.display` |
| [6. Pengiriman Data Hasil Pelayanan Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_6_pengiriman_data_hasil_pelayanan_imunisasi) | `Immunization` | `vaccineCode.coding[0].system`, `vaccineCode.coding[0].code`, `vaccineCode.coding[0].display`, `vaccineCode.coding[1].system`, `vaccineCode.coding[1].code`, `vaccineCode.coding[1].display`, `vaccineCode.coding[2].system`, `vaccineCode.coding[2].code`, `vaccineCode.coding[2].display`, `status`, `patient`, `encounter`, `occurenceDateTime`, `recorded`, `primarySource`, `reportOrigin`, `performer` |
| [7. Pengiriman Data Hasil Observasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_7_pengiriman_data_hasil_observasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [8. Pengiriman Data Gejala KIPI](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_8_pengiriman_data_gejala_kipi) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [9. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_9_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [10. Pengiriman Data Gejala KIPI](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_10_pengiriman_data_gejala_kipi) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [11. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_11_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |
| [12. Pembaharuan Data Kunjungan (Status Akhir Pasien) dan Diagnosis Akhir](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_12_pembaharuan_data_kunjungan_status_akhir_pasien_dan_diagnosis_akhir) | Pemetaan pada alur modul | [Kontrak internal](../alur/imunisasi-dan-kipi.md) |

## Tumbuh Kembang v3.0

[Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [3. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_3_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [4. Pengiriman Data Antropometri](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_4_pengiriman_data_antropometri) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [5. Pengiriman Data Stimulasi, Deteksi, dan Intervensi Dini Tumbuh Kembang (SDIDTK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_5_pengiriman_data_stimulasi_deteksi_dan_intervensi_dini_tumbuh_kembang_sdidtk) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [6. Pengiriman Data Riwayat Terkait Gizi dan Konsumsi Makanan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_6_pengiriman_data_riwayat_terkait_gizi_dan_konsumsi_makanan) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [7. Pengiriman Data Status Pertumbuhan dan Perkembangan, serta Data Lainnya](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_7_pengiriman_data_status_pertumbuhan_dan_perkembangan_serta_data_lainnya) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [8. Pengiriman Data Pemeriksaan Penunjang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_8_pengiriman_data_pemeriksaan_penunjang) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [9. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_9_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [10. Pengiriman Data Tindakan/Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_10_pengiriman_data_tindakanprosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [11. Pengiriman Data Farmasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_11_pengiriman_data_farmasi) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [12. Pengiriman Data Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_12_pengiriman_data_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [13. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_13_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [16. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tumbuh-kembang-new/#_16_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |

## Gizi v4.0

[Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#pendaftaran-pasien) | `RelatedPerson` | `identifier[i]`, `patient`, `relationship[i]`, `communication.language` |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [3. Pengiriman Data Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_3_pengiriman_data_anamnesis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [4. Pengiriman Data Hasil Pemeriksaan Fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_4_pengiriman_data_hasil_pemeriksaan_fisik) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [5. Pengiriman Data Asesmen Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_5_pengiriman_data_asesmen_gizi) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [6. Pengiriman Data Masalah Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_6_pengiriman_data_masalah_gizi) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [7. Pengiriman Data Intervensi/ Tatalaksana Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_7_pengiriman_data_intervensi_tatalaksana_gizi) | `NutritionOrder` | `status`, `intent`, `patient`, `encounter`, `dateTime` |
| [8. Pengiriman Data Monitoring dan Evaluasi Gizi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_8_pengiriman_data_monitoring_dan_evaluasi_gizi) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [9. Pengiriman Data Gizi Bermasalah](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_9_pengiriman_data_gizi_bermasalah) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [10. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_10_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [11. Pengiriman Data Tindakan/ Prosedur Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_11_pengiriman_data_tindakan_prosedur_medis) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [12. Pengiriman Data Rencana Tindak Lanjut & Sarana Transportasi Untuk Rujuk](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_12_pengiriman_data_rencana_tindak_lanjut_sarana_transportasi_untuk_rujuk) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [13. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_13_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [14. Pengiriman Data Kondisi Saat Meninggalkan Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_14_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [15. Pengiriman Data Cara Keluar dari Rumah Sakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_15_pengiriman_data_cara_keluar_dari_rumah_sakit) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |
| [16. Pembaharuan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/gizi/#_16_pembaharuan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/tumbuh-kembang-dan-gizi.md) |

## PKPR Luar Gedung v1.1

[Kontrak internal](../alur/pkpr-luar-gedung.md)

| Bab | Resource | Field bertanda `*` |
| --- | --- | --- |
| [1. Pendaftaran Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#pendaftaran-pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [2. Pendaftaran Kunjungan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_2_pendaftaran_kunjungan_pasien) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [3. Identifikasi Disabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_3_identifikasi_disabilitas) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [4. Pemeriksaan Kesehatan untuk Usia Sekolah dan Remaja di UKS](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_4_pemeriksaan_kesehatan_untuk_usia_sekolah_dan_remaja_di_uks) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [5. Pemeriksaan Kesehatan untuk Usia Sekolah dan Remaja di Posyandu oleh Nakes dan Kader](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_5_pemeriksaan_kesehatan_untuk_usia_sekolah_dan_remaja_di_posyandu_oleh_nakes_dan_kader) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [6. Pengiriman Data Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_6_pengiriman_data_diagnosis) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [7. Pengiriman Data Instruksi untuk Tindak Lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_7_pengiriman_data_instruksi_untuk_tindak_lanjut) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |
| [8. Pembaruan Data Kunjungan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/#_8_pembaruan_data_kunjungan) | Pemetaan pada alur modul | [Kontrak internal](../alur/pkpr-luar-gedung.md) |

## Manajemen Terpadu Balita Sakit

MTBS diterbitkan dalam buku PDF. Pemetaan untuk bab 1–13, grup Q0011 dan Q0027, serta referensi Observation tercatat di [Kontrak dan matriks MTBS](../alur/manajemen-terpadu-balita-sakit.md). [Buku publik versi 1.0](https://drive.google.com/file/d/16sTSKmOoZjGz0LxQXd6H3If58haZefnF/preview)
