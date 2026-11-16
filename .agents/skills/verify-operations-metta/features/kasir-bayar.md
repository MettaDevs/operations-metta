# Kasir bayar dan batal pembayaran

Kasir membuka daftar pembayaran, memilih kunjungan yang Belum Bayar, melihat rincian biaya tindakan dan obat, mengisi uang yang diterima, lalu menyimpan. Pembayaran yang salah dibatalkan dengan Batal Pembayaran selama clerk masih berjalan, dan kunjungannya kembali Belum Bayar.

## Sub-features

- `kasir-jenis-bayar` membuat jenis bayar tunai yang tampil di kasir.
- `kasir-clerk-start` memulai clerk kasir untuk pengguna yang sedang masuk.
- `kasir-bayar` membayar tagihan kunjungan dengan tunai dan kembalian.
- `kasir-batal` membatalkan pembayaran dengan alasan.

## How to get to it (user POV)

- Menu aplikasi Kasir › Pembayaran (`/billing/payments`), tombol `Tindakan untuk <NoReg> <nama>`, menu `Bayar`. Halaman pembayaran ada di `/billing/payments/<id kunjungan>`.
- Kasir › Clerk (`/billing/clerk`) untuk Clerk Start dan Clerk End.
- Kasir › Setup › Jenis bayar (`/billing/payment-methods`), tombol `Baru`.

## Driving it with verify.ts

Prasyarat:

- Kunjungan sudah Selesai periksa dan resepnya sudah Siapkan, mengikuti [pemeriksaan](./pemeriksaan-poli.md) dan [resep](./resep-farmasi.md).
- Legal entity tempat kerja punya jenis bayar tunai yang tampil di kasir, dan admin sudah Clerk Start. Data contoh tidak membuat keduanya; buat lewat dua butir pertama, atau pakai `bun scripts/verify.ts journey outpatient --prepare-cashier`.

- **Jenis bayar tunai.** Jalankan `bun scripts/verify.ts go billing/payment-methods`, `click button Baru --exact`, `fill textbox Kode TUNAI --exact`, `fill textbox Nama Tunai --exact`, `fill textbox "Label di kasir" Tunai --exact`, `click combobox Perilaku --exact`, `click option Tunai --exact`, dan `click button Simpan --exact --within "Jenis bayar"`. Daftar menampilkan `TUNAI`, dan `sql "select kode, perilaku, tampil_di_kasir, aktif from jenis_bayar"` mencetak `tunai | t | t`.
- **Clerk Start.** Jalankan `bun scripts/verify.ts go billing/clerk` dan `click button "Clerk Start"`. Teks `Proses Clerk Start sudah dilakukan` muncul.
- **Buka pembayaran.** Jalankan `bun scripts/verify.ts go billing/payments`, `click button "Tindakan untuk <NoReg> " --prefix`, dan `click menuitem Bayar --exact`. Judul `Pembayaran <NoReg>`, Rincian Biaya berisi baris `OBAT` dan `PERAWATAN`, dan `Grand Total` sama dengan jumlah keduanya.
- **Bayar.** Jalankan `bun scripts/verify.ts fill textbox Tunai 60000 --exact`, `click button Simpan --exact --within "Detail Pembayaran"`, lalu `click button Simpan --exact --within "Apakah Anda yakin"`. Tombol `Batal Pembayaran` muncul di toolbar.
- **Bukti bayar.** Jalankan `bun scripts/verify.ts sql "select k.no_bukti, k.nilai, k.jumlah_bayar, k.nilai_kembalian, k.status, d.jenis_biaya_nama, d.status from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id join kasir k on k.id = d.kasir_id where t.sumber_nomor = '<NoReg>'" --save bayar`. Setiap rincian berstatus `ditagih` dan menunjuk satu `kasir` berstatus `diposting`, dengan kembalian sama dengan jumlah bayar dikurangi nilai. Daftar pembayaran menulis kunjungan itu `Sudah Bayar`.
- **Batal pembayaran.** Jalankan `bun scripts/verify.ts click button "Batal Pembayaran"`, `fill textbox "Alasan Batal" "Salah input nominal"`, dan `click button Proses --within "Batal Pembayaran"`. Dialog menyebut nomor bukti kasir yang dibatalkan.
- **Bukti batal.** Jalankan `bun scripts/verify.ts sql "select no_bukti, status, tgl_batal, alasan_batal from kasir where no_bukti = '<no bukti>'" --save batal` dan `sql "select status, count(*), count(kasir_id) from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id where t.sumber_nomor = '<NoReg>' group by status"`. Kasir berstatus `batal` dengan alasan dan waktu batal, rinciannya kembali `terbuka` tanpa `kasir_id`, dan daftar pembayaran menulis kunjungan itu `Belum Bayar`.

## Gotchas

- Data contoh tidak membuat jenis bayar maupun clerk. Tanpa jenis bayar tunai, form bayar hanya punya Data Kasir tanpa isian jumlah bayar, dan tidak ada cara membayar. `journey outpatient` tanpa `--prepare-cashier` berhenti gagal di langkah `kasir-bayar` karena hal ini.
- Dengan jenis bayar tetapi tanpa Clerk Start, Simpan ditolak dengan pesan `Tidak dapat melanjutkan proses, Karena User belum melakukan Start Clerk!` dan tombol Batal Pembayaran tidak muncul.
- Halaman Clerk menampilkan `Memuat…` sebentar. Tunggu tombol `Clerk Start` atau teks `Proses Clerk Start sudah dilakukan`, bukan judul halamannya.
- Clerk Start dan Clerk End tidak meminta kata sandi. Pengguna yang sedang masuk dan punya izin clerk memulai dan mengakhiri clerk-nya sendiri, termasuk pengguna SSO yang tidak punya kata sandi.
- Nama isian uang tunai adalah `Label di kasir` jenis bayarnya, bukan teks tetap. Resep ini memakai `Tunai` karena jenis bayar dibuat dengan label itu.
- Ada tiga tombol `Simpan` dalam alur bayar (form, dialog konfirmasi, dan jenis bayar). Selalu pakai `--within`.
- Angka di layar memakai pemisah ribuan titik (`55.265`). Baca nilai dari `find textbox "Grand Total" --exact`, lalu buang titiknya.
- Daftar pembayaran hanya memuat kunjungan yang sudah Selesai periksa pada tanggal yang dipilih.
- Batal Pembayaran hanya ada selama clerk pembayaran itu masih berjalan. Sesudah Clerk End, koreksinya Nota Kredit, yang belum dipetakan.
