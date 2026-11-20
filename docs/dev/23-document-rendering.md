# Dokumen cetak, layout, dan laporan

Setiap dokumen cetak dan laporan tabel di repo ini lahir dari satu mesin di Core, `src/platform/reporting/`: pemilik data mendaftarkan dataset dan layout bawaannya, mesin mengisi layout Word (lalu membuat PDF lewat renderer) atau layout Excel, dan menyajikannya ke satu komponen cetak di layar. Cara menambah laporan ada di skill [`report-engine`](../../.agents/skills/report-engine/SKILL.md). Halaman ini menyimpan alasannya.

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
- On-prem tidak boleh bergantung pada Office 365. Pengguna menyunting `.docx` di Word lokal atau `.xlsx` di Excel lokal lalu mengunggahnya.
- Yang berbeda antarklinik adalah tampilan, bukan data. Dengan dataset yang sama, setiap legal entity boleh mengunggah layout-nya sendiri tanpa developer menulis ulang apa pun.

## Core memegang mesinnya, pemilik data memegang datasetnya

| Lapis               | Padanan BC              | Di repo ini                                                                                                  |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Dataset             | Report dataset          | `defineReport` di folder fitur pemilik data, misalnya `payment-receipt.report.ts` dan `drug-label.report.ts` |
| Katalog laporan     | Report object           | `reportCatalog([...])` di `src/main.ts`, dirakit dari laporan yang di-export Core dan module                 |
| Layout bawaan       | Extension layout        | `layouts` pada definisi laporan: `wordDocument` untuk Word, `ExcelWorkbook` untuk Excel                      |
| Layout unggahan     | User-defined layout     | `report_layouts`, per legal entity, isi berkas di kolom `isi`                                                |
| Layout yang dipakai | Report Layout Selection | `report_layout_defaults`, satu per legal entity dan laporan                                                  |
| Render PDF          | Report rendering        | Gotenberg di `RENDERER_URL`, tanpa status dan tanpa tenant                                                   |
| Identitas cetak     | Company Information     | `print_identities` per legal entity atau unit kerja, Sys Admin › Kop surat                                   |

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

- **Layout bawaan ditulis sebagai kode**, dengan `wordDocument` di `src/platform/reporting/docx.ts` atau `ExcelWorkbook` di `src/platform/reporting/xlsx.ts`, bukan berkas `.docx` atau `.xlsx` biner. Diff-nya terbaca di review, dan tag, nama, serta kolom yang dipakainya diperiksa saat proses mulai. Klinik yang ingin rupa lain mengunduhnya dari Sys Admin › Layout cetak, menyuntingnya di Word atau Excel, lalu mengunggahnya.
- **Format milik layout, bukan milik laporan.** Satu laporan boleh punya layout Word dan layout Excel sekaligus, sama dengan BC. Format unggahan dibaca dari isi berkasnya dan disimpan di kolom `report_layouts.format`, yang sudah ada sejak baseline.
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

