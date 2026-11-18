# Posting dari purchase order

Petugas pembelian menerima dan memfakturkan barang langsung dari purchase order yang dirilis, seperti Post di Purchase Order Business Central. Di baris order ia mengisi Diterima sekarang, batch, dan kedaluwarsa, di kepala No. faktur vendor, lalu memilih Posting › Terima, Faktur, atau Terima dan faktur. Penerimaan dan faktur pembelian lahir dan diposting sekaligus, dan fakturnya muncul di Utang vendor.

## Sub-features

- `po-terima` memposting sebagian barang order; kolom Diterima bertambah dan status tetap Dirilis.
- `po-terima-faktur` menerima sisanya sekaligus memfakturkan semua yang sudah diterima; order Selesai dan Difakturkan sama dengan Jumlah.
- `po-utang` menampilkan faktur itu di Utang vendor dengan nomor faktur vendornya.

## How to get to it (user POV)

- Sys Admin › Pembelian › Purchase order, buka order berstatus Dirilis, tombol `Posting` di toolbar.

## Driving it with verify.ts

Prasyarat: order `PO-00000001` berisi 5 BOX PCT-500 seharga 12.000 dan PPN 11% sudah dirilis, mengikuti [purchase order](./purchase-order.md) tanpa diskon.

- **Isian bawaan.** Jalankan `find textbox "Diterima sekarang, baris 1"` dan `find textbox "Difakturkan sekarang, baris 1"`. Keduanya bernilai 5: sisa order, dan diterima ditambah diterima sekarang dikurangi yang sudah difakturkan.
- **Terima 3.** Jalankan `fill textbox "Diterima sekarang, baris 1" 3`, `fill textbox "Batch, baris 1" PCT2911X`, `fill textbox "Kedaluwarsa, baris 1" 30/11/2028`, `click button Posting --exact`, lalu `click menuitem Terima --exact`. Toast `Barang order PO-00000001 diterima: penerimaan PNR-….` muncul, Diterima baris 1 berisi 3, dan status tetap `Dirilis`.
- **Terima dan faktur 2.** Diterima sekarang kembali terisi 2 dan Difakturkan sekarang 5. Jalankan `fill textbox "Batch, baris 1" PCT2912Y`, `fill textbox "Kedaluwarsa, baris 1" 31/12/2028`, `fill textbox "No. faktur vendor" FKT-7781`, `click button Posting --exact`, lalu `click menuitem "Terima dan faktur" --exact`. Toast menyebut penerimaan dan `faktur PI-00000001`. Status `Selesai`, Diterima dan Difakturkan sama-sama 5, dan tombol Posting hilang.
- **Bukti.** Jalankan `sql "select f.nomor, f.no_faktur_vendor, trim_scale(fd.jumlah) jumlah, r.nomor penerimaan from ap_tr_faktur f join ap_tr_faktur_detail fd on fd.faktur_id = f.id join bl_tr_penerimaan_detail d on d.id = fd.penerimaan_detail_id join bl_tr_penerimaan r on r.id = d.penerimaan_id order by fd.urutan"`: dua baris `PI-00000001 FKT-7781`, 3 dari penerimaan pertama dan 2 dari penerimaan kedua. `sql "select jenis, no_faktur_vendor, trim_scale(jumlah), trim_scale(sisa) from ap_tr_entri_utang"`: satu entri `faktur`, 66600, sisa 66600.
- **Utang vendor.** Jalankan `go sysadmin/purchasing/vendor-ledger`. Baris `PI-00000001` dengan `FKT-7781` dan sisa 66.600.

## Gotchas

- Barang contoh `PCT-500` wajib batch dan kedaluwarsa; kolom Batch dan Kedaluwarsa hanya tampil bila ada barang seperti itu, dan posting tanpa keduanya ditolak di baris order.
- Menu Posting dan tombol Posting di jendela penerimaan sama-sama bernama `Posting`. Pilihan di menu dicari sebagai `menuitem`.
- Faktur saja memfakturkan yang sudah diterima. Bawaan Difakturkan sekarang yang ikut menghitung Diterima sekarang tidak berlaku untuk pilihan itu.
- Jalan lama tetap ada: `Terima barang` membuat draf penerimaan, mengikuti [terima dari order](./terima-dari-order.md).
