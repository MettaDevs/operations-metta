# Pelayanan Kesehatan Peduli Remaja (PKPR) luar gedung

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Kesehatan Peduli Remaja (PKPR) Luar Gedung](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/) (v1.1, rilis 2024-05-29, disunting 2025-10-02) · [Lampiran Terminologi Pelayanan Kesehatan Peduli Remaja (PKPR) Luar Gedung](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/pkpr-luar-gedung/) (disunting 2024-11-12)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload dan terminologi PKPR luar gedung](../payload/pkpr-luar-gedung.md)

Playbook PKPR v1.1 (29 Mei 2024) meliputi pemeriksaan anak usia 6 sampai kurang dari 18 tahun di UKS serta Posyandu oleh nakes atau kader. Gunakan Organization dan Location lokasi kegiatan yang terdaftar, serta tenaga dan sumber informasi sesuai tanggung jawabnya. [Playbook PKPR](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pkpr-luar-gedung/) · [Lampiran terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/pkpr-luar-gedung/)

## Prasyarat dan sumber Metta

Metta menyimpan demografi, klaster usia sekolah/remaja, tujuan kunjungan, ruangan, tanda vital, temuan pemeriksaan, diagnosis dan tindakan. Data ini mendukung identitas, Encounter dan sebagian Observation. Perlu pencatatan kegiatan luar gedung per UKS/Posyandu, hubungan fasilitas dan lokasi kegiatan, pelaku (nakes/kader), disabilitas, hasil tes mata/telinga, skor instrumen, TTD, NAPZA dan data merokok. Sumber hasil skrining berasal dari penilaian petugas yang tercatat. [Klaster ILP](../../../../modules/healthcare/README.md#klaster-dan-siklus-hidup-ilp) · [Rekam medis](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Identitas](../payload/matriks-identitas.md)

## Flow, endpoint dan output

| Bab | Operasi | Data yang disimpan |
| --- | --- | --- |
| 1–2 | Resolve Patient melalui MPI, buat `POST /fhir-r4/v1/Encounter` sesuai konteks pelayanan. Gunakan Location UKS atau Posyandu yang benar. | Patient, Encounter, Organization, Location dan pelaksana. |
| 3 | `POST /fhir-r4/v1/Observation` untuk identifikasi disabilitas bila dinilai. | ID temuan, waktu pemeriksaan, kode dan nilai yang benar-benar dinilai. |
| 4 | UKS mengirim Observation pengukuran, penglihatan, pendengaran, kebugaran, gigi, kesehatan jiwa, risiko dan temuan anemia; Procedure untuk pemeriksaan terkait bila dilakukan dan MedicationStatement untuk TTD yang dikonsumsi menurut profil. | Tautkan Observation dan tindakan yang sesuai, simpan nilai, bodySite dan sumber. |
| 5 | Posyandu nakes/kader mengirim Observation, QuestionnaireResponse dan MedicationStatement sesuai layanan; edukasi menggunakan Procedure sesuai Playbook. | Rekam pelaku, hasil, obat yang dikonsumsi dan instrumen Q0012 bila diisi. |
| 6–8 | `POST /fhir-r4/v1/Condition` bila ada diagnosis, `POST /fhir-r4/v1/ServiceRequest` untuk follow-up dan `PUT /fhir-r4/v1/Encounter/{id}` untuk menutup kunjungan. | Baca balik ID, diagnosis, rencana, waktu dan cara keluar. |

FHIR memakai Bearer, host per lingkungan dan JSON FHIR. Cek operasi MedicationStatement dan Procedure di [Inventaris operasi](../endpoint/inventaris-operasi-http.md). Baca ulang `GET /fhir-r4/v1/Observation/{id}` serta `GET /fhir-r4/v1/QuestionnaireResponse/{id}` setelah create. Gunakan query pasien/Encounter yang didokumentasikan untuk daftar hasil. [Kontrak HTTP](../endpoint/kontrak-fhir-http.md)

## Error, privasi dan uji

Lacak `400`/`422` dan `OperationOutcome.issue[]` ketika code system, linkId atau referensi salah. `401`/`403` memerlukan pemeriksaan scope dan organisasi. Untuk timeout atau respons sementara, cari data yang sudah masuk menurut ID, Encounter, tipe formulir dan waktu, lalu lakukan retry terbatas bila layak. [Validasi dan error](../validasi/respons-dan-error.md)

Uji satu kunjungan UKS dan satu Posyandu, termasuk perbedaan nakes/kader, lokasi, hasil tes kanan/kiri, TTD, Q0012, dan tindak lanjut. Lulus jika hasil serta survei merujuk Patient dan Encounter yang benar, lalu kasus referensi salah dan retry bisa direkonsiliasi tanpa menduplikasi output. Catat hasil dengan fixture dan batasi log atas identitas, sekolah, data disabilitas, jawaban perilaku, penggunaan zat dan data kesehatan jiwa. Bukti Sandbox Metta untuk PKPR belum ada. [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
