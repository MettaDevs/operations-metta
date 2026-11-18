# Saran pembayaran

Petugas pembelian membuat draf pembayaran ke vendor untuk semua utang yang jatuh tempo sampai tanggal pilihan, tanpa mengambil faktur satu per satu. Satu draf per vendor aktif, berisi faktur yang sisanya belum lunas dan nota kredit yang kreditnya belum dipakai, selama belum ada di draf pembayaran lain. Vendor yang utangnya habis dikurangi kredit dilewati. Drafnya diperiksa dan diposting seperti pembayaran biasa.

## Sub-features

- `saran-buat` membuat satu draf per vendor dengan faktur dan kredit yang jatuh tempo sampai tanggal pilihan.
- `saran-kosong` menolak bila tidak ada utang yang jatuh tempo dan belum ada di draf lain.
- `saran-vendor` membatasi saran ke satu vendor.

## How to get to it (user POV)

- Sys Admin › Pembelian › Pembayaran ke vendor (`/sysadmin/purchasing/vendor-payments`), tombol `Saran pembayaran` di samping `Baru`.

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, faktur `PI-00000001` diposting, dan jenis bayar `TUNAI - Tunai` berperilaku Tunai, mengikuti [nota kredit pembelian](./nota-kredit-pembelian.md) bagian Prasyarat. Nota kredit `PCM-00000001` potongan 15.000 tanpa Kurangi utang faktur mengikuti langkah Potongan harga di resep yang sama.

- **Buat saran.** Jalankan `go sysadmin/purchasing/vendor-payments`, `click button "Saran pembayaran" --exact`, `fill textbox "Jatuh tempo sampai" 30/11/2026`, `click combobox "Cara bayar"`, `click option "TUNAI - Tunai"`, dan `click button "Buat draf" --exact`. Toast `1 draf pembayaran dibuat: PV-00000001.` muncul dan daftar memuat `PV-00000001` berstatus Draf. `sql "select h.nomor, h.status, e.nomor_dokumen, trim_scale(d.jumlah) from ap_tr_pembayaran h join ap_tr_pembayaran_detail d on d.pembayaran_id = h.id join ap_tr_entri_utang e on e.id = d.entri_utang_id order by d.urutan"` mencetak `PV-00000001 | draf | PI-00000001 | 67500` dan `PV-00000001 | draf | PCM-00000001 | -15000`.
- **Tidak ada lagi.** Ulangi langkah Buat saran. Ringkasan error menyebut `Tidak ada utang vendor aktif yang jatuh tempo`.

## Gotchas

- Isian `Rekening bank` baru muncul sesudah cara bayar non tunai dipilih, dan boleh dikosongkan sampai posting.
- Urutan baris mengikuti jatuh tempo; nota kredit jatuh tempo pada tanggal nota vendor.
- Utang yang sudah ada di draf pembayaran lain tidak diambil lagi, jadi hapus draf lama untuk menyusun ulang saran.
