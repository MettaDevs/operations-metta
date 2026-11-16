# Kebutuhan khusus pelanggan tanpa fork

Halaman ini menjawab satu pertanyaan: **kalau seorang pelanggan meminta sesuatu yang belum ada, jawabannya ditaruh di mana.** Pilihannya berurutan, dari yang paling murah dirawat sampai yang paling khusus. Satu pilihan tidak pernah tersedia: salinan source untuk satu pelanggan.

Larangan itu bukan soal selera. Sistem lama menempuh jalan itu. Setiap pelanggan memegang salinan source dan database-nya sendiri, sehingga setiap update menjadi proyek pindahan tersendiri untuk setiap pelanggan. Repo ini dibangun justru untuk keluar dari keadaan itu.

## Yang mudah tertukar

**Module khusus dan fitur produk.** Keduanya kode di repo ini, dan keduanya ikut ke image yang sama untuk semua klien. Bedanya hanya siapa yang berhak membukanya, dan hak itu datang dari entitlement yang diberikan control plane.

**Integrasi dan module.** Integrasi berjalan di luar runtime dan hanya menyentuh API serta event. Module berjalan di dalam runtime dan tunduk pada seluruh aturan module di `AGENTS.md`. Pelanggan boleh membangun integrasinya sendiri, tetapi tidak pernah menaruh kode di dalam runtime.

**Setelan dan kode.** Perbedaan yang dapat ditulis sebagai data, misalnya format nomor dokumen, adalah setelan tenant. Menjawabnya dengan kode membuat setiap perubahan kecil menunggu rilis.

## Urutan jawaban

| Urutan | Dipakai bila | Bentuknya |
| --- | --- | --- |
| 1. Setelan | Perbedaannya dapat ditulis sebagai data | Setelan tenant yang diatur admin di Sys Admin atau di layar setup module |
| 2. Fitur produk | Dibutuhkan lebih dari satu pelanggan, atau domainnya umum | Fitur module biasa, boleh dinyalakan per tenant lewat setelan module itu |
| 3. Integrasi di luar runtime | Kebutuhannya di luar inti ERP, misalnya dasbor dengan data dari sistem lain, form lapangan, atau notifikasi | Pelanggan atau partner membangunnya sendiri di atas API dan event |
| 4. Module khusus | Hanya satu pelanggan, dan harus berjalan di dalam ERP | Module di `modules/` yang hak pakainya diberikan hanya ke tenant tertentu |
| Tidak pernah | | Salinan source atau branch per pelanggan |

Mulai dari urutan teratas, dan turun hanya bila urutan di atasnya tidak cukup. Semakin ke bawah, semakin banyak yang harus ikut dirawat setiap kali Core berubah.

### 1. Setelan

Setelan bertahan melewati update tanpa pekerjaan tambahan, karena yang berubah hanya data. Contoh setelan yang sudah ada di repo ini: format dan scope nomor dokumen di Sys Admin › Nomor dokumen (`src/foundation/number-sequence/`), presisi mata uang, kebijakan data sharing antar legal entity, dan susunan role dari duty. Daftar lengkapnya adalah menu Sys Admin di `src/platform/access/navigation.ts` beserta layar setup tiap module.

Yang di CoreERP sudah menjadi setelan tetapi belum dipindah ke sini: workflow persetujuan dan dasbor yang disusun dari dataset module. Sampai keduanya dipindah, permintaan yang membutuhkannya turun ke urutan berikutnya. Statusnya di [visual workflow engine](21-visual-workflow-engine.md) dan [engine analitik](35-analitik.md).

Custom field, yaitu kolom tambahan yang dibuat pelanggan sendiri, belum ada. Permintaan yang membutuhkannya juga turun ke urutan berikutnya sampai mekanisme itu benar-benar dibangun.

### 2. Fitur produk

**Begitu pelanggan kedua meminta hal yang sama, atau domainnya jelas umum, ia menjadi fitur produk, bukan module khusus kedua.** Satu jalur kode diuji dan dipakai semua pelanggan. Dua module khusus untuk hal yang sama berarti dua jalur yang menua sendiri-sendiri dan sama-sama harus diperbaiki setiap kali Core berubah.

Kalau fiturnya tidak cocok untuk semua pelanggan, ia dinyalakan lewat setelan tenant milik module itu, bukan dipisah menjadi module khusus.

### 3. Integrasi di luar runtime

**Repo ini tidak membangun platform low-code.** Pelanggan boleh memakai alat apa pun, misalnya Power Apps, n8n, spreadsheet, atau backoffice-nya sendiri. Yang disediakan repo ini adalah API dan event yang layak dipakai alat apa pun. Membangun platform low-code sendiri berarti merawat produk kedua yang sama besarnya dengan ERP-nya.

