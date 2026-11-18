# Pembelian

Halaman ini untuk developer yang mengubah alur pembelian Core di `src/foundation/purchasing/`. Isinya keputusan bentuk dokumen beserta rujukannya di Business Central, supaya perubahan berikutnya tidak menarik alur kembali ke bentuk sistem lama.

## Kenapa mengikuti Business Central, bukan sistem lama

Di sistem puskesmas lama, permintaan, order, dan penerimaan berjalan berurutan dengan aturan yang ditulis mati di controller, dan pemilik produk menerima banyak keluhan tentang alur itu. Pembelian di sini mengikuti dokumen BC: Purchase Order dengan status Open dan Released, penerimaan yang mencatat jumlah diterima pada baris order, dan Requisition Worksheet yang mengubah permintaan menjadi order per vendor.

Pemakaian di data lama menentukan urutannya. Kuta 1 tidak memakai permintaan maupun order sama sekali. Apotek Adapotek memakai keduanya di setiap pembelian:

| Database lama | `BL_trPermintaan` | `BL_trOrder` | `BL_trPenerimaan` |
| ------------- | ----------------: | -----------: | ----------------: |
| Adapotek      |           190.725 |      190.725 |           191.634 |
| Seroja        |                57 |           57 |                42 |
| Penta         |                 8 |            6 |                16 |

Di Adapotek setiap penerimaan merujuk order, 2.982 order diterima lebih dari sekali, dan setiap order berasal dari tepat satu permintaan yang sudah membawa vendor. Termin pembayaran (`Term_Pembayaran`) tidak pernah diisi.

## Purchase order

Tabel `bl_tr_order` dan `bl_tr_order_detail`, nama dari `BL_trOrder` dan `BL_trOrderDetail` sistem lama. Padanannya Purchase Header dan Purchase Line berjenis Order di BC (`python D:\Kerja\bc-tools\bc.py table "Purchase Header"`).

