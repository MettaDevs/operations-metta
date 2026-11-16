# Cakupan integrasi SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](inventaris-sumber-resmi.md)
>
> **Acuan utama** [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) (disunting 2024-10-03) · [Panduan Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/) (disunting 2026-10-12) · [Master Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/) (disunting 2024-09-09)

[Indeks SATUSEHAT](../README.md) · [Referensi dan pemeliharaan dokumen](README.md)

Dokumentasi ini menjadi rujukan kerja internal untuk menyiapkan integrasi Operations Metta. Catat kontrak menurut versi sumber yang diperiksa. Jika endpoint atau aturan resmi berubah, perbarui bagian yang terdampak dan jalankan kembali skenario uji terkait.

| Kelompok | Cakupan yang diperiksa |
| --- | --- |
| Akses dan orientasi | Kredensial per environment, OAuth, registrasi fasyankes dan RME, Organization, Location, Patient, Practitioner, serta perubahan akses dan konfigurasi. |
| Master data | MPI untuk pasien dengan NIK, tanpa NIK, dan bayi baru lahir. Sertakan MSI, Master Wilayah, KFA, dan referensi terminologi. |
| FHIR dan modul pelayanan | Operasi resource, alur Rawat Jalan, IGD, Rawat Inap, dan Kefarmasian. |
| Modul penerapan | Program klinis, rujukan dan penunjang, laporan atau registrasi tematik, klaim, dan penandatanganan dokumen yang terbit dalam katalog. |
| Pertukaran lain | DICOM, verifikasi identitas KYC, akses riwayat SSRME, dan kemampuan lain yang dijelaskan resmi. |
| Operasi integrasi | Aturan validasi, penanganan respons, rekonsiliasi, monitoring, format aduan, serta bukti pengujian Sandbox. |

