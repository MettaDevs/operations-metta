# Saran pesan ulang

Petugas mengatur cara pesan ulang barang per lokasi di kartu barang: stok minimum, stok maksimum, Jumlah tetap atau Sampai stok maksimum, dan jumlah pesan ulang. Petugas pembelian memilih Hitung saran di Permintaan pembelian. Barang yang stoknya, ditambah purchase order yang belum datang dan permintaan yang belum dipesan, sampai di stok minimum mendapat baris berstatus Saran. Hitung saran yang diulang tidak menggandakan baris. Saran yang disetujui dibuatkan purchase order seperti permintaan lain.

## Sub-features

- `saran-setelan` mengatur cara pesan ulang barang per lokasi.
- `saran-hitung` membuat baris saran dengan jumlah menurut cara pesan ulangnya.
- `saran-ulang` menjalankan Hitung saran lagi tanpa baris ganda.
- `saran-order` menyetujui saran lalu Buat purchase order.

## How to get to it (user POV)

- Sys Admin › Persediaan › Barang (`/sysadmin/inventory/items`), buka barang, bagian Stok minimum dan maksimum per lokasi.
- Sys Admin › Pembelian › Permintaan pembelian (`/sysadmin/purchasing/requisitions`), tombol Hitung saran.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md). Data contoh memberi PCT-500 stok 300 TAB di FARMASI dan 340 TAB di GUDANG, satuan beli BOX isi 100, stok minimum 100 dan maksimum 500 di FARMASI, dan penerimaan dari PBF Contoh Farma.

- **Buka setelan.** `go sysadmin/inventory/items`, `click button "Tindakan untuk Parasetamol 500 mg"`, `click menuitem Buka`, lalu `click button "Stok minimum dan maksimum per lokasi" --exact`. Baris FARMASI tampil dengan kolom Cara pesan ulang.
- **Jumlah tetap di GUDANG.** `click button Baru --exact --within "Stok minimum dan maksimum per lokasi"`, `click combobox Lokasi`, `fill combobox Lokasi GUDANG`, `click option GUDANG`, `fill textbox "Stok minimum (TAB)" 400`, `click combobox "Cara pesan ulang"`, `click option "Jumlah tetap" --exact`, `fill textbox "Jumlah pesan ulang (TAB)" 100`, `click button Simpan --exact`. Toast `Stok minimum dan maksimum disimpan.` muncul. Kembali dengan `click button "Kembali ke halaman sebelumnya"`.
- **Sampai stok maksimum di FARMASI.** `click row "FARMASI · Farmasi 100 500"`, `press Enter`, `fill textbox "Stok minimum (TAB)" 300`, `click combobox "Cara pesan ulang"`, `click option "Sampai stok maksimum"`, `click button Simpan --exact`. Toast `Stok minimum dan maksimum diperbarui.` muncul.
- **Hitung saran.** `go sysadmin/purchasing/requisitions`, `click button "Hitung saran" --exact`, lalu `click button "Hitung saran" --exact --within "Hitung saran pesan?"`. Toast `Saran dihitung: 2 saran baru.` muncul. Daftar berisi FARMASI 2 BOX (200 TAB sampai stok maksimum 500) dan GUDANG 1 BOX (100 TAB, karena 340 + 100 melewati 400), keduanya vendor PBF Contoh Farma dan status Saran.
- **Hitung lagi.** Ulangi dua klik di atas. Toast `Saran sudah sesuai stok. Tidak ada yang berubah.` muncul dan daftar tetap dua baris.
- **Setujui dan pesan.** `click row Farmasi`, `press Enter`, `click checkbox Disetujui`, `click button Simpan --exact`, `click button "Kembali ke halaman sebelumnya"`, lalu `click button "Buat purchase order" --exact` dan `click button "Buat purchase order" --exact --within "Buat purchase order?"`. Toast `Purchase order dibuat: PO-…` muncul. Hitung saran sekali lagi: FARMASI tidak mendapat saran baru, karena order 200 TAB yang belum datang ikut dihitung.
- **Bukti.** `sql "select l.kode, trim_scale(r.jumlah), s.kode, r.saran, r.disetujui, o.nomor from bl_tr_permintaan r join gd_m_lokasi l on l.id = r.lokasi_id join gd_m_satuan s on s.id = r.satuan_id left join bl_tr_order_detail d on d.id = r.order_detail_id left join bl_tr_order o on o.id = d.order_id where r.deleted_at is null order by 1"`. FARMASI 2 BOX `diubah` dengan nomor order, GUDANG 1 BOX `baru` tanpa order, dan tidak ada baris lain.

## Gotchas

- Baris di tabel setelan dan daftar permintaan dibuka dengan klik ganda. `click row` saja hanya memilih baris; susul dengan `press Enter`.
- Escape tidak menutup kartu setelan yang terbuka di atas kartu barang. Pakai `click button "Kembali ke halaman sebelumnya"`.
- Satuan saran adalah satuan beli bila jumlahnya habis dibagi isinya. Stok minimum yang membuat jumlah tidak bulat per BOX menghasilkan saran dalam TAB.
