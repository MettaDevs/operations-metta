# Purchase order

Petugas pembelian memesan barang ke vendor untuk satu lokasi. Ia membuat order terbuka, mengisi vendor, lokasi tujuan, tanggal diharapkan datang, dan baris barang dengan harga, diskon, dan PPN, lalu merilisnya. Order dirilis terkunci dan bisa dicetak untuk vendor. Buka lagi membukanya untuk diubah.

## Sub-features

- `po-simpan` membuat order terbuka bernomor `PO-…`.
- `po-rilis` mengunci order; toolbar hanya menampilkan Buka lagi dan cetak.
- `po-cetak` mencetak order A4 tegak dengan terbilang.

## How to get to it (user POV)

- Sys Admin › Pembelian › Purchase order (`/sysadmin/purchasing/orders`), tombol `Baru`.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md).

- **Buka order baru.** Jalankan `bun scripts/verify.ts go sysadmin/purchasing/orders` lalu `click button Baru --exact`.
- **Isi kepala.** Jalankan `fill combobox Vendor "PBF"`, `click option "PBF Contoh Farma"`, `fill combobox "Dikirim ke" "GUDANG"`, `click option "GUDANG"`, dan `fill textbox "Diharapkan datang" "20/11/2026"`.
- **Isi baris.** Jalankan `click button Tambah --exact`, `fill combobox "Barang, baris 1" "PCT"`, `click option "PCT-500"`, `fill textbox "Jumlah, baris 1" 5`, `fill textbox "Harga satuan, baris 1" 12000`, `fill textbox "Diskon %, baris 1" 5`, dan `fill textbox "PPN %, baris 1" 11`. Satuan terisi `BOX` dari satuan beli barang.
- **Simpan.** Jalankan `click button Simpan --exact`. Toast `Order dibuat.` muncul dan judul berganti ke `PO-00000001 PBF Contoh Farma`.
- **Rilis.** Jalankan `click button Rilis --exact`. Toast `Order PO-00000001 dirilis. Isinya terkunci dan siap dikirim ke vendor.` muncul, Status `Dirilis`, dan toolbar hanya berisi `Buka lagi` dan `Purchase order`. Subtotal 57.000, PPN 6.270, total 63.270.
- **Panel samping.** Panel kanan kartu order berisi nama vendor, Sisa utang, Lewat jatuh tempo, Order belum datang, Diterima belum difakturkan, Pembayaran terakhir, Riwayat vendor (jumlah order, penerimaan, faktur, dan nota kredit diposting; angka bukan nol membuka daftarnya dengan pencarian nama vendor), lalu baris aktif dengan `Stok di <lokasi>` dan `Sedang dipesan` dalam satuan dasar. Diperiksa 18 Nov 2026: sesudah faktur `PI-00000001` dari [pembayaran ke vendor](./pembayaran-vendor.md) bagian Prasyarat, order PCT-500 5 BOX @12.000 PPN 11% plus AMX-500 10 @5.000 yang dirilis menampilkan Sisa utang 67.500, Lewat jatuh tempo 67.500, Order belum datang 122.100, `PCT-500 · Parasetamol 500 mg` dengan Stok di GUDANG 340 TAB dan Sedang dipesan 500 TAB. `click row "AMX-500"` memindahkan panah baris aktif dan panel ke AMX-500 (205 KAP, 10 KAP). `click link "1" --exact --nth 2` membuka Faktur pembelian berisi `PI-00000001`.
- **Cetak.** Jalankan `pdf button "Purchase order" po-cetak --exact`. PDF A4 210 x 297 mm berjudul `PURCHASE ORDER` dengan `Terbilang: Enam Puluh Tiga Ribu Dua Ratus Tujuh Puluh Rupiah`.
- **Bukti.** Jalankan `bun scripts/verify.ts sql "select h.nomor, h.status, h.dirilis_pada is not null dirilis, d.jumlah, d.konversi from bl_tr_order h join bl_tr_order_detail d on d.order_id = h.id" --save po`. Satu baris `dirilis`, jumlah 5, konversi 100.

## Gotchas

- Tombol cetak di kartu order berlabel `Purchase order`, sama dengan judul halaman. Pakai `--exact` pada tombol, bukan teks.
