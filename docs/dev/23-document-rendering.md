# Dokumen cetak, layout, dan laporan

Setiap dokumen cetak di repo ini lahir dari satu mesin di Core, `src/platform/reporting/`: pemilik data mendaftarkan dataset dan layout bawaannya, mesin mengisi layout Word, membuat PDF lewat renderer, dan menyajikannya ke satu komponen cetak di layar. Cara menambah dokumen ada di skill [`report-engine`](../../.agents/skills/report-engine/SKILL.md). Halaman ini menyimpan alasannya.

Desainnya pindahan mesin CoreERP, `apps/core/app/Platform/Reporting/` di [repo CoreERP](https://github.com/MettaDevs/coreERP), dengan cacatnya diperbaiki. Bagian [Yang berbeda dari CoreERP](#yang-berbeda-dari-coreerp) mencatat perbaikannya.

## Semua cetakan dan laporan lewat satu mesin template

Keputusan pemilik produk, 13 November 2026: laporan berupa template di mesin laporan dan cetak tersendiri, bukan layar dengan kolom dan query yang ditulis mati. Migration `0030_inventory_report_names.sql` mencatat akibatnya: LPLPO tidak lagi menjadi layar tetap.

- Jangan membuat view cetak, rute cetak, CSS cetak, atau tombol Cetak yang menulis logika cetak di layar mana pun. Layar memasang `PrintAction` dengan kode laporan dan id record-nya, tidak lebih.
- Jangan membuat halaman laporan dengan kolom dan query tetap. Catat kebutuhannya sebagai laporan tabel di mesin ini.
- Layar tanya-jawab data, misalnya **Stok per lokasi** di `src/foundation/inventory/stock-by-location/`, bukan laporan. Layar itu padanan halaman daftar BC seperti Items by Location, dan tetap layar biasa.

## Model yang ditiru: Business Central

Dynamics 365 punya dua model. F&O memakai Electronic Reporting: data model abstrak, model mapping, konfigurasi format berversi, dan penyuntingan template yang menuntut SharePoint dan Office 365. Business Central jauh lebih kecil: satu report adalah dataset yang ditentukan developer, dan dataset itu dipakai banyak layout Word atau Excel yang boleh diubah pengguna tanpa rilis ([Report Layout Selection](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-how-change-report-layout), [Custom Report Layouts](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-manage-report-layouts)).

Repo ini mengambil model BC, dengan satu ide dari F&O: dataset adalah kontrak yang stabil, bukan tabel mentah.

- Skalanya sepadan dengan BC. Electronic Reporting adalah framework tersendiri yang butuh tim untuk merawatnya.
- On-prem tidak boleh bergantung pada Office 365. Pengguna menyunting `.docx` di Word lokal lalu mengunggahnya.
- Yang berbeda antarklinik adalah tampilan, bukan data. Dengan dataset yang sama, setiap legal entity boleh mengunggah layout-nya sendiri tanpa developer menulis ulang apa pun.

## Core memegang mesinnya, pemilik data memegang datasetnya

| Lapis | Padanan BC | Di repo ini |
| --- | --- | --- |
| Dataset | Report dataset | `defineReport` di folder fitur pemilik data, misalnya `payment-receipt.report.ts` dan `drug-label.report.ts` |
| Katalog laporan | Report object | `reportCatalog([...])` di `src/main.ts`, dirakit dari laporan yang di-export Core dan module |
| Layout bawaan | Extension layout | `layouts` pada definisi laporan, ditulis dengan `wordDocument` |
| Layout unggahan | User-defined layout | `report_layouts`, per legal entity, isi berkas di kolom `isi` |
| Layout yang dipakai | Report Layout Selection | `report_layout_defaults`, satu per legal entity dan laporan |
| Render PDF | Report rendering | Gotenberg di `RENDERER_URL`, tanpa status dan tanpa tenant |
| Identitas cetak | Company Information | `print_identities` per legal entity atau unit kerja, Sys Admin › Kop surat |

Batas yang mengikat setiap pemilik dataset:

- **Dataset dibuat pemilik datanya, lewat service yang juga dipakai layarnya.** `load` farmasi memanggil `Dispensings.show`, yang sudah menegakkan izin dan scope seperti di layar penyerahan. Core tidak membaca tabel module dan tidak menulis ulang aturan siapa boleh membaca record mana. `check:boundaries` menolak nama tabel module di `src/`.
- **Izin cetak adalah izin baca record asalnya.** Tidak ada izin cetak tersendiri: siapa yang boleh membuka record boleh mencetaknya. Mesin memeriksa `permission` laporan di tempat kerja pemilik dataset, lalu dataset memeriksanya lagi lewat service-nya.
- **Laporan module yang belum terpasang tidak dikenal.** Mesin membaca `core_module_installations`, sama dengan `onEvent`; laporan `core` selalu ada.
- **Katalog dibaca dari definisi dataset, satu tempat.** CoreERP menulis laporan juga di manifest, dan kedua sumber itu menyimpang. Di sini katalog adalah nilai di `src/main.ts`, dan proses gagal mulai bila sebuah laporan salah bentuk: kode ganda, izin di luar module pemiliknya, contoh data yang tidak sesuai field, atau layout bawaan yang memakai tag tidak dikenal. Test memuat `src/main.ts`, jadi CI ikut gagal.

## Field dataset: arti, bukan rupa

Dataset menyatakan arti tiap nilai (`field.text`, `field.money`, `field.date`, `field.datetime`, `field.quantity`, `field.flag`, `field.lines` untuk baris yang boleh bersarang). Rupanya milik mesin, padanan `AutoFormatType` BC:

- **Uang** dibulatkan ke presisi mata uang tenant (`currency_precisions`), sumber yang sama dengan `roundAmount`. `field.money(label, { words: true })` menambah tag `<key>_words` berisi terbilang.
- **Pemisah angka, nama bulan, dan terbilang mengikuti bahasa layout.** Bahasa melekat pada layout (`id` atau `en`), bukan pada pengguna, karena klinik yang melayani wisatawan mencetak dokumen yang sama dalam dua bahasa.
- **Waktu disimpan UTC dan ditulis menurut zona waktu legal entity dokumen** (`legal_entities.timezone`), beserta nama zonanya: WIB, WITA, WIT. Tanggal tanpa jam tidak pernah digeser zona.
- **Nilai yang tidak sesuai field-nya menggagalkan cetak**, tidak dicetak kosong. Dokumen yang salah lebih mahal daripada pesan error.

Organisasi dokumen datang dari record, bukan dari tempat kerja pengguna. Dataset mengembalikan legal entity dan unit kerja record-nya, dan kop, zona waktu, serta layout ikut itu. Mesin menolak record dari legal entity lain dengan 404.

## Identitas cetak bukan bagian layout

Nama tampil, baris induk, NPWP, nomor izin, dan catatan kaki disimpan per legal entity, dengan unit kerja boleh punya kop sendiri. Saat mencetak, kop unit kerja yang menerbitkan dokumen dipakai, kalau tidak ada kop legal entity-nya, kalau tidak ada juga cukup nama legal entity. Alamat, telepon, dan email tidak disimpan di kop. Ketiganya dibaca dari buku alamat organisasi, `src/platform/address-book/`, supaya satu alamat kantor tidak diubah di dua tempat.

Logo belum dipasang dari kop. Layout per legal entity membawa gambarnya sendiri di dalam berkas Word.

### Penanda tangan dokumen

Dokumen gudang dan farmasi di Indonesia ditutup kotak tanda tangan: petugas yang mengerjakan dokumen, lalu pejabat yang mengetahui, misalnya kepala puskesmas atau apoteker penanggung jawab, beserta NIP atau nomor izinnya. Sistem lama menulis nama dan NIP pejabat itu mati di template.

Keduanya diperlakukan berbeda:

- **Petugas adalah data dokumennya.** Pengirim, penerima, penghitung, dan pembuat dokumen adalah pengguna yang memposting atau mengajukan dokumen itu, dan dataset mengirim namanya sebagai field biasa. Business Central melakukan hal yang sama: dokumen terposting mencatat pengguna yang memposting, dan perhitungan fisik mencatat Person Responsible.
- **Pejabat adalah data organisasi.** Tabel `penanda_tangan_cetak` menyimpan jabatan, nama, dan nomor di bawah nama per legal entity atau unit kerja, diisi di Sys Admin › Kop surat. Padanannya [Officials](https://learn.microsoft.com/en-us/dynamics365/finance/localizations/europe/emea-set-up-signers-for-printing-forms) di Dynamics 365 Finance, yang juga menyimpan penanda tangan per legal entity dan per jenis dokumen. Business Central W1 tidak punya padanannya.

Mesin mengisi tag `{#signers}{title} {name} {id_number}{/signers}` untuk setiap laporan, dengan urutan pilihan yang sama dengan kop: penanda tangan unit kerja dokumen bila ada, kalau tidak milik legal entity-nya. Penanda tangan yang dibatasi ke satu laporan hanya tercetak di laporan itu. Nomor di bawah nama dicetak apa adanya, jadi "NIP 1980…" dan "SIPA 503/…" sama-sama tertulis benar tanpa label di layout. Tanpa baris penanda tangan, blok itu hilang dari kertas. Layout bawaan memasangnya lewat `signatureBlocks` di `src/platform/reporting/signers.ts`.

## Layout adalah data legal entity

- **Layout bawaan ditulis sebagai kode**, dengan `wordDocument` di `src/platform/reporting/docx.ts`, bukan berkas `.docx` biner. Diff-nya terbaca di review, dan tag-nya diperiksa saat proses mulai. Klinik yang ingin rupa lain mengunduhnya sebagai Word dari Sys Admin › Layout cetak.
- **Unggahan disimpan di database lingkungan**, kolom `report_layouts.isi`. Image runtime tidak punya volume tulis, dan database lingkungan sudah terpisah per tenant dan sudah dicadangkan. Berkasnya paling besar 2 MB.
- **Baris layout tidak pernah diubah isinya.** Mengganti layout berarti mengunggah baris baru lalu memilihnya. Unggahan berkas yang sama untuk laporan dan legal entity yang sama menemukan baris yang sudah ada.
- **Pilihan layout dibaca ulang setiap cetak.** Pilihan yang menunjuk layout terhapus atau layout bawaan yang sudah tidak ada jatuh ke layout bawaan pertama, jadi tidak ada pilihan yang perlu diselaraskan saat layout dihapus.
- **Ukuran kertas milik dokumen Word itu sendiri** (setelan halaman), dibaca saat unggah untuk ditampilkan. A4, etiket 96 × 200 mm, dan struk 76 mm hanyalah layout dengan setelan halaman berbeda.
- **Mengelola layout butuh dua izin**: `core.report-layout.update` dan izin baca dokumen laporannya. Pengelola layout farmasi tidak bisa mengganti kuitansi kasir.

## Cara layout membaca dataset

Tag memakai sintaks [docxtemplater](https://docxtemplater.com/docs/tag-types/):

- `{number}` mengambil satu nilai; `{letterhead.name}` dan `{printed.at}` diisi mesin untuk setiap laporan.
- `{#services}…{/services}` mengulang isi untuk setiap baris. Bila tag pembuka dan penutup ada di satu baris tabel Word, baris tabel itu yang diulang. Baris bersarang, misalnya komposisi racikan di dalam etiket, ditulis dengan cara yang sama.
- `{#cancelled}…{/cancelled}` hanya tampil bila nilainya ada; `{^cancelled}…{/cancelled}` sebaliknya. Paragraf yang hanya berisi tag pembuka atau penutup hilang dari kertas.
- `{$no}`, `{$first}`, dan `{$last}` tersedia di dalam perulangan.
- Baris baru di dalam nilai teks menjadi baris baru di Word.

Unggahan ditolak bila bukan dokumen Word, berisi makro atau ActiveX, mengambil gambar dari luar dokumen, sintaks tag-nya rusak, atau memakai tag yang tidak dikenal laporannya. Tag tak dikenal ditolak, bukan diperingatkan: di kertas ia tercetak kosong tanpa ada yang tahu.

## Cetak dokumen berjalan sinkron

`GET /api/v1/reports/{code}/records/{id}?format=pdf|docx&layout=` menjawab berkasnya langsung. Mengisi layout butuh 3 sampai 5 ms, dan konversi PDF median 317 sampai 372 ms setelah LibreOffice hangat (diukur dengan Gotenberg 8.36 di laptop pengembang; tabel di bagian Renderer). Antrean, penyimpanan hasil, dan polling seperti CoreERP tidak sepadan untuk satu dokumen.

- Renderer yang tidak diisi atau tidak menjawab dijawab `503` berkode `renderer_unavailable`. `PrintAction` lalu menawarkan unduh Word, karena berkas Word tetap bisa dibuat tanpa renderer.
- LibreOffice butuh sekitar 13 detik untuk konversi pertamanya. Gotenberg dijalankan dengan `--libreoffice-auto-start`, supaya waktu itu habis saat container mulai, bukan pada klik cetak pertama. `RENDERER_TIMEOUT_SECONDS` (bawaan 30) menutup sisanya.
- Satu cetak memegang koneksi database request-nya selama konversi.

## Renderer: Gotenberg di samping runtime

PDF dibuat LibreOffice di dalam [Gotenberg](https://gotenberg.dev/), container terpisah dari runtime. Image runtime tetap `oven/bun` slim; memasang LibreOffice di dalamnya menambah ratusan megabyte ke setiap proses runtime dan worker, dan setiap konversi akan menyalakan LibreOffice dari nol.

| | Terukur |
| --- | --- |
| Image | `gotenberg/gotenberg:8.36.0`, 2,41 GB |
| Memori | 12 MB sebelum konversi pertama, 159 MB sesudah 12 konversi, sekitar 285 MB sesudah 100-an konversi |
| Konversi kuitansi A4 dan etiket | median 317 sampai 372 ms; pertama 13,3 detik tanpa auto-start; sesekali sekitar 1,4 detik saat LibreOffice dinyalakan ulang (`--libreoffice-restart-after`) |
| Isi layout di runtime | median 2,8 ms (etiket) dan 3,5 ms (kuitansi); memori runtime tidak bertambah sesudah 600 kali isi |

- **Satu Gotenberg per host runtime**, tanpa status dan tanpa tenant. Di SaaS dev ia service `ops-renderer` di `deploy/saas-dev/compose.yaml` repo control-plane-metta, dengan `RENDERER_URL` diisi ke ops-app.
- **Tanpa jalan keluar ke internet**, supaya dokumen unggahan tenant tidak dapat memancingnya mengambil sumber dari luar.
- **On-prem** butuh container yang sama di compose server klien. Selama belum ada, cetak di server itu hanya bisa berupa Word.
- **Laptop** memakai container yang sama lewat Docker; `bun scripts/verify.ts up` menyalakannya per run.

## Laporan tabel: kontrak, belum dibangun

Laporan tabel, misalnya daftar penjualan atau kartu stok, memakai field yang sama tanpa `field.lines`: satu baris dataset satu baris laporan. Bedanya dengan dokumen:

- Parameter laporan (periode, lokasi) dinyatakan sebagai schema zod, sumber validasi dan tipe untuk layar pemilihnya.
- Baris dialirkan per halaman, bukan dimuat sekaligus.
- Layout-nya `.xlsx`. Angka dan tanggal masuk sel sebagai nilai asli, supaya bisa dijumlah dan diurutkan.
- Daftar besar berjalan lewat antrean `report_exports` di worker, dengan hak pengguna diperiksa ulang saat job berjalan, masa sewa per baris antrean, dan hasil yang punya masa simpan.

Bagian ini dibangun saat laporan tabel pertama diminta.

## Yang berbeda dari CoreERP

- Baris bersarang (`field.lines` di dalam `field.lines`). CoreERP hanya mengenal tabel datar.
- Baris baru di teks menjadi baris baru di Word. Di CoreERP kop berbaris banyak tercetak sebagai spasi.
- Bahasa per layout dan terbilang. CoreERP menulis mati `id` dan rupiah.
- Cetak dokumen sinkron. CoreERP mengantrekan setiap cetak, termasuk satu kuitansi.
- Tag tak dikenal ditolak saat unggah. CoreERP hanya memperingatkan, lalu mencetaknya kosong.
- Layout unggahan tidak diubah di tempat. CoreERP menimpa berkasnya, sehingga ekspor yang sedang antre ikut berubah.
- Izin mengelola layout per laporan. CoreERP memakai satu izin untuk seluruh tenant.
- Katalog di kode dan diperiksa saat mulai. CoreERP menyalin katalog ke tabel `app_reports`, yang di sini dibiarkan tanpa pembaca.

## Lihat juga

- [Engine analitik](35-analitik.md): pertanyaan "berapa" atas data module, berbeda dari dataset dokumen cetak
- [Number sequence](14-number-sequences.md): layanan Core lain yang dipakai bersama
