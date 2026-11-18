# Rekening bank

Petugas mencatat rekening bank milik legal entity: kode, nama, nama bank, nomor rekening, mata uang, dan Diblokir. Saat membayar vendor dengan cara bayar non tunai, petugas memilih rekening asal uang dari daftar ini. Posting pembayaran non tunai tanpa rekening, atau dengan rekening yang diblokir, ditolak. Cara bayar tunai tidak menampilkan isian rekening. Rekening yang sudah dipakai pembayaran tidak bisa dihapus.

## Sub-features

- `rekening-baru` membuat rekening; kodenya disimpan huruf besar.
- `bayar-tanpa-rekening` menolak posting pembayaran non tunai tanpa rekening.
- `bayar-dari-rekening` memposting pembayaran dari rekening; bukti pembayaran mencetak nama bank dan nomor rekening.
- `rekening-diblokir` menyembunyikan rekening diblokir dari pemilih dan menolak posting draf yang memakainya.
- `rekening-terpakai` menolak Delete rekening yang sudah dipakai pembayaran.

## How to get to it (user POV)

- Sys Admin › Bank › Rekening bank (`/sysadmin/bank/bank-accounts`), tombol `Baru`.
- Sys Admin › Pembelian › Pembayaran ke vendor (`/sysadmin/purchasing/vendor-payments`), isian `Rekening bank` sesudah cara bayar non tunai dipilih.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, faktur `PI-00000001` diposting, dan jenis bayar `TRF - Transfer` non tunai, keduanya mengikuti [pembayaran ke vendor](./pembayaran-vendor.md).

- **Rekening baru.** Jalankan `go sysadmin/bank/bank-accounts`, `click button Baru --exact`, `fill textbox Kode bca-ops --exact`, `fill textbox Nama Operasional --exact`, `fill textbox "Nama bank" BCA --exact`, `fill textbox "Nomor rekening" 1234567890 --exact`, dan `click button Simpan --exact`. Toast `Rekening dibuat.`; daftar memuat `BCA-OPS` berstatus Aktif. `sql "select kode, nama_bank, nomor_rekening, mata_uang, diblokir from rekening_bank"` mencetak `BCA-OPS | BCA | 1234567890 | | f`.
- **Bayar tanpa rekening.** Jalankan `go sysadmin/purchasing/vendor-payments`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `click combobox "Cara bayar"`, `click option "TRF - Transfer"`, `click button "Ambil utang terbuka"`, `click checkbox "Pilih PI-00000001"`, `click button "Tambah 1 utang"`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting pembayaran ini?"`. Ringkasan error menyebut `Pilih rekening bank asal uang sebelum posting`.
- **Bayar dari rekening.** Di draf yang sama, jalankan `fill combobox "Rekening bank" BCA`, `click option "BCA-OPS"`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting pembayaran ini?"`. Status Diposting dan isian Rekening bank berisi `BCA-OPS · BCA 1234567890`. `sql "select h.nomor, b.kode, h.bank from ap_tr_pembayaran h join rekening_bank b on b.id = h.rekening_bank_id"` mencetak `PV-00000001 | BCA-OPS |`. `pdf button "Bukti pembayaran" bukti-rekening --exact` memuat `BCA 1234567890`.
- **Diblokir.** Jalankan `go sysadmin/bank/bank-accounts`, `click button "Tindakan untuk BCA-OPS"`, `click menuitem Buka`, `click checkbox Diblokir`, dan `click button Simpan --exact`. Daftar menampilkan status Diblokir. Di draf pembayaran baru dengan `TRF - Transfer`, `fill combobox "Rekening bank" BCA` tidak menawarkan `BCA-OPS`.
- **Terpakai.** Di kartu `BCA-OPS` (`click button "Tindakan untuk BCA-OPS"`, `click menuitem Buka`), jalankan `click button Delete --exact` dan `click button Delete --exact --within "Delete rekening BCA-OPS?"`. Ringkasan error menyebut `sudah dipakai pembayaran ke vendor`.

## Gotchas

- Isian `Rekening bank` baru muncul sesudah cara bayar non tunai dipilih. Cara bayar tunai mengosongkan rekening yang sudah dipilih.
- Pemilih rekening hanya menampilkan rekening tidak diblokir dalam mata uang lokal. Rekening valas tetap ada di daftar Rekening bank.
- Pembayaran yang dicatat sebelum master rekening ada menampilkan teks lamanya di isian `Bank`, hanya baca.
