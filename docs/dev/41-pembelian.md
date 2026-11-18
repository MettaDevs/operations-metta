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
- **Vendor dan order.** Vendor membawa termin bawaan. Order baru mengambilnya bila termin tidak dikirim, termasuk order dari Buat purchase order. Memilih vendor lain di layar order mengganti terminnya dengan termin vendor itu.
- **Izin.** Termin dikelola duty `core.vendor.manage`, karena di BC termin dipilih di kartu vendor. Duty lihat vendor dan duty purchase order ikut melihatnya.
- **Hapus.** Ditolak selama termin masih menjadi bawaan vendor atau dipakai purchase order. Kodenya boleh dipakai lagi sesudah dihapus.

## Penerimaan dari purchase order

Penerimaan tetap satu dokumen (`bl_tr_penerimaan`) yang disimpan sebagai draf lalu diposting, dengan atau tanpa order. Bentuknya mengikuti Warehouse Receipt BC dengan Get Source Documents, bukan Post Receive langsung dari order, karena batch, kedaluwarsa, dan sumber dana baru diketahui saat barang datang dan diisi di draf.

- **Terima barang.** `POST /api/v1/purchasing/orders/{id}/receipts` membuat draf penerimaan untuk order yang dirilis. Setiap baris berisi sisa baris order (Outstanding Quantity) dengan harga, diskon, PPN, dan satuan order, dan merujuk baris ordernya lewat `bl_tr_penerimaan_detail.order_detail_id`. Petugas mengubah jumlah yang benar-benar datang dan menghapus baris yang belum datang.
- **Satu draf per order.** Draf kedua ditolak lewat `refuse` dengan tombol yang membuka draf pertama. Dua draf yang sama-sama berisi sisa penuh hanya akan membuat salah satunya gagal saat posting.
- **Kunci order.** Vendor, lokasi, dan baris penerimaan dari order tidak bisa diganti; baris di luar order ditolak. Barang lain dicatat di penerimaan tanpa order.
- **Posting.** `receiveOnOrder` di `purchase-order.service.ts` berjalan di transaksi posting: kepala order dikunci, jumlah per baris order dijumlahkan dan dibandingkan dengan sisanya, lalu `jumlah_diterima` bertambah. Constraint `jumlah_diterima <= jumlah` menjaga hal yang sama di database. Order yang semua barisnya sudah diterima menjadi `selesai`. Posting ditolak bila ordernya sedang dibuka lagi, dengan tombol yang membuka order itu.
- **Batal posting.** `unreceiveOnOrder` mengurangi `jumlah_diterima`, dan order `selesai` kembali `dirilis`.
- **Mengubah order yang sudah diterima sebagian.** Sesudah Buka lagi, baris yang sudah diterima tidak bisa dihapus, barang dan satuannya tetap, dan jumlahnya tidak boleh kurang dari yang sudah diterima, seperti Quantity terhadap Quantity Received di Purchase Line BC. Order yang tidak akan dikirim penuh ditutup dengan mengurangi jumlahnya sampai sama dengan yang sudah diterima, lalu merilisnya: Rilis langsung menjadikannya `selesai`.
- **Hapus order.** Ditolak bila sebagian sudah diterima, atau bila ada draf penerimaan dari order itu.

## Permintaan pembelian

Tabel `bl_tr_permintaan`, nama dari `BL_trPermintaan` sistem lama. Bentuknya Requisition Line di Requisition Worksheet BC (`python D:\Kerja\bc-tools\bc.py table "Requisition Line"`), bukan dokumen permintaan dengan kepala dan detail seperti sistem lama.

