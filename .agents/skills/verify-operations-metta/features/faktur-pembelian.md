# Faktur pembelian dan utang vendor

Petugas pembelian mencatat faktur dari vendor atas barang yang sudah diterima. Ia memilih vendor, mengisi nomor dan tanggal faktur vendor, lalu mengambil baris penerimaan yang belum difakturkan. Jatuh tempo terisi dari termin vendor. Harga boleh diubah mengikuti faktur vendor, dan biaya lain seperti ongkos angkut ditambahkan sebagai baris biaya. Posting mencatat utang yang tampil di Utang vendor sampai dibayar. Penerimaan yang sudah difakturkan tidak bisa dibatalkan postingnya, dan Batal posting faktur menutup utangnya.

## Sub-features

- `termin-baru` membuat termin pembayaran dan memasangnya di vendor.
- `faktur-ambil` mengambil baris penerimaan yang belum difakturkan ke draf faktur.
- `faktur-posting` memposting faktur; utangnya tampil di Utang vendor dengan jatuh tempo.
- `terima-ditolak` menolak Batal posting penerimaan yang sudah difakturkan, dengan tombol Buka faktur.
- `faktur-batal` membatalkan posting faktur; Utang vendor kosong lagi.

## How to get to it (user POV)

- Sys Admin › Pembelian › Setup › Termin pembayaran (`/sysadmin/purchasing/payment-terms`).
- Sys Admin › Pembelian › Faktur pembelian (`/sysadmin/purchasing/invoices`), tombol `Baru`.
- Sys Admin › Pembelian › Utang vendor (`/sysadmin/purchasing/vendor-ledger`).

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md), dan penerimaan `PNR-00000002` berisi 3 BOX PCT-500 dari order, mengikuti [terima dari order](./terima-dari-order.md) sampai Terima sebagian.

- **Termin.** Jalankan `go sysadmin/purchasing/payment-terms`, `click button Baru --exact`, `fill textbox Kode 30h`, `fill textbox Keterangan "30 hari"`, `fill textbox "Jumlah hari" 30`, `click button Simpan --exact`. Toast `Termin dibuat.` dan kodenya menjadi `30H`.
- **Termin di vendor.** Jalankan `go sysadmin/purchasing/vendors`, `click button "Tindakan untuk PBF Contoh Farma"`, `click menuitem Buka`, `fill combobox "Termin pembayaran" 30H`, `click option 30H`, `click button Simpan --exact`.
- **Draf faktur.** Jalankan `go sysadmin/purchasing/invoices`, `click button Baru --exact`, `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `fill textbox "No. faktur vendor" FKT-7781`, dan `fill textbox "Tanggal faktur vendor" 10/11/2026`. Termin terisi `30H · 30 hari` dan Jatuh tempo `10/12/2026`.
- **Ambil baris.** Jalankan `click button "Ambil baris penerimaan"`, `click checkbox "Pilih PNR-00000002 Parasetamol 500 mg"`, dan `click button "Tambah 1 baris penerimaan"`. Baris 1 berisi 3 BOX seharga 12.000.
- **Ubah dan tambah biaya.** Jalankan `fill textbox "Jumlah, baris 1" 2`, `fill textbox "Harga satuan, baris 1" 12500`, `click button "Tambah biaya"`, `fill textbox "Keterangan biaya, baris 2" "Ongkos angkut"`, `fill textbox "Nilai biaya, baris 2" 15000`, lalu `click button Simpan --exact`. Toast `Faktur dibuat.`, judul `PI-00000001 PBF Contoh Farma`, subtotal 38.750, PPN 4.263, total 43.013.
- **Posting.** Jalankan `click button Posting --exact` lalu `click button Posting --exact --within "Posting faktur ini?"`. Jalankan `sql "select h.status, e.jumlah, e.sisa, e.jatuh_tempo, d.jumlah_difaktur from ap_tr_faktur h join ap_tr_entri_utang e on e.faktur_id = h.id join ap_tr_faktur_detail f on f.faktur_id = h.id and f.jenis = 'barang' join bl_tr_penerimaan_detail d on d.id = f.penerimaan_detail_id"`: `diposting`, 43013, sisa 43013, jatuh tempo 2026-12-10, difakturkan 2.
- **Utang vendor.** Jalankan `go sysadmin/purchasing/vendor-ledger`. Satu baris `PI-00000001`, jatuh tempo 10/12/2026, dan footer `Sisa utang 43.013`.
- **Penerimaan terkunci.** Jalankan `go sysadmin/purchasing/receipts`, `click button "Tindakan untuk PNR-00000002"`, `click menuitem Buka`, `click button "Batal posting" --exact`, dan `click button "Batalkan posting" --exact --within "Batalkan posting PNR-00000002?"`. Ringkasan error menyebut `sudah difakturkan di PI-00000001` dengan tombol `Buka faktur PI-00000001`.
- **Batal posting faktur.** Jalankan `click button "Buka faktur PI-00000001"`, `click button "Batal posting" --exact --within "Faktur pembelian"`, lalu `click button "Batalkan posting" --exact --within "Batalkan posting PI-00000001?"`. Entri `faktur` sisa 0 dan ditutup, entri `pembatalan` -43013, difakturkan kembali 0, dan Utang vendor menampilkan `Tidak ada utang ke vendor yang belum dibayar.`

## Gotchas

- Data contoh punya penerimaan `PNR-00000001` dari vendor yang sama, jadi Ambil baris penerimaan juga menampilkan barisnya. Pilih baris `PNR-00000002`.
- Klik baris di daftar vendor dan penerimaan tidak membuka kartu lewat verify.ts; pakai tombol `Tindakan untuk …` lalu menu `Buka`.
- Tombol pemilih baris berlabel `Tambah 1 baris penerimaan`, bukan `Tambah`.
- Kolom Sisa di Utang vendor dan kolom Selisih dari penerimaan di kartu faktur ada di kanan dan tidak tampil di screenshot lebar bawaan; baca lewat `text` atau `sql`.
