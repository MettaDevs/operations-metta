# Retur ke vendor

Petugas gudang mengembalikan sebagian barang dari penerimaan yang sudah diposting ke vendornya, misalnya kemasan rusak atau mendekati kedaluwarsa. Ia membuka penerimaannya, memilih Retur ke vendor, mengisi tanggal, alasan, dan jumlah per baris penerimaan. Barang keluar dari lokasi penerimaan dengan batch dan harga baris itu, hanya sebanyak yang masih ada di lokasi. Retur bisa dibatalkan, dan penerimaan yang sudah pernah diretur tidak bisa dibatalkan postingnya.

## Sub-features

- `retur-vendor-tolak-habis` menolak retur atas baris yang barangnya sudah habis dipakai atau dipindah.
- `retur-vendor-simpan` memposting retur dan menampilkannya di bagian Retur ke vendor penerimaan.
- `retur-vendor-tolak-batal-posting` menolak Batal posting penerimaan yang sudah pernah diretur.
- `retur-vendor-batal` membatalkan retur; barangnya kembali ke stok dan bisa diretur lagi.

## How to get to it (user POV)

- Sys Admin › Pembelian › Penerimaan barang (`/sysadmin/purchasing/receipts`), menu `Tindakan untuk <nomor>` › `Buka` pada penerimaan berstatus Diposting, lalu tombol `Retur ke vendor` di toolbar.
- Retur yang sudah tercatat tampil di bagian `Retur ke vendor` di bawah baris penerimaan, dengan `Batal retur` di menu tindakan barisnya.

## Driving it with verify.ts

Prasyarat:

- Tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md).
- Data contoh sudah memposting `PNR-00000001` dari PBF Contoh Farma ke `GUDANG`, lalu dua amprah memindahkan seluruh batch pertama tiap obat dan sebagian batch kedua ke farmasi dan pusling.

- **Buka penerimaan.** Jalankan `bun scripts/verify.ts go sysadmin/purchasing/receipts`, `click button "Tindakan untuk PNR-00000001"`, dan `click menuitem Buka`. Toolbar menampilkan `Retur ke vendor` dan `Batal posting`, dan bagian `Retur ke vendor` menulis `Belum ada barang yang diretur ke vendor.`
- **Retur baris yang sudah habis.** Jalankan `click button "Retur ke vendor" --exact`, `fill textbox "Alasan retur" "Kemasan penyok saat diterima"`, `fill textbox "Diretur sekarang, baris 1" 1`, dan `click button Simpan --exact`. Baris 1 (`PCT2703A`) berkolom `Masih di lokasi` `0 TAB`, dan pesan `Barang dari baris ini sudah tidak ada di Gudang Obat: sudah diretur atau sudah dipakai.` tampil.
- **Simpan retur.** Jalankan `fill textbox "Diretur sekarang, baris 1" ""`, `fill textbox "Diretur sekarang, baris 2" 1`, lalu `click button Simpan --exact`. Toast `Retur RPB-00000001 diposting. Barangnya keluar dari stok lokasi penerimaan.` muncul, dan bagian Retur ke vendor memuat `RPB-00000001` berstatus `Diretur`.
- **Bukti retur.** Jalankan `bun scripts/verify.ts sql "select h.nomor, h.status, d.jumlah, s.kode satuan, k.jenis, k.jumlah kartu_jumlah, k.nilai, t.no_batch from bl_tr_retur h join bl_tr_retur_detail d on d.retur_id = h.id join gd_m_satuan s on s.id = d.satuan_id join gd_tr_kartu_gudang k on k.sumber_jenis = 'retur_pembelian' and k.sumber_id = h.id left join gd_m_batch t on t.id = k.batch_id order by k.id" --save retur-vendor`. Satu baris kartu gudang berjenis `penerimaan`, jumlah `-100`, nilai `-11000`, batch `PCT2809B`.
- **Batal posting ditolak.** Jalankan `click button "Batal posting" --exact` lalu `click button "Batalkan posting" --exact`. Kotak error `Posting belum dibatalkan` menulis `Barang dari penerimaan ini sudah pernah diretur ke vendor (RPB-00000001), jadi postingnya tidak bisa dibatalkan. …`, dan `bl_tr_penerimaan` tetap `diposting`.
- **Batal retur.** Jalankan `click button "Tindakan untuk RPB-00000001"`, `click menuitem "Batal retur"`, lalu `click button "Batal retur" --exact --within "Batal retur RPB"`. Status baris menjadi `Dibatalkan`, kartu gudang retur mendapat baris pembalik `+100` bernilai `11000`, dan `Retur ke vendor` baris 2 kembali berkolom `Masih di lokasi` `340 TAB`.

## Gotchas

- Klik pada sel nomor tidak membuka penerimaan; pakai menu `Tindakan untuk <nomor>` › `Buka`.
- Baris 1 di data contoh selalu habis karena amprah contoh mengambil batch yang paling cepat kedaluwarsa. Pakai baris berkolom `Masih di lokasi` lebih dari 0 untuk retur yang berhasil.
- Dialog konfirmasi dan menu tindakan sama-sama punya tombol `Batal retur`; batasi klik konfirmasi dengan `--within "Batal retur RPB"`.
- Tanggal retur bawaan hari ini. Tanggal sebelum tanggal penerimaan ditolak, dan tanggal di periode persediaan yang ditutup ditolak mesin posting.
