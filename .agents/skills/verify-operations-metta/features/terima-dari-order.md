# Terima barang dari purchase order

Petugas gudang menerima barang yang dipesan lewat purchase order. Di order yang sudah dirilis ia memilih Terima barang; jendela penerimaan terbuka berisi sisa setiap baris order. Ia mengubah jumlah yang benar-benar datang, mengisi batch dan kedaluwarsa, lalu memposting. Order mencatat jumlah diterima, dan order yang diterima seluruhnya berstatus Selesai.

## Sub-features

- `terima-order-draf` membuat draf penerimaan berisi sisa order.
- `terima-order-sebagian` memposting sebagian; kolom Diterima di order bertambah dan status tetap Dirilis.
- `terima-order-selesai` memposting sisanya; status order menjadi Selesai.

## How to get to it (user POV)

- Sys Admin › Pembelian › Purchase order, buka order berstatus Dirilis, tombol `Terima barang`.

## Driving it with verify.ts

Prasyarat: order `PO-00000001` sudah dirilis, mengikuti [purchase order](./purchase-order.md).

- **Buat draf.** Jalankan `click button "Terima barang" --exact`. Jendela `Penerimaan barang` terbuka berisi field `Purchase order` = `PO-00000001`, kolom `Sisa order`, dan jumlah 5 BOX.
- **Terima sebagian.** Jalankan `fill textbox "Jumlah, baris 1" 3`, `fill textbox "No. batch, baris 1" PCT2911X`, `fill textbox "Kedaluwarsa, baris 1" 30/11/2028`, `click button Posting --exact`, lalu `click button Posting --exact --within "Posting penerimaan"`. Toast `Penerimaan PNR-… diposting.` muncul.
- **Bukti order.** Tutup jendela penerimaan. Kolom `Diterima` baris 1 berisi 3 dan status tetap `Dirilis`. Jalankan `sql "select h.status, d.jumlah, d.jumlah_diterima from bl_tr_order h join bl_tr_order_detail d on d.order_id = h.id"`.
- **Terima sisanya.** Ulangi Terima barang; jumlahnya 2. Isi batch dan kedaluwarsa lalu posting. Status order menjadi `Selesai` dan `selesai_pada` terisi.

## Gotchas

- Barang contoh `PCT-500` wajib batch dan kedaluwarsa; tanpa keduanya posting ditolak mesin posting.
- Konfirmasi posting dan toolbar sama-sama punya tombol `Posting`; batasi klik konfirmasi dengan `--within`.
