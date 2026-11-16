# Prioritas implementasi SATUSEHAT per resource

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04)

[Indeks SATUSEHAT](../README.md) · [Pengujian dan backlog](README.md) · [Backlog kunjungan pertama](backlog-rawat-jalan-tanpa-resep.md) · [Skenario dan bukti Sandbox](skenario-sandbox.md)

Urutan ini menempatkan **satu kunjungan rawat jalan tanpa resep sampai resume diterima** sebagai target pertama. Pakai data yang sudah dicatat di Metta dan tutup gap yang menghalangi payload untuk skenario itu. Setelah jalur tersebut terbukti, tambahkan resep, pengkajian, dan penyerahan. Layanan kondisional masuk sesuai cakupan fasyankes. Bila skenario rilis pertama sudah mencakup layanan tersebut, jadwalkan resource terkait bersama skenario rilisnya.

Prioritas ini usulan pengerjaan. Status field wajib dan kondisional mengikuti [Playbook Rawat Jalan Kemenkes v7.0](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) dan [matriks field](../payload/aturan-field-fhir.md#cara-membaca-matriks).

[1. Identitas dan koneksi](#1-identitas-dan-koneksi) · [2. Kunjungan dan resume tanpa resep](#2-kunjungan-dan-resume-tanpa-resep) · [3. Resep, pengkajian, dan penyerahan](#3-resep-pengkajian-dan-penyerahan) · [4. Variasi rawat jalan dan layanan kondisional](#4-variasi-rawat-jalan-dan-layanan-kondisional) · [5. Akses riwayat nasional](#5-akses-riwayat-nasional)

## 1. Identitas dan koneksi

Mulai dari transaksi per NoReg, event yang tersedia, dan lokasi pencatatan ID balikan di Operations. Siapkan konfigurasi dan bukti per fasyankes serta environment. [Mekanisme pengiriman](../operasional/pengiriman-fhir.md#mekanisme-pengiriman-yang-diusulkan) · [SB-00](skenario-sandbox.md#sb-00-identitas-dan-koneksi)

| Urutan | Resource atau kemampuan | Yang sudah ada | Gap yang ditutup dan bukti selesai |
| --- | --- | --- | --- |
| 1.1 | OAuth dan konfigurasi pengirim | Kunjungan sudah memiliki konteks legal entity. | Pilih kredensial Sandbox per fasyankes dan dokumentasikan mesin kirim. Buktikan token bisa dipakai untuk membaca resource yang benar. |
| 1.2 | [Organization](../payload/matriks-identitas.md#organization) | Legal entity, kode, dan hierarki organisasi lokal. | Verifikasi ID nasional induk. Petakan suborganisasi bila dipakai, tanpa mencampur data tenant atau environment. |
| 1.3 | [Location](../payload/matriks-identitas.md#location) | Section, ruangan, dan lokasi serah obat. | Verifikasi ID SATUSEHAT poli pertama dan relasinya ke fasyankes. Tambahkan pemetaan lokasi farmasi pada tahap resep. |
| 1.4 | [Patient](../payload/matriks-identitas.md#patient) | NIK, NRM, dan demografi party. | Resolve dan simpan Patient IHS. Tangani hasil kosong atau ambigu. Uji alur registrasi MPI tersendiri jika diperlukan untuk cakupan awal. |
| 1.5 | [Practitioner](../payload/matriks-identitas.md#practitioner) | Master nakes dan tautan pelaku pada pemeriksaan. | Resolve Practitioner IHS untuk nakes yang benar-benar melayani atau mengukur. Buktikan akun lokal yang tidak tertaut tidak menghasilkan referensi buatan. |
| 1.6 | Catatan hasil, urutan, dan retry | Ada fakta klinis dan event internal pada sebagian alur. | Tentukan lokasi penyimpanan ID FHIR, status kirim per versi fakta, serta penanganan hasil POST yang tidak pasti. Buktikan pengulangan tidak membuat kunjungan ganda. [SB-06](skenario-sandbox.md#sb-06-gagal-kirim-dan-pengulangan) |

## 2. Kunjungan dan resume tanpa resep

Ambil satu pasien uji, satu poli, satu nakes, dan satu kunjungan sintetis dengan keluhan, pemeriksaan, serta diagnosis yang tercatat. Pakai kode yang sudah dipetakan untuk fixture tersebut. Bila sebuah field wajib untuk skenario ini belum tersedia, tandai penyebabnya di matriks lalu selesaikan sebelum mengirim skenario penerimaan. [SB-01](skenario-sandbox.md#sb-01-rawat-jalan-tanpa-resep) · [SB-02](skenario-sandbox.md#sb-02-temuan-klinis-kondisional) · [SB-03](skenario-sandbox.md#sb-03-rujuk-internal-batal-dan-koreksi)

| Urutan | Resource | Data Metta yang dipakai lebih dulu | Gap yang ditutup dan bukti selesai |
| --- | --- | --- | --- |
| 2.1 | [Encounter awal](../payload/matriks-rawat-jalan.md#encounter) | NoReg, waktu registrasi, status, poli, pasien, dan nakes terjadwal atau pelaku sesuai tahap. | Tetapkan pemicu kirim, pemetaan identifier, status, lokasi, organisasi, peserta, serta minimum payload awal. Simpan ID balikan `POST /Encounter`. |
| 2.2 | [Condition](../payload/matriks-rawat-jalan.md#condition) | Keluhan, diagnosis ICD-10, serta keadaan pulang yang tercatat. | Selesaikan coding yang berlaku, termasuk padanan SNOMED CT untuk diagnosis dan kode kondisi pulang. Simpan ID tiap Condition dan perannya pada Encounter. |
| 2.3 | [Observation](../payload/matriks-rawat-jalan.md#observation) | Tanda vital, waktu ukur, pemeriksa, serta anotasi LOINC dan UCUM pada migration. | Terapkan pemetaan kode, satuan, nilai, waktu, dan pelaku. Buktikan hasil numerik dan hasil berkode yang berlaku dapat dibaca kembali. |
| 2.4 | [AllergyIntolerance](../payload/matriks-rawat-jalan.md#allergyintolerance) | Kategori, alergen, reaksi, status, dan pencatat. | Lengkapi kode alergen serta aturan alergi tercatat, tidak ada, atau tidak diketahui. Uji kasus dengan alergi agar pencatat dan referensi kunjungan ikut benar. |
| 2.5 | [Procedure](../payload/matriks-rawat-jalan.md#procedure) | Baris tindakan, kode ICD-9-CM jika diisi, dan penanggung jawab. | Pastikan ada fakta tindakan klinis dan data pelaksanaan yang dipersyaratkan. Uji tindakan berkode secara terpisah dari baris jasa Kasir. |
| 2.6 | [Encounter akhir](../payload/matriks-rawat-jalan.md#encounter) | Waktu poli dan kunjungan selesai, diagnosis, serta status pulang. | Lengkapi `PUT /Encounter/{id}` dengan referensi klinis yang diterima, waktu akhir, riwayat, dan cara pulang. Buktikan ID tetap sama dengan hasil 2.1. |
| 2.7 | [Composition](../payload/matriks-rawat-jalan.md#composition) | CPPT, pemeriksaan, dan data rujukan dalam satu NoReg. | Bentuk resume dengan tipe yang tepat, penulis, waktu finalisasi, dan section yang merujuk ID SATUSEHAT. Buktikan resume diterima dan referensinya dapat ditelusuri. |

Target selesai tahap ini adalah bukti **SB-00 dan SB-01**, ditambah variasi **SB-02 dan SB-03** yang dipakai fasyankes. Hasil lulus hanya berlaku untuk skenario yang tercatat.

## 3. Resep, pengkajian, dan penyerahan

Ambil resep nonracikan lebih dulu dan lanjutkan ke racikan jika dilayani. Gunakan kunjungan yang sudah tersambung ke Encounter. Tetapkan apakah resume disusun setelah pengeluaran obat atau memerlukan koreksi saat data farmasi datang belakangan. Dasarkan keputusan ini pada profil SATUSEHAT, aturan klinik, dan uji skenario pengiriman yang bersangkutan. [SB-04](skenario-sandbox.md#sb-04-resep-nonracikan-sampai-diserahkan) · [SB-05](skenario-sandbox.md#sb-05-racikan-batch-dan-retur)

| Urutan | Resource | Data Metta yang dipakai lebih dulu | Gap yang ditutup dan bukti selesai |
| --- | --- | --- | --- |
| 3.1 | [Medication](../payload/matriks-farmasi.md#medication) | Master barang, kolom KFA, jenis racikan, bentuk sediaan, satuan, dan data batch aktual. | Lengkapi katalog fixture, pastikan KFA produk aktual `93xxxxxx` pada pengeluaran nonracikan, dan validasi pemetaan komponen serta takaran racikan. |
| 3.2 | [MedicationRequest](../payload/matriks-farmasi.md#medicationrequest) | Resep yang dikirim dokter, nomor dan baris, dosis, rute, lama pemberian, dan diagnosis bila dirujuk. | Tetapkan identifier stabil, kode satuan, serta keputusan substitusi yang sah sesuai profil. Simpan ID balikan per baris resep untuk referensi berikutnya. |
| 3.3 | [QuestionnaireResponse](../payload/matriks-farmasi.md#questionnaireresponse) | Pasien, kunjungan, dan resep sudah ada. | Catat jawaban, waktu, pelaku, serta referensi resep Q0007 yang dikaji. Buktikan jawaban sesuai tipe dan `linkId` dan berasal dari pengkajian yang dilakukan. |
| 3.4 | [MedicationDispense](../payload/matriks-farmasi.md#medicationdispense) | Fakta Serahkan, waktu siap dan serah, jumlah aktual, batch, petugas, dan penerima. | Petakan obat aktual dan IHS pelaku. Tunggu ID MedicationRequest. Uji satuan, beberapa batch bila dipakai, penyerahan ulang, dan keputusan SATUSEHAT untuk koreksi/retur. |
| 3.5 | [Composition dengan obat](../payload/matriks-rawat-jalan.md#composition) | Resume dari tahap 2 dan resource resep yang sudah diterima. | Tambahkan referensi obat yang berlaku pada section yang benar. Uji penanganan resume ketika pengeluaran obat baru tercatat setelah poli selesai. |

## 4. Variasi rawat jalan dan layanan kondisional

Tutup kebutuhan rujukan yang berlaku dahulu, lalu pilih kelompok lanjutan berdasarkan layanan nyata dan siapa yang memegang data sumber. Jika data berasal dari LIS, PACS, atau sistem lain, pastikan tim tahu pihak yang mengirim dan pihak yang menyimpan ID balikan sebelum membangun pengiriman kedua. Urutan dalam kelompok mengikuti dependensi referensinya. [Matriks layanan kondisional](../payload/matriks-layanan-kondisional.md)

| Kelompok | Urutan resource | Gap yang ditutup | Skenario |
| --- | --- | --- | --- |
| 4.1 Rujukan dan tindak lanjut | [ServiceRequest](../payload/matriks-rawat-jalan.md#servicerequest) → [Encounter akhir](../payload/matriks-rawat-jalan.md#encounter) → [Composition](../payload/matriks-rawat-jalan.md#composition) jika ditautkan | Tetapkan tujuan dan referensi nasional, intent, jenis rencana tindak lanjut, instruksi atau transportasi yang dicatat. | [SB-03](skenario-sandbox.md#sb-03-rujuk-internal-batal-dan-koreksi), [SB-07](skenario-sandbox.md#sb-07-rujukan-eksternal-dan-data-klinis-tambahan) |
| 4.2 Anamnesis lanjutan | [FamilyMemberHistory](../payload/matriks-layanan-kondisional.md#familymemberhistory) dan [MedicationStatement](../payload/matriks-layanan-kondisional.md#medicationstatement) | Pecah riwayat keluarga dan riwayat obat jadi fakta terstruktur. Gunakan teks lokal sebagai konteks. | [SB-07](skenario-sandbox.md#sb-07-rujukan-eksternal-dan-data-klinis-tambahan) |
| 4.3 Penilaian dan rencana | [RiskAssessment](../payload/matriks-layanan-kondisional.md#riskassessment) dan [ClinicalImpression](../payload/matriks-layanan-kondisional.md#clinicalimpression) sesuai referensi yang dipakai. [Goal](../payload/matriks-layanan-kondisional.md#goal) dibuat sebelum [CarePlan](../payload/matriks-layanan-kondisional.md#careplan) yang merujuknya | Petakan risiko dan prognosis, tentukan ukuran tujuan, kategori rencana, identitas penulis, serta status aktivitas. | [SB-07](skenario-sandbox.md#sb-07-rujukan-eksternal-dan-data-klinis-tambahan) |
| 4.4 Laboratorium | [ServiceRequest → Substance bila dipakai → Specimen → Observation → DiagnosticReport](../payload/matriks-layanan-kondisional.md#lab-dan-radiologi) | Identifikasi pemilik order dan hasil, catat pengambilan serta pemrosesan spesimen, dan cocokkan kode serta unit hasil. | [SB-08](skenario-sandbox.md#sb-08-lab-dan-radiologi) |
| 4.5 Radiologi | [ServiceRequest → ImagingStudy saat DICOM berlaku → Observation → DiagnosticReport](../payload/matriks-layanan-kondisional.md#lab-dan-radiologi) | Tetapkan asal accession number dan UID, alur PACS/NIDR, serta laporan dan kesimpulan yang sudah disahkan. | [SB-08](skenario-sandbox.md#sb-08-lab-dan-radiologi) |
| 4.6 Pemberian obat dan diet | [MedicationAdministration dan NutritionOrder](../payload/matriks-layanan-kondisional.md#pemberian-obat-diet-dan-alat-kesehatan) | Sediakan fakta pemberian obat aktual dan order diet yang sah. Gunakan resource hanya untuk skenario yang terjadi. | [SB-09](skenario-sandbox.md#sb-09-pemberian-obat-diet-dan-alat-kesehatan) |
| 4.7 Alat kesehatan | [Device → DeviceRequest → DeviceDispense atau DeviceUseStatement. SupplyRequest → SupplyDelivery untuk alur suplai yang berlaku](../payload/matriks-layanan-kondisional.md#pemberian-obat-diet-dan-alat-kesehatan) | Konfirmasi endpoint dan versi profil, identitas perangkat, permintaan dan pemakaian, serta relasi ke pasien bila berlaku. | [SB-09](skenario-sandbox.md#sb-09-pemberian-obat-diet-dan-alat-kesehatan) |

## 5. Akses riwayat nasional

Implementasi SSRME bisa disiapkan setelah identitas dan kredensial tersedia. Jadwalkan pembuktian akses setelah prasyarat fasyankes terpenuhi dan data uji tersedia di SATUSEHAT. Uji OAuth, CHLink, pemberian consent, SHLink, serta keadaan ditolak, kedaluwarsa, dan darurat sesuai kemampuan environment. [Desain SSRME](../alur/ssrme.md) · [SB-10](skenario-sandbox.md#sb-10-akses-ssrme)