- **Kenapa baris, bukan dokumen.** Di Adapotek setiap order berasal dari tepat satu permintaan (190.725 dan 190.725), dan permintaan sudah membawa vendor, jadi kepala permintaan hanya menyalin kepala order. Lembar kerja baris membiarkan permintaan beberapa lokasi untuk satu vendor dipesan bersama, dan kelak menerima baris saran dari titik pesan ulang (Calculate Plan) di tempat yang sama.
- **Dua peran.** Lokasi mengajukan barang, satuan, jumlah, tanggal permintaan (Order Date), tanggal dibutuhkan (Due Date), dan keterangan; pengaju dicatat di `diminta_oleh_user_id` (Requester ID). Petugas pembelian mengisi vendor (Vendor No.), harga (Direct Unit Cost), dan Disetujui (Accept Action Message). Duty `core.purchase-requisition.request` hanya mengajukan; vendor, harga, dan persetujuan butuh izin `core.purchase-requisition.process` dari duty `core.purchase-requisition.manage`.
- **Buat purchase order.** `POST /api/v1/purchasing/requisitions/carry-out` memproses semua baris disetujui di lokasi yang boleh dilihat pengguna, seperti Carry Out Action Message (report 493, codeunit "Req. Wksh.-Make Order"). Satu order terbuka per vendor dan lokasi. BC mengelompokkan per vendor dan menaruh lokasi di baris; di sini lokasi ada di kepala order, jadi lokasi ikut kunci kelompok. Tanggal diharapkan baris order adalah tanggal dibutuhkan, dan kepala order memakai yang paling awal. Order dibuat lewat `insertOrder` di `purchase-order.service.ts`, fungsi yang sama dengan layar order.
- **Tanggal permintaan.** Kolom `tanggal_permintaan`, Order Date di Requisition Line BC: hari permintaan diajukan, berbeda dari tanggal dibutuhkan. Bawaannya hari ini di zona waktu legal entity bila tidak diisi, dan bisa diubah selama permintaan belum dipesan. Kolom permintaan LPLPO sebulan menjumlah permintaan dengan tanggal permintaan di bulan itu. Baris yang lahir sebelum kolom ini ada diisi migration `0082_requisition_request_date.sql` dari `created_at` di zona waktu legal entity.
- **Harga.** Harga kosong diisi harga penerimaan terakhir yang diposting untuk barang dan satuan itu, atau 0 bila belum pernah diterima. Order lahir terbuka, jadi harga masih bisa diubah sebelum dirilis.
- **Sesudah diproses.** Baris merujuk baris ordernya (`order_detail_id`) dan tidak bisa diubah atau dihapus lagi. BC menghapus barisnya; di sini baris tetap ada karena tidak ada penghapusan fisik, dan tampil di Lihat yang sudah dipesan.

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
- **Izin.** Setelan ini tetap memakai izin ubah kartu barang (`core.inventory-item.update`), bukan izin pembelian. Satu baris setelan memegang stok minimum, maksimum, dan cara pesannya sekaligus, dan memecahnya ke dua duty membuat satu kartu disimpan dengan dua izin. Di BC kartu Stockkeeping Unit juga bagian persediaan.
- **Yang belum ada.** Safety Stock Quantity, Minimum dan Maximum Order Quantity, Order Multiple, dan lead time. Setiap angka itu menambah aturan perhitungan BC, dan tidak ada di data lama.

### Hitung saran

Tombol Hitung saran di Permintaan pembelian memanggil `POST /api/v1/purchasing/requisitions/calculate-plan`, yang dijalankan `calculatePlan` di `requisition-plan.ts`. Ia butuh izin `core.purchase-requisition.process`, sama dengan Buat purchase order, karena saran mengisi vendor.

- **Yang dihitung.** Setiap barang dan lokasi yang punya cara pesan ulang, di lokasi yang boleh dilihat pengguna (`allowedLocationsSql`). Barang yang diblokir dilewati, seperti `Blocked = false` di report 699.
- **Stok yang akan tersedia.** Kartu gudang di lokasi itu, ditambah sisa baris purchase order terbuka dan dirilis untuk lokasi itu (Outstanding Quantity), ditambah permintaan yang belum dipesan selain saran yang akan ditulis ulang, ditambah dan dikurangi amprah yang belum selesai. Semua dalam satuan dasar.
- **Amprah.** Amprah draf dan diajukan dihitung seperti Transfer Line di codeunit "Inventory Profile Offsetting" (`TransRcptTransLineToProfile` dan `TransShptTransLineToProfile`). Jumlah yang belum diterima lokasi peminta, termasuk yang sudah dikirim dan masih di lokasi transit, menambah stok peminta. Jumlah yang belum dikirim lokasi pemasok mengurangi stok pemasok. Mengirim ke transit lalu menerima tidak mengubah saran, karena barang hanya pindah dari amprah ke kartu gudang. Amprah selesai atau dibatalkan tidak dihitung, jadi jumlah yang tidak pernah dikirim berhenti mengurangi stok pemasok begitu amprahnya ditutup. Draf ikut dihitung seperti purchase order terbuka, sama dengan BC yang tidak menyaring status Transfer Order. Saran tetap hanya pembelian (Replenishment System Purchase): Hitung saran tidak membuat amprah.
- **Jumlah.** `reorderQuantity` mengikuti `CalcOrderQty` di codeunit "Inventory Profile Offsetting". Saran dibuat bila stok yang akan tersedia sama dengan atau di bawah stok minimum. Jumlah tetap memesan jumlah pesan ulang, dikalikan sampai hasilnya melewati stok minimum. Sampai stok maksimum memesan selisihnya dengan stok maksimum.
- **Satuan.** Satuan beli barang bila jumlahnya habis dibagi isi satuan beli, kalau tidak satuan dasar. BC memakai satuan beli dan membulatkan jumlahnya; di sini jumlah barang tidak pernah dibulatkan.
- **Vendor dan harga.** Vendor dari penerimaan terakhir yang diposting untuk barang itu, bila vendornya aktif. Harga dibiarkan kosong, jadi Buat purchase order mengisinya dengan harga penerimaan terakhir seperti permintaan biasa.
- **Tanggal permintaan.** Saran yang ditulis atau ditulis ulang mendapat tanggal permintaan hari Hitung saran dijalankan, di zona waktu legal entity. Tanggal dibutuhkan tetap dari isian di dialog Hitung saran.
- **Tanda saran.** Kolom `saran`: `baru` untuk saran yang belum disentuh orang, `diubah` sesudah orang mengubah atau menyetujuinya. Layar menampilkan status Saran, dan keterangan baris menyebut stok yang akan tersedia dan stok minimum yang dipakai.
- **Diulang.** Saran `baru` ditulis ulang di tempat dan yang tidak lagi dibutuhkan dihapus, jadi menjalankannya dua kali berakhir di keadaan yang sama. Index unik menjaga satu saran `baru` per barang dan lokasi, dan advisory lock per legal entity menahan dua hitungan yang berjalan bersamaan. Permintaan orang dan saran `diubah` tidak disentuh dan dihitung sebagai stok yang akan datang. BC menghapus semua baris barang itu di lembar kerja; di sini lembar kerja dipakai bersama lokasi yang mengajukan, jadi baris orang dipertahankan.
- **Sesudahnya.** Saran disetujui lalu Buat purchase order, sama dengan permintaan lain.

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

