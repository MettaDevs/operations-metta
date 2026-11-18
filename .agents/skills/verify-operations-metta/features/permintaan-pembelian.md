# Permintaan pembelian

Lokasi mengajukan barang yang dibutuhkan. Petugas pembelian mengisi vendor dan harga, menandai permintaan Disetujui, lalu memilih Buat dokumen. Setiap vendor dan lokasi mendapat satu purchase order terbuka, dan permintaannya pindah ke Lihat yang sudah dipesan dengan nomor ordernya.

## Sub-features

- `permintaan-ajukan` mengajukan barang, jumlah, tanggal permintaan, dan tanggal dibutuhkan.
- `permintaan-setujui` mengisi vendor dan menandai Disetujui.
- `permintaan-buat-order` membuat purchase order terbuka per vendor dan lokasi, dan draf amprah untuk permintaan amprah.

## How to get to it (user POV)

- Sys Admin › Pembelian › Permintaan pembelian (`/sysadmin/purchasing/requisitions`).

## Driving it with verify.ts

Prasyarat: tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md). Admin memegang kedua peran.

- **Ajukan.** Jalankan `go sysadmin/purchasing/requisitions`, `click button Baru --exact`, `fill combobox "Untuk lokasi" FARMASI`, `click option FARMASI`, `fill combobox Barang PCT`, `click option PCT-500`, dan `fill textbox Jumlah 10`. Tanggal permintaan terisi hari ini dan bisa diganti lewat `Tanggal permintaan`.
- **Setujui.** Pada kartu yang sama jalankan `fill combobox Vendor PBF`, `click option "PBF Contoh Farma"`, `click checkbox Disetujui`, lalu `click button Simpan --exact`. Toast `Permintaan diajukan.` muncul.
- **Buat order.** Tutup kartu, jalankan `click button "Buat dokumen" --exact` lalu `click button "Buat dokumen" --exact --within "Buat dokumen?"`. Toast `Dokumen dibuat: PO-…` muncul dan daftar kosong.
- **Bukti.** `sql "select r.jumlah, o.nomor, o.status, l.kode from bl_tr_permintaan r join bl_tr_order_detail d on d.id = r.order_detail_id join bl_tr_order o on o.id = d.order_id join gd_m_lokasi l on l.id = o.lokasi_id"`. Satu baris berstatus `terbuka` di FARMASI.

## Gotchas

- Tanggal permintaan yang tidak dikirim layar diisi server dengan hari ini di zona waktu legal entity.
- Harga kosong diisi harga penerimaan terakhir. Data contoh sudah memposting penerimaan PCT-500, jadi harga ordernya bukan 0.