- **Status.** `terbuka` (Open) dan `dirilis` (Released). Rilis dan Buka lagi mengikuti codeunit 415 "Release Purchase Document": order tanpa baris ditolak, dan vendornya harus aktif. Order dirilis tidak bisa diubah atau dihapus sampai dibuka lagi. Rilis dan Buka lagi memakai satu izin, `core.purchase-order.release`, karena di BC keduanya pasangan tombol yang sama.
- **Lokasi di kepala.** BC menaruh Location Code per baris. Di sini lokasi ada di kepala order, sama dengan penerimaan, karena satu penerimaan memposting ke satu lokasi dan pembatasan petugas lokasi (`requireLocationAccess`) berlaku per dokumen.
- **Tanggal diharapkan datang.** Kepala order membawa Expected Receipt Date bawaan. Baris yang tanggalnya kosong mengikuti kepala; baris bisa membawa tanggalnya sendiri.
- **Baris.** Barang, satuan (kosong berarti satuan beli barang), jumlah, harga satuan, diskon, dan PPN. Aturan isiannya `checkPriceLine` di `purchase-line.service.ts`, yang juga dipakai penerimaan. Nilai baris dan total dokumen dihitung satu fungsi, `lineAmount` dan `documentTotals` di `purchase-line.amounts.ts`, yang dipakai server (daftar, kartu, cetak, posting faktur) dan layar sambil mengisi, jadi angka di layar sama dengan angka yang disimpan. Nilai baris dibulatkan per baris ke presisi jumlah mata uang, PPN dokumen dibulatkan sekali, seperti Line Amount BC. `test/foundation/purchasing/purchase-line.amounts.test.ts` membandingkannya dengan rumus SQL sebelumnya untuk setiap presisi 0 sampai 4.
- **Nomor.** Reference `core.purchase-order-number`, satu sequence per legal entity, awalan `PO-`.
- **Cetak.** Laporan `core.purchase-order` lewat mesin cetak Core. Order yang belum dirilis tercetak dengan tanda BELUM DIRILIS.
- **Termin pembayaran.** Order membawa termin dari vendor, seperti Payment Terms Code yang disalin dari kartu vendor di BC, dan boleh diganti selama order terbuka. Rinciannya di [Termin pembayaran](#termin-pembayaran).

## Termin pembayaran

Tabel `termin_pembayaran`, padanan Payment Terms BC (`python D:\Kerja\bc-tools\bc.py table "Payment Terms"`). Layarnya Pembelian › Setup › Termin pembayaran.

Data lama tidak punya master termin. Kolom `Term_Pembayaran` di order dan penerimaan tidak pernah diisi, tetapi penerimaan menyimpan jatuh temponya sendiri (`Tgl_JatuhTempo`):

| Database lama | Penerimaan aktif | Jatuh tempo bukan hari terima | Selisih hari terbanyak |
| ------------- | ---------------: | ----------------------------: | ---------------------- |
| Adapotek      |          187.624 |                       151.526 | 30, 29, 21, 28, 20, 14 |
| Penta         |               15 |                             8 |                        |
| Seroja        |               41 |                             0 |                        |
| Kuta 1        |               99 |                             0 |                        |

- **Isian.** Kode pendek yang diketik pengguna (Code), keterangan (Description), dan jumlah hari sampai jatuh tempo. BC memakai rumus tanggal (Due Date Calculation, misalnya `1M+CM`); di sini cukup jumlah hari, karena data lama hanya mengenal selisih hari. Diskon bayar cepat (Discount Date Calculation, Discount %) tidak ikut, karena tidak ada di data lama.
- **Jatuh tempo** = tanggal faktur vendor + jumlah hari, seperti `"Due Date" := CalcDate(PaymentTerms."Due Date Calculation", "Document Date")` di Purchase Header. Tanpa termin, jatuh tempo sama dengan tanggal faktur vendor.
- **Vendor dan order.** Vendor membawa termin bawaan. Order baru mengambilnya bila termin tidak dikirim, termasuk order dari Buat dokumen di Permintaan pembelian. Memilih vendor lain di layar order mengganti terminnya dengan termin vendor itu.
- **Izin.** Termin dikelola duty `core.vendor.manage`, karena di BC termin dipilih di kartu vendor. Duty lihat vendor dan duty purchase order ikut melihatnya.
- **Hapus.** Ditolak selama termin masih menjadi bawaan vendor atau dipakai purchase order. Kodenya boleh dipakai lagi sesudah dihapus.

## Penerimaan dari purchase order

Penerimaan tetap satu dokumen (`bl_tr_penerimaan`) yang disimpan sebagai draf lalu diposting, dengan atau tanpa order. Ada dua jalan dari order. Terima barang membuat draf, seperti Warehouse Receipt BC dengan Get Source Documents, untuk penerimaan yang butuh sumber dana, program, beberapa batch per baris, atau diperiksa dulu sebelum diposting. Posting dari order menulis dan memposting penerimaan itu sekaligus, seperti Post Receive di Purchase Order BC; rinciannya di [Posting dari purchase order](#posting-dari-purchase-order).

- **Terima barang.** `POST /api/v1/purchasing/orders/{id}/receipts` membuat draf penerimaan untuk order yang dirilis. Setiap baris berisi sisa baris order (Outstanding Quantity) dengan harga, diskon, PPN, dan satuan order, dan merujuk baris ordernya lewat `bl_tr_penerimaan_detail.order_detail_id`. Petugas mengubah jumlah yang benar-benar datang dan menghapus baris yang belum datang.
- **Satu draf per order.** Draf kedua ditolak lewat `refuse` dengan tombol yang membuka draf pertama. Dua draf yang sama-sama berisi sisa penuh hanya akan membuat salah satunya gagal saat posting.
- **Kunci order.** Vendor, lokasi, dan baris penerimaan dari order tidak bisa diganti; baris di luar order ditolak. Barang lain dicatat di penerimaan tanpa order.
- **Posting.** `receiveOnOrder` di `purchase-order.service.ts` berjalan di transaksi posting: kepala order dikunci, jumlah per baris order dijumlahkan dan dibandingkan dengan sisanya, lalu `jumlah_diterima` bertambah. Constraint `jumlah_diterima <= jumlah` menjaga hal yang sama di database. Order yang semua barisnya sudah diterima menjadi `selesai`. Posting ditolak bila ordernya sedang dibuka lagi, dengan tombol yang membuka order itu.
- **Batal posting.** `unreceiveOnOrder` mengurangi `jumlah_diterima`, dan order `selesai` kembali `dirilis`.
- **Mengubah order yang sudah diterima sebagian.** Sesudah Buka lagi, baris yang sudah diterima tidak bisa dihapus, barang dan satuannya tetap, dan jumlahnya tidak boleh kurang dari yang sudah diterima, seperti Quantity terhadap Quantity Received di Purchase Line BC. Order yang tidak akan dikirim penuh ditutup dengan mengurangi jumlahnya sampai sama dengan yang sudah diterima, lalu merilisnya: Rilis langsung menjadikannya `selesai`.
- **Hapus order.** Ditolak bila sebagian sudah diterima, atau bila ada draf penerimaan dari order itu.

## Posting dari purchase order

Purchase Order BC (page 50) membawa Qty. to Receive, Quantity Received, Qty. to Invoice, dan Quantity Invoiced di setiap baris, Vendor Invoice No. di kepala, dan satu tombol Post dengan pilihan Receive, Invoice, atau Receive and Invoice (`ReceiveInvoiceOptionsQst` di codeunit "Posting Selection Management"). Order di sini mendapat jalan yang sama, tanpa menghapus jalan dokumen terpisah: Terima barang dan Ambil baris penerimaan di faktur tetap ada.

- **Layar.** Order Dirilis menampilkan Tanggal posting dan No. faktur vendor di kepala, lalu kolom Diterima sekarang, Difakturkan, dan Difakturkan sekarang di baris. Batch dan Kedaluwarsa tampil bila ada barang yang wajib batch atau kedaluwarsa, sebagai Item Tracking Lines BC dengan satu lot per baris. Order Selesai hanya menampilkan kolom faktur. Tombol Posting membuka pilihan Terima, Faktur, dan Terima dan faktur.
- **Bawaan.** Diterima sekarang = sisa baris order (Outstanding Quantity, `InitQtyToReceive`). Difakturkan sekarang = diterima + diterima sekarang − sudah difakturkan, seperti `MaxQtyToInvoice` di Purchase Line BC; untuk Faktur saja tanpa Diterima sekarang. Nilainya hanya dikirim saat posting, tidak disimpan di order: BC menyimpannya di baris, tetapi di sini order yang dirilis terkunci dan isiannya hanya berarti untuk satu posting.
- **Difakturkan** di baris order dihitung dari `jumlah_difaktur` baris penerimaan diposting yang merujuk baris order itu, bukan kolom baru, supaya hanya posting faktur yang menulis jumlah difakturkan.
- **Posting.** `POST /api/v1/purchasing/orders/{id}/post` (`purchase-order-post.service.ts`) mengunci order dan memeriksa versinya, lalu dalam satu transaksi: Terima membuat penerimaan dari baris yang diisi (`Receipts.receiveOrder`) dan mempostingnya dengan posting penerimaan yang sama; Faktur membagi Difakturkan sekarang ke baris penerimaan order itu yang belum difakturkan, dari penerimaan terlama, lalu membuat dan memposting faktur (`PurchaseInvoices.createAndPost`). Faktur memakai No. faktur vendor, tanggal posting sebagai tanggal faktur vendor, dan termin order. Gagal di salah satu langkah membatalkan semuanya.
- **Penolakan.** Aturan penerimaan dan faktur tidak ditulis ulang. Penerimaan melebihi sisa order ditolak `receiveOnOrder`, batch dan kedaluwarsa oleh mesin posting, faktur melebihi yang diterima oleh posting faktur, nomor faktur vendor kosong atau dobel oleh faktur. Penolakan itu memakai nomor baris penerimaan atau faktur, dan diterjemahkan ke baris dan kolom order di layar.
- **Izin.** Terima butuh `core.purchase-receipt.update` dan `.post`, Faktur butuh `core.purchase-invoice.update` dan `.post`, sama dengan membuat dan memposting dokumennya sendiri.
- **Yang tidak ikut.** Sumber dana, program, dan tahun anggaran per baris, serta beberapa batch untuk satu baris order. Untuk itu pakai Terima barang.

## Permintaan pembelian

Tabel `bl_tr_permintaan`, nama dari `BL_trPermintaan` sistem lama. Bentuknya Requisition Line di Requisition Worksheet BC (`python D:\Kerja\bc-tools\bc.py table "Requisition Line"`), bukan dokumen permintaan dengan kepala dan detail seperti sistem lama.

- **Kenapa baris, bukan dokumen.** Di Adapotek setiap order berasal dari tepat satu permintaan (190.725 dan 190.725), dan permintaan sudah membawa vendor, jadi kepala permintaan hanya menyalin kepala order. Lembar kerja baris membiarkan permintaan beberapa lokasi untuk satu vendor dipesan bersama, dan kelak menerima baris saran dari titik pesan ulang (Calculate Plan) di tempat yang sama.
- **Dua peran.** Lokasi mengajukan barang, satuan, jumlah, tanggal permintaan (Order Date), tanggal dibutuhkan (Due Date), dan keterangan; pengaju dicatat di `diminta_oleh_user_id` (Requester ID). Petugas pembelian mengisi vendor (Vendor No.), harga (Direct Unit Cost), dan Disetujui (Accept Action Message). Duty `core.purchase-requisition.request` hanya mengajukan; vendor, harga, dan persetujuan butuh izin `core.purchase-requisition.process` dari duty `core.purchase-requisition.manage`.
- **Buat dokumen.** `POST /api/v1/purchasing/requisitions/carry-out` memproses semua baris disetujui di lokasi yang boleh dilihat pengguna, seperti Carry Out Action Message (report 493, codeunit "Req. Wksh.-Make Order"), yang membuat purchase order dan, untuk baris ber-Replenishment System Transfer, transfer order dari lembar kerja yang sama. Baris pembelian menjadi satu order terbuka per vendor dan lokasi. BC mengelompokkan per vendor dan menaruh lokasi di baris; di sini lokasi ada di kepala order, jadi lokasi ikut kunci kelompok. Tanggal diharapkan baris order adalah tanggal dibutuhkan, dan kepala order memakai yang paling awal. Order dibuat lewat `insertOrder` di `purchase-order.service.ts`, fungsi yang sama dengan layar order. Baris amprah menjadi satu draf amprah per lokasi asal dan lokasi peminta, sama dengan `InsertTransLine` di codeunit "Carry Out Action" yang membuat kepala baru setiap Transfer-from Code atau lokasi berubah. Amprah dibuat lewat `insertTransferOrder` di `transfer-order.service.ts`, fungsi yang sama dengan layar Amprah, dengan tanggal order sebagai tanggal amprah. Baris pembelian butuh izin `core.purchase-order.update`, baris amprah butuh `core.inventory-transfer.update`.
- **Tanggal permintaan.** Kolom `tanggal_permintaan`, Order Date di Requisition Line BC: hari permintaan diajukan, berbeda dari tanggal dibutuhkan. Bawaannya hari ini di zona waktu legal entity bila tidak diisi, dan bisa diubah selama permintaan belum dipesan. Kolom permintaan LPLPO sebulan menjumlah permintaan dengan tanggal permintaan di bulan itu. Baris yang lahir sebelum kolom ini ada diisi migration `0082_requisition_request_date.sql` dari `created_at` di zona waktu legal entity.
- **Harga.** Harga kosong diisi harga penerimaan terakhir yang diposting untuk barang dan satuan itu, atau 0 bila belum pernah diterima. Order lahir terbuka, jadi harga masih bisa diubah sebelum dirilis.
- **Permintaan amprah.** Baris dengan `lokasi_pemasok_id` terisi (Transfer-from Code di Requisition Line) diminta dari lokasi lain, bukan dibeli. Baris ini hanya lahir dari Hitung saran. Vendor dan harga ditolak, sama dengan `SetReplenishmentSystemFromTransfer` di BC yang mengosongkan Vendor No. Permintaan amprah yang diketik orang dibuat langsung di layar Amprah.
- **Sesudah diproses.** Baris merujuk baris ordernya (`order_detail_id`) atau baris amprahnya (`amprahan_detail_id`), `diproses_pada` terisi, dan baris tidak bisa diubah atau dihapus lagi. BC menghapus barisnya; di sini baris tetap ada karena tidak ada penghapusan fisik, dan tampil di Lihat yang sudah dipesan.

## Saran pesan ulang

Barang yang stoknya menipis disarankan untuk dipesan, pola Calculate Plan di Requisition Worksheet BC (report 699 "Calculate Plan - Req. Wksh."), dengan logika titik pesan ulang dari codeunit "Inventory Profile Offsetting". Perhitungan kebutuhan (MRP) dari permintaan penjualan dan forecast tidak ikut.

Sistem lama sudah menyimpan batas stok per lokasi di `mBarangLokasiNew` (`Min_Stok`, `Max_Stok`, `QtyReOrder`), dan prosedur `BuatkanOrderanAutomatis` membuat amprahan untuk barang fast moving yang stoknya di bawah `Min_Stok`. Pemakaiannya kecil:

| Database lama | Baris `mBarangLokasiNew` | Dengan `Min_Stok` dan `Max_Stok` | Dengan `QtyReOrder` |
| ------------- | -----------------------: | -------------------------------: | ------------------: |
| Adapotek      |                   40.790 |                              985 |              25.960 |
| Kuta 1        |                    8.224 |                                0 |               1.328 |
| Seroja        |                      835 |                                0 |                  67 |

Angka di sana diisi prosedur, bukan diketik orang: `HitungStokMinimum_*` menerima jumlah hari stok minimum, maksimum, dan ROP, dan `GetDataReOrder` menghitung jumlah pesan dari rata-rata pemakaian tiga bulan berbobot. Rumus itu tidak dipindah. Di BC titik pesan ulang dan jumlah pesan adalah isian di kartu, dan perhitungannya hanya membaca isian itu.

### Setelan per barang dan lokasi

Setelan ada di tabel `gd_m_barang_lokasi`, bagian Stok minimum dan maksimum di kartu barang. Padanannya Stockkeeping Unit BC (`python D:\Kerja\bc-tools\bc.py table "Stockkeeping Unit"`). Semua angka dalam satuan dasar barang.

- **Stok minimum** adalah Reorder Point. Saran dibuat bila stok tersedia sampai di angka ini atau di bawahnya. Kolomnya tetap `stok_minimum`, karena artinya sama dengan `Min_Stok` sistem lama.
- **Stok maksimum** adalah Maximum Inventory.
- **Cara pesan ulang** (`kebijakan_pesan_ulang`) adalah Reordering Policy. Kosong berarti barang itu tidak dihitung di lokasi itu. `jumlah_tetap` adalah Fixed Reorder Qty. dan butuh jumlah pesan ulang. `maksimum` adalah Maximum Qty. dan butuh stok maksimum di atas stok minimum, seperti `CalcMaximumReorderQty` di BC. Lot-for-Lot dan Order tidak ikut, karena keduanya menutup permintaan, bukan menjaga stok.
- **Jumlah pesan ulang** (`jumlah_pesan_ulang`) adalah Reorder Quantity.
- **Cara pengadaan** (`cara_pengadaan`) adalah Replenishment System, dan **Amprah dari** (`lokasi_pemasok_id`) adalah Transfer-from Code. `beli` (bawaan) disarankan dipesan ke vendor. `amprah` disarankan diminta dari lokasi asal, misalnya pusling atau farmasi yang diisi gudang puskesmas. Lokasi asal harus lokasi biasa lain di legal entity yang sama, dan rantai amprah barang itu tidak boleh kembali ke lokasi ini, supaya Hitung saran punya urutan. Prod. Order dan Assembly tidak ikut karena tidak ada produksi.
- **Izin.** Setelan ini tetap memakai izin ubah kartu barang (`core.inventory-item.update`), bukan izin pembelian. Satu baris setelan memegang stok minimum, maksimum, dan cara pesannya sekaligus, dan memecahnya ke dua duty membuat satu kartu disimpan dengan dua izin. Di BC kartu Stockkeeping Unit juga bagian persediaan.
- **Yang belum ada.** Safety Stock Quantity, Minimum dan Maximum Order Quantity, Order Multiple, dan lead time. Setiap angka itu menambah aturan perhitungan BC, dan tidak ada di data lama.

### Hitung saran

Tombol Hitung saran di Permintaan pembelian memanggil `POST /api/v1/purchasing/requisitions/calculate-plan`, yang dijalankan `calculatePlan` di `requisition-plan.ts`. Ia butuh izin `core.purchase-requisition.process`, sama dengan Buat dokumen, karena saran mengisi vendor.

- **Yang dihitung.** Setiap barang dan lokasi yang punya cara pesan ulang, di lokasi yang boleh dilihat pengguna (`allowedLocationsSql`). Barang yang diblokir dilewati, seperti `Blocked = false` di report 699.
- **Stok yang akan tersedia.** Kartu gudang di lokasi itu, ditambah sisa baris purchase order terbuka dan dirilis untuk lokasi itu (Outstanding Quantity), ditambah permintaan yang belum dipesan selain saran yang akan ditulis ulang, ditambah dan dikurangi amprah yang belum selesai. Semua dalam satuan dasar.
- **Amprah.** Amprah draf dan diajukan dihitung seperti Transfer Line di codeunit "Inventory Profile Offsetting" (`TransRcptTransLineToProfile` dan `TransShptTransLineToProfile`). Jumlah yang belum diterima lokasi peminta, termasuk yang sudah dikirim dan masih di lokasi transit, menambah stok peminta. Jumlah yang belum dikirim lokasi pemasok mengurangi stok pemasok. Mengirim ke transit lalu menerima tidak mengubah saran, karena barang hanya pindah dari amprah ke kartu gudang. Amprah selesai atau dibatalkan tidak dihitung, jadi jumlah yang tidak pernah dikirim berhenti mengurangi stok pemasok begitu amprahnya ditutup. Draf ikut dihitung seperti purchase order terbuka, sama dengan BC yang tidak menyaring status Transfer Order. Permintaan amprah yang belum diproses selain saran yang akan ditulis ulang juga menambah stok lokasi peminta dan mengurangi stok lokasi asal, seperti `TransTransReqLineToProfile` yang membaca Requisition Line ber-Replenishment System Transfer.
- **Saran amprah.** Barang yang cara pengadaannya amprah mendapat saran dengan lokasi asal dan tanpa vendor. Jumlahnya dihitung sama dengan saran pembelian, dalam satuan dasar barang, sama dengan `UpdateUnitOfMeasureCodeFromItemBaseUnitOfMeasure` untuk Transfer di BC.
- **Urutan lokasi.** Lokasi yang mengamprah dihitung sebelum lokasi asalnya, dan jumlah saran amprahnya menjadi kebutuhan lokasi asal di hitungan yang sama. Pusling di bawah stok minimum mendapat saran amprah dari gudang, lalu stok gudang yang akan tersedia dikurangi jumlah itu, dan gudang yang turun sampai stok minimumnya mendapat saran pembelian. Padanannya Transfer-Level Code di Stockkeeping Unit: `PlanItem` di codeunit "Inventory Profile Offsetting" mengurutkan SKU menurut kode itu, dan lokasi peminta selalu satu tingkat di bawah lokasi asalnya (`UpdateTempSKUTransferLevels`).
- **Jumlah.** `reorderQuantity` mengikuti `CalcOrderQty` di codeunit "Inventory Profile Offsetting". Saran dibuat bila stok yang akan tersedia sama dengan atau di bawah stok minimum. Jumlah tetap memesan jumlah pesan ulang, dikalikan sampai hasilnya melewati stok minimum. Sampai stok maksimum memesan selisihnya dengan stok maksimum.
- **Satuan.** Satuan beli barang bila jumlahnya habis dibagi isi satuan beli, kalau tidak satuan dasar. BC memakai satuan beli dan membulatkan jumlahnya; di sini jumlah barang tidak pernah dibulatkan.
- **Vendor dan harga.** Vendor dari penerimaan terakhir yang diposting untuk barang itu, bila vendornya aktif. Harga dibiarkan kosong, jadi Buat dokumen mengisinya dengan harga penerimaan terakhir seperti permintaan biasa.
- **Tanggal permintaan.** Saran yang ditulis atau ditulis ulang mendapat tanggal permintaan hari Hitung saran dijalankan, di zona waktu legal entity. Tanggal dibutuhkan tetap dari isian di dialog Hitung saran.
- **Tanda saran.** Kolom `saran`: `baru` untuk saran yang belum disentuh orang, `diubah` sesudah orang mengubah atau menyetujuinya. Layar menampilkan status Saran, dan keterangan baris menyebut stok yang akan tersedia dan stok minimum yang dipakai.
- **Diulang.** Saran `baru` ditulis ulang di tempat dan yang tidak lagi dibutuhkan dihapus, jadi menjalankannya dua kali berakhir di keadaan yang sama. Index unik menjaga satu saran `baru` per barang dan lokasi, dan advisory lock per legal entity menahan dua hitungan yang berjalan bersamaan. Permintaan orang dan saran `diubah` tidak disentuh dan dihitung sebagai stok yang akan datang. BC menghapus semua baris barang itu di lembar kerja; di sini lembar kerja dipakai bersama lokasi yang mengajukan, jadi baris orang dipertahankan.
- **Sesudahnya.** Saran disetujui lalu Buat dokumen, sama dengan permintaan lain.

## Faktur pembelian

Tabel `ap_tr_faktur` dan `ap_tr_faktur_detail`, nama dari `AP_trFaktur` dan `AP_trFakturDetail` sistem lama. Padanannya Purchase Header berjenis Invoice dengan baris dari Get Receipt Lines (codeunit 74 "Purch.-Get Receipt"), lalu Posted Purchase Invoice. Layarnya Pembelian › Faktur pembelian.

Di sistem lama tagihan vendor tidak punya dokumen sendiri. Tabel `AP_trFaktur` ada tetapi kosong di setiap database, dan tagihan dicatat di penerimaan itu sendiri:

| Database lama | Penerimaan aktif | Kredit (`Type_Pembayaran` 1) | Jatuh tempo bukan hari terima | Ditandai lunas (`StatusBayar`) | Ongkos angkut | Potongan |
| ------------- | ---------------: | ---------------------------: | ----------------------------: | -----------------------------: | ------------: | -------: |
| Adapotek      |          187.624 |                      155.034 |                       151.526 |                        181.382 |        10.317 |   11.294 |
| Penta         |               15 |                           15 |                             8 |                kolom tidak ada |             0 |        0 |
| Seroja        |               41 |                           41 |                             0 |                kolom tidak ada |             0 |        0 |
| Kuta 1        |               99 |                           99 |                             0 |                kolom tidak ada |             0 |        0 |

Hanya Adapotek yang benar-benar mencatat utang. Pembayarannya satu tanda lunas per penerimaan beserta tanggal, cara bayar (Tunai atau Transfer), dan bank, tanpa bayar sebagian. Nomor dokumen vendor (`No_DO`) diisi di setiap penerimaan, tetapi 16.236 penerimaan berbagi nomor isian seperti `-`, `00`, atau `.`, jadi nomor itu tidak bisa dijadikan kunci unik untuk data lama.

- **Kenapa dokumen sendiri, bukan kolom di penerimaan.** Satu faktur vendor sering menagih beberapa pengiriman, dan satu pengiriman bisa ditagih sebagian. BC memisahkan keduanya: penerimaan mencatat barang, faktur mencatat tagihan, dan baris penerimaan menyimpan jumlah yang sudah difakturkan.
- **Ambil baris penerimaan.** `GET /api/v1/purchasing/invoice-receipt-lines?vendor_id=` mengembalikan baris penerimaan diposting milik vendor itu yang sisanya belum difakturkan (`Qty. Rcd. Not Invoiced <> 0`), di lokasi yang boleh dilihat pengguna. Jumlah yang sudah ada di draf faktur lain ikut dikurangkan, supaya dua draf tidak menagih barang yang sama.
- **Jumlah difakturkan.** Kolom `bl_tr_penerimaan_detail.jumlah_difaktur` adalah Quantity Invoiced di Purch. Rcpt. Line, dalam satuan baris penerimaan. Ia hanya ditulis posting dan batal posting faktur, dan constraint `jumlah_difaktur <= jumlah` menjaga faktur tidak pernah melebihi yang diterima. Baris faktur boleh menagih sebagian. Barang yang diretur sebelum ditagih cukup tidak ikut difakturkan, karena belum ada credit memo.
- **Harga.** Baris barang membawa harga, diskon, dan PPN penerimaan, dan boleh diubah mengikuti faktur vendor. Kolom Selisih dari penerimaan menunjukkan selisih nilai baris dengan nilai jumlah yang sama pada harga penerimaan. Selisih itu tidak mengubah harga di kartu gudang; di BC ia menjadi penyesuaian biaya barang (Value Entry), yang menunggu perhitungan biaya persediaan.
- **Biaya lain.** Baris biaya berisi keterangan dan nilai, misalnya ongkos angkut, seperti baris G/L Account di BC dan `Ongkos_Angkut` sistem lama. Nilainya 0 atau lebih. `Potongan` sistem lama (diskon per faktur) tidak dipindah; diskon dicatat per baris.
- **Nomor faktur vendor** (Vendor Invoice No.) wajib dan unik per vendor di antara faktur yang belum dihapus dan belum dibatalkan, tanpa membedakan huruf besar, seperti `CheckExternalDocumentNumber` di codeunit 90 "Purch.-Post". BC tetap menolak nomor dari faktur yang sudah dibatalkan; di sini nomornya lepas supaya tagihan yang sama bisa dicatat ulang dengan benar.
- **Jatuh tempo** dihitung dari tanggal faktur vendor dan termin (bagian [Termin pembayaran](#termin-pembayaran)), boleh diubah, dan tidak boleh sebelum tanggal faktur vendor. Termin bawaan diambil dari vendor.
- **Posting.** Vendor harus aktif, faktur punya sedikitnya satu baris, dan setiap baris barang masih punya sisa belum difakturkan di penerimaan yang diposting milik vendor yang sama. Baris penerimaan dikunci (`for update`), `jumlah_difaktur` bertambah, lalu satu entri utang ditulis. Posting yang diulang tidak menulis apa pun.
- **Batal posting** mengikuti Cancel pada Posted Purchase Invoice (codeunit "Correct Posted Purch. Invoice"): ditolak bila utangnya sudah dibayar sebagian atau lunas (`TestIfInvoiceIsPaid`), dengan tombol yang membuka pembayaran terakhirnya. Sesudah pembayarannya dibatalkan, faktur bisa dibatalkan lagi. Entri pembatalan bernilai negatif menutup entri fakturnya, dan `jumlah_difaktur` berkurang lagi. BC membuat credit memo; di sini belum ada credit memo, jadi pembatalannya entri pada ledger yang sama.
- **Penerimaan yang sudah difakturkan** tidak bisa dibatalkan postingnya, seperti Undo Receipt BC ("This receipt has already been invoiced"). Penolakannya membawa tombol yang membuka faktur itu.
- **Izin.** `core.purchase-invoice.read`, `.update`, `.post`, dan `.reverse`, pola yang sama dengan penerimaan barang: duty `core.purchase-invoice.inquire` hanya melihat, duty `core.purchase-invoice.manage` membuat, memposting, dan membatalkan posting.
- **Nomor.** Reference `core.purchase-invoice-number`, satu sequence per legal entity, awalan `PI-`.

## Utang vendor

Tabel `ap_tr_entri_utang`, padanan Vendor Ledger Entry (`python D:\Kerja\bc-tools\bc.py table "Vendor Ledger Entry"`). Layarnya Pembelian › Utang vendor.

- **Isi.** Satu entri `faktur` per faktur yang diposting: tanggal posting, nomor faktur, nomor faktur vendor, jatuh tempo, jumlah termasuk PPN, dan sisa. Entri `pembatalan` ditulis saat posting faktur dibatalkan. Satu entri `pembayaran` per pembayaran ke vendor yang diposting, bernilai negatif, dan entri `pembatalan_pembayaran` saat postingnya dibatalkan. Entri `nota_kredit` per nota kredit yang diposting, bernilai negatif dengan sisa kredit yang belum dipakai, dan `pembatalan_nota_kredit` saat postingnya dibatalkan. Entri hanya ditambah; yang berubah hanya sisa dan tanda tutupnya (`ditutup_oleh_entri_id`, `ditutup_pada`, seperti Closed by Entry No. dan Closed at Date).
- **Sisa disimpan, bukan dihitung.** BC menyimpan Remaining Amount sebagai FlowField dari Detailed Vendor Ledg. Entry. Di sini sisa disimpan di entri faktur, dan baris pembayaran yang diposting (`ap_tr_pembayaran_detail`) menjadi catatan penerapannya: berapa yang dibayar ke entri mana. Batal posting pembayaran mengembalikan jumlah baris itu ke sisa.
- **Layar** menampilkan entri yang masih terbuka, dari jatuh tempo paling awal, dengan keterangan berapa hari lewat atau tersisa sampai jatuh tempo, jumlah yang sudah dibayar beserta nomor pembayarannya, total sisa, dan total yang lewat jatuh tempo. Entri yang sudah ditutup, termasuk entri pembayaran, bisa ditampilkan; faktur yang ditutup pembayaran berlabel Lunas. Baris faktur membuka fakturnya dan, lewat menu baris, setiap pembayarannya. Baris pembayaran membuka pembayarannya.
- **Izin** sama dengan lihat faktur pembelian.

## Pembayaran ke vendor

Tabel `ap_tr_pembayaran` dan `ap_tr_pembayaran_detail`. Padanannya Payment Journal BC yang diterapkan ke Vendor Ledger Entry lewat Apply Entries dan Applies-to ID, lalu Unapply Entries dan Reverse Transaction untuk membatalkannya (codeunit 227 "VendEntry-Apply Posted Entries"). Layarnya Pembelian › Pembayaran ke vendor. Di BC baris jurnal pembayaran hilang sesudah diposting. Di sini pembayaran disimpan sebagai dokumen bernomor, karena sistem lama mencatat siapa membayar apa dan kapan, petugas butuh bukti pembayaran untuk diserahkan, dan batal posting butuh catatan baris yang diterapkannya.

Data lama hanya ada di Adapotek: 181.382 penerimaan ditandai lunas, masing-masing dengan tanggal, cara bayar (`Tunai` 110.547, `Transfer` 70.811), dan bank berupa teks bebas (`Mandiri`, `BCA`, atau kosong). Satu tanda lunas membayar satu penerimaan utuh, tanpa bayar sebagian.

- **Isian.** Vendor, tanggal bayar (Posting Date), cara bayar (Payment Method Code), rekening bank, nomor referensi (External Document No., misalnya nomor bukti transfer), dan keterangan.
- **Cara bayar** memakai jenis bayar kasir (`jenis_bayar`), padanan Payment Method BC yang juga dipakai penjualan dan pembelian. Hanya jenis bayar yang uangnya sudah di tangan klinik yang bisa dipilih, yaitu perilaku `tunai` dan `non_tunai` (`behaviorsSettledAs('received')`). Penjamin, piutang, dan beban tidak dipakai membayar vendor.
- **Rekening bank** dipilih dari master [Rekening bank](#rekening-bank), seperti Bal. Account Type Bank Account di baris Payment Journal. Isian itu hanya tampil untuk cara bayar non tunai, karena uang tunai tidak keluar dari rekening. Draf boleh disimpan tanpa rekening, tetapi posting pembayaran non tunai menuntutnya: tanpa lawan, baris jurnal BC tidak seimbang dan ditolak codeunit "Gen. Jnl.-Check Line". Rekening yang diblokir atau bermata uang asing ditolak saat simpan dan saat posting, seperti `PostBankAcc` di codeunit "Gen. Jnl.-Post Line". Kolom teks `bank` tetap ada untuk pembayaran yang dicatat sebelum master rekening ada, dan tampil di kartu sebagai Bank. Merchan kasir adalah bank atau mesin EDC penerima kartu dengan biaya kartu, bukan rekening asal uang.
- **Ambil utang terbuka.** `GET /api/v1/purchasing/vendor-payment-entries?vendor_id=` mengembalikan entri faktur vendor itu yang sisanya lebih dari 0 dan nota kredit yang kreditnya belum habis (lihat [Nota kredit pembelian](#nota-kredit-pembelian)), dari jatuh tempo paling awal. Jumlah yang sudah ada di draf pembayaran lain dikurangkan, seperti Applies-to ID yang hanya dipegang satu baris jurnal. Jumlah bayar bawaannya sisa itu dan boleh dikurangi untuk bayar sebagian. BC membolehkannya lewat Amount to Apply, walau data lama tidak pernah memakainya.
- **Posting.** Vendor harus aktif, karena BC menolak vendor yang diblokir untuk pembayaran. Pembayaran punya sedikitnya satu baris. Setiap baris membayar entri faktur vendor yang sama, dengan jumlah tidak melebihi sisanya. Tanggal bayar tidak boleh sebelum tanggal posting faktur yang dibayar (`MustNotBeBeforeErr`). Entri faktur dikunci, satu entri `pembayaran` sebesar minus total ditulis, sisa entri faktur berkurang, dan entri yang sisanya 0 ditutup oleh entri pembayaran itu. Posting yang diulang tidak menulis apa pun.
- **Batal posting** mengikuti Unapply lalu Reverse. Sisa entri faktur bertambah lagi sebesar baris pembayaran dan entrinya terbuka lagi, lalu entri `pembatalan_pembayaran` menutup entri pembayarannya. Batal posting ditolak bila faktur yang dibayarnya sudah dibayar lagi oleh pembayaran yang diposting sesudahnya (`UnapplyAllPostedAfterThisEntryErr`). Penolakannya membawa tombol yang membuka pembayaran sesudahnya itu.
- **Cetak.** Laporan `core.vendor-payment` (Bukti pembayaran ke vendor) lewat mesin cetak Core: faktur yang dibayar, jumlahnya, terbilang, dan tanda tangan petugas dan vendor. Draf tercetak dengan tanda BELUM DIPOSTING.
- **Izin.** `core.vendor-payment.read`, `.update`, `.post`, dan `.reverse`, pola yang sama dengan faktur pembelian. Duty `core.vendor-payment.inquire` hanya melihat. Duty `core.vendor-payment.manage` membuat, memposting, dan membatalkan posting. Keduanya ikut melihat vendor, faktur pembelian, dan utang vendor.
- **Nomor.** Reference `core.vendor-payment-number`, satu sequence per legal entity, awalan `PV-`.

## Nota kredit pembelian

Tabel `ap_tr_nota_kredit` dan `ap_tr_nota_kredit_detail`, padanan Purchase Credit Memo BC (Purchase Header berjenis Credit Memo, lalu Purch. Cr. Memo Hdr. sesudah posting). Kodenya di `src/foundation/purchasing/purchase-credit-memo/`, layarnya Sys Admin › Pembelian › Nota kredit pembelian.

Sistem lama tidak punya nota kredit vendor. Di BO PIP tidak ada faktur bernilai negatif di `AP_trFaktur` (4.310 faktur), dan tidak ada voucher yang merujuk retur (`AP_trVoucher.No_Retur` kosong di 2.922 voucher); `BL_trRetur` hanya satu baris. Adapotek mencatat 2.579 retur penerimaan (`BL_trReturPenerimaan`, 188 di antaranya batal) tanpa dokumen yang mengurangi utang.

- **Isian.** Vendor, nomor nota kredit vendor (Vendor Cr. Memo No., wajib), tanggal nota vendor (Document Date), tanggal posting, Kurangi utang faktur (Applies-to Doc. No., opsional), dan keterangan. Nomor nota vendor unik per vendor di antara nota yang belum dihapus, dijaga indeks parsial `ap_tr_nota_kredit_no_nota_vendor_unique`. Berbeda dengan faktur, nota yang postingnya dibatalkan tetap memegang nomornya, seperti entri vendor BC yang tetap ada sesudah Cancel.
- **Ambil baris retur** (Get Return Shipment Lines, codeunit 6648 "Purch.-Get Return Shipments") menawarkan baris retur ke vendor yang diposting dan belum selesai dikreditkan, di lokasi penerimaan yang boleh dilihat pengguna. Harga, diskon, dan PPN bawaannya dari baris penerimaan, dihitung ke satuan baris retur, dan boleh diubah mengikuti nota vendor.
- **Potongan harga** adalah baris tanpa barang yang kembali, merujuk baris faktur yang diposting milik vendor yang sama, dengan alasan wajib. Jumlahnya tidak boleh melebihi jumlah di baris faktur.
- **Jumlah dikreditkan** di baris retur (`bl_tr_retur_detail.jumlah_dikredit`, padanan Quantity Invoiced di Return Shipment Line) bertambah saat posting dan berkurang saat batal posting. Constraint `bl_tr_retur_detail_jumlah_dikredit_check` menjaganya antara 0 dan jumlah yang diretur. Retur yang sudah dikreditkan tidak bisa dibatalkan, seperti Undo Return Shipment BC yang hanya untuk baris yang belum di-invoice; penolakannya membawa tombol yang membuka nota kreditnya.
- **Posting.** Vendor aktif, sedikitnya satu baris, dan total lebih dari 0. Entri `nota_kredit` ditulis di `ap_tr_entri_utang` dengan jumlah dan sisa negatif sebesar total termasuk PPN, jatuh temponya tanggal nota vendor. Bila Kurangi utang faktur diisi, entri faktur itu dikunci dan dikurangi sebesar yang lebih kecil dari total nota dan sisa faktur; entri yang sisanya habis ditutup. Tanggal posting tidak boleh sebelum tanggal posting faktur itu.
- **Kredit terbuka di pembayaran.** Ambil utang terbuka di Pembayaran ke vendor juga menawarkan nota kredit yang sisanya belum habis. Barisnya bernilai negatif (Amount to Apply BC), jadi jumlah yang diketik dicatat dengan tanda entri yang dipakainya. Total pembayaran sesudah dikurangi kredit harus lebih dari 0.
- **Batal posting** mengikuti Cancel pada Posted Purchase Credit Memo (codeunit "Cancel Posted Purch. Cr. Memo"): hanya selama kreditnya belum dipakai sama sekali (`UnappliedErr`). Jumlah dikreditkan di baris retur berkurang lagi, lalu entri `pembatalan_nota_kredit` menutup entri kreditnya. Kredit yang dipakai pembayaran bisa dibatalkan sesudah pembayarannya dibatalkan; penolakannya membawa tombol yang membuka pembayaran itu. Kredit yang langsung mengurangi faktur lewat Kurangi utang faktur tidak bisa dibatalkan, karena Unapply belum ada.
- **Faktur yang sudah dikurangi nota kredit** tidak bisa dibatalkan postingnya, seperti faktur yang sudah dibayar (TestIfInvoiceIsPaid). Penolakannya membawa tombol yang membuka nota kreditnya.
- **Izin.** `core.purchase-credit-memo.read`, `.update`, `.post`, dan `.reverse`, pola faktur pembelian. Duty `core.purchase-credit-memo.inquire` hanya melihat, `core.purchase-credit-memo.manage` membuat, memposting, dan membatalkan posting. Duty pembayaran ke vendor ikut melihat nota kredit.
- **Nomor.** Reference `core.purchase-credit-memo-number`, satu sequence per legal entity, awalan `PCM-`.

## Rekening bank

Tabel `rekening_bank`, padanan Bank Account BC (`python D:\Kerja\bc-tools\bc.py table "Bank Account"`). Kodenya di `src/foundation/bank/bank-account/`, karena di BC rekening bank ada di folder Bank, bukan Purchases, dan dipakai penjualan maupun pembelian. Layarnya Sys Admin › Bank › Rekening bank.

Sistem lama tidak punya master rekening. `SIMmClaimBank` kosong di Adapotek, Seroja, Penta, dan Kuta 1, dan bank pembayaran ke vendor dicatat sebagai teks di `BL_trPenerimaan.Bank` (Adapotek 56.949 penerimaan, dua nilai: Mandiri dan BCA). Teks itu tidak dipindah ke master.

- **Isian.** Kode pendek yang diketik pengguna (No.), nama (Name), nama bank, nomor rekening (Bank Account No.), mata uang (Currency Code, kosong berarti mata uang lokal), dan Diblokir (Blocked). Nama bank tidak ada di BC; di sana nama bank biasanya ikut Name. Mata uang dipilih dari mata uang asing yang sudah disetel di Sys Admin › Mata uang, sama dengan jenis bayar.
- **Diblokir.** Rekening yang diblokir tidak tampil di pemilih pembayaran dan ditolak saat posting. Pembayaran yang sudah memakainya tetap tersimpan.
- **Hapus.** Ditolak selama rekening dipakai pembayaran ke vendor yang belum dihapus. Rekening yang tidak dipakai lagi diblokir. Kodenya boleh dipakai lagi sesudah dihapus.
- **Izin.** `core.bank-account.read` dan `.update`, dengan duty `core.bank-account.inquire` dan `core.bank-account.manage`, pola yang sama dengan faktur pembelian. Duty pembayaran ke vendor ikut melihat rekening.
- **Yang belum ada.** Mutasi rekening (Bank Account Ledger Entry), saldo, rekonsiliasi, dan Bank Account Posting Group. Semuanya menunggu feed posting finance. Kasir belum memakai rekening: merchan menyimpan bank penerbit EDC dan biaya kartu, sedangkan rekening tujuan setoran adalah Bal. Account di Payment Method BC, perubahan di jenis bayar yang belum dikerjakan.

## Yang belum ada

- **Kas dan bank di buku besar.** Pembayaran ke vendor hanya mengurangi utang. Di BC baris jurnalnya juga menulis Bal. Account (rekening bank atau akun kas) dan G/L Entry utang lawan kas. Rekening banknya sudah dicatat di pembayaran. Yang ditunggu pemetaan akun utang (Vendor Posting Group) dan feed posting finance untuk pembelian.
- **Diskon bayar cepat dan selisih kurs.** Payment Discount dan pembayaran dalam mata uang asing tidak ikut, karena termin di sini tidak membawa diskon dan pembelian hanya dalam mata uang lokal.
- **Uang muka ke vendor.** Pembayaran yang belum diterapkan ke faktur, yaitu entri pembayaran yang tetap terbuka, belum bisa dicatat. Setiap pembayaran harus membayar faktur yang sudah diposting.
- **Jurnal ke finance.** Feed posting finance (`src/foundation/finance-posting/`) hanya dipakai penerimaan aset, dan penerimaan barang di Core belum menerbitkan posting. Faktur pembelian juga tidak, karena pemetaan akunnya (setara Vendor Posting Group dan General Posting Setup BC: akun utang, persediaan atau perantara penerimaan, dan PPN Masukan) belum ada. Menerbitkan tanpa pemetaan itu hanya akan membuat setiap posting tertahan (`held`).
- **Unapply nota kredit.** Kredit yang sudah mengurangi faktur lewat Kurangi utang faktur tidak bisa dilepas lagi, jadi nota itu dan fakturnya tidak bisa dibatalkan postingnya.
- **Cetak faktur pembelian** lewat mesin cetak.
- **Selisih harga ke biaya persediaan.** Harga faktur yang berbeda dari penerimaan belum mengubah nilai stok.
