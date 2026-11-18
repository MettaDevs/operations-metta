# Pembayaran ke vendor

Petugas pembelian membayar utang vendor dari faktur pembelian yang sudah diposting. Ia memilih vendor, cara bayar, rekening bank untuk cara bayar non tunai, dan nomor referensi, lalu mengambil utang yang belum lunas. Jumlah bayar bawaannya sisa utang dan boleh dikurangi untuk bayar sebagian. Posting mengurangi sisa di Utang vendor, dan faktur yang sisanya habis ditutup. Faktur yang sudah dibayar tidak bisa dibatalkan postingnya. Pembayaran yang dibatalkan postingnya membuka utangnya lagi, dan pembayaran yang lebih awal baru bisa dibatalkan sesudah pembayaran berikutnya dibatalkan.

## Sub-features

- `bayar-cara` membuat jenis bayar non tunai yang bisa dipilih sebagai cara bayar.
- `bayar-sebagian` memposting pembayaran sebagian; Utang vendor menampilkan sisa dan nomor pembayarannya.
- `faktur-terkunci` menolak Batal posting faktur yang sudah dibayar, dengan tombol Buka pembayaran.
- `bayar-lunas` memposting sisa utang; entri faktur ditutup oleh pembayaran itu.
- `bayar-cetak` mencetak bukti pembayaran lewat mesin cetak.
- `bayar-urutan` menolak Batal posting pembayaran yang lebih awal, dengan tombol yang membuka pembayaran sesudahnya.
- `bayar-batal` membatalkan posting pembayaran; utangnya terbuka lagi dan fakturnya bisa dibatalkan postingnya.

## How to get to it (user POV)

- Kasir › Setup › Jenis bayar (`/billing/payment-methods`), tombol `Baru`.
- Sys Admin › Pembelian › Pembayaran ke vendor (`/sysadmin/purchasing/vendor-payments`), tombol `Baru`.
- Sys Admin › Pembelian › Utang vendor (`/sysadmin/purchasing/vendor-ledger`), menu `Tindakan untuk <faktur>` berisi `Buka faktur` dan `Buka pembayaran <nomor>`.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md). Faktur `PI-00000001` diposting atas penerimaan contoh `PNR-00000001`: jalankan `go sysadmin/purchasing/invoices`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `fill textbox "No. faktur vendor" FKT-9001`, `fill textbox "Tanggal faktur vendor" 10/11/2026`, `click button "Ambil baris penerimaan"`, `click checkbox "Pilih PNR-00000001 Amoksisilin 500 mg"`, `click button "Tambah 1 baris penerimaan"`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting faktur ini?"`. Utangnya 67.500. Rekening `BCA-OPS` dibuat mengikuti [rekening bank](./rekening-bank.md), langkah Rekening baru.

- **Cara bayar.** Jalankan `go billing/payment-methods`, `click button Baru --exact`, `fill textbox Kode TRF --exact`, `fill textbox Nama Transfer --exact`, `click combobox Perilaku --exact`, `click option "Non tunai" --exact`, dan `click button Simpan --exact`. `sql "select kode, perilaku from jenis_bayar"` mencetak `TRF | non_tunai`.
- **Draf pembayaran.** Jalankan `go sysadmin/purchasing/vendor-payments`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `click combobox "Cara bayar"`, `click option "TRF - Transfer"`, `fill combobox "Rekening bank" BCA`, `click option "BCA-OPS"`, `fill textbox "No. referensi" TRF-0001`, `click button "Ambil utang terbuka"`, `click checkbox "Pilih PI-00000001"`, dan `click button "Tambah 1 utang"`. Baris 1 berisi `PI-00000001`, sisa 67.500, dan jumlah bayar 67500.
- **Bayar sebagian.** Jalankan `fill textbox "Jumlah bayar, baris 1" 30000`, `click button Simpan --exact`, `click button Posting --exact`, dan `click button Posting --exact --within "Posting pembayaran ini?"`. Judul `PV-00000001 PBF Contoh Farma`, kolom Sisa sesudah bayar 37.500. `sql "select nomor_dokumen, jenis, trim_scale(sisa) from ap_tr_entri_utang"` mencetak `PI-00000001 | faktur | 37500` dan `PV-00000001 | pembayaran | 0`.
- **Utang vendor.** Jalankan `go sysadmin/purchasing/vendor-ledger`. Footer `Sisa utang 37.500`; `text` memuat `30.000` dan `PV-00000001` di baris `PI-00000001`.
- **Faktur terkunci.** Jalankan `click button "Tindakan untuk PI-00000001"`, `click menuitem "Buka faktur"`, `click button "Batal posting" --exact --within "Faktur pembelian"`, dan `click button "Batalkan posting" --exact --within "Batalkan posting PI-00000001?"`. Ringkasan error menyebut `sudah dibayar sebagian atau lunas` dengan tombol `Buka pembayaran PV-00000001`.
- **Bayar lunas.** Ulangi Draf pembayaran dengan `fill textbox "No. referensi" TRF-0002`, lalu Simpan dan Posting tanpa mengubah jumlah. Total dibayar 37.500. Entri `PI-00000001` sisa 0, ditutup, dan `ditutup_oleh_entri_id` menunjuk entri `PV-00000002`.
- **Cetak.** Di kartu `PV-00000002`, jalankan `pdf button "Bukti pembayaran" bukti-PV-00000002 --exact`. PDF A4 berjudul `BUKTI PEMBAYARAN KE VENDOR` memuat `PI-00000001`, Dibayar 37.500, dan terbilang `Tiga Puluh Tujuh Ribu Lima Ratus Rupiah`.
- **Urutan batal.** Jalankan `go sysadmin/purchasing/vendor-payments`, `click button "Tindakan untuk PV-00000001"`, `click menuitem Buka`, `click button "Batal posting" --exact`, dan `click button "Batalkan posting" --exact --within "Batalkan posting PV-00000001?"`. Ringkasan error menyebut `sudah dibayar lagi di PV-00000002` dengan tombol `Buka pembayaran PV-00000002`.
- **Batal pembayaran.** Jalankan `click button "Buka pembayaran PV-00000002"`, `click button "Batal posting" --exact`, dan `click button "Batalkan posting" --exact --within "Batalkan posting PV-00000002?"`. Entri `PI-00000001` terbuka lagi dengan sisa 37500, dan entri `pembatalan_pembayaran` 37500 menutup `PV-00000002`. Batalkan juga `PV-00000001` dari daftar; Utang vendor kembali `Sisa utang 67.500`, dan Batal posting faktur `PI-00000001` sekarang berhasil.

## Gotchas

- Data contoh tidak membuat jenis bayar. Tanpa jenis bayar tunai atau non tunai, isian Cara bayar kosong dan hint-nya mengarah ke Kasir › Setup › Jenis bayar.
- `click button Simpan --exact --within "Jenis bayar"` gagal karena menu samping juga bernama Jenis bayar; pakai `click button Simpan --exact` selama hanya kartu jenis bayar yang terbuka.
- Tombol pemilih utang berlabel `Tambah 1 utang`, bukan `Tambah`.
- Kolom Dibayar, Pembayaran, dan Sisa di Utang vendor ada di kanan dan tidak tampil di screenshot lebar bawaan; baca lewat `text` atau `sql`.
- Tanggal bayar tidak boleh sebelum tanggal posting faktur. Faktur yang diposting hari ini hanya bisa dibayar dengan tanggal hari ini atau sesudahnya.
