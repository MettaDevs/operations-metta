# Manajemen Terpadu Balita Sakit (MTBS)

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Manajemen Terpadu Balita Sakit (MTBS)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mtbs-prio/) (v1.0, rilis 2024-11-04, disunting 2024-12-08) · [Lampiran Terminologi Manajemen Terpadu Balita Sakit](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/mtbs/) (disunting 2024-08-21)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload Q0011 dan Q0027 untuk MTBS](../payload/manajemen-terpadu-balita-sakit.md)

MTBS melaporkan asesmen balita sakit melalui Observation dan QuestionnaireResponse, dengan instrumen berbeda menurut kelompok usia. Gunakan Playbook v1.0. Halaman indeks mencantumkan rilis 4 November 2024, sementara buku publik menuliskan versi 1.0 tanggal 18 November 2024. Pemetaan di bawah mengikuti isi buku. [Halaman MTBS](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mtbs-prio/) · [Buku teknis v1.0](https://drive.google.com/file/d/16sTSKmOoZjGz0LxQXd6H3If58haZefnF/preview)

## Prasyarat Metta

Siapkan IHS anak, nakes, Organization, Location, usia di tanggal layanan, dan ID Encounter. Untuk bayi baru lahir gunakan [MPI](../endpoint/master-data-pasien.md). Metta menyimpan tanggal lahir, registrasi, klaster usia, anamnesis, tanda vital, hasil fisik, diagnosis, tindakan, resep dan status pasien. Instrumen MTBS memerlukan data per linkId, bukti pemeriksaan, klasifikasi dari klinisi, serta cut-off umur dan versi yang dipakai. Klasifikasi ILP menjadi petunjuk kelompok layanan. Umur untuk memilih instrumen harus dibuktikan pada tanggal pelayanan. [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [ILP](../../../../modules/healthcare/README.md#klaster-dan-siklus-hidup-ilp)

## Tahapan, operasi dan hubungan

| Bab buku | Request dan fungsi | Keluaran |
| --- | --- | --- |
| 1–2 | Lookup Patient dan registrasi dengan `POST /fhir-r4/v1/Encounter`. | ID Patient dan Encounter, nakes dan Organization yang berwenang. |
| 3 | Untuk pasien yang masih dalam usia neonatus, cari atau buat EpisodeOfCare bertipe `Neonate`. Tautkan ke `Encounter.episodeOfCare[]`. | ID episode yang sama dipakai saat kedatangan berikutnya. [Kontrak episode](../endpoint/episode-kehamilan-dan-neonatus.md#kontrak-episodeofcare-dan-encounter) |
| 4–5.1 | Catat keluhan melalui Condition sesuai profil. `POST /fhir-r4/v1/Observation` untuk berat, panjang/tinggi, lingkar lengan, lingkar kepala dan suhu sesuai pemeriksaan. | ID hasil, waktu, unit dan petugas. [Antropometri](../payload/tumbuh-kembang-dan-gizi.md#antropometri-dan-temuan-gizi) |
| 5.2–5.3 | `POST /fhir-r4/v1/Observation` untuk hasil penilaian klinis yang dirujuk. `POST /fhir-r4/v1/QuestionnaireResponse` untuk `Q0011` atau `Q0027`. | ID setiap Observation. Isi `answer.valueReference` hanya setelah memperoleh ID. Simpan ID formulir, versi dan Encounter. |
| 6–8 | Diagnosis Condition, tindakan Procedure, tatalaksana dengan resource farmasi sesuai layanan. | ID dan kode terhubung ke Encounter yang sama. [Farmasi](../payload/matriks-farmasi.md) |
| 9–13 | Rencana dan instruksi tindak lanjut, rujuk, kondisi/cara keluar dan finalisasi Encounter. Gunakan ServiceRequest, Condition dan Encounter sesuai pintu masuk. `PUT /fhir-r4/v1/Encounter/{id}` membawa ID balikan. | Baca ulang Encounter selesai, diagnosis, rencana dan disposition yang tepat. |

Gunakan OAuth Bearer, media type dan host mengikuti [Kontrak FHIR](../endpoint/kontrak-fhir-http.md). Untuk referensi bukti gunakan detail `GET /fhir-r4/v1/QuestionnaireResponse/{id}`, `GET /fhir-r4/v1/Observation/{id}`, atau query pasien/Encounter yang tersedia di [Inventaris HTTP](../endpoint/inventaris-operasi-http.md). Periksa `subject`, `encounter`, `status`, `questionnaire`, dan referensi hasil. Satu jawaban `false` tetap merupakan fakta yang harus disimpan sesuai versi formulir.

## Error, akses dan penerimaan

| Kondisi uji | Kriteria lulus |
| --- | --- |
| Usia 0–<2 bulan, termasuk neonatus | Q0011 dan Observation berhubungan. Untuk bayi neonatus, dua kunjungan yang relevan memakai episode yang sama. |
| Usia 2 bulan–5 tahun | Gunakan Q0027 dengan cabang tanda bahaya, pemeriksaan yang dilakukan dan hasil nutrisi/pertumbuhan yang tepat. Uji usia perbatasan instrumen dan referensi hasil kondisional. |
| Error validasi dan izin | Uji linkId atau tipe jawaban salah, rujukan Observation ke pasien lain dan Organization yang tidak berwenang. Catat `400`/`422`, `OperationOutcome.issue[]` atau `401`/`403` sesuai bukti. |
| Retry create dan tindak lanjut | Pada respons hilang, cari dahulu hasil atau respons sebelumnya menurut ID, pasien, Encounter dan waktu. Terapkan retry terbatas untuk gangguan sementara. Baca ulang Encounter, Condition dan instruksi untuk memastikan urutan dan korelasi tetap sama. |
| Privasi | Gunakan fixture tanpa identitas nyata. Simpan ID korelasi yang disamarkan, kode, waktu dan status. Batasi akses ke riwayat klinis anak serta payload, termasuk asesmen HIV. |

Kontrak peran, bentuk operation outcome aktual, dan bukti Sandbox Metta masih terbuka. [Validasi dan error](../validasi/respons-dan-error.md) · [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
