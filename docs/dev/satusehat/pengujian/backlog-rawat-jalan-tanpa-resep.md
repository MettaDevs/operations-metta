# Backlog satu kunjungan rawat jalan tanpa resep

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Pengajuan dan Verifikasi Akses](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/registration/) (disunting 2024-09-09) · [Endpoint Information](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) (disunting 2024-11-08)

[Indeks SATUSEHAT](../README.md) · [Pengujian dan backlog](README.md) · [Prioritas per resource](prioritas-implementasi.md) · [Skenario Sandbox](skenario-sandbox.md)

Target backlog ini adalah **satu transaksi rawat jalan sintetis dari Operations Metta menghasilkan satu Encounter selesai dan satu resume Composition yang diterima SATUSEHAT Sandbox**. Mulai dengan satu fasyankes, satu poli, satu pasien uji, dan nakes uji. Fixture berisi keluhan utama, diagnosis yang telah dikodekan, setidaknya satu tanda vital yang benar-benar diisi dalam skenario uji, dan cara pulang yang berlaku. Kirim resource lain jika diwajibkan oleh fakta pada fixture tersebut. Kunjungan ini tanpa resep, sehingga target pengiriman tidak mencakup resource farmasi.

Kriteria di bawah merupakan syarat lulus yang akan dibuktikan saat implementasi. Keberadaan data lokal, keberhasilan membuka portal, dan keberhasilan mengirim manual lewat Postman dicatat sebagai bukti yang berbeda. Format field mengikuti [matriks identitas](../payload/matriks-identitas.md), [matriks rawat jalan](../payload/matriks-rawat-jalan.md), dan [Playbook Kemenkes v7.0](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/).

