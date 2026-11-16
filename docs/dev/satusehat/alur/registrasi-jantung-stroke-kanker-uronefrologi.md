# Registrasi Jantung, Stroke, Kanker, dan Uronefrologi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Simplifikasi Registrasi Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/) (v1.0, rilis 2026-08-13, disunting 2026-10-13) · [Simplifikasi Registrasi Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/) (v1.0, rilis 2026-10-05, disunting 2026-10-13) · [Registrasi Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/) (v1.0, rilis 2026-04-01, disunting 2026-07-30)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload registrasi Jantung, Stroke, Kanker, dan Uronefrologi](../payload/registrasi-jantung-stroke-kanker-uronefrologi.md)

Dokumen ini mengikuti Simplifikasi Registrasi Jantung v1.0 (13 Agustus 2026), Simplifikasi Registrasi Stroke v1.0 (5 Oktober 2026), Registrasi Kanker v1.0 (1 April 2026), dan Registrasi Uronefrologi v1.5 (21 Agustus 2024). Masing-masing program menautkan Encounter ke EpisodeOfCare dan mengirim Composition dengan rujukan ke fakta yang telah diterbitkan. [Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/) · [Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/) · [Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/) · [Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/) · [Field per bab](../payload/profil-field-registrasi-dan-gigi.md)

[Prasyarat dan pemetaan Metta](#prasyarat-dan-pemetaan-metta) · [Episode per program](#episode-per-program) · [Flow, operasi dan respons](#flow-operasi-dan-respons) · [Error, privasi dan Sandbox](#error-privasi-dan-sandbox)

## Prasyarat dan pemetaan Metta

Siapkan IHS Patient dan Practitioner, Organization dan Location, izin program, Encounter sesuai pintu masuk, serta data diagnosis dan pemeriksaan yang disahkan. Operations menyimpan registrasi, penanggung jawab, riwayat, pemeriksaan fisik, ICD-10, tindakan, obat, rencana/status pasien. Untuk registri diperlukan status episode dan nomor nasional, data skrining, data penunjang sesuai alat, skor dan klasifikasi khusus, serta ID laporan dan pembaca yang berwenang. Tetapkan sumber LIS/RIS/DICOM bila pemeriksaan berasal dari sistem lain. [Identitas](../payload/matriks-identitas.md) · [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Diagnosis Metta](../../../../modules/healthcare/README.md#diagnosa-pemeriksaan) · [Skrining PTM](skrining-penyakit-tidak-menular.md)

## Episode per program

`EpisodeOfCare.type[]` memakai `http://terminology.kemkes.go.id/CodeSystem/episodeofcare-type`. Kirim Patient, `managingOrganization`, `status`, tipe, periode dan histori sesuai profil serta peristiwa. Gunakan `period` pada wire FHIR. Simpan ID resource, nomor surveilans dan nomor register sebagai pengenal terpisah. Di source nomor nasional disebut `suspect-id`, `register-id`, `registry-id`, atau Registrasi-id sesuai modul. Baca nama system yang benar-benar dikembalikan server. [Katalog EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/)

| Program | Mulai `waitlist` | Aktivasi atau penutupan |
| --- | --- | --- |
| Jantung `CAD` | Diagnosis hipertensi pertama disertai Charta Prediksi Risiko PTM sedang/tinggi menurut bab 3. | Setelah konfirmasi, PATCH ke `active`. Jika belum ada episode saat serangan/diagnosis, POST langsung `active`. Untuk hasil yang tidak mengonfirmasi penyakit jantung, panduan membiarkan status episode sebelumnya. Bab 17 menetapkan penutupan `finished` saat pasien meninggal. |
| Stroke `CVD` | Charta tinggi atau kasus terduga stroke sesuai bab 3. | Ketika serangan/diagnosis dicatat, PATCH `active`, atau POST `active` jika episode belum ada. Bab 17 menutup `finished` saat pasien meninggal. |
| Kanker `cancer` | Terduga sesuai bab 3. | PATCH ke `active` setelah kanker terkonfirmasi atau diagnosis kanker dicatat. Bab 16 menetapkan `finished` pada kematian pasien. Status awal untuk jalur tanpa episode terduga perlu dibuktikan dari kontrak registri. |
| Uronefrologi `CKD` | Diagnosis hipertensi dan/atau diabetes sesuai bab 3. | Diagnosis PGK mengubah status ke `active`, atau buat langsung `active` bila belum ada. Bab 17 menutup episode saat meninggal atau pada kasus batu saluran kemih di atas 18 tahun yang sudah dinyatakan sembuh sesuai ketentuan. |

[Episode Jantung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-jantung/#_3_memulai_episode_perawatan_jantung) · [Episode Stroke](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/stroke/#_3_memulai_episode_perawatan_stroke) · [Episode Kanker](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kanker/#_3_memulai_episode_perawatan_kanker) · [Episode Uronefrologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/uronefro/#_3_memulai_episode_perawatan_uronefrologi)

## Flow, operasi dan respons

| Tahap | Request | Hasil dan dependensi |
| --- | --- | --- |
| Identitas dan kunjungan | Lookup Patient melalui MPI. Buat `POST /fhir-r4/v1/Encounter` dengan pintu masuk yang benar. | Simpan ID pasien, nakes, lokasi, organisasi dan kunjungan. Tautkan episode yang sah pada `Encounter.episodeOfCare[]`. |
| Episode | `GET /fhir-r4/v1/EpisodeOfCare` untuk mencari yang sudah ada. [Kueri program](../endpoint/kueri-episode-of-care.md) memberi URL koleksi Jantung, Stroke dan Uronefrologi. Kanker mengikuti semantik Playbook sambil menunggu bukti URL khusus. `POST /EpisodeOfCare` untuk episode baru dan `PATCH /EpisodeOfCare/{id}` untuk transisi. | Baca ulang ID, status, namespace nomor nasional dan scope Organization. Simpan histori. Untuk penutupan, isi `period.end`, tutup histori aktif dan catat status selesai sesuai struktur terbaru yang dibaca. |
| Pemeriksaan | `POST /Observation`, `POST /Condition` dan resource penunjang sesuai program. Order, Specimen dan DiagnosticReport untuk lab/radiologi mengikuti profil terkait. | ID fakta per Patient dan Encounter. Simpan rujukan historis mana yang masuk laporan. |
| Tindakan, terapi, tindak lanjut | `POST /Procedure`, MedicationRequest dan resource farmasi sesuai peristiwa, ServiceRequest untuk rujukan atau layanan berikut, ClinicalImpression sesuai kebutuhan. | ID tindakan/resep/rencana; gunakan data aktual. Rujuk [Lab](laboratorium-rujukan-spesimen.md), [Radiologi](radiologi-dicom.md), [Farmasi](../payload/matriks-farmasi.md), [Rujukan](rujukan-pasien.md) dan [IGD/Rawat Inap](igd-dan-rawat-inap.md). |
| Finalisasi | `PUT /Encounter/{id}`, ID body sama dengan ID path. `POST /Composition` memakai type program dan `section[].entry[]` yang menunjuk ID yang sudah ada. | Simpan ID Composition dan identifier lokal. `GET /Composition/{id}` bila didukung; cocokkan Patient, Encounter, jenis, section, attestation dan rujukan sebelum menganggap pengiriman selesai. |

Path singkat relatif terhadap `/fhir-r4/v1`. Gunakan OAuth Bearer dan media type sesuai [Kontrak HTTP](../endpoint/kontrak-fhir-http.md). Saat lookup lintas fasyankes, simpan hanya episode yang aksesnya sah. Buat baru setelah memastikan hasil pencarian dan catatan lokal sesuai kejadian.

## Error, privasi dan Sandbox

Rekonsiliasi episode menurut ID, pasien, tipe, status, periode dan organisasi. Saat respons create hilang, cari data yang sudah tersimpan sebelum retry. Jika hasil klinis perlu diperbarui, gunakan ID dan versi yang didukung lalu pertahankan referensi Composition yang relevan. `400`/`422` perlu pemeriksaan `OperationOutcome.issue[]`, path dan Rule Number. `401`/`403` perlu pemeriksaan token dan scope. Terapkan retry terbatas setelah rekonsiliasi untuk `429`, `5xx` atau timeout. Log umum hanya memuat korelasi tersamarkan serta status. [Validasi dan error](../validasi/respons-dan-error.md)

Uji satu sesi untuk tiap program, dua kunjungan yang memakai episode sama, jalur langsung aktif jika tertulis, diagnosis belum terkonfirmasi, penutupan, ketepatan kode section, dan referensi silang yang keliru. Lulus jika episode, resource klinis, nomor surveilans/register dan Composition dapat dibaca ulang dengan Patient yang sama, dan retry tidak menduplikasi data. Uji Sandbox registri masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
