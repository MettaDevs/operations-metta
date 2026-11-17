# LPLPO

Petugas memilih lokasi di Stok per lokasi lalu mencetak LPLPO: per barang stok awal, penerimaan beserta rinciannya per sumber dana, persediaan, pemakaian, sisa stok, stok optimum, dan permintaan, dari awal bulan tanggal stok sampai tanggal stok. Sisa stok di cetakan sama dengan stok di layar.

## Sub-features

- `lplpo-cetak` mencetak LPLPO satu lokasi lewat mesin cetak.
- `lplpo-silang` mencocokkan sisa stok, stok optimum, dan permintaan dengan SQL langsung.

## How to get to it (user POV)

- Sys Admin › Persediaan › Stok per lokasi (`/sysadmin/inventory/stock-by-location`). Tombol LPLPO muncul di toolbar setelah lokasi dipilih di filter.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md).

- **Stok maksimum.** Data contoh tidak memberi GUDANG stok maksimum, jadi kolom Stok optimum kosong di semua baris. `go sysadmin/inventory/items`, `click button "Tindakan untuk Parasetamol 500 mg"`, `click menuitem Buka`, `click button "Stok minimum dan maksimum per lokasi" --exact`, `click button Baru --exact --within "Stok minimum dan maksimum per lokasi"`, `click combobox Lokasi`, `fill combobox Lokasi GUDANG`, `click option GUDANG`, `fill textbox "Stok minimum (TAB)" 400`, `fill textbox "Stok maksimum (TAB)" 1000`, `click combobox "Cara pesan ulang"`, `click option "Sampai stok maksimum"`, `click button Simpan --exact`, lalu `click button "Kembali ke halaman sebelumnya"`.
- **Permintaan dari Hitung saran.** `go sysadmin/purchasing/requisitions`, `click button "Hitung saran" --exact`, lalu `click button "Hitung saran" --exact --within "Hitung saran pesan?"`. Satu saran GUDANG lahir untuk PCT-500: 660 TAB (6,6 BOX), yaitu stok maksimum 1000 dikurangi sisa stok 340.
- **Pilih lokasi.** `go sysadmin/inventory/stock-by-location`, `fill combobox Lokasi GUDANG`, `click option GUDANG`, `click button "Tutup filter"`. Tombol LPLPO tampil.
- **Cetak.** `pdf button LPLPO lplpo-gudang --exact`. Kertas 297 x 210 mm, judul LAPORAN PEMAKAIAN DAN LEMBAR PERMINTAAN OBAT, tujuh baris barang GUDANG. PCT-500: stok awal 0, penerimaan 700 dengan rincian `APBD 200, Dana kapitasi JKN 500`, persediaan 700, pemakaian 360, sisa stok 340, stok optimum 1.000, permintaan 660. Stok optimum enam barang lain kosong karena GUDANG tidak punya stok maksimum untuknya. Sisa stok setiap baris sama dengan kolom Jumlah di layar.
- **Silang sumber dana.** `sql` yang menjumlah `gd_tr_kartu_gudang` GUDANG bergerak masuk dalam bulan per barang dan `gd_m_sumber_dana.nama` (kosong menjadi Tanpa sumber dana). Setiap pasangan sama dengan rincian di kolom Penerimaan per sumber dana, dan jumlahnya sama dengan kolom Penerimaan.
- **Silang.** `sql` yang menjumlah `gd_tr_kartu_gudang` GUDANG per barang sebelum awal bulan (stok awal), masuk dan keluar dalam bulan, `bl_tr_permintaan` GUDANG yang dibuat bulan itu dalam satuan dasar (`jumlah * konversi`), dan `gd_m_barang_lokasi.stok_maksimum` GUDANG yang belum dihapus. Angkanya sama dengan baris cetakan dan dengan kolom stok di layar.

## Gotchas

- Periode selalu dari tanggal 1 bulan tanggal stok sampai tanggal stok. Ganti tanggal stok di filter untuk mencetak bulan lain.
- Permintaan dihitung dari tanggal dibuatnya permintaan pembelian, karena tabelnya tidak punya tanggal permintaan sendiri.