- **Isi.** Satu entri `faktur` per faktur yang diposting: tanggal posting, nomor faktur, nomor faktur vendor, jatuh tempo, jumlah termasuk PPN, dan sisa. Entri `pembatalan` ditulis saat posting faktur dibatalkan. Satu entri `pembayaran` per pembayaran ke vendor yang diposting, bernilai negatif, dan entri `pembatalan_pembayaran` saat postingnya dibatalkan. Entri hanya ditambah; yang berubah hanya sisa dan tanda tutupnya (`ditutup_oleh_entri_id`, `ditutup_pada`, seperti Closed by Entry No. dan Closed at Date).
- **Sisa disimpan, bukan dihitung.** BC menyimpan Remaining Amount sebagai FlowField dari Detailed Vendor Ledg. Entry. Di sini sisa disimpan di entri faktur, dan baris pembayaran yang diposting (`ap_tr_pembayaran_detail`) menjadi catatan penerapannya: berapa yang dibayar ke entri mana. Batal posting pembayaran mengembalikan jumlah baris itu ke sisa.
- **Layar** menampilkan entri yang masih terbuka, dari jatuh tempo paling awal, dengan keterangan berapa hari lewat atau tersisa sampai jatuh tempo, jumlah yang sudah dibayar beserta nomor pembayarannya, total sisa, dan total yang lewat jatuh tempo. Entri yang sudah ditutup, termasuk entri pembayaran, bisa ditampilkan; faktur yang ditutup pembayaran berlabel Lunas. Baris faktur membuka fakturnya dan, lewat menu baris, setiap pembayarannya. Baris pembayaran membuka pembayarannya.
- **Izin** sama dengan lihat faktur pembelian.

## Pembayaran ke vendor

Tabel `ap_tr_pembayaran` dan `ap_tr_pembayaran_detail`. Padanannya Payment Journal BC yang diterapkan ke Vendor Ledger Entry lewat Apply Entries dan Applies-to ID, lalu Unapply Entries dan Reverse Transaction untuk membatalkannya (codeunit 227 "VendEntry-Apply Posted Entries"). Layarnya Pembelian › Pembayaran ke vendor. Di BC baris jurnal pembayaran hilang sesudah diposting. Di sini pembayaran disimpan sebagai dokumen bernomor, karena sistem lama mencatat siapa membayar apa dan kapan, petugas butuh bukti pembayaran untuk diserahkan, dan batal posting butuh catatan baris yang diterapkannya.

Data lama hanya ada di Adapotek: 181.382 penerimaan ditandai lunas, masing-masing dengan tanggal, cara bayar (`Tunai` 110.547, `Transfer` 70.811), dan bank berupa teks bebas (`Mandiri`, `BCA`, atau kosong). Satu tanda lunas membayar satu penerimaan utuh, tanpa bayar sebagian.