[Kondisi awal dari portal](#kondisi-awal-dari-portal) · [Hasil uji RJ-00 sampai RJ-05](#hasil-uji-rj-00-sampai-rj-05) · [Pemetaan fixture sebelum uji Encounter](#pemetaan-fixture-sebelum-uji-encounter) · [Bukti uji Encounter awal di Sandbox](#bukti-uji-encounter-awal-di-sandbox) · [A. Akses dan identitas](#a-akses-dan-identitas) · [B. Fixture dan jalur pengiriman](#b-fixture-dan-jalur-pengiriman) · [C. Resource klinis dan finalisasi](#c-resource-klinis-dan-finalisasi) · [D. Uji pengulangan dan penerimaan](#d-uji-pengulangan-dan-penerimaan)

## Kondisi awal dari portal

Pemeriksaan 16 November 2026 menggunakan sesi Chrome yang sudah login di Portal Developer SATUSEHAT.

| Yang diperiksa | Yang terlihat | Artinya bagi backlog |
| --- | --- | --- |
| Kode Akses API → Sandbox | Panel menampilkan Organization ID, Client ID, dan Client Secret. | Akses diuji pada RJ-01 dan Organization dari panel dibaca kembali pada RJ-02. |
| Master Data | Menu Master Data memuat bagian Data Pasien. | Ada jalur untuk memeriksa data uji yang sesuai. Kecocokan IHS untuk fixture tetap dibuktikan lewat pencarian pada RJ-04 dan RJ-05. |
| Beranda → Sandbox → Log transaksi FHIR | Filter resource dan status tersedia. Saat diperiksa, tabel menampilkan 0 transaksi pada filter yang sedang aktif. | Gunakan tampilan log ini untuk mencocokkan transaksi uji saat tersedia. Hasil API dan ID balikan tetap menjadi bukti utama. |

Pemeriksaan awal portal membaca tampilan. Uji berikutnya memakai kredensial Sandbox di memori untuk meminta token dan membaca API FHIR. Bukti di bawah hanya mencatat status, jumlah hasil, dan kecocokan. [Dashboard Developer SATUSEHAT](https://satusehat.kemkes.go.id/platform/dashboard) · [Panduan kode akses API](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/registration/)

## Hasil uji RJ-00 sampai RJ-05

Diperiksa 16 November 2026 pada endpoint resmi Sandbox. Organization diambil dari konteks akun Sandbox yang sedang login. Pencarian Patient dan Practitioner memakai fixture dummy resmi Kemenkes. Bukti uji akses awal dicatat di tabel ini dan hasil pemetaan ke Metta ada di [Pemetaan fixture sebelum uji Encounter](#pemetaan-fixture-sebelum-uji-encounter). [Endpoint Sandbox resmi](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) · [Fixture Patient](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/patient/) · [Fixture Practitioner](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/practitioner/)

| Task | Status dan bukti | Gap atau langkah berikutnya |
| --- | --- | --- |
| **RJ-00** | **Dasar pengiriman Operations diperiksa.** Healthcare mengelompokkan rangkaian rawat jalan per NoReg. Platform menulis event ke outbox di transaksi yang mencatat fakta. [Aturan kunjungan](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Kode event Operations](../../../../src/platform/events/index.ts) | Pemicu kirim setelah commit dan pencatatan ID balikan masih perlu dibuktikan pada RJ-07. |
| **RJ-01** | **Lulus uji OAuth.** `POST /oauth2/v1/accesstoken?grant_type=client_credentials` mengembalikan HTTP 200, token, dan `expires_in=14399` detik. Token yang sama berhasil dipakai membaca FHIR. | Saat implementasi, pasang konfigurasi rahasia backend per fasyankes dan environment. |
| **RJ-02** | **Organization Sandbox terverifikasi.** `GET /Organization/{id}` mengembalikan HTTP 200, ID sama dengan portal, dan `active=true`. | ID kini dipetakan ke legal entity `KCS` di fixture demo lokal. |
| **RJ-03** | **Location sudah dibuat dan terverifikasi.** Pada uji awal, `GET /Location?organization={id}` mengembalikan HTTP 200 dengan Bundle `total=0`. Pencarian identifier sebelum pembuatan juga kosong. Satu `POST /Location` berhasil dengan HTTP 201. Baca balik Location tersebut mengembalikan HTTP 200, ID yang sama, identifier yang sama, status aktif, dan Organization yang sesuai. | Location kini dipetakan ke Poli Umum dan Ruang Periksa Umum pada fixture. Gunakan ID yang tersimpan untuk uji Encounter. |
| **RJ-04** | **Patient dummy terverifikasi dengan filter gabungan.** NIK saja untuk fixture pertama memberi dua hasil. Pencarian NIK, nama, dan tanggal lahir memberi tepat satu hasil untuk masing-masing dari dua fixture resmi, dengan IHS yang diharapkan. Baca langsung kedua IHS mengembalikan HTTP 200 dan ID yang sama. | Dummy resmi pertama dipetakan ke Budi Contoh. Respons GET langsung tidak memuat tanggal lahir atau gender pada uji ini, sehingga kecocokan dummy didasarkan pada pencarian gabungan dan IHS resmi. |
| **RJ-05** | **Practitioner dummy dipetakan dengan IHS resmi.** Dua GET langsung mengembalikan HTTP 200 dan ID yang diharapkan. Pencarian NIK fixture pertama memberi 27 hasil tanpa IHS yang diharapkan. Pencarian fixture kedua memberi 0 hasil. | Dummy resmi pertama dipetakan secara eksplisit ke dr. Contoh Sehat. Lookup dengan NIK masih perlu ditelusuri sebelum pemetaan otomatis. |

## Pemetaan fixture sebelum uji Encounter

Pemetaan di bawah diverifikasi 16 November 2026 untuk tenant sintetis `klinik-contoh` di lingkungan demo lokal. API Operations Metta mengembalikan satu kecocokan untuk legal entity `KCS`, unit `KCS-01`, section, ruangan, pasien, dan nakes. Ruang Periksa Umum terdaftar sebagai ruangan Poli Umum.

| Referensi FHIR | Fixture Operations Metta | Bukti Sandbox |
| --- | --- | --- |
| Organization | Legal entity `KCS` dan unit fixture `KCS-01` | Organization dari portal dibaca kembali dengan HTTP 200 dan berstatus aktif. |
| Location | Poli Umum `UMUM` dan Ruang Periksa Umum `R-UMUM` | Satu Location fisik tipe ruangan dibuat dengan identifier `METTA-RJ-UMUM-R-UMUM`. POST HTTP 201, GET HTTP 200. Organization pengelola dan status aktif cocok. |
| Patient | Budi Contoh | Dipasangkan dengan dummy Patient resmi pertama. Filter gabungan HTTP 200 dengan satu hasil dan baca balik IHS HTTP 200. |
| Practitioner | dr. Contoh Sehat | Dipasangkan dengan dummy Practitioner resmi pertama. Baca balik IHS HTTP 200 dengan ID yang diharapkan. |

Berkas lokal `%LOCALAPPDATA%\Metta\SATUSEHAT\outpatient-sandbox.json` menyimpan ID record fixture Metta dan empat referensi FHIR yang sudah terbukti. Pasien dan nakes merupakan pasangan uji eksplisit antara data sintetis lokal dan dummy Kemenkes. Berkas ini berada di luar repo dan menunjuk ke [bukti uji Encounter awal](#bukti-uji-encounter-awal-di-sandbox). [Dokumentasi Location Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/location/#penambahan-data)

## Bukti uji Encounter awal di Sandbox

**Uji kontrak RJ-08 lulus pada 16 November 2026.** Satu `POST /Encounter` menggunakan empat referensi dari pemetaan fixture demo Metta menghasilkan HTTP 201 dan ID Encounter. `GET /Encounter/{id}` menghasilkan HTTP 200 serta mengembalikan ID dan identifier yang sama. Status terbaca `arrived` dan kelas terbaca `AMB`. Referensi Patient, Practitioner, Location, dan Organization seluruhnya cocok dengan payload. [API Encounter Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/)

Identifier kunjungan sintetis untuk uji ini adalah `METTA-RJ-ARRIVED-20261116084033-4B0525` dengan `period.start` pada 16 November 2026 pukul 16.40.03 WITA. ID Encounter dan bukti baca balik tersimpan di `%LOCALAPPDATA%\Metta\SATUSEHAT\outpatient-encounter-sandbox.json`. Berkas pemetaan menunjuk ke bukti tersebut.

Uji ini menyiapkan payload secara manual dari empat referensi fixture. Bukti bahwa pengiriman berawal dari NoReg dan transaksi Operations Metta masih menunggu fixture klinis RJ-06 dan pengirim RJ-07. Pembaruan ke `finished` dan pengiriman `Composition` adalah pekerjaan berikutnya dalam skenario kunjungan utuh.

## A. Akses dan identitas

| Task | Pekerjaan | Dependensi | Kriteria lulus |
| --- | --- | --- | --- |
| **RJ-00 Tentukan batas pengiriman** | Petakan transaksi per NoReg, event yang tersedia, dan pekerjaan yang perlu dijadwalkan setelah commit. Tentukan pemilik pemetaan payload dan pencatatan ID balikan di Operations. | — | Ada keputusan tertulis dengan rujukan kode Operations. Jalur dari transaksi ke pekerjaan pengiriman dan penyimpanan hasil dapat ditelusuri. |
| **RJ-01 Autentikasi Sandbox** | Siapkan konfigurasi OAuth Sandbox untuk satu fasyankes. Pasang kredensial dari portal melalui konfigurasi rahasia backend atau environment Postman lokal. Panggil endpoint token dengan `client_credentials`. | — | Token diperoleh dari host Sandbox yang benar. Lingkungan, masa berlaku, dan hasil uji tercatat tanpa nilai kredensial atau token. Kesalahan autentikasi tampak sebagai masalah konfigurasi. |
| **RJ-02 Petakan Organization** | Kaitkan legal entity uji ke ID Organization dari konfigurasi Sandbox. Verifikasi lewat baca organisasi menggunakan token RJ-01. | RJ-01 | `GET /Organization/{id}` mengembalikan ID fasyankes yang dipilih. Pemetaan tercatat untuk tenant, legal entity, dan environment yang tepat. Pasangan salah gagal diverifikasi. |
| **RJ-03 Petakan Location** | Kaitkan section dan ruangan fixture ke Location yang sah di bawah organisasi RJ-02. Gunakan lokasi yang tersedia atau ikuti orientasi lokasi Sandbox bila belum ada. | RJ-02 | Baca balik Location membuktikan ID dan afiliasi organisasi. Satu poli/rute layanan fixture terpetakan. Lokasi dari organisasi lain tidak dipakai untuk Encounter ini. |
| **RJ-04 Resolve Patient** | Cocokkan pasien lokal dari data uji yang diizinkan dengan hasil MPI. Simpan pemetaan ID pasien lokal ke Patient IHS sesuai lingkup. | RJ-01, RJ-02 | Satu hasil yang cocok menghasilkan referensi `Patient/{ihs}`. Hasil kosong, ambigu, atau identitas tidak cocok menahan pengiriman dengan alasan yang jelas. NRM tetap dipakai sebagai nomor lokal. |
| **RJ-05 Resolve Practitioner** | Cocokkan nakes uji lewat Master Nakes Index. Petakan dokter yang memeriksa dan pelaku tanda vital bila orangnya berbeda. | RJ-01, RJ-02 | Pencarian menghasilkan Practitioner IHS yang benar untuk pelaku. Akun aplikasi tanpa tautan nakes tidak menghasilkan referensi nasional buatan. |

Bukti tahap ini dicatat di [SB-00 Identitas dan koneksi](skenario-sandbox.md#sb-00-identitas-dan-koneksi). Lokasi dan pemetaan dua identitas dapat dikerjakan paralel setelah konfigurasi fasyankes tersedia.

## B. Fixture dan jalur pengiriman

| Task | Pekerjaan | Dependensi | Kriteria lulus |
| --- | --- | --- | --- |
| **RJ-06 Kunci skenario dan field** | Tentukan fixture satu poli dan tanpa resep. Pilih field dan kode yang diperlukan per tahap `arrived` dan `finished`. Catat pasangan ICD-10/SNOMED CT yang sesuai, kode LOINC/UCUM, penulis resume, serta cara pulang. Tentukan apakah AllergyIntolerance, Procedure, atau ServiceRequest berlaku pada fixture. | RJ-02, RJ-03, RJ-04, RJ-05 | Ada matriks fixture dengan sumber tiap field, nilai uji yang sah, resource yang berlaku, dan alasan untuk field kondisional. Semua ID Sandbox dapat di-resolve dan field wajib fixture punya sumber. |
| **RJ-07 Catat pekerjaan dan ID balikan** | Sambungkan pengirim yang disepakati ke fakta kunjungan yang sudah commit. Catat lingkup, NoReg atau ID fakta, resource, versi, dependensi, dan ID SATUSEHAT. Pisahkan status tertahan, belum pasti, gagal, dan diterima. | RJ-00, RJ-01, RJ-02 | Simulasi lokal membuktikan fakta yang dibatalkan tidak terkirim, respons berhasil menyimpan ID, dan pekerjaan turunan menunggu referensi yang dibutuhkan. Kegagalan pengiriman dapat ditelusuri dari NoReg tanpa mengganggu simpan pemeriksaan. |

Rujukan pengirim dan semantik status ada di [mekanisme pengiriman](../operasional/pengiriman-fhir.md#mekanisme-pengiriman-yang-diusulkan). Untuk payload awal gunakan [contoh Encounter](../payload/contoh-rawat-jalan-dan-farmasi.md#encounter-saat-registrasi) setelah mengganti placeholder dan melengkapi field sesuai fixture.

## C. Resource klinis dan finalisasi

| Task | Pekerjaan | Dependensi | Kriteria lulus |
| --- | --- | --- | --- |
| **RJ-08 Encounter awal** | Ambil NoReg, waktu registrasi, dan konteks poli dari transaksi Metta. Bentuk `POST /Encounter` dengan status awal, kelas rawat jalan, serta referensi yang dibutuhkan. Simpan ID balikan. | RJ-06, RJ-07 | Sandbox menerima payload. ID balikan terkait tepat ke NoReg, Organization, Location, Patient, dan Practitioner yang digunakan. Baca balik bila endpoint tersedia. |
| **RJ-09 Condition** | Dari pemeriksaan tersimpan, bentuk Condition untuk keluhan atau diagnosis yang berlaku dan kondisi pulang apabila dicatat sebagai Condition. Setiap diagnosis memakai data sumber dan kode yang disahkan untuk fixture. | RJ-08 | Payload yang berlaku diterima, satu resource per diagnosis, dengan referensi Patient dan Encounter yang benar. ID balikan dan peran tiap Condition dapat dipakai saat finalisasi. |
| **RJ-10 Observation** | Bentuk Observation dari tanda vital yang dicatat. Ambil nilai, kode, satuan, waktu ukur, dan pemeriksa dari sumbernya. | RJ-08 | Sandbox menerima hasil. Nilai dan satuan dapat dicocokkan ke pemeriksaan Metta. Timestamp UTC dan Practitioner sesuai dengan pengukuran yang dicatat. |
| **RJ-11 Resource kondisional fixture** | Periksa field dan fakta pilihan pada RJ-06. Implementasikan AllergyIntolerance, Procedure, atau ServiceRequest yang memang berlaku. Catat bukti penerimaan atau alasan masing-masing tidak berlaku untuk fixture ini. | RJ-06, RJ-08. RJ-09 bila perlu mereferensikan Condition. | Semua resource kondisional yang berlaku diterima dan referensinya benar. Ketiadaan data tidak menciptakan pernyataan negatif atau tindakan buatan. Gap pada skenario yang dipakai membuat task tertahan. |
| **RJ-12 Encounter akhir** | Saat kunjungan selesai, isi waktu akhir, histori, diagnosis, cara pulang, dan referensi yang berlaku. Gunakan `PUT /Encounter/{id}` dengan ID RJ-08. | RJ-08, RJ-09, RJ-10, RJ-11 | Respons dan baca balik menunjukkan Encounter yang sama berstatus `finished`, dengan periode, status, dan referensi klinis sesuai fixture. NoReg memiliki satu ID Encounter yang terverifikasi. |
| **RJ-13 Composition** | Bentuk resume rawat jalan dari kunjungan yang selesai. Petakan tipe resume, pasien, penulis, waktu, section, serta referensi yang sudah diterima. Simpan ID Composition. | RJ-12 dan semua ID yang akan dirujuk resume | Sandbox menerima Composition. ID resume tercatat, merujuk Encounter yang sama, dan masing-masing referensi section cocok dengan fakta dan ID balikan yang dipilih. |

Condition dan Observation dapat dikerjakan paralel setelah Encounter awal tersedia. Pemicu kirim memakai fakta pelayanan di Metta. Bukti tahap klinis mengikuti [SB-01](skenario-sandbox.md#sb-01-rawat-jalan-tanpa-resep) dan varian [SB-02](skenario-sandbox.md#sb-02-temuan-klinis-kondisional) jika berlaku.

## D. Uji pengulangan dan penerimaan

| Task | Pekerjaan | Dependensi | Kriteria lulus |
| --- | --- | --- | --- |
| **RJ-14 Uji pengulangan dan kegagalan** | Simulasikan token habis, mapping hilang, respons validasi, dan timeout sesudah POST. Uji replay pesan/pekerjaan dengan kunci yang sama. Jika pencarian identifier didukung, verifikasi cara mencari hasil terdahulu di Sandbox. | RJ-07, RJ-08 | Pengirim mencatat sebab tiap kasus. Timeout yang hasilnya tidak pasti direkonsiliasi sebelum POST ulang. Replay tidak membuat Encounter ganda. Hasil simulasi dibedakan dari bukti Sandbox. |
| **RJ-15 Jalankan satu kunjungan utuh** | Dari modul klinik Metta, buat satu NoReg baru, lakukan rangkaian RJ-08 sampai RJ-13, lalu cocokkan bukti di pengirim, baca balik API, dan log FHIR portal bila entri sudah tersedia. | RJ-00 sampai RJ-14; RJ-11 dipenuhi menurut kondisi fixture | Satu jejak dari NoReg Metta membuktikan Encounter awal, semua resource yang berlaku, `PUT` pada Encounter yang sama, dan Composition diterima. Catat ID balikan yang disamarkan, waktu UTC, status, versi pengirim, dan hasil pencocokan. Uji kirim manual Postman saja belum memenuhi task ini. |

Gunakan [SB-06](skenario-sandbox.md#sb-06-gagal-kirim-dan-pengulangan) untuk RJ-14, serta [format catatan hasil Sandbox](skenario-sandbox.md#catatan-hasil) untuk RJ-15. Jika API telah menerima dan baca balik cocok tetapi log portal belum menampilkan entri, catat perbedaan itu dengan rentang waktu dan filter yang diperiksa. Penerimaan untuk fixture ini membuktikan cakupan kunjungan tanpa resep yang diuji.
