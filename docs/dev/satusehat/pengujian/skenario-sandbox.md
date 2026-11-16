# Skenario penerimaan SATUSEHAT Sandbox

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Endpoint Information](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) (disunting 2024-11-08)

[Indeks SATUSEHAT](../README.md) · [Pengujian dan backlog](README.md) · [Prioritas implementasi](prioritas-implementasi.md) · [Endpoint dan pengiriman](../alur/rawat-jalan.md) · [Backlog kunjungan pertama](backlog-rawat-jalan-tanpa-resep.md)

Catat jalur uji kontrak HTTP, simulasi lokal, atau transaksi Operations Metta pada setiap bukti. Uji kontrak membuktikan request dan respons untuk fixture tertentu. Uji dari Metta membuktikan sumber data, pemicu, urutan, rekonsiliasi, dan ID balikan yang dipakai aplikasi. [Endpoint Sandbox resmi](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) · [Playbook Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/)

[Status bukti](#status-bukti) · [Persiapan dan kriteria umum](#persiapan-dan-kriteria-umum) · [SB-00 Identitas dan koneksi](#sb-00-identitas-dan-koneksi) · [SB-01 Rawat jalan tanpa resep](#sb-01-rawat-jalan-tanpa-resep) · [SB-02 Temuan klinis kondisional](#sb-02-temuan-klinis-kondisional) · [SB-03 Rujuk internal, batal, dan koreksi](#sb-03-rujuk-internal-batal-dan-koreksi) · [SB-04 Resep nonracikan sampai diserahkan](#sb-04-resep-nonracikan-sampai-diserahkan) · [SB-05 Racikan, batch, dan retur](#sb-05-racikan-batch-dan-retur) · [SB-06 Gagal kirim dan pengulangan](#sb-06-gagal-kirim-dan-pengulangan) · [SB-07 Rujukan eksternal dan data klinis tambahan](#sb-07-rujukan-eksternal-dan-data-klinis-tambahan) · [SB-08 Lab dan radiologi](#sb-08-lab-dan-radiologi) · [SB-09 Pemberian obat, diet, dan alat kesehatan](#sb-09-pemberian-obat-diet-dan-alat-kesehatan) · [SB-10 Akses SSRME](#sb-10-akses-ssrme) · [Catatan hasil](#catatan-hasil)

## Status bukti

Status per 16 November 2026 mengikuti bukti yang tercatat di backlog.

| Skenario | Bukti yang ada | Yang masih perlu diuji |
| --- | --- | --- |
| SB-00 untuk fixture demo | OAuth berhasil. Organization aktif, satu Location dibuat dan dibaca balik, Patient dummy cocok dengan filter gabungan, dan Practitioner dummy dibaca langsung per IHS. Keempat referensi sudah dipetakan ke fixture lokal. | Uji konfigurasi backend dan lookup otomatis Practitioner lewat NIK sebelum dipakai pada alur otomatis. |
| SB-01 untuk Encounter awal | POST manual sintetis HTTP 201 dan GET HTTP 200 mengonfirmasi `arrived`, `AMB`, identifier, serta empat referensi fixture. | Jalankan dari NoReg dan transaksi Metta. Kirim hasil klinis yang berlaku, PUT Encounter yang sama ke `finished`, dan kirim Composition. |
| SB-02 sampai SB-09 | Skenario dan kriteria lulus tersedia. | Jalankan skenario yang berlaku untuk cakupan fasyankes. Catat status per resource. |
| SB-10 | Rute v2, request, dan bentuk respons ditelusuri dari Juknis serta Postman. | Uji CHLink, verifikasi persetujuan, SHLink, pembatasan akses, dan alur darurat sesuai lingkungan. |

[Bukti SB-00](backlog-rawat-jalan-tanpa-resep.md#pemetaan-fixture-sebelum-uji-encounter) · [Bukti Encounter awal](backlog-rawat-jalan-tanpa-resep.md#bukti-uji-encounter-awal-di-sandbox)

## Persiapan dan kriteria umum

1. Siapkan kredensial Sandbox dan ambil token dari backend atau environment Postman khusus Sandbox. Siapkan fixture sintetis Metta serta identitas uji yang valid dan diizinkan di Sandbox. Isi contoh payload dengan ID uji dari environment tersebut.
2. Catat versi Operations, versi pengirim, referensi Playbook, dan fixture. Untuk tiap skenario, catat resource serta kondisi yang berlaku dan field wajib dari matriks. Jika ada persyaratan yang belum terverifikasi atau setup belum tersedia, catat sebagai **belum diuji** atau **tertahan** beserta alasannya.
3. Untuk setiap pengiriman yang diharapkan berhasil, periksa status HTTP dan hasil per resource atau per entry jika memakai Bundle. Simpan ID balikan sesuai endpoint dan lakukan baca balik bila tersedia. Cocokkan identitas, kode, nilai, satuan, timestamp UTC, dan referensi dengan sumber Metta.
4. Catat hasil negatif di lokasi yang tepat. Gunakan pengujian lokal dengan respons tiruan untuk timeout, kegagalan jaringan, rate limit, atau skenario yang sulit dipicu secara sengaja di Sandbox. Bukti uji lokal dicatat bersama hasil Sandbox dengan asal pengujiannya.

## SB-00 Identitas dan koneksi

**Siapkan:** satu tenant dan legal entity uji, satu poli, satu nakes, dan satu pasien uji. Ulangi dengan konteks tenant atau fasyankes kedua jika akses Sandbox mendukung.

**Langkah:** ambil token dari base URL Sandbox. Verifikasi `Organization/{id}` dan `Location/{id}`, resolve Patient dan Practitioner IHS, lalu cocokkan semua referensi dengan fixture. Coba satu hasil lookup pasien kosong atau ambigu memakai fixture atau respons tiruan.

**Lulus jika:** referensi benar dan disimpan dalam lingkup yang tepat. Organisasi/lokasi yang tidak cocok dan identitas yang belum pasti menahan pekerjaan terkait, dengan alasan yang bisa ditindaklanjuti. Token serta payload sensitif tidak muncul di log. [Matriks identitas](../payload/matriks-identitas.md)

## SB-01 Rawat jalan tanpa resep

**Siapkan:** satu kunjungan sintetis, kode diagnosis yang telah dipetakan, hasil tanda vital yang diukur, dan status pulang yang sesuai.

1. Daftarkan kunjungan di Metta dan ambil NoReg. Verifikasi `POST /Encounter` memakai kelas rawat jalan, waktu, dan referensi yang sesuai tahap. Catat ID balikan.
2. Lakukan pemeriksaan, simpan keluhan, diagnosis, dan tanda vital. Kirim Condition dan Observation yang berlaku. Cocokkan kode, nilai, satuan, waktu, pemeriksa, dan kaitan keduanya ke Encounter.
3. Selesaikan layanan. Verifikasi `PUT /Encounter/{id}` menggunakan ID semula dan membawa waktu akhir, status, serta referensi klinis yang berlaku.
4. Kirim Composition resume. Periksa tipe, penulis, subjek, Encounter, section, dan ID resource yang dirujuk.

**Lulus jika:** ada satu Encounter untuk NoReg itu, finalisasi memperbarui ID yang sama, dan Composition serta semua referensi yang diwajibkan skenario diterima. Catat bahwa tidak ada kejadian resep pada fixture. [Matriks rawat jalan](../payload/matriks-rawat-jalan.md) · [Contoh payload](../payload/contoh-rawat-jalan-dan-farmasi.md)

## SB-02 Temuan klinis kondisional

**Siapkan:** varian SB-01 dengan alergi yang dicatat, satu tindakan klinis berkode, dan paling sedikit satu hasil berkode bila skenario yang dipakai membutuhkannya.

**Langkah:** kirim AllergyIntolerance, Procedure, dan Observation yang berlaku. Ulangi pada fixture terpisah untuk status alergi tidak diketahui atau pernyataan tidak ada alergi yang dibuat secara eksplisit sesuai Playbook. Periksa tanggapan saat kode wajib untuk suatu temuan belum dipetakan.

**Lulus jika:** jenis temuan, pelaku, kode dan referensi sesuai fakta. Data yang tidak lengkap terlihat sebagai pekerjaan tertahan dengan sumber field yang jelas. Ketiadaan baris alergi tidak menghasilkan pernyataan negatif dari sistem. Barang atau jasa yang hanya masuk tagihan tidak ikut menjadi Procedure. [Matriks pemeriksaan dan tindakan](../payload/matriks-rawat-jalan.md#allergyintolerance)

## SB-03 Rujuk internal, batal, dan koreksi

**Siapkan:** satu NoReg dengan dua tujuan poli serta kunjungan terpisah yang bisa dibatalkan atau dikoreksi sesuai aturan Metta.

**Langkah:** mulai di poli asal, rujuk internal, dan selesaikan di poli tujuan. Periksa perubahan status dan histori lokasi pada Encounter yang sama. Pada fixture terpisah, coba pembatalan sebelum diperiksa. Uji koreksi data klinis atau resume setelah payload awal diterima, menggunakan metode yang telah dikonfirmasi untuk resource terkait.

**Lulus jika:** rujukan internal tetap punya satu ID Encounter, lokasi dan waktu tiap poli bisa ditelusuri, serta status akhir cocok dengan transaksi Metta. Batal dan koreksi mengikuti metode yang didukung SATUSEHAT dan tidak menduplikasi resource awal. Jika metode koreksi belum dikonfirmasi, catat skenario tersebut sebagai tertahan. [Matriks Encounter](../payload/matriks-rawat-jalan.md#encounter) · [Aturan update dan resume Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_28_pembaharuan_data_kunjungan)

## SB-04 Resep nonracikan sampai diserahkan

**Siapkan:** satu kunjungan, satu resep nonracikan, KFA resep, KFA aktual `93xxxxxx`, satuan, stok, petugas, dan lokasi Farmasi yang sudah terpetakan. Siapkan jawaban Q0007 berbasis pengkajian sintetis.

1. Kirim resep dari poli. Periksa ID MedicationRequest per baris, Medication di `contained`, dosis, rute, satuan, dan keputusan substitusi yang dicatat.
2. Catat pengkajian. Buktikan QuestionnaireResponse Q0007 memakai tipe jawaban dan `linkId` yang sesuai serta merujuk ID resep yang benar.
3. Siapkan obat dan verifikasi status lokal. Setelah obat diserahkan, kirim MedicationDispense. Periksa KFA aktual, jumlah, batch bila berlaku, waktu siap dan serah, pelaku, penerima, serta `authorizingPrescription`.
4. Validasi section obat pada resume. Jika serah terjadi setelah poli selesai, uji aturan finalisasi atau koreksi resume yang dipilih.

**Lulus jika:** tiap resource yang berlaku diterima dan merujuk Encounter, resep, serta obat aktual yang tepat. Persiapan yang belum menjadi penyerahan tidak dilaporkan sebagai `completed` untuk dispense. [Matriks Farmasi](../payload/matriks-farmasi.md)

## SB-05 Racikan, batch, dan retur

**Siapkan:** fixture racikan d.t.d. atau dibagi rata sesuai cakupan, serta varian pengeluaran menggunakan lebih dari satu batch bila dilayani. Siapkan satu penyerahan uji yang dapat diretur sesuai aturan lokal.

**Langkah:** uji pemetaan MedicationType `SD` dan `EP` untuk jenis yang dilayani. Cocokkan bentuk sediaan, jumlah tiap komponen, rasio, satuan, dan total yang diminta atau diserahkan. Untuk beberapa batch, rekonsiliasi jumlah payload dengan stok yang benar-benar keluar. Uji retur atau pembatalan setelah pengiriman dalam skenario terpisah.

**Lulus jika:** komposisi dan jumlah cocok dari resep sampai pengeluaran. Riwayat transaksi serta ID yang telah diterima tetap dapat ditelusuri. Untuk retur, bukti mencakup metode koreksi yang telah dikonfirmasi dan hasilnya. [Matriks Medication dan MedicationDispense](../payload/matriks-farmasi.md)

## SB-06 Gagal kirim dan pengulangan

| Kasus | Langkah uji | Kriteria lulus |
| --- | --- | --- |
| Mapping wajib belum lengkap | Hilangkan satu mapping IHS, lokasi, atau terminologi yang diperlukan dari fixture | Pengiriman tertahan di field yang tepat. Setelah diperbaiki, pekerjaan yang sama dapat dilanjutkan. |
| Token habis atau ditolak | Uji alur penggantian token sesuai kode respons. Gunakan respons tiruan untuk memaksa cabang tertentu | Token diperbarui sesuai aturan. Kredensial salah tampil sebagai konfigurasi bermasalah. |
| Payload ditolak | Uji satu field atau referensi tidak valid dengan data uji | Waktu, resource, status, dan penyebab terpantau. Retry berjalan setelah koreksi dan alasan diagnostik sensitif tersaring dari log. |
| Timeout sesudah POST | Simulasikan respons putus setelah server tiruan menyimpan resource. Bila kemampuan pencarian tersedia, buktikan pencarian identifier di Sandbox secara terpisah | Pengirim merekonsiliasi hasil sebelum POST ulang. Status tetap belum pasti jika hasil ambigu, dan tidak ada resource ganda. |
| `429`, `5xx`, dan dependensi terlambat | Simulasikan respons uji yang terkontrol dan proses pekerjaan dalam urutan berbeda | Retry mengikuti penundaan. Pengiriman turunan menunggu referensi dan versi lama tidak menimpa koreksi yang lebih baru. |
| Pengulangan dan isolasi | Putar ulang transaksi yang sama. Gunakan organisasi lain bila dapat diuji | Kunci dan ID tetap konsisten dalam lingkup asal. Referensi tidak tertukar antar tenant, organisasi, atau environment. |

[Aturan respons dan rekonsiliasi](../operasional/pengiriman-fhir.md#mekanisme-pengiriman-yang-diusulkan)

## SB-07 Rujukan eksternal dan data klinis tambahan

**Siapkan:** fixture dengan rencana kontrol atau rujukan eksternal yang tercatat, beserta satu varian untuk tiap riwayat, risiko, prognosis, tujuan, atau rencana rawat yang masuk cakupan.

**Langkah:** kirim ServiceRequest yang berlaku, lalu ikuti referensi Encounter dan Composition. Pada setiap varian tambahan, kirim hanya resource yang punya fakta sumber sesuai cakupan. Uji referensi ke Goal, Condition, penilaian risiko, atau hasil yang dipakai masing-masing.

**Lulus jika:** tujuan, jenis rujukan atau rencana, dan referensi mengikuti data sumber. Setiap resource tambahan punya bukti sendiri. Teks bebas yang belum dipetakan dicatat sebagai gap field atau skenario. [Matriks rujukan](../payload/matriks-rawat-jalan.md#servicerequest) · [Matriks anamnesis dan rencana perawatan](../payload/matriks-layanan-kondisional.md#anamnesis-dan-rencana-perawatan)

## SB-08 Lab dan radiologi

**Siapkan:** fixture order dan laporan dari sumber yang akan dipakai fasyankes. Untuk DICOM, siapkan UID dan akses test PACS/NIDR sesuai alur yang berlaku.

**Langkah:** uji lab dari ServiceRequest ke Specimen, Observation, dan DiagnosticReport. Tambahkan Substance bila skenario memerlukan bahan tambahan. Uji radiologi dari ServiceRequest ke bacaan dan DiagnosticReport, serta ImagingStudy bila memakai alur DICOM. Catat ID yang berasal dari sistem lain.

**Lulus jika:** laporan merujuk order dan hasil yang benar, waktu serta satuan cocok, dan data citra merujuk studi yang tepat bila berlaku. Pemilik pengiriman dan penyimpanan ID jelas. [Matriks lab dan radiologi](../payload/matriks-layanan-kondisional.md#lab-dan-radiologi)

## SB-09 Pemberian obat, diet, dan alat kesehatan

**Siapkan:** fixture per jenis layanan yang benar-benar masuk cakupan, dengan peran dan sumber fakta yang ditetapkan.

**Langkah:** uji MedicationAdministration dari kejadian pemberian obat. Uji NutritionOrder dari order diet. Untuk alat kesehatan, pastikan endpoint dan versi profil di Sandbox sebelum menguji rantai permintaan, penyerahan, atau pemakaian yang dipilih.

**Lulus jika:** resource yang berlaku diterima dengan subjek, referensi permintaan, pelaku, dan waktu yang benar menurut profil. Skenario tanpa sumber kejadian atau endpoint terverifikasi tetap tercatat sebagai tertahan. [Matriks pemberian obat, diet, dan alat kesehatan](../payload/matriks-layanan-kondisional.md#pemberian-obat-diet-dan-alat-kesehatan)

## SB-10 Akses SSRME

**Siapkan:** fasyankes, pasien, dan nakes uji yang memenuhi prasyarat SSRME untuk environment yang dipakai. Pastikan data layanan uji yang diharapkan sudah tersedia.

**Langkah:** uji petugas berwenang meminta CHLink, proses consent pasien, dan pembukaan SHLink dari kunjungan yang benar. Uji consent tidak tersedia atau kedaluwarsa, petugas tanpa akses, dan akses darurat bila environment mendukung. Catat alur izin dan akses, tanpa menyertakan tautannya dalam hasil uji.

**Lulus jika:** tautan sesuai pasien dan petugas, masa berlaku dipatuhi, penolakan ditangani sesuai sebab, dan akses darurat hanya berjalan dengan kewenangan dan catatan yang diperlukan. Pisahkan bukti akses SSRME dari penerimaan payload FHIR. [Desain dan matriks SSRME](../alur/ssrme.md)

## Catatan hasil

Catat satu entri per skenario dan percobaan penting. Bukti disamarkan sebelum dibagikan atau ditaruh di repo publik.

| Kolom | Isi |
| --- | --- |
| Skenario dan jalur | Kode SB, varian fixture, dan uji Postman, pengirim Metta, atau simulasi lokal. |
| Tanggal dan versi | Waktu uji, versi Operations, pengirim, dan Playbook atau profil. |
| Scope | Alias tenant/fasyankes dan environment uji. Gunakan alias fixture untuk pasien dan nakes. |
| Payload dan hasil | Resource, metode, status HTTP, kategori kesalahan, dan korelasi yang aman. Buang NIK, isi klinis, token, dan tautan sensitif. |
| Bukti baca balik | ID balikan yang disamarkan, kesesuaian referensi, dan hasil pencocokan dengan fakta sumber. |
| Keputusan | Lulus, gagal, tertahan, atau belum diuji, disertai field penyebab dan tindak lanjut bila ada. |