- **Isian.** Vendor, tanggal bayar (Posting Date), cara bayar (Payment Method Code), bank, nomor referensi (External Document No., misalnya nomor bukti transfer), dan keterangan.
- **Cara bayar** memakai jenis bayar kasir (`jenis_bayar`), padanan Payment Method BC yang juga dipakai penjualan dan pembelian. Hanya jenis bayar yang uangnya sudah di tangan klinik yang bisa dipilih, yaitu perilaku `tunai` dan `non_tunai` (`behaviorsSettledAs('received')`). Penjamin, piutang, dan beban tidak dipakai membayar vendor.
- **Bank** berupa teks bebas, sama dengan kolom `Bank` sistem lama. Core belum punya master rekening bank (Bank Account BC). Merchan kasir adalah bank atau mesin EDC penerima kartu dengan biaya kartu, bukan rekening asal uang.
- **Ambil utang terbuka.** `GET /api/v1/purchasing/vendor-payment-entries?vendor_id=` mengembalikan entri faktur vendor itu yang sisanya lebih dari 0, dari jatuh tempo paling awal. Jumlah yang sudah ada di draf pembayaran lain dikurangkan, seperti Applies-to ID yang hanya dipegang satu baris jurnal. Jumlah bayar bawaannya sisa itu dan boleh dikurangi untuk bayar sebagian. BC membolehkannya lewat Amount to Apply, walau data lama tidak pernah memakainya.
- **Posting.** Vendor harus aktif, karena BC menolak vendor yang diblokir untuk pembayaran. Pembayaran punya sedikitnya satu baris. Setiap baris membayar entri faktur vendor yang sama, dengan jumlah tidak melebihi sisanya. Tanggal bayar tidak boleh sebelum tanggal posting faktur yang dibayar (`MustNotBeBeforeErr`). Entri faktur dikunci, satu entri `pembayaran` sebesar minus total ditulis, sisa entri faktur berkurang, dan entri yang sisanya 0 ditutup oleh entri pembayaran itu. Posting yang diulang tidak menulis apa pun.
- **Batal posting** mengikuti Unapply lalu Reverse. Sisa entri faktur bertambah lagi sebesar baris pembayaran dan entrinya terbuka lagi, lalu entri `pembatalan_pembayaran` menutup entri pembayarannya. Batal posting ditolak bila faktur yang dibayarnya sudah dibayar lagi oleh pembayaran yang diposting sesudahnya (`UnapplyAllPostedAfterThisEntryErr`). Penolakannya membawa tombol yang membuka pembayaran sesudahnya itu.
- **Cetak.** Laporan `core.vendor-payment` (Bukti pembayaran ke vendor) lewat mesin cetak Core: faktur yang dibayar, jumlahnya, terbilang, dan tanda tangan petugas dan vendor. Draf tercetak dengan tanda BELUM DIPOSTING.
- **Izin.** `core.vendor-payment.read`, `.update`, `.post`, dan `.reverse`, pola yang sama dengan faktur pembelian. Duty `core.vendor-payment.inquire` hanya melihat. Duty `core.vendor-payment.manage` membuat, memposting, dan membatalkan posting. Keduanya ikut melihat vendor, faktur pembelian, dan utang vendor.
- **Nomor.** Reference `core.vendor-payment-number`, satu sequence per legal entity, awalan `PV-`.

## Yang belum ada

- **Kas dan bank di buku besar.** Pembayaran ke vendor hanya mengurangi utang. Di BC baris jurnalnya juga menulis Bal. Account (rekening bank atau akun kas) dan G/L Entry utang lawan kas. Itu menunggu master rekening bank, pemetaan akun utang (Vendor Posting Group), dan feed posting finance untuk pembelian.
- **Diskon bayar cepat dan selisih kurs.** Payment Discount dan pembayaran dalam mata uang asing tidak ikut, karena termin di sini tidak membawa diskon dan pembelian hanya dalam mata uang lokal.
- **Uang muka ke vendor.** Pembayaran yang belum diterapkan ke faktur, yaitu entri pembayaran yang tetap terbuka, belum bisa dicatat. Setiap pembayaran harus membayar faktur yang sudah diposting.
- **Jurnal ke finance.** Feed posting finance (`src/foundation/finance-posting/`) hanya dipakai penerimaan aset, dan penerimaan barang di Core belum menerbitkan posting. Faktur pembelian juga tidak, karena pemetaan akunnya (setara Vendor Posting Group dan General Posting Setup BC: akun utang, persediaan atau perantara penerimaan, dan PPN Masukan) belum ada. Menerbitkan tanpa pemetaan itu hanya akan membuat setiap posting tertahan (`held`).
- **Credit memo pembelian** untuk koreksi faktur yang sudah dibayar, dan untuk retur yang sudah difakturkan.
- **Cetak faktur pembelian** lewat mesin cetak.
- **Selisih harga ke biaya persediaan.** Harga faktur yang berbeda dari penerimaan belum mengubah nilai stok.
