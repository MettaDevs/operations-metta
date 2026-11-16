# Rujukan pasien

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Rujukan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan/) (v6.1, rilis 2026-08-21, disunting 2026-08-24)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Kontrak HTTP rujukan pasien](../endpoint/rujukan-pasien.md) · [Matriks resource dan data rujukan pasien](../payload/rujukan-pasien.md)

Rujukan SATUSEHAT mempertemukan fasyankes perujuk, calon penerima dan fasyankes tujuan. Rujukan rawat jalan menggunakan mesin rekomendasi kandidat dan Bundle permintaan. Rujukan rawat inap/darurat menambah ketersediaan tempat tidur dan keputusan tugas. Rujuk balik menghubungkan layanan lanjutan dan, bila dibutuhkan, resep. Panduan ini mengikuti Juknis Rujukan v6.1 tanggal 21 Agustus 2026, bab 1–3. [Halaman Rujukan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan/) · [Juknis Rujukan v6.1](https://drive.google.com/file/d/1sdL3l_b3jKxynX-KxNgOzQk0riC_nh3F/preview)

[Prasyarat dan pemilik data](#prasyarat-dan-pemilik-data) · [Rawat jalan](#rawat-jalan) · [Rawat inap dan rawat darurat](#rawat-inap-dan-rawat-darurat) · [Rujuk balik](#rujuk-balik) · [Uji Sandbox](#uji-sandbox)

## Prasyarat dan pemilik data

- Fasyankes perujuk dan tujuan mempunyai ID Organization di lingkungan yang sama. Untuk skenario pencarian, siapkan struktur organisasi layanan, Location, dan data layanan atau kapasitas sebagaimana panduan. Pastikan akses lintas organisasi diberikan untuk kedua peran.
- Siapkan IHS Patient, petugas, Encounter asal jika berlaku, dan diagnosis Condition dengan kode ICD-10. Perujuk menetapkan urgensi, alasan klinis, kebutuhan layanan dan dokumen pendukung. Penerima menetapkan keputusan serta Encounter pada fasyankesnya sendiri.
- Metta mencatat konteks kunjungan, diagnosis, status pasien/rujuk internal dan CPPT. Tetapkan kontrak penyimpanan untuk organisasi tujuan, nomor rujukan nasional, hasil kandidat, rencana, Task, keputusan penerima dan korelasi Encounter. Uji integrasi dua organisasi masih terbuka. [Healthcare Metta](../../../../modules/healthcare/README.md#status-pasien-rujuk-internal-dan-cppt) · [Matriks rawat jalan](../payload/matriks-rawat-jalan.md#servicerequest)

## Rawat jalan

| Tahap | Pelaku dan pertukaran | Data yang disimpan |
| --- | --- | --- |
| 1. Pra-permintaan | Perujuk membuat Task `referral-pre-request` dengan `status=requested`, `intent=instance-order`, `priority=routine`, ref Organization perujuk dan diagnosis primer. SATUSEHAT memberi Task respons kriteria yang menunjuk permintaan melalui `basedOn[]`. | ID Task pra-permintaan, ID Task respons dan kriteria klinis. Pertahankan bahwa keduanya merepresentasikan tahap yang berbeda. |
| 2. Permintaan kandidat | Kirim Task `request-referral-candidate` dengan Patient, Organization, diagnosis dan kriteria yang diminta; kaitkan dengan Task tahap sebelumnya sesuai Juknis. Baca Task rekomendasi yang menunjuk Task pencarian dan memuat kandidat pada `output[]` bertipe `candidate-referral-facility`. | ID Task pencarian, rekomendasi, organisasi kandidat dan pilihan petugas. Respon kriteria serta rekomendasi juga memakai kode `request-referral-candidate` dalam profil. Bedakan berdasarkan relasi, peran dan tahap, dengan tetap menyimpan kode asli. |
| 3. Pengiriman permintaan | Kirim Bundle `transaction` yang membawa ServiceRequest dan CarePlan. `meta.tag` memakai system `http://terminology.kemkes.go.id`, code `referral-request`. Kaitkan `ServiceRequest.basedOn[]` ke rencana. | ID ServiceRequest dan CarePlan, hasil setiap entry Bundle, nomor nasional pada identifier `http://sys-ids.kemkes.go.id/referral-number-satusehat`. |
| 4. Kedatangan pasien | Tujuan membaca ServiceRequest menggunakan nomor nasional dan data pendukung yang diperlukan. Tujuan membuat Encounter dengan `basedOn[]` yang menunjuk ServiceRequest tadi. | ID Encounter tujuan dan tautannya ke order nasional. Saat pencarian, cocokkan pasien, organisasi tujuan dan referensi order. |

Rujuk kondisi klinis dan kriteria yang benar-benar tercatat. Pada Task pracari, `Task.input[].type` bernilai `primary-diagnosis` dari system `http://terminology.kemkes.go.id` dan `valueCoding` memakai `http://hl7.org/fhir/sid/icd-10`. Task pertukaran kandidat dapat membawa diagnosis sekunder melalui kode `secondary-diagnosis`. Gunakan tipe input/output yang ditentukan untuk setiap tahap, terutama untuk data kandidat, kriteria dan kasus tanpa kandidat. [Juknis Rujukan v6.1, bab 1.1–1.3](https://drive.google.com/file/d/1sdL3l_b3jKxynX-KxNgOzQk0riC_nh3F/preview)

## Rawat inap dan rawat darurat

1. Jalankan pra-permintaan dan permintaan kandidat. Baca ketersediaan tempat tidur melalui `GET Task` pada hasil rekomendasi dan `Task.output[].extension` yang diidentifikasi Juknis sebagai `bed-availability`. Tampilkan waktu perolehan data dalam Metta.
2. Kirim Bundle `transaction` berisi Task pengajuan tugas, CarePlan, dan Task rekomendasi. Isi `Bundle.meta.tag` dengan system `http://terminology.kemkes.go.id` dan code `referral-approval`. Task pengajuan memakai `code=referral-approval-request`, `status=requested`, `intent=instance-order`, `priority=routine`, `for` Patient, `requester` Organization perujuk, `owner` Organization tujuan, `reasonReference` Condition, serta `input[]` dengan tipe `referral-task` dan `valueReference` Organization tujuan.
3. Penerima memberi keputusan melalui `PATCH Task/{id}`. Keputusan pada `output[]` memakai tipe `response-referral-task` dari system Kemenkes dan `valueCoding.system=http://hl7.org/fhir/task-status` dengan code `accepted` atau `rejected`. Simpan ID Task yang diperbarui, keputusan dan waktu. Bedakan keputusan sah dari error HTTP.
4. Setelah jalur pengiriman rujukan dapat dilanjutkan, perujuk membuat `ServiceRequest` langsung sesuai bab 2.4. Tujuan membuat Encounter yang menunjuk order pada `basedOn[]`. [Juknis Rujukan v6.1, bab 2.1–2.4](https://drive.google.com/file/d/1sdL3l_b3jKxynX-KxNgOzQk0riC_nh3F/preview)

## Rujuk balik

1. Perujuk membuat ServiceRequest untuk pasien yang memenuhi kriteria rujuk balik. Sertakan kategori SNOMED CT `3457005` dan kategori `SR000007` dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term`. Nomor balikan muncul pada `ServiceRequest.identifier[]`, system `http://sys-ids.kemkes.go.id/srb-number`.
2. Jika ada resep rujuk balik, perujuk mengirim MedicationRequest dan DocumentReference menurut modul kefarmasian. Isi `MedicationRequest.basedOn[]` dengan referensi ServiceRequest rujuk balik. Simpan nomor resep nasional sesuai kontrak farmasi.
3. Tujuan mencari data pendukung lewat ServiceRequest menggunakan nomor rujuk balik. Jika perlu, tujuan mengambil resep melalui DocumentReference atau MedicationRequest dengan nomor resep nasional. Encounter tujuan mengisi `basedOn[]` dengan ServiceRequest rujuk balik. Pengeluaran obat mengikuti alur kefarmasian. [Juknis Rujukan v6.1, bab 3](https://drive.google.com/file/d/1sdL3l_b3jKxynX-KxNgOzQk0riC_nh3F/preview) · [Matriks Farmasi Metta](../payload/matriks-farmasi.md)

## Uji Sandbox

| Uji | Kriteria lulus |
| --- | --- |
| Rujukan rawat jalan | Dua organisasi uji dapat melalui tahap kriteria, kandidat dan transaksi. Nomor nasional ditemukan pada ServiceRequest; tujuan membaca data yang berhak diakses dan membuat Encounter dengan `basedOn` yang benar. |
| Rujukan rawat inap/darurat | Bukti ketersediaan tempat tidur tertaut pada Task rekomendasi. Bundle persetujuan dapat dibaca, kedua cabang keputusan ditangani, dan order dibuat lewat ServiceRequest langsung pada jalur lanjut. |
| Rujuk balik | Nomor rujuk balik dapat dicari oleh tujuan. Untuk kasus dengan resep, nomor resep bisa dibaca dan MedicationRequest menunjuk ServiceRequest rujuk balik. |
| Validasi dan rekonsiliasi | Referensi lintas lingkungan, organisasi yang tidak berwenang, kandidat kosong, penolakan, dan timeout Bundle menghasilkan status internal yang tepat. Replay mengaitkan kembali resource yang sudah ada. |

Status uji rujukan nasional Metta masih terbuka. Pembuatan Encounter awal rawat jalan telah diuji melalui flow terpisah. [SB-07 Rujukan eksternal](../pengujian/skenario-sandbox.md#sb-07-rujukan-eksternal-dan-data-klinis-tambahan) · [Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
