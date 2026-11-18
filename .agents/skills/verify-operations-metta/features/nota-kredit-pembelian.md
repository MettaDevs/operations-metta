# Nota kredit pembelian

Petugas pembelian mencatat nota kredit dari vendor atas barang yang sudah diretur, atau potongan harga atas faktur yang sudah diposting. Ia memilih vendor dan nomor nota vendor, lalu mengambil baris retur yang belum dikreditkan atau baris faktur untuk potongan harga. Nota bisa langsung mengurangi utang satu faktur (Kurangi utang faktur), atau dibiarkan terbuka sebagai kredit yang dipakai saat membayar vendor. Retur yang sudah dikreditkan tidak bisa dibatalkan, dan nota yang kreditnya sudah dipakai tidak bisa dibatalkan postingnya.

## Sub-features

- `nota-retur` mengkreditkan baris retur dan langsung mengurangi utang faktur.
- `nota-retur-terkunci` menolak Batal retur yang barangnya sudah dikreditkan.
- `nota-potongan` mencatat potongan harga sebagai kredit terbuka.
- `nota-di-pembayaran` memakai kredit terbuka di pembayaran ke vendor, sehingga jumlah yang dibayar berkurang.
- `nota-batal` menolak Batal posting nota yang kreditnya dipakai, lalu menerimanya sesudah pembayarannya dibatalkan.

## How to get to it (user POV)

- Sys Admin › Pembelian › Nota kredit pembelian (`/sysadmin/purchasing/credit-memos`), tombol `Baru`.
- Kredit terbuka tampil di Sys Admin › Pembelian › Utang vendor dan di `Ambil utang terbuka` pada Pembayaran ke vendor.

## Driving it with verify.ts

Prasyarat:

- Tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md).
- Faktur `PI-00000001` diposting atas `PNR-00000001`, mengikuti [pembayaran ke vendor](./pembayaran-vendor.md) bagian Prasyarat. Utangnya 67.500.
- Retur `RPB-00000001` sebanyak 1 dari baris 2 `PNR-00000001`, mengikuti [retur ke vendor](./retur-ke-vendor.md) langkah Simpan retur.
- Jenis bayar `TUNAI - Tunai` berperilaku Tunai di Kasir › Jenis bayar, supaya pembayaran tidak butuh rekening bank.

- **Nota atas retur.** Jalankan `go sysadmin/purchasing/credit-memos`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `fill textbox "No. nota vendor" CN-9001`, `click button "Ambil baris retur"`, `click checkbox "Pilih RPB-00000001 Parasetamol 500 mg"`, `click button "Tambah 1 baris retur"`, `click combobox "Kurangi utang faktur"`, `click option PI-00000001 --prefix`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting nota kredit ini?"`. Isian Sisa kredit 0. `sql "select jenis, trim_scale(jumlah), trim_scale(sisa) from ap_tr_entri_utang order by created_at"` mencetak `PI-00000001 | 67500 | 56500` dan `PCM-00000001 | -11000 | 0`. `sql "select trim_scale(jumlah_dikredit) from bl_tr_retur_detail"` mencetak `1`.
- **Retur terkunci.** Jalankan `go sysadmin/purchasing/receipts`, `click button "Tindakan untuk PNR-00000001"`, `click menuitem Buka`, `click button "Tindakan untuk RPB-00000001"`, `click menuitem "Batal retur"`, dan `click button "Batal retur" --exact --within "Batal retur RPB"`. Ringkasan error menyebut `sudah dikreditkan di PCM-00000001` dengan tombol `Buka nota kredit PCM-00000001`.
- **Potongan harga.** Jalankan `go sysadmin/purchasing/credit-memos`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `fill textbox "No. nota vendor" CN-9002`, `click button "Potongan harga"`, `click checkbox "Pilih PI-00000001 Amoksisilin 500 mg"`, `click button "Tambah 1 baris faktur"`, `fill textbox "Potongan per satuan" 100`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting nota kredit ini?"`. Isian Sisa kredit `15.000`.
- **Kredit di pembayaran.** Jalankan `go sysadmin/purchasing/vendor-payments`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `click combobox "Cara bayar"`, `click option "TUNAI - Tunai"`, `click button "Ambil utang terbuka"`, `click checkbox "Pilih PI-00000001"`, `click checkbox "Pilih PCM-00000002"`, `click button "Tambah 2 utang"`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting pembayaran ini?"`. Baris `PCM-00000002` bernilai `-15.000`, Total dibayar `41.500`, dan entri `pembayaran` `PV-00000001` bernilai `-41500`.
- **Lepas dari faktur.** Di run baru dengan faktur `PI-00000001` saja: buat nota Potongan harga `CN-9002` seperti langkah Potongan harga, tetapi sebelum Simpan jalankan `click combobox "Kurangi utang faktur"` dan `click option PI-00000001 --prefix`. Sesudah posting, toolbar nota memuat `Lepas dari faktur`. Jalankan `go sysadmin/purchasing/vendor-ledger`, `click checkbox "Tampilkan yang sudah ditutup"`, `click button "Tindakan untuk PCM-00000001"`, dan `click menuitem "Lepas dari faktur"`. Dialog `Lepas PCM-00000001 dari faktur` menampilkan `PI-00000001 · FKT-9001`, jumlah 15.000, dan Tanggal lepas hari ini. `click button "Lepas dari faktur" --within "Lepas PCM-00000001"`. `sql "select nomor_dokumen, trim_scale(sisa) from ap_tr_entri_utang order by created_at"` mencetak `PI-00000001 | 67500` dan `PCM-00000001 | -15000`; `ap_tr_nota_kredit` mencatat `jumlah_diterapkan` 15000, `tanggal_dilepas`, dan `dilepas_oleh_user_id`. Kurangi utang faktur di nota menjadi `PI-00000001 · FKT-9001 · dilepas <tanggal>`, lalu Batal posting nota dan Batal posting faktur berhasil.
- **Batal posting nota.** Buka `PCM-00000002` dari daftar nota kredit, `click button "Batal posting" --exact`, dan `click button "Batalkan posting" --exact`. Ringkasan error menyebut pembayaran `PV-00000001` dengan tombol `Buka pembayaran PV-00000001`. Sesudah posting `PV-00000001` dibatalkan, ulangi dan status nota menjadi Dibatalkan.

## Gotchas

- `Kurangi utang faktur` hanya menawarkan faktur vendor yang sama yang masih punya sisa. Nota yang langsung mengurangi faktur dilepas dulu lewat `Lepas dari faktur` sebelum postingnya bisa dibatalkan.
- Nomor nota vendor tetap terpakai sesudah posting nota dibatalkan.
- Baris kredit di pembayaran tampil negatif. Angka yang diketik dicatat dengan tanda entri yang dipakai, jadi `5000` dan `-5000` sama artinya.
