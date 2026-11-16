# Penjualan obat bebas

Petugas loket farmasi menjual obat tanpa resep kepada pembeli. Ia memilih lokasi dan obat, mengisi jumlah dan uang yang diterima, lalu Simpan dan bayar. Penjualan dan pembayarannya lahir dalam satu langkah, dan obatnya tercatat langsung diserahkan.

## Sub-features

- `otc-lokasi` mengizinkan sebuah lokasi farmasi menjual obat bebas, dengan kelompok harganya.
- `otc-jual` menjual obat dengan pembayaran tunai dan kembalian.

## How to get to it (user POV)

- Menu aplikasi Farmasi › Pelayanan resep › Penjualan obat bebas (`/pharmacy/dispensing/otc-sale`).
- Farmasi › Setup › Lokasi penjualan obat bebas (`/pharmacy/dispensing/otc-sale-locations`), tombol `Baru`.

## Driving it with verify.ts

Prasyarat:

- Tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md).
- Lokasi `FARMASI` boleh menjual obat bebas. Data contoh tidak mengaturnya; buat lewat butir pertama.

- **Atur lokasi.** Jalankan `bun scripts/verify.ts go pharmacy/dispensing/otc-sale-locations`, `click button Baru --exact`, `click combobox Lokasi --exact`, `click option "FARMASI Farmasi" --exact`, `click combobox "Kelompok harga"`, `click option "UMUM Umum"`, dan `click button Simpan --exact`. Daftar memuat satu baris.
- **Buka loket.** Jalankan `bun scripts/verify.ts go pharmacy/dispensing/otc-sale`. Combobox `Lokasi` bernilai `FARMASI · Farmasi`, dan tombol `Simpan dan bayar` tampil.
- **Isi penjualan.** Jalankan `bun scripts/verify.ts fill textbox "Nama pembeli" "Pembeli Contoh"`, `fill combobox "Obat, baris 1" Oralit`, `click option Oralit`, dan `fill textbox "Jumlah, baris 1" 2`. Baris menampilkan stok lokasi, harga, dan total, dan `Harus dibayar` terisi.
- **Simpan dan bayar.** Jalankan `bun scripts/verify.ts fill textbox "Tunai diterima" 2000` lalu `click button "Simpan dan bayar"`. Teks `Penjualan <nomor> tersimpan dengan pembayaran <no bukti>. Kembalian <nilai>.` muncul.
- **Bukti.** Jalankan `bun scripts/verify.ts sql "select b.nomor, b.status, b.pembeli_nama, b.resep_id is null tanpa_resep, t.jenis, k.no_bukti, k.nilai, k.nilai_kembalian, k.status from bill_farmasi b join tagihan_kasir t on t.sumber_nomor = b.nomor join kasir k on k.sumber_dokumen_id = t.sumber_dokumen_id where b.nomor = '<nomor>'" --save otc`. `bill_farmasi` berstatus `diserahkan` tanpa resep, `tagihan_kasir` berjenis `penjualan` dari `pharmacy`, dan `kasir` berstatus `diposting`.

## Gotchas

- Tanpa lokasi penjualan obat bebas, layar hanya menulis `Belum ada lokasi yang boleh menjual obat bebas` tanpa form.
- Pilihan lokasi dan kelompok harga bernama kode lalu nama (`FARMASI Farmasi`, `UMUM Umum`). `--exact` dengan nama saja tidak menemukan apa pun.
- Penjualan ini satu-satunya kali dijalankan saat jenis bayar tunai sudah ada dan Clerk Start sudah dilakukan. Perilakunya tanpa keduanya belum diverifikasi.
- Penjualan memotong stok lokasi. Ulangan berkali-kali di run yang sama menghabiskan stok obat contoh yang kecil.
