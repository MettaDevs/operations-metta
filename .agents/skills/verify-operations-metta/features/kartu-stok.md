# Kartu stok

Petugas memilih barang dan lokasi di layar Kartu stok. Layar menampilkan gerak stok periode itu dengan jenis gerak dalam bahasa sehari-hari, misalnya Terima dari vendor dan Mutasi keluar. Tombol Kartu stok mencetak saldo awal, setiap gerak beserta batch, kedaluwarsa, masuk, keluar, dan saldo berjalannya, lalu jumlah masuk, jumlah keluar, dan saldo akhir, sebagai PDF A4 mendatar atau Word.

## Sub-features

- `kartu-stok-layar` menampilkan gerak stok satu barang di satu lokasi.
- `kartu-stok-cetak` mencetak kartu stok lewat mesin cetak.
- `kartu-stok-silang` mencocokkan angka cetakan dengan kartu gudang lewat SQL.

## How to get to it (user POV)

- Sys Admin › Persediaan › Kartu stok (`/sysadmin/inventory/item-ledger-entries`). Tombol Kartu stok muncul di toolbar setelah barang dan lokasi dipilih.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md). Data contoh memberi PCT-500 dua penerimaan (200 dan 500 TAB) dan dua mutasi keluar dari GUDANG pada tanggal hari ini.

- **Layar.** `go sysadmin/inventory/item-ledger-entries`, `fill combobox Barang PCT`, `click option PCT-500`, `fill combobox Lokasi GUDANG`, `click option GUDANG`, `click button "Tutup filter"`. Lima baris tampil dengan jenis Terima dari vendor dan Mutasi keluar, dan kaki tabel `Saldo awal per 01/<bulan>: 0 TAB`.
- **Cetak.** `pdf button "Kartu stok" kartu-stok --exact`. Kertas 297 x 210 mm, judul KARTU STOK, lima baris dengan saldo 200, 700, 500, 400, 340, lalu Jumlah masuk 700 TAB, Jumlah keluar 360 TAB, Saldo akhir 340 TAB. `click button "Pilihan kartu stok"` menampilkan layout A4 dan Unduh Word.
- **Silang.** `sql "select trim_scale(sum(k.jumlah) filter (where k.jumlah > 0)) as masuk, trim_scale(-sum(k.jumlah) filter (where k.jumlah < 0)) as keluar, trim_scale(sum(k.jumlah)) as saldo, trim_scale(sum(k.sisa)) as sisa from gd_tr_kartu_gudang k join gd_m_barang b on b.id = k.barang_id join gd_m_lokasi l on l.id = k.lokasi_id where b.kode = 'PCT-500' and l.kode = 'GUDANG' and k.legal_entity_id = l.legal_entity_id"`. Hasilnya 700, 360, 340, 340, sama dengan cetakan.

## Gotchas

- Periode bawaan adalah bulan berjalan. Data contoh diposting pada tanggal `dev:setup` berjalan, jadi angka di atas hanya berlaku untuk bulan itu.
- Cetakan mengabaikan saringan Batch dan Jenis di layar: kartu stok selalu memuat semua gerak barang itu di lokasi itu.
- Lokasi yang hanya untuk petugasnya tidak ditawarkan di pilihan Lokasi, gerak stoknya tidak ikut tampil tanpa saringan lokasi, dan alamat yang menyebut lokasi itu ditolak dengan pesan dan tombol ke petugas lokasi. Admin data contoh belum menjadi petugas di mana pun, jadi menandai GUDANG Khusus petugas lokasi menyembunyikannya dari admin sampai admin didaftarkan di Petugas lokasi. Stok per lokasi mengikuti aturan yang sama.
