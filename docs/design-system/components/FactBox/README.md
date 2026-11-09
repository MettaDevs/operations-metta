# FactBox

Panel pendamping di kanan form atau daftar, berisi tab **Detail** dan **Lampiran**, yang bisa dibuka-tutup dan diubah lebarnya tanpa melepas form utama.

## Anatomi

- Tombol buka/tutup panel (`panel-right-open` / `panel-right-close`) dan tombol perbesar (`maximize-2` / `minimize-2`) di toolbar host.
- Tab **Detail** (ringkasan record terkait) dan **Lampiran** (`paperclip`, dengan jumlah berkas bila diketahui).
- Pembatas yang bisa diseret di antara form dan panel, dengan nama aksesibel "Ubah lebar panel detail dan lampiran".

## Ukuran dan perilaku

- Lebar bawaan 384px, minimum 288px, maksimum lebar wadah dikurangi 356px supaya form utama selalu punya ruang. Perbesar membawa panel ke lebar maksimum itu.
- Mulai `breakpoint-xl` panel berdampingan dan bisa diseret (pointer maupun keyboard). Di bawahnya pembatas disembunyikan dan panel ditumpuk di bawah form.
- Form utama tetap terpasang saat panel diubah ukurannya atau layar menyempit.
- Pada daftar penuh, tabel dan panel menggulir terpisah.

## Lampiran

Batas ukuran per berkas, jumlah berkas, ukuran gabungan, dan jenis berkas dibaca dari server, bukan ditulis di layar. Pada record baru, berkas yang dipilih tetap lokal dan ikut Simpan utama secara atomik; bila Simpan gagal, pilihan berkas dipertahankan.