Sumber utama untuk menemukan kemampuan dan batasnya adalah [katalog Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/), [Panduan Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/), [Master Data](https://satusehat.kemkes.go.id/platform/docs/id/master-data/), [dokumen KYC](https://satusehat.kemkes.go.id/platform/docs/id/kyc/), dan [catatan rilis](https://satusehat.kemkes.go.id/platform/docs/id/whats-new/). Rujukan yang dikirim pengguna dan bukti yang sudah ada tercatat di [Referensi dan cakupan Rawat Jalan](cakupan-rawat-jalan-dan-ssrme.md).

[Bentuk catatan per integrasi](#bentuk-catatan-per-integrasi) · [Daftar kontrol](#daftar-kontrol) · [Status penurunan kontrak](#status-penurunan-kontrak) · [Hasil audit dokumentasi](#hasil-audit-dokumentasi)

## Bentuk catatan per integrasi

| Bagian | Isi yang dicatat |
| --- | --- |
| Fungsi dan pemicu | Peristiwa yang memulai integrasi, siapa pemilik proses, dan data yang harus tersedia lebih dulu. |
| Kontrak HTTP | Environment, metode, path, autentikasi, header, query, parameter URI, dan format body. |
| Alur dan data | Urutan transaksi, ID yang dipakai ulang, field wajib dan kondisional, kardinalitas, terminologi, sumber di Metta, serta data yang belum tersedia. |
| Contoh dan respons | Request sintetis, bentuk respons, ID yang perlu disimpan, serta contoh kesalahan yang bisa ditangani. |
| Kontrol dan pengujian | Korelasi, pembaruan, retry, rekonsiliasi, privasi log, skenario uji, dan bukti yang benar-benar diperoleh. |
| Sumber dan batas | Tanggal atau versi verifikasi, perbedaan antar sumber, dan akses yang dibutuhkan untuk menutup bagian yang belum diketahui. |

Catat tingkat bukti pada masing-masing kontrak. **Terdokumentasi** berarti informasi ditelusuri di sumber resmi. **Terbukti di Sandbox** berarti request dan responsnya sudah diperiksa. **Terhubung ke Metta** berarti pengiriman dan penyimpanan hasil dari transaksi aplikasi sudah dibuktikan. Jika sumber dibatasi akses atau hanya memuat pengumuman, catat bagian yang tersedia dan gap kontraknya.

## Daftar kontrol

- [Inventaris sumber resmi](inventaris-sumber-resmi.md) merekam 268 halaman kanonis per 16 November 2026 beserta satu tautan navigasi yang perlu ditinjau.
- [Inventaris Playbook](inventaris-playbook.md) menunjukkan halaman layanan dan use case yang sudah ditemukan beserta status dokumentasi internalnya.
- [Inventaris operasi HTTP](../endpoint/inventaris-operasi-http.md) mencatat metode, path, parameter yang ada pada tabel sumber, dan kelas respons yang ditemukan.
- [Kontrak per operasi API](../endpoint/kontrak-operasi-api.md) menambahkan header, tipe dan variasi parameter, bentuk body, dan balikan yang tersedia untuk setiap baris katalog.
- [Inventaris profil resource](../payload/inventaris-profil-resource.md) menautkan profil resmi, field bertanda wajib, operasi yang terindeks, dan konteks penggunaan di Metta.
- [Kompatibilitas payload FHIR](../payload/kompatibilitas-payload-fhir.md) mencatat perbedaan ejaan, bentuk extension, dan versi pada heading profil yang diperiksa.
- [Profil dan extension FHIR R4](../payload/profil-dan-extension-fhir.md) mencatat 40 URI profil dan 10 URI extension dari Implementation Guide publik, termasuk posisi slice, contoh kelas layanan dan perbedaan dengan contoh portal.
- [Indeks contoh payload](../payload/indeks-contoh-payload.md) menautkan contoh sintetis pada setiap profil resource terindeks. Contoh dasar R5 dan potongan non-FHIR memiliki label tersendiri.
- [Kontrak terminologi](../terminologi/kontrak-terminologi.md) dan [indeks per field](../terminologi/indeks-terminologi-field.md) mencatat versi, CodeSystem, penggunaan, dan jejak field dari buku v12.0.
- [Validasi dan penanganan error](../validasi/respons-dan-error.md) menjelaskan format FHIR dan tindakan umum. Catat variasi error per endpoint pada kontrak masing-masing.
- [Indeks Rule Number](../validasi/kamus-rule-number.md) menautkan nomor dan path validasi ke kategori pemeriksaan serta worksheet resmi.

## Status penurunan kontrak

| Kelompok | Rujukan internal | Bukti dan pekerjaan yang masih terbuka |
| --- | --- | --- |
| OAuth dan orientasi | [Onboarding FHIR](../endpoint/onboarding-fhir.md) dan [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md) | OAuth, baca Organization dan Practitioner, serta create/read Location sudah diuji untuk fixture. Scope Production, pembaruan resource, dan lookup otomatis nakes masih perlu dibuktikan. |
| MPI | [Master Patient Index](../endpoint/master-data-pasien.md) | Pencarian dan baca balik Patient dummy sudah ada. Cabang tanpa NIK, registrasi, patch, dan relasi bayi masih perlu uji. |
| MSI, Wilayah, dan KFA | [Sarana dan Wilayah](../endpoint/master-data-sarana-wilayah.md) · [KFA](../endpoint/master-data-kfa.md) | Endpoint, parameter, respons, dan kriteria uji tercatat. Sinkronisasi dari Metta dan perilaku kasus perbedaan antar contoh resmi masih perlu dibuktikan. |
| Rawat Jalan | [Referensi dan cakupan per bab](cakupan-rawat-jalan-dan-ssrme.md) | Encounter awal sudah terbukti di Sandbox. Alur utuh dari transaksi Metta masih menjadi backlog. |
| IGD, Rawat Inap, dan Kefarmasian | [IGD dan Rawat Inap](../alur/igd-dan-rawat-inap.md) · [Kefarmasian lintas fasyankes](../alur/pelayanan-kefarmasian-lintas-fasyankes.md) · [Field wajib per bab](../payload/profil-field-layanan.md) | Alur layanan, selector NRN, dan penebusan publik dicatat. Beberapa extension, endpoint alat kesehatan, dan uji Metta masih terbuka. |
| KYC dan SSRME | [KYC](../endpoint/kyc.md) · [SSRME](../alur/ssrme.md) | Kontrak terdokumentasi. Uji akses layanan dan consent masih terbuka. |
| Laboratorium, radiologi, dan rujukan nasional | [Lab dan spesimen](../alur/laboratorium-rujukan-spesimen.md) · [DICOM](../alur/radiologi-dicom.md) · [Rujukan pasien](../alur/rujukan-pasien.md) | Kontrak dan alur publik utama tercatat. Uji lintas organisasi, selector khusus tertentu, dan konfigurasi rilis router masih terbuka. |
| Pembiayaan dan klaim | [BPJS Kesehatan](../alur/klaim-bpjs.md) · [Asuransi swasta, AKT, dan OOP](../alur/klaim-swasta-dan-bayar-mandiri.md) | Alur publik, field utama dan skenario uji tercatat. Kontrak mitra, akses antar pihak dan uji belum tersedia. |
| TTE dan Consent | [Tanda tangan elektronik dan FHIR Consent](../alur/tanda-tangan-elektronik-dan-consent.md) | Alur FHIR/SSM dan profil Consent tercatat. Konfigurasi QR/webhook, extension dan hak baca ulang perlu dibuktikan. |
| Kehamilan, persalinan, kelahiran dan neonatus | [Episode ANC, INC, PNC dan Neonatus](../alur/program-kehamilan-persalinan-dan-neonatus.md) · [Data Kelahiran](../alur/data-kelahiran-dan-akta.md) · [SHK](../alur/skrining-hipotiroid-kongenital.md) · [Matriks field](../payload/profil-field-program-ibu-dan-bayi.md) | Task akta, query episode menurut koleksi, dan rujukan DBS tercatat. Uji antar-organisasi serta query gabungan hasil SHK masih terbuka. |
| Pelaporan kematian | [MPDN dan SMPK](../alur/pelaporan-kematian-mpdn-dan-smpk.md) | Notifikasi maternal/perinatal, sertifikasi penyebab, dan manajemen verifikasi tercatat. Uji role pelapor dan koder belum ada. |
| Imunisasi dan kesehatan anak | [Imunisasi/KIPI dan COVID-19](../alur/imunisasi-dan-kipi.md) · [Tumbuh Kembang dan Gizi](../alur/tumbuh-kembang-dan-gizi.md) · [MTBS](../alur/manajemen-terpadu-balita-sakit.md) · [PKPR](../alur/pkpr-luar-gedung.md) · [Matriks field](../payload/profil-field-imunisasi-dan-anak.md) | Alur, kode, instrumen dan POST NutritionOrder tercatat. Operasi baca, scope NutritionOrder dan penerimaan Sandbox masih terbuka. |
| Penyakit menular dan upaya berhenti merokok | [TB dan SITB](../alur/tuberkulosis-dan-sitb.md) · [HIV](../alur/hiv-dan-pemeriksaan-penunjang.md) · [GHPR/Rabies](../alur/ghpr-rabies.md) · [Matriks penyakit menular](../payload/profil-field-penyakit-menular.md) · [UBM](../alur/upaya-berhenti-merokok.md) | Alur, query TB-SO, hasil tes dan instrumen publik dicatat. Selector khusus HIV, izin, jalur lain dan uji Sandbox masih terbuka. |
| Skrining PTM | [Skrining PTM](../alur/skrining-penyakit-tidak-menular.md) · [Field per bab](../payload/profil-field-ptm.md) | Alur episode terduga, faktor risiko, instrumen dan kode section tercatat. Uji tiap jenis deteksi dan izin masih terbuka. |
| Registrasi penyakit serta layanan Gigi dan MCU | [Registrasi penyakit](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) · [Mata dan Telinga](../alur/registrasi-mata-dan-telinga.md) · [Gigi](../alur/rawat-jalan-gigi-dan-odontogram.md) · [MCU](../alur/medical-check-up.md) · [Field per bab](../payload/profil-field-registrasi-dan-gigi.md) | Alur, kode, query episode dari koleksi yang tersedia dan skenario utama tercatat. Selector khusus kanker, extension dan pengujian modul masih terbuka. |
| Resource dan operasi lintas modul | [Inventaris Playbook](inventaris-playbook.md) · [Inventaris HTTP](../endpoint/inventaris-operasi-http.md) · [Kontrak per operasi](../endpoint/kontrak-operasi-api.md) · [Indeks contoh](../payload/indeks-contoh-payload.md) | Setiap Playbook terindeks menunjuk panduan internal. Operasi dan contoh terindeks cocok dengan snapshot publik. Perilaku operasi yang bergantung pada izin atau konfigurasi mitra dicatat pada panduan tiap jalur. |
| Penjadwalan dan janji temu | [Penjadwalan dan janji temu](../alur/penjadwalan-dan-janji-temu.md) | Metode publik, field dasar FHIR dan pemetaan Metta tercatat. Route Schedule, lookup Slot dan perilaku reservasi masih terbuka. |
| Monitoring dan aduan | [Monitoring dan kanal aduan](../operasional/monitoring-dan-aduan.md) · [Indeks Rule Number](../validasi/kamus-rule-number.md) | Role, tampilan dan rentang portal, rekonsiliasi dan format aduan tercatat. Bukti cocoknya log portal dengan pengiriman Metta masih terbuka. |

## Hasil audit dokumentasi

| Pemeriksaan pada snapshot 16 November 2026 | Hasil |
| --- | --- |
| Katalog publik dan tautan panduan | 268 halaman portal yang dapat dibaca, 36 Playbook dengan panduan internal, serta 165 operasi dengan metode, path, dan rujukan yang cocok pada dua inventaris operasi. |
| Profil dan terminologi | 57 profil portal dengan 2.144 path unik. Implementation Guide menyediakan 40 URI profil dan 10 URI extension. Indeks Standar Terminologi v12.0 memuat 385 path dan 25 bagian dengan ECL. |
| Contoh payload | 135 blok JSON valid. Pemeriksaan nama field dan bentuk objek memeriksa 114 objek R4 dari 64 tipe. Pemeriksaan binding wajib pada literal contoh mencakup 153 nilai R4 dan 1 nilai R5, termasuk rupiah dan tipe media. Potongan JSON serta contoh R5 diberi konteks pemakaian. |
| Tautan dan keamanan isi | Tautan internal dan anchor diperiksa bersama pencarian pola token, kunci privat, NIK, dan ID fixture yang diketahui. Bukti uji memakai ID tersamarkan. |

Kontrak yang memerlukan role mitra, akses khusus, atau detail wire yang belum terkonfirmasi tercatat pada tabel status dan panduan modul. Perbedaan URI AdministrativeCode dan CodeSystem MedicationType dicatat dengan contoh yang dipakai masing-masing sumber. Bukti pengiriman dibaca dari status Sandbox dan backlog Rawat Jalan. [Profil dan extension](../payload/profil-dan-extension-fhir.md) · [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti) · [Backlog Rawat Jalan](../pengujian/backlog-rawat-jalan-tanpa-resep.md)
