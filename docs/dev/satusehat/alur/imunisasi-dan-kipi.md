# Imunisasi rutin, riwayat imunisasi, KIPI, dan COVID-19

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/) (v2.6, rilis 2024-05-27, disunting 2025-10-02) · [Imunisasi COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/) (v1.0, rilis 2024-07-15, disunting 2025-10-02) · [Immunization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload dan terminologi imunisasi dan KIPI](../payload/imunisasi-dan-kipi.md)

Dokumen ini mengikuti Playbook Imunisasi v2.6 (27 Mei 2024) dan Imunisasi COVID-19 v1.0 (15 Juli 2024). Portal menandai modul khusus COVID-19 tersedia di Sandbox selama pengembangan. Untuk dosis, penolakan, dan riwayat yang dilaporkan, pertahankan fakta pelayanan dan asal informasinya. [Playbook Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/) · [Playbook Imunisasi COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/)

## Prasyarat dan sumber data Metta

| Data | Sumber dan gap |
| --- | --- |
| Patient, nakes, fasilitas, lokasi | Registrasi Healthcare menyimpan pasien, kunjungan, tujuan, pelaksana dan ruangan. Perlu IHS dan Organization/Location yang tepat untuk poli, fasilitas atau kegiatan luar gedung. [Identitas](../payload/matriks-identitas.md) |
| Vaksin dan stok | Master obat dan pengeluaran stok memiliki data KFA serta batch pada skenario farmasi. Untuk imunisasi perlu pencatatan produk vaksin yang benar-benar diberikan, lot, kedaluwarsa, rute, dosis, seri dan pelaksana vaksinasi. Jangan menyimpulkan pemberian dari transaksi stok saja. [Matriks farmasi](../payload/matriks-farmasi.md) |
| Riwayat dan reaksi | Perlu sumber terstruktur untuk ingatan pasien, bukti tertulis, laporan kader, alasan tidak diberikan, serta waktu dan gejala KIPI. Simpan bukti sumber sebelum menentukan `primarySource` dan `reportOrigin`. |
| Skrining dan observasi COVID-19 | Registrasi mencatat kelompok skrining dan fakta kehamilan/siklus hidup. Data vital dasar ada. Versi Q0015, jawaban, riwayat imunisasi, hasil penentuan sasaran dan pemantauan pasca-imunisasi perlu penyimpanan khusus yang diverifikasi. [Registrasi Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [ILP](../../../../modules/healthcare/README.md#klaster-dan-siklus-hidup-ilp) |

## HTTP dan urutan transaksi

| Tahap | Operasi | Hasil yang disimpan |
| --- | --- | --- |
| Registrasi | Resolve MPI dan buat `POST /fhir-r4/v1/Encounter` sesuai pelayanan. | ID Patient, Encounter, Practitioner, Organization dan Location. |
| Skrining/status sebelum layanan | Buat Observation atau QuestionnaireResponse untuk fakta yang dipakai oleh modul, lalu simpan ID. Untuk COVID-19 ikuti grup Q0015 dan keputusan skrining. | Hasil dan waktu pemeriksaan. Jaga tautan ke pasien, kunjungan dan pelaku. |
| Pemberian, penolakan, atau riwayat | `POST /fhir-r4/v1/Immunization`. Untuk penolakan gunakan `not-done` dan statusReason. | Simpan ID server, identifier lokal bila dikirim, status, asal informasi dan identitas vaksin. |
| KIPI dan tindakan | Buat `POST /fhir-r4/v1/Observation` untuk gejala KIPI dan tautkan ke `Immunization.reaction[].detail` bila berlaku. `POST /Condition` dan `POST /Procedure` untuk diagnosis/tindakan yang tercatat. | ID hasil, waktu reaksi, data pelapor dan hubungan dengan Immunization. Bila KIPI baru dilaporkan sesudah data imunisasi ada, perbarui Immunization yang sama sesuai izin dan kontrak. |
| Baca balik dan koreksi | `GET /fhir-r4/v1/Immunization/{id}`. Search `GET /fhir-r4/v1/Immunization?patient={ihs}` dan parameter `date` sesuai katalog. Gunakan `PUT /Immunization/{id}` atau `PATCH /Immunization/{id}` yang didukung. Finalisasi Encounter dengan ID yang sama. | Cocokkan riwayat dan status sebelum mengulang kirim. Verifikasi ID, status, alasan, produk, dose number, pelaksana dan korelasi KIPI. |

FHIR menggunakan OAuth Bearer, host per environment, format resource JSON dan JSON Patch sesuai metode. Path singkat pada tabel relatif ke basis FHIR. [Katalog Immunization](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/immunization/) · [Kontrak HTTP](../endpoint/kontrak-fhir-http.md)

## Error, rekonsiliasi dan uji Sandbox

- Search sukses dapat mengembalikan Bundle kosong. Cocokkan Patient, tanggal, vaksin, nomor dosis, Organization dan fakta sumber sebelum retry create. Dua dosis dalam seri yang sama dibedakan dengan identifier/peristiwa, bukan hanya nama vaksin.
- `400`/`422` menandakan masalah seperti referensi atau code set. Catat HTTP status, `OperationOutcome.issue[]` serta Rule Number aktual. `401`/`403` menandakan konteks akses harus dikoreksi. Gunakan retry terbatas untuk timeout, `429` dan `5xx` setelah rekonsiliasi operasi tulis. [Validasi dan error](../validasi/respons-dan-error.md)
- Lulus saat pemberian, penolakan, laporan kader, riwayat recall/record, KIPI dan keputusan skrining COVID-19 bisa dibaca balik dengan status serta provenance yang tepat. Uji duplikasi, salah produk, IHS atau peran yang tidak sah. Gunakan fixture dan catat waktu, kode serta korelasi. Batasi log atas identitas, data kehamilan, gejala, catatan klinis dan header autentikasi.

Bukti Sandbox kedua program masih terbuka. [Matriks program anak](../payload/profil-field-imunisasi-dan-anak.md) · [Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