Keadaan sekarang, supaya tidak dijanjikan lebih dari yang ada:

- API module berversi ada di `/api/modules/<module>/v1/...` dan `/api/v1/...`. Semuanya memakai sesi peramban, jadi sistem pelanggan belum dapat memanggilnya dari server ke server.
- Tempat route untuk sistem luar sudah ditetapkan, yaitu berkas `.integration.routes.ts` dengan kontrak di `contracts/integration/<domain>/`. Belum ada satu pun, karena Core belum punya autentikasi untuk pemanggil itu.
- Kontrak event yang sudah ditulis ada di `contracts/events/`. Event itu masih diantar di dalam runtime saja; pengirim ke luar runtime belum ada.

Dua aturan berlaku untuk setiap integrasi:

- **Sistem luar menyimpan id uuid, bukan kode bisnis.** Kode boleh dipakai ulang setelah barisnya dihapus lunak, karena indeks unik kode bersifat parsial (`WHERE deleted_at IS NULL`). Integrasi yang menyimpan kode dapat diam-diam menunjuk baris lain; id tidak pernah dipakai ulang.
- **Event untuk pihak luar sedikit dan stabil.** Event yang diterbitkan adalah janji jangka panjang. Nama, envelope, dan aturan versinya ada di bagian Aturan module dan Kontrak `AGENTS.md`. Kebutuhan antar-module di dalam runtime tidak otomatis menjadi event untuk pihak luar.

### 4. Module khusus

Module khusus adalah module biasa. Ia tinggal di `modules/`, memenuhi seluruh aturan module, dan dipasang per tenant lewat entitlement seperti module lain. Yang membuatnya berbeda:

**Ia ikut ke image yang sama dengan semua klien.** Kode module khusus sampai ke server setiap klien, walaupun tidak terbuka di sana. Karena itu module khusus dinamai menurut kemampuannya, bukan menurut pelanggannya, dan tidak memuat nama, rahasia, atau data pelanggan mana pun. Repo ini publik, dan `AGENTS.md` melarang nama perusahaan ditulis mati di kode.

**Data tambahannya disimpan di tabelnya sendiri**, dengan kolom yang menunjuk id milik Core atau module lain. Module tidak boleh menyentuh tabel module lain, termasuk menambah kolom ke sana. Business Central mengizinkan hal itu lewat `tableextension`; repo ini sengaja tidak, karena batas tabel antar-module yang membuat module dapat dicabut tanpa merusak module lain. Kolom tambahan untuk master milik Core mengikuti pola halaman yang sama di bagian Shared master pada skill `operations-metta-architecture`.

**Titik sambung dibuat saat permintaan nyata pertama datang.** Kalau module khusus perlu bereaksi saat module lain mencatat sesuatu, ia mendengarkan event module itu lewat `src/platform/events/`. Kalau event yang dibutuhkan belum ada, atau module khusus perlu menambah field di layar module lain, titik sambungnya ditambahkan ke module pemiliknya ketika kebutuhan itu benar-benar ada, bersama test-nya. Slot untuk menambah field di layar module lain saat ini belum ada.

## Keputusan dicatat

Setiap permintaan yang berakhir di urutan 2 atau 4 melewati [gate penemuan dan keputusan](18-module-discovery-and-decision-gate.md). Proposalnya menyebut padanan Dynamics 365 bila ada, urutan yang dipilih, dan alasan urutan di atasnya tidak cukup. Module khusus yang kemudian diminta pelanggan kedua dipindahkan menjadi fitur produk, dan keputusan itu dicatat di proposal yang sama.

## Pembanding: Business Central

Business Central memecahkan masalah yang sama dengan bentuk yang mirip:

- Kebutuhan satu pelanggan ditulis sebagai [extension per tenant](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-extension-types-and-scope) yang mengait event, sehingga kode dasarnya tidak pernah disunting dan update tetap berjalan untuk semua pelanggan.
- API untuk sistem luar dikunci `SystemId`, bukan nomor bisnis, dan berversi.
- Event di dalam prosesnya banyak, sedangkan [event bisnis](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/business-events-overview) yang diterbitkan ke sistem luar sedikit.
- Power Apps dan Power Automate tersambung lewat API dan event bisnis itu, sebagai produk terpisah.

Yang tidak ditiru: menambah kolom atau field ke tabel dan layar milik module lain, dan menjalankan kode buatan pelanggan di dalam runtime.

## Lihat juga

- [Grand design](01-grand-design.md)
- [Gate penemuan dan keputusan](18-module-discovery-and-decision-gate.md)
- [Release dan on-prem](03-release-and-on-prem.md)
