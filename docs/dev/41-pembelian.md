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