Unggahan ditolak bila bukan dokumen Word, berisi makro atau ActiveX, mengambil gambar dari luar dokumen, sintaks tag-nya rusak, atau memakai tag yang tidak dikenal laporannya. Tag tak dikenal ditolak, bukan diperingatkan: di kertas ia tercetak kosong tanpa ada yang tahu. Layout Excel membaca dataset lewat nama dan tabel, bukan tag; aturannya di [Laporan tabel: layout Excel](#laporan-tabel-layout-excel).

## Dokumen yang sudah terdaftar

| Kode                        | Dokumen                               | Padanan BC                                         | Tombol di layar                                                        |
| --------------------------- | ------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `core.payment-receipt`      | Kuitansi pembayaran                   | Posted Sales Invoice                               | Kasir › Pembayaran                                                     |
| `pharmacy.drug-label`       | Etiket obat                           | Tidak ada                                          | Farmasi › kartu penyerahan                                             |
| `core.transfer-order`       | Permintaan barang (amprah)            | Transfer Order (5703)                              | Sys Admin › Persediaan › Amprah                                        |
| `core.transfer-shipment`    | Mutasi barang                         | Transfer Shipment (5704)                           | Sys Admin › Persediaan › Mutasi, dan riwayat posting amprah            |
| `core.transfer-receipt`     | Penerimaan mutasi                     | Transfer Receipt (5705)                            | Sys Admin › Persediaan › Penerimaan mutasi                             |
| `core.purchase-receipt`     | Penerimaan barang                     | Purchase - Receipt (408)                           | Sys Admin › Pembelian › Penerimaan barang                              |
| `core.purchase-return`      | Retur ke vendor                       | Purchase - Return Shipment (6636)                  | Bagian Retur ke vendor di kartu penerimaan                             |
| `core.stock-count-sheet`    | Lembar hitung opname                  | Phys. Inventory List (722)                         | Sys Admin › Persediaan › Opname stok                                   |
| `core.stock-count-result`   | Hasil opname                          | Posted Phys. Invt. Order Diff. (5876)              | Sys Admin › Persediaan › Opname stok                                   |
| `core.inventory-adjustment` | Penyesuaian stok                      | Item Journal dengan Reason Code                    | Sys Admin › Persediaan › Penyesuaian stok                              |
| `core.stock-card`           | Kartu stok satu barang di satu lokasi | Inventory - Transaction Detail (704)               | Sys Admin › Persediaan › Kartu stok, setelah barang dan lokasi dipilih |
| `core.lplpo`                | LPLPO satu lokasi                     | Inventory Valuation (1001), tanpa kolom permintaan | Sys Admin › Persediaan › Stok per lokasi, setelah lokasi dipilih       |
| `core.inventory-value`      | Nilai persediaan satu lokasi (Excel)  | Inventory Valuation (1001) dengan saringan lokasi  | Sys Admin › Persediaan › Stok per lokasi, setelah lokasi dipilih       |

Dokumen persediaan dan pembelian berbagi rupa layout bawaan lewat `inventoryDocument` di `src/foundation/inventory/document-layout.ts`: kop, keterangan dokumen, tabel baris, jumlah, dan kotak tanda tangan. Bentuknya mengikuti dataset BC, bukan form puskesmas lama:

- **Satu baris per batch.** Mutasi, penerimaan, retur, opname, dan penyesuaian terposting mencetak setiap batch beserta kedaluwarsanya, karena serah terima obat diperiksa per batch.
- **Petugas dari posting.** Pengirim, penerima, penghitung, dan petugas penyesuaian adalah pengguna yang memposting. Pihak di luar sistem, misalnya vendor atau penerima di lokasi lain, mendapat garis kosong untuk ditulis tangan.
- **Tanpa jenis dokumen terpisah.** Berita acara serah terima adalah mutasi yang ditandatangani dua pihak. Berita acara pemusnahan adalah penyesuaian beralasan pemusnahan dengan kolom saksi.
- **Penyesuaian terposting dicetak dari kartu gudang.** Batch stok keluar baru dipilih saat posting, jadi baris draf dan baris terposting bisa berbeda.
- **Hitung buta.** Lembar hitung punya layout tanpa stok tercatat, seperti opsi Show Qty. (Calculated) di BC.

## Parameter cetak

Sebagian laporan butuh lebih dari id record, seperti request page BC. Kartu stok mencetak satu barang (record-nya), tetapi hanya untuk satu lokasi dan satu periode. Query cetak selain `format` dan `layout` diteruskan ke `load` sebagai `parameters`, dan `PrintAction` menerimanya sebagai `parameters`. Dataset memeriksa parameternya sendiri dengan aturan yang sama dengan layarnya: isian yang salah dijawab 422 per field, dan lokasi yang hanya untuk petugasnya ditolak `requireLocationAccess`.

Parameter tidak menentukan format. Kartu stok dan LPLPO berlayout Word, karena keduanya dibaca dan ditandatangani di kertas; nilai persediaan berlayout Excel, karena angkanya diolah lagi. Ketiganya memakai `parameters` dengan cara yang sama.

Kontrak lama halaman ini menyebut parameter laporan tabel sebagai schema zod. Itu tidak dibangun: laporan pertama berparameter yang sama dengan LPLPO, dan dua cara untuk satu tugas lebih mahal daripada pemeriksaan tangan di `load`. Parameter tetap `URLSearchParams`, diperiksa dataset sendiri.

### LPLPO

LPLPO (Laporan Pemakaian dan Lembar Permintaan Obat) adalah laporan bulanan puskesmas. Ia kembali sebagai laporan di mesin ini, bukan layar tetap, sesuai `0030_inventory_report_names.sql`. Record-nya lokasi, parameternya periode: tombol LPLPO di Stok per lokasi mencetak dari awal bulan tanggal stok sampai tanggal stok, jadi sisa stoknya sama dengan stok di layar. Izinnya izin baca Stok per lokasi (`core.inventory-report.read`), yang memang lahir sebagai izin LPLPO.

Kolom dan rumusnya dari prosedur `SIMPUS_LPLPO` sistem lama: stok awal, penerimaan, persediaan (stok awal + penerimaan), pemakaian, sisa stok (persediaan - pemakaian), stok optimum, dan permintaan. Stok optimum adalah stok maksimum barang di lokasi itu, yang diatur di kartu barang bagian Stok minimum dan maksimum per lokasi (`gd_m_barang_lokasi.stok_maksimum`, Maximum Inventory pada Stockkeeping Unit BC), dalam satuan dasar seperti kolom lain. Kolomnya kosong bila lokasi itu belum punya stok maksimum untuk barang tersebut; tidak ada isian tangan dan tidak ada rumus lain, sama dengan `Max_Stok` lama yang dibaca dari master. Penerimaan dan pemakaian adalah semua gerak masuk dan keluar di lokasi itu, termasuk mutasi dan penyesuaian, sama dengan `Qty_Masuk` dan `Qty_Keluar` lama. Yang sengaja berbeda:

- Stok awal adalah jumlah kartu gudang sebelum periode. Prosedur lama hanya membaca baris saldo awal (`JTransaksi_ID` 500) di hari pertama periode.
- Barang yang punya stok tanpa gerak tetap tercetak. Prosedur lama hanya memuat barang yang bergerak.
- Permintaan adalah permintaan pembelian lokasi itu yang tanggal permintaannya (`tanggal_permintaan`, Order Date BC) jatuh dalam periode. Permintaan itu diisi Hitung saran di Permintaan pembelian ([41-pembelian.md](41-pembelian.md#hitung-saran)) atau dibuat petugas di layar yang sama, lalu dipesan lewat purchase order. LPLPO hanya merangkum yang sudah terjadi; memesan tidak dilakukan dari cetakan ini. Prosedur lama menjumlah permintaan semua lokasi. Amprah antarlokasi dan saran amprah dari Hitung saran sengaja tidak ikut, sama dengan prosedur lama: lembar permintaan LPLPO ditujukan ke pemasok di luar klinik, misalnya instalasi farmasi kabupaten, bukan ke gudang sendiri.
- Penerimaan dirinci per sumber dana di field `received_by_funding_source` (Penerimaan per sumber dana): satu baris per sumber dana yang tercatat di kartu gudang penerimaan itu, berisi nama dari master Sumber dana legal entity dan jumlahnya. Penerimaan tanpa sumber dana, misalnya penyesuaian, menjadi "Tanpa sumber dana". Jumlah rinciannya sama dengan kolom Penerimaan. Prosedur lama memecahnya ke kolom B_Pusat, B_Prov, APBD, Program, dan Lainnya dari id subkategori yang ditulis mati; di sini tidak ada nama atau id sumber dana di kode.
- Layout bawaan menulis rincian itu dalam satu kolom ("Dana APBD 40, Dana BLUD 25"), bukan satu kolom per sumber dana. Sumber dana berbeda per legal entity, dan layout Word mesin ini hanya bisa mengulang baris tabel, tidak menambah kolom per data. Layout Excel bisa: tabel `received_by_funding_source` membawa kolom barang induknya, jadi pivot dengan sumber dana di kolom memberi satu kolom per sumber dana. Klinik yang membutuhkannya mengunggah layout Excel untuk LPLPO.

BC tidak punya LPLPO. Padanan terdekatnya report "Inventory Valuation" (1001) dengan saringan lokasi: stok awal, bertambah, berkurang, dan stok akhir per barang dalam periode. Kolom permintaan tidak punya padanan di report itu.

### Nilai persediaan

Nilai persediaan (`core.inventory-value`, `src/foundation/inventory/item-ledger/inventory-value.report.ts`) adalah laporan tabel pertama: nilai stok satu lokasi dalam satu periode, satu baris per barang dan sumber dana, diunduh sebagai Excel. Acuannya Excel nilai persediaan sistem lama (`report_helper::export_excel_inventory_value`): kelompok per Program, kolom nama obat, satuan, harga satuan, stok awal, penerimaan, pengeluaran, dan stok akhir, masing-masing dalam jumlah dan rupiah, ditutup baris TOTAL PERSEDIAAN. Record dan parameternya sama dengan LPLPO, ditambah `category_id` opsional (kelompok barang sistem lama, termasuk subkategorinya). Tombolnya di Stok per lokasi, di sebelah LPLPO, membawa saringan kategori layar itu.

Layout bawaannya pivot Excel atas tabel `lines`: sumber dana, kode, nama barang, satuan, dan harga satuan di baris, delapan nilai di kolom, total per sumber dana, dan total akhir berjudul TOTAL PERSEDIAAN. Kop, lokasi, periode, kategori, dan waktu cetak dibaca dari nama `Report.*`. Sheet tabel `lines` ikut tampil, untuk diurutkan dan disaring sendiri.

Yang sengaja berbeda dari sistem lama:

- Rupiah adalah nilai kartu gudang, biaya sebenarnya setiap gerak (FIFO per batch), bukan jumlah dikali satu harga dari master (keputusan pemilik produk, 20 November 2026). Inventory Valuation BC memakai nilai entri yang sama.
- Program lama dipetakan ke sumber dana kartu gudang. Sumber dana ikut baris keluar dari baris masuk yang diambilnya, jadi pengeluaran pun terpecah per sumber dana. Stok tanpa sumber dana menjadi "Tanpa sumber dana", sama dengan LPLPO; nama sumber dana lain datang dari master Sumber dana.
- Harga satuan adalah nilai stok akhir dibagi jumlahnya, kosong bila stok akhirnya nol. Di pivot ia ditaruh di baris, bukan dijumlah, jadi baris berstok nol menampilkan "(blank)".
- Tidak ada kolom No, karena pivot tidak memberi nomor urut.
- Stok awal adalah jumlah kartu gudang sebelum periode, sama dengan LPLPO.

Yang sengaja berbeda dari Inventory Valuation (1001) BC: penerimaan dan pengeluaran dipisah menurut tanda jumlah, sama dengan LPLPO, bukan menurut jenis entri. Pembatalan penerimaan yang diposting dalam periode tercatat sebagai penerimaan dan pengeluaran, bukan saling meniadakan di kolom penerimaan; dua laporan dari kartu gudang yang sama di layar yang sama tetap memberi angka yang sama. Stok akhir selalu sama dengan jumlah kartu gudang sampai tanggal akhir. BC mengelompokkan per inventory posting group; di sini per sumber dana, dengan kategori barang sebagai kolom untuk pivot sendiri.

## Cetak dokumen berjalan sinkron

`GET /api/v1/reports/{code}/records/{id}?format=pdf|docx|xlsx&layout=` menjawab berkasnya langsung. Tanpa `format`, keluarannya mengikuti layout yang dipakai: layout Word menjadi PDF, layout Excel menjadi `.xlsx`. Format yang tidak cocok dengan layout-nya, misalnya PDF dari layout Excel, dijawab 422 per field `format`. Mengisi layout butuh 3 sampai 5 ms, dan konversi PDF median 317 sampai 372 ms setelah LibreOffice hangat (diukur dengan Gotenberg 8.36 di laptop pengembang; tabel di bagian Renderer). Antrean, penyimpanan hasil, dan polling seperti CoreERP tidak sepadan untuk satu dokumen.

- Renderer yang tidak diisi atau tidak menjawab dijawab `503` berkode `renderer_unavailable`. `PrintAction` lalu menawarkan unduh Word, karena berkas Word tetap bisa dibuat tanpa renderer.
- LibreOffice butuh sekitar 13 detik untuk konversi pertamanya. Gotenberg dijalankan dengan `--libreoffice-auto-start`, supaya waktu itu habis saat container mulai, bukan pada klik cetak pertama. `RENDERER_TIMEOUT_SECONDS` (bawaan 30) menutup sisanya.
- Satu cetak memegang koneksi database request-nya selama konversi.

## Renderer: Gotenberg di samping runtime

PDF dibuat LibreOffice di dalam [Gotenberg](https://gotenberg.dev/), container terpisah dari runtime. Image runtime tetap `oven/bun` slim; memasang LibreOffice di dalamnya menambah ratusan megabyte ke setiap proses runtime dan worker, dan setiap konversi akan menyalakan LibreOffice dari nol.

|                                 | Terukur                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image                           | `gotenberg/gotenberg:8.36.0`, 2,41 GB                                                                                                                       |
| Memori                          | 12 MB sebelum konversi pertama, 159 MB sesudah 12 konversi, sekitar 285 MB sesudah 100-an konversi                                                          |
| Konversi kuitansi A4 dan etiket | median 317 sampai 372 ms; pertama 13,3 detik tanpa auto-start; sesekali sekitar 1,4 detik saat LibreOffice dinyalakan ulang (`--libreoffice-restart-after`) |
| Isi layout di runtime           | median 2,8 ms (etiket) dan 3,5 ms (kuitansi); memori runtime tidak bertambah sesudah 600 kali isi                                                           |

- **Satu Gotenberg per host runtime**, tanpa status dan tanpa tenant. Di SaaS dev ia service `ops-renderer` di `deploy/saas-dev/compose.yaml` repo control-plane-metta, dengan `RENDERER_URL` diisi ke ops-app.
- **Tanpa jalan keluar ke internet**, supaya dokumen unggahan tenant tidak dapat memancingnya mengambil sumber dari luar.
- **On-prem** butuh container yang sama di compose server klien. Selama belum ada, cetak di server itu hanya bisa berupa Word.
- **Laptop** memakai container yang sama lewat Docker; `bun scripts/verify.ts up` menyalakannya per run.

## Laporan tabel: layout Excel

Laporan tabel, misalnya nilai persediaan atau daftar penjualan, bukan jenis laporan kedua. Ia laporan biasa (`defineReport`, field, `load`, izin, dan route yang sama) yang layout-nya Excel. Modelnya layout Excel Business Central, seperti layout app Excel Reports di BCApps, misalnya `CustomerTopListExcel.xlsx`. Platform menulis ulang sheet data dan metadata, sheet buatan penulis layout tidak disentuh, dan pivot di-refresh saat berkas dibuka. Semua yang terlihat di laporan, yaitu kolom, pengelompokan, judul, total, dan pivot, milik layout. Legal entity menggantinya dengan mengunggah workbook, tanpa developer.

Kontrak lama halaman ini merencanakan jenis laporan kedua tanpa `field.lines`, dengan baris yang dialirkan. Itu ditinggalkan: dua jenis laporan berarti dua katalog, dua route, dan dua tombol, padahal yang berbeda hanya format layout-nya. Dengan format milik layout, LPLPO, kartu stok, dan kuitansi juga bisa diberi layout Excel tanpa kode.

### Nama dan tabel di workbook

Dataset dilihat layout Excel lewat nama dan tabel Excel, diturunkan dari field yang sama dengan tag Word (`src/platform/reporting/workbook.ts`):

| Di Excel                                                 | Isinya                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `=Report.location_name`                                  | satu field skalar di akar dataset                                                    |
| `=Report.letterhead.name`, `=Report.printed.at`          | bagian yang diisi mesin, dengan kunci yang sama dengan tag Word-nya                  |
| `=Report.total_words`                                    | terbilang uang yang ditandai `words`, dalam bahasa layout                            |
| `=Caption.location_name`, `=Caption.lines.closing_value` | label field, jadi layout tidak perlu menulis ulang judul kolom                       |
| `lines[closing_value]`                                   | tabel Excel bernama kunci `field.lines`-nya, untuk pivot dan rumus                   |
| `received_by_funding_source[item_code]`                  | tabel bersarang membawa kolom baris induknya; kolom sendiri menang bila namanya sama |
| `signers[name]`                                          | penanda tangan dari Sys Admin › Kop surat                                            |

Awalan `Report.` dan `Caption.` meniru `ReportRequest.*` dan `Caption.*` BC. Nama tidak bisa tertukar dengan alamat sel atau nama fungsi Excel, dan mesin tahu nama mana miliknya. Setiap nama menunjuk sel di sheet tersembunyi "Keterangan laporan", yang sekaligus mencatat arti setiap nama dan kolom di dalam berkasnya. Karena legal entity mana pun boleh mengunggah layout Excel untuk laporan mana pun, kunci setiap field di setiap laporan harus sah sebagai nama Excel; kunci seperti `a1` atau `r` menghentikan proses saat mulai.

Nilai masuk sel sebagai nilai asli, supaya bisa dijumlah, diurutkan, dan dipivot. Uang dan harga satuan dibulatkan ke presisi mata uang tenant dan ditulis sebagai angka dari teks desimalnya, dengan format angka sesuai presisi itu. Jumlah barang ditulis apa adanya dengan format General. Tanggal menjadi serial Excel tanpa geser zona, waktu menjadi jam dinding di zona waktu legal entity dokumen, dan ya/tidak menjadi boolean. Teks selalu inline string dan tidak pernah menjadi rumus. Pemisah ribuan dan nama bulan mengikuti setelan Excel pembacanya, jadi bahasa layout Excel hanya menentukan terbilang. Aturan per jenis field ada di `cellOf` (`format.ts`), di sebelah aturan Word, dengan pemeriksaan nilai yang sama.

### Yang ditulis mesin saat mengisi

Workbook layout punya dua penulis, mesin dan penulis layout, dan masing-masing memegang bagian sendiri. Mesin (`fillWorkbook` di `xlsx.ts`) hanya menulis:

- sheet tempat setiap tabel laporan berada: isi sheet dan definisi tabelnya ditulis ulang. Nama sheet, tampil atau tersembunyi, id tabel, id kolom, gaya tabel, dan format kolom dipertahankan, supaya slicer dan rumus tetap menunjuk kolom yang sama. Tabel yang belum ada dibuat di sheet tersembunyi;
- sheet "Keterangan laporan" dan semua nama berawalan `Report.` dan `Caption.`. Nama yang hilang dari dataset ikut terbuang, jadi rumus yang memakainya tampil `#NAME?`, bukan diam-diam membaca sel lain;
- gaya angka mesin, dicari dulu lalu ditambahkan di ujung `styles.xml`, sehingga indeks gaya penulis layout tidak bergeser;
- tanda hitung ulang: `calcChain` dibuang, `fullCalcOnLoad`, dan `refreshOnLoad` pada setiap pivot cache;
- hasil tersimpan setiap rumus dan isi setiap pivot di sheet penulis layout, yang dikosongkan.

Bagian terakhir perlu karena layout yang pernah disimpan Excel membawa hasil dari data contoh, dan dua pembaca menampilkannya apa adanya:

- Excel di Protected View, yang muncul untuk berkas unduhan, tidak menghitung ulang. Layout yang disimpan Excel tampil dengan lokasi dan total pivot dari data contoh; hasil isian mesin tampil kosong sampai Enable Editing, lalu dihitung.
- LibreOffice 26.2 di Gotenberg 8.36 mencetak sel `=Report.location_name` yang masih membawa hasil lama dengan lokasi dari data contoh, walau nama itu sudah menunjuk lokasi baru dan `fullCalcOnLoad` dipasang. Tanpa hasil tersimpan, LibreOffice menghitung rumusnya saat berkas dibuka.

Bagian lain disalin apa adanya. Hasil isian hanya bergantung pada layout tersimpan dan datanya, dan mengisi hasil isian lagi memberi workbook yang sama, tanpa sheet, nama, atau gaya yang menumpuk. Penulisnya pizzip dan XML yang ditulis tangan, tanpa pustaka xlsx: exceljs dan SheetJS membaca workbook lalu menyimpannya ulang, dan cara itu membuang pivot, slicer, dan chart, padahal itulah isi kustomisasi legal entity.

LibreOffice menyimpan sumber pivot sebagai rentang sel (`A1:P5` di sheet tabel), bukan nama tabel. Sumber seperti itu yang persis rentang sebuah tabel laporan dibaca sebagai tabel itu dan dikembalikan ke nama tabelnya saat diisi. Tanpa itu pivot hanya membaca baris sebanyak data contoh saat berkas disimpan.

### Pemeriksaan unggahan dan saat mulai

`inspectWorkbook` menolak workbook dengan alasan bertipe, dan layanan layout menulis teksnya untuk pengguna lewat switch yang lengkap. Yang ditolak:

- bukan workbook `.xlsx` yang terbaca, berisi makro, objek tertanam, atau ActiveX;
- mengambil data dari luar berkas: tautan ke workbook lain, koneksi data, query table, Power Query, atau relasi ke alamat luar selain hyperlink;
- fungsi yang menghubungi luar berkas (`WEBSERVICE`, `IMAGE`, `RTD`, `CALL`, `REGISTER.ID`), karena `fullCalcOnLoad` menjalankannya dengan data laporan setiap kali berkas dibuka;
- sheet tabel laporan yang berisi hal lain, atau tabel laporan dengan Total Row atau kolom tambahan, karena semuanya hilang saat diisi;
- nama `Report.*`, `Caption.*`, atau kolom tabel laporan yang tidak dikenal laporannya, di rumus, nama, format bersyarat, validasi, chart, atau pivot;
- rumus atau pivot yang membaca sheet tabel atau Keterangan laporan lewat alamat sel, karena isinya berubah setiap unduhan;
- nama milik penulis layout yang sama dengan tabel laporan.

Workbook tanpa tabel laporan tetap sah: sheet-nya boleh hanya membaca nama. Pemeriksaan yang sama dijalankan katalog atas setiap layout Excel bawaan saat proses mulai, setelah layout itu ditulis dan diisi data contoh, jadi CI ikut gagal.

### Layout bawaan dan unduhan Sys Admin

Layout Excel bawaan ditulis sebagai data (`ExcelWorkbook`): sheet, sel berisi teks, nama, atau rumus, satu pivot per sheet (baris, nilai, subtotal pada baris terluar, judul total akhir), dan tabel laporan yang sheet-nya tampil. Mesin menulisnya setiap kali dipakai dengan format angka tenant, karena format angka pivot tidak mengikuti sel sumbernya. Pivot bawaan ditulis dengan cache kosong dan `refreshOnLoad`, jadi isinya selalu dibangun aplikasi pembacanya dari tabel laporan.

Unduh layout Excel di Sys Admin › Layout cetak memberi layout yang diisi data contoh laporan dan kop legal entity, supaya pivot dan rumusnya terlihat bekerja saat disunting. Isi sheet tabel dan Keterangan laporan diganti lagi setiap kali laporan diunduh.

### Unduhan langsung, batas 50.000 baris

Unduhan Excel berjalan sinkron di request yang sama dengan cetak dokumen (keputusan pemilik produk, 20 November 2026). Laporan yang tabelnya lebih dari 50.000 baris dijawab 422 berkode `report_too_large` dengan pesan untuk mempersempit periode atau saringannya. Antrean `report_exports` (hak pengguna diperiksa ulang saat job berjalan, masa sewa per baris antrean, hasil yang punya masa simpan) dibangun saat ada laporan yang memang sebesar itu.

PDF dari layout Excel tidak ditawarkan. LibreOffice di renderer memang membangun pivot-nya, tetapi tanpa judul pivot buatan mesin (lihat di bawah), jadi PDF-nya tidak sama dengan yang dilihat pengguna di Excel.

### Membuka hasilnya

Diperiksa dengan Excel desktop 16.0 lewat otomasi COM dan LibreOffice 26.2 di Gotenberg 8.36, termasuk layout yang disimpan ulang oleh Excel dan oleh LibreOffice lalu diisi data lain:

- Excel membuka berkasnya tanpa perbaikan dan me-refresh pivot saat dibuka. Di Protected View rumus dan pivot kosong sampai Enable Editing.
- LibreOffice membangun ulang pivot dari tabel saat berkas dibuka, dengan angka yang sama. Ia mengabaikan judul pivot buatan mesin: total akhir tertulis "Total Result", bukan TOTAL PERSEDIAAN, dan judul baris memakai kunci kolom seperti `funding_source_name`.

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
