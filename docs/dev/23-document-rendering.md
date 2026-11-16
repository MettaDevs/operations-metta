# Dokumen cetak, layout, dan ekspor

> **Status di repo ini:** belum dipindah. Tidak ada mesin cetak, layout, antrean ekspor, atau layanan render PDF. Tabelnya, antara lain `print_identities`, `report_layouts`, `report_layout_defaults`, `report_exports`, `report_presets`, dan `report_last_used_options`, ada di `database/migrations/0001_coreerp_baseline.sql`, tetapi belum ada kode yang membacanya. Acuan perilaku: [`docs/dev/23-document-rendering.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/23-document-rendering.md) dan `apps/core/app/Platform/Reporting/` di [repo CoreERP](https://github.com/MettaDevs/coreERP).

Halaman ini menyimpan aturan desain mesin cetak CoreERP yang tetap berlaku untuk repo ini, supaya mesin yang kelak dibangun di sini tidak mengulang keputusan yang sudah dibayar mahal.

## Semua cetakan dan laporan lewat satu mesin template

Keputusan pemilik produk, 13 November 2026: laporan berupa template di mesin laporan dan cetak tersendiri, bukan layar dengan kolom dan query yang ditulis mati. Migration `0030_inventory_report_names.sql` mencatat akibatnya: LPLPO tidak lagi menjadi layar tetap.

Akibatnya untuk pekerjaan hari ini:

- Jangan membuat view cetak, rute cetak, CSS cetak, atau tombol Cetak di layar mana pun. Cetakan seperti rekam medis, kwitansi, surat, dan label menunggu mesinnya.
- Jangan membuat halaman laporan dengan kolom dan query tetap. Catat kebutuhannya sebagai kebutuhan mesin laporan.
- Layar tanya-jawab data, misalnya **Stok per lokasi** di `src/foundation/inventory/stock-by-location/`, bukan laporan. Layar itu padanan halaman daftar BC seperti Items by Location, dan tetap layar biasa.

## Model yang ditiru: Business Central

Dynamics 365 punya dua model. F&O memakai Electronic Reporting: data model abstrak, model mapping, konfigurasi format berversi, dan penyuntingan template yang menuntut SharePoint dan Office 365. Business Central jauh lebih kecil: satu report adalah dataset yang ditentukan developer, dan dataset itu dipakai banyak layout Word atau Excel yang boleh diubah pengguna tanpa rilis.

CoreERP mengambil model BC, dengan satu ide dari F&O: dataset adalah kontrak yang stabil, bukan tabel mentah. Alasannya tetap berlaku di sini:

- Skalanya sepadan dengan BC. Electronic Reporting adalah framework tersendiri yang butuh tim untuk merawatnya.
- On-prem tidak boleh bergantung pada Office 365. Pengguna menyunting `.docx` di Word lokal lalu mengunggahnya.
- Yang berbeda antarklinik adalah tampilan, bukan data. Dengan dataset yang sama, setiap tenant boleh mengunggah layout-nya sendiri tanpa developer menulis ulang apa pun.

## Core memegang mesinnya, pemilik data memegang datasetnya

Mesin cetak milik Core, sama seperti number sequence. Bila mesinnya disalin ke setiap module, salinan itu perlahan saling menyimpang, dan admin tenant mendapat satu halaman pengaturan layout per module.

| Lapis | Padanan BC | Pemilik |
| --- | --- | --- |
| Dataset | Report dataset | Pemilik data: Core atau module |
| Katalog laporan | Report object | Dibaca dari definisi dataset, bukan ditulis di tempat kedua |
| Layout bawaan | Extension layout | Ikut rilis pemilik dataset |
| Layout unggahan | User-defined layout | Tenant, opsional per legal entity |
| Layout default | Report Selections | Tenant per legal entity; legal entity mengalahkan tenant |
| Antrean ekspor dan hasilnya | Report scheduling | Core |
| Render PDF | Report rendering | Infrastruktur Core, tanpa status dan tanpa tenant |
| Identitas cetak: nama kop, baris induk, footer, logo | Company Information | Tenant per legal entity atau operating unit |

Batas yang mengikat setiap pemilik dataset:

- **Dataset dokumen diminta kepada pemilik datanya.** Pemilik menegakkan permission dan scope organisasi pengguna persis seperti di layarnya, lalu menyerahkan data yang sudah disaring. Core boleh membaca tabel module, tetapi isi dokumen dan siapa boleh mencetak record mana milik module, dan memintanya membuat semua itu satu sumber dengan layarnya. Konteks pengguna dikirim sebagai argumen, bukan dibaca dari request, karena ekspor berjalan di worker tanpa sesi. Izin diperiksa dua kali: Core memeriksa boleh menjalankan laporan, pemilik data memeriksa boleh membaca datanya.
- **Katalog laporan dibaca dari definisi dataset.** CoreERP pernah menulis laporan juga di manifest, dan kedua sumber itu menyimpang: laporan yang terlewat tampil di pratinjau lalu menjawab 404 saat dicetak.

## Identitas cetak bukan bagian layout

Nama, logo, dan footer kop disimpan sebagai data per legal entity, dengan operating unit boleh punya identitas sendiri. Saat mencetak, identitas yang paling spesifik dipakai. Alamat dan kontak tidak disimpan di identitas cetak. Keduanya dibaca dari buku alamat organisasi, `src/platform/address-book/`, supaya satu alamat kantor tidak diubah di dua tempat.

Logo adalah daftar berposisi, bukan satu gambar, karena kop instansi pemerintah memuat lambang daerah di kiri dan logo instansi di kanan. Logo hanya PNG atau JPEG. Akibatnya mengganti logo atau footer tidak pernah menyentuh layout.

## Layout adalah data tenant

Tenant boleh mengunggah, mengganti, dan mengarsipkan layout tanpa rilis. Yang dikunci hanya kode laporan, karena layout tersimpan dan riwayat ekspor merujuknya. Layout bawaan tidak pernah disunting di tempat: pengguna mengunduhnya, mengubahnya, lalu mengunggahnya sebagai layout baru. Hak mengelola layout terpisah dari hak mencetak, jadi tenant dapat memberi hak cetak tanpa memberi hak mengganti kop.

## Cara layout membaca dataset

- Placeholder `${kode}` mengambil satu nilai. Baris tabel Word atau baris Excel yang memuat placeholder berawalan nama tabel dataset digandakan per baris.
- **Uang, angka, persen, tanggal, dan waktu dikirim mentah dan diformat mesin.** Dataset hanya menyatakan jenis nilainya, padanan `AutoFormatType` BC. Word dan PDF mendapat teks berformat, Excel mendapat angka atau tanggal asli supaya dapat dijumlah dan diurutkan. Presisi uang dibaca dari presisi mata uang tenant, sumber yang sama dengan `roundAmount` di `src/foundation/currency/`.
- **Waktu dikirim dalam UTC** dan ditulis menurut zona waktu pengguna yang mencetak, beserta nama zonanya.
- **Placeholder tak dikenal dikosongkan.** Dokumen yang sampai ke pihak luar tidak boleh memuat `${...}`. Saat unggah, placeholder yang tidak ada di dataset dilaporkan sebagai peringatan.
- **Dokumen bermakro ditolak saat unggah.** Yang diperiksa isi berkasnya, bukan ekstensinya.

## Ekspor berjalan di latar belakang

Permintaan cetak dijawab `202` dengan baris ekspor `queued`, lalu worker mengambil dataset, mengisi layout, mengubah format, dan menyimpan berkas. Pengguna tidak menunggu di layar.

- Hak pengguna diperiksa ulang saat job berjalan, bukan dibekukan saat permintaan dibuat. Pencabutan hak di antaranya langsung berlaku.
- Database yang menjamin satu baris antrean hanya diambil satu worker. Baris `running` punya masa sewa, supaya ekspor yang ditinggal worker mati tetap diselesaikan dan satu ekspor tidak dikerjakan dua worker.
- Kegagalan yang pasti berulang, misalnya layout salah susun atau hak dicabut, langsung `failed` dengan pesan yang jelas. Yang diulang, dengan batas jumlah percobaan, adalah gangguan sesaat, misalnya layanan PDF yang terlambat menjawab, dan worker yang mati di tengah ekspor.
- Ekspor aktif per pengguna dan jumlah baris dataset dibatasi, supaya satu permintaan tidak menguasai worker.
- Hasil ekspor punya masa simpan dan dihapus sesudahnya. Dokumen selalu dapat dibuat ulang dari data dan layout terbaru.
- Layanan render berjalan tanpa jalan keluar ke internet, supaya dokumen unggahan tenant tidak dapat memancingnya mengambil sumber dari luar.

## Yang tidak dipindah

- Nama kelas, command, dan paket PHP: `ModuleReportProvider`, `TypedSheetWriter`, OpenSpout, PhpSpreadsheet, `queue:work`, dan setelan `COREERP_REPORTING_*`.
- `CustomEvent('coreerp:print')` dari layar module ke Shell. Cara layar di repo ini meminta cetak belum diputuskan.
- Container renderer CoreERP berbasis Gotenberg dan LibreOffice. Pilihan engine render di repo ini belum diputuskan.
- Fitur laporan CoreERP yang lebih jauh, misalnya opsi terakhir, preset, filter tambahan per kolom, Excel data saja, dan ekspor daftar di layar. Rinciannya di halaman CoreERP.

## Lihat juga

- [Engine analitik](35-analitik.md): pertanyaan "berapa" atas data module, berbeda dari dataset dokumen cetak
- [Number sequence](14-number-sequences.md): layanan Core lain yang dipakai bersama
