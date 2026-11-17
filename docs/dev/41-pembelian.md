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
- **Baris.** Barang, satuan (kosong berarti satuan beli barang), jumlah, harga satuan, diskon, dan PPN. Aturan isiannya `checkPriceLine` di `purchase-line.service.ts`, yang juga dipakai penerimaan, dan nilai baris dihitung `lineAmountSql` di berkas yang sama. Layar memakai hitungan yang sama di `purchase-lines.tsx`.
- **Nomor.** Reference `core.purchase-order-number`, satu sequence per legal entity, awalan `PO-`.
- **Cetak.** Laporan `core.purchase-order` lewat mesin cetak Core. Order yang belum dirilis tercetak dengan tanda BELUM DIRILIS.
- **Yang belum ada.** Termin pembayaran dan jatuh tempo tidak ikut, karena tidak pernah dipakai di data lama dan hutang usaha menunggu finance. Posting faktur pembelian juga belum ada.

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
- **Dua peran.** Lokasi mengajukan barang, satuan, jumlah, tanggal dibutuhkan (Due Date), dan keterangan; pengaju dicatat di `diminta_oleh_user_id` (Requester ID). Petugas pembelian mengisi vendor (Vendor No.), harga (Direct Unit Cost), dan Disetujui (Accept Action Message). Duty `core.purchase-requisition.request` hanya mengajukan; vendor, harga, dan persetujuan butuh izin `core.purchase-requisition.process` dari duty `core.purchase-requisition.manage`.
- **Buat purchase order.** `POST /api/v1/purchasing/requisitions/carry-out` memproses semua baris disetujui di lokasi yang boleh dilihat pengguna, seperti Carry Out Action Message (report 493, codeunit "Req. Wksh.-Make Order"). Satu order terbuka per vendor dan lokasi. BC mengelompokkan per vendor dan menaruh lokasi di baris; di sini lokasi ada di kepala order, jadi lokasi ikut kunci kelompok. Tanggal diharapkan baris order adalah tanggal dibutuhkan, dan kepala order memakai yang paling awal. Order dibuat lewat `insertOrder` di `purchase-order.service.ts`, fungsi yang sama dengan layar order.
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
- **Tanda saran.** Kolom `saran`: `baru` untuk saran yang belum disentuh orang, `diubah` sesudah orang mengubah atau menyetujuinya. Layar menampilkan status Saran, dan keterangan baris menyebut stok yang akan tersedia dan stok minimum yang dipakai.
- **Diulang.** Saran `baru` ditulis ulang di tempat dan yang tidak lagi dibutuhkan dihapus, jadi menjalankannya dua kali berakhir di keadaan yang sama. Index unik menjaga satu saran `baru` per barang dan lokasi, dan advisory lock per legal entity menahan dua hitungan yang berjalan bersamaan. Permintaan orang dan saran `diubah` tidak disentuh dan dihitung sebagai stok yang akan datang. BC menghapus semua baris barang itu di lembar kerja; di sini lembar kerja dipakai bersama lokasi yang mengajukan, jadi baris orang dipertahankan.
- **Sesudahnya.** Saran disetujui lalu Buat purchase order, sama dengan permintaan lain.
