# Penjualan obat bebas

Petugas loket farmasi menjual obat tanpa resep kepada pembeli. Ia memilih lokasi dan obat, mengisi jumlah dan uang yang diterima, lalu Simpan dan bayar. Penjualan dan pembayarannya lahir dalam satu langkah, dan obatnya tercatat langsung diserahkan.

## Sub-features

- `otc-lokasi` mengizinkan sebuah lokasi farmasi menjual obat bebas, dengan kelompok harganya.
- `otc-jual` menjual obat dengan pembayaran tunai dan kembalian.
- `otc-pengganti` menawarkan obat pengganti yang masih punya stok saat jumlah baris melebihi stok lokasi, dan memilihnya mengganti obat baris.
- `otc-nota` mencetak nota penjualan berisi obat, total, dan pembayaran, dari toolbar loket sesudah Simpan dan bayar dan dari kartu penjualan, termasuk jumlah yang diretur.
- `otc-petugas-lokasi` menyembunyikan penjualan di lokasi khusus petugas dari pengguna yang bukan petugasnya, dan menolak kartunya bila dibuka lewat alamat.

## How to get to it (user POV)

- Menu aplikasi Farmasi › Pelayanan resep › Penjualan obat bebas (`/pharmacy/dispensing/otc-sale`).
- Menu aplikasi Farmasi › Pelayanan resep › Daftar penjualan (`/pharmacy/dispensing/otc-sales`), dan kartu penjualan lewat alamat `/pharmacy/dispensing/otc-sales?sale=<id>`.
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
- **Nota sesudah bayar.** Tepat sesudah Simpan dan bayar, toolbar loket menampilkan `Nota <nomor>`. Jalankan `bun scripts/verify.ts pdf button "Nota <nomor>" otc-nota --exact`. `evidence/otc-nota.pdf` berkertas A4 dan berisi `NOTA PENJUALAN`, nomor penjualan, Oralit dengan jumlah, harga, dan nilainya, total dengan terbilang, `Tunai`, uang diterima, kembalian, dan no bukti kasir. `click button "Pilihan nota"` (nama lengkapnya `Pilihan nota <nomor>`) menampilkan `Nota A4 · 210×297 mm`, `Struk 76 mm · 76×200 mm`, dan `Unduh Word`.
- **Nota dari kartu.** Jalankan `bun scripts/verify.ts go "pharmacy/dispensing/otc-sales?sale=<id>"`, lalu `pdf button Nota otc-nota-kartu --exact`. Isinya sama dengan nota sesudah bayar. Silang angkanya dengan `sql "select k.no_bukti, trim_scale(k.nilai - k.nilai_discount + k.biaya_tambahan) total, trim_scale(k.jumlah_bayar) diterima, trim_scale(k.nilai_kembalian) kembalian from kasir k join bill_farmasi b on b.id = k.sumber_dokumen_id where b.nomor = '<nomor>' and k.status = 'diposting'" --save otc-nota`.
- **Penjualan di dua lokasi.** Atur juga `PUSLING Farmasi Pusling` lewat butir pertama. Di loket, `click combobox Lokasi --exact` lalu `click option "PUSLING · Farmasi Pusling" --exact`, dan jual Oralit seperti di atas. `sql "select b.nomor, l.kode from bill_farmasi b join gd_m_lokasi l on l.id = b.lokasi_id where b.resep_id is null order by b.nomor"` mencetak satu penjualan di `FARMASI` dan satu di `PUSLING`.
- **Lokasi khusus petugas.** Jalankan `bun scripts/verify.ts go sysadmin/inventory/locations`, `click button "Tindakan untuk Farmasi" --exact`, `click menuitem Buka --exact`, `click checkbox "Khusus petugas lokasi" --exact`, dan `click button Simpan --exact`. Admin bukan petugas FARMASI, jadi lokasi itu tertutup baginya.
- **Daftar disaring.** Jalankan `bun scripts/verify.ts go pharmacy/dispensing/otc-sales` dan `snapshot otc-daftar`. Hanya penjualan PUSLING yang tampil. Di loket, combobox `Lokasi` hanya menawarkan `PUSLING · Farmasi Pusling`.
- **Buka lewat alamat.** Ambil id penjualan FARMASI dengan `sql "select id from bill_farmasi where nomor = '<nomor>'"`, lalu `go "pharmacy/dispensing/otc-sales?sale=<id>"` dan `wait text "hanya untuk petugasnya"`. Kartu menulis `Lokasi FARMASI Farmasi hanya untuk petugasnya, dan Anda belum terdaftar sebagai petugas di sana.` dengan tombol `Coba lagi`.
- **Obat pengganti saat stok kurang.** Atur dulu pengganti Parasetamol: `go pharmacy/drug/drugs`, `click button "Tindakan untuk PCT-500 Parasetamol 500 mg" --exact`, `click menuitem Buka --exact`, `fill combobox "Obat pengganti" Antasida --exact`, `click text "Antasida DOEN tablet kunyah" --nth 1`, dan `click button "Tambah obat pengganti"`. Di loket, `fill combobox "Obat, baris 1" Parasetamol`, `click option Parasetamol`, dan `fill textbox "Jumlah, baris 1" 400` (stok FARMASI 300). Di bawah obat muncul `Stok kurang. Obat pengganti:` dengan tombol `Antasida DOEN tablet kunyah · stok 150 TAB`. `click button "Antasida DOEN tablet kunyah · stok 150 TAB" --exact` mengganti obat baris menjadi `ANT-DOEN · Antasida DOEN tablet kunyah`. Isi jumlah 5, lalu Simpan dan bayar seperti di atas; `bill_farmasi_detail` penjualan itu berisi `ANT-DOEN`.

## Gotchas

- `pdf` hanya menyimpan PDF layout bawaan legal entity. Struk 76 mm dicetak dari menu `Pilihan nota`, yang membuka tab sendiri.
- Tombol `Nota <nomor>` di loket hilang saat halaman dimuat ulang; nota penjualan lama dicetak dari kartunya.

- Tanpa lokasi penjualan obat bebas, layar hanya menulis `Belum ada lokasi yang boleh menjual obat bebas` tanpa form.
- Pilihan lokasi dan kelompok harga bernama kode lalu nama (`FARMASI Farmasi`, `UMUM Umum`). `--exact` dengan nama saja tidak menemukan apa pun.
- Penjualan ini satu-satunya kali dijalankan saat jenis bayar tunai sudah ada dan Clerk Start sudah dilakukan. Perilakunya tanpa keduanya belum diverifikasi.
- Penjualan memotong stok lokasi. Ulangan berkali-kali di run yang sama menghabiskan stok obat contoh yang kecil.
- Lokasi khusus petugas tertutup juga bagi admin yang belum terdaftar di Petugas lokasi, jadi resep dan penjualan FARMASI hilang dari layar admin sampai saklarnya dimatikan lagi. Jalankan langkah itu terakhir di sebuah run.
