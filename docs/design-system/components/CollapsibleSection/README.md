# CollapsibleSection

FastTab: bagian kartu yang bisa dibuka-tutup dan tetap menampilkan ringkasan isinya saat tertutup.

## Anatomi

- Baris judul (tinggi minimum `fasttab-header`, padding `space-1` × `space-3`): judul `fasttab-title`, lalu ringkasan nilai kunci 14px `muted-foreground` yang dipotong satu baris, lalu chevron.
- Isi: padding `space-3` di semua sisi, dipisah garis atas `border`. Padding atas itu bukan hiasan: ia memberi ruang bagi label mengambang field pertama yang menonjol di atas tepi kontrol.
- Setiap bagian diakhiri garis bawah `border`.

## Perilaku

- Bagian berdiri sendiri: membuka satu tidak menutup yang lain.
- Ringkasan hanya ada saat bagian tertutup, lalu dihapus (bukan disembunyikan) saat dibuka supaya pembaca layar tidak membaca nilai dua kali.
- Bagian yang pernah dibuka bisa dipertahankan terpasang agar draft di dalamnya tidak hilang saat ditutup.
- Saat record dalam mode baca, mengaktifkan judul bagian meminta mode Ubah (lihat RecordEditBoundary).

## Aturan

- Menutup bagian menyembunyikan materi pendukung, bukan alasan pengguna membuka halaman. Daftar utama dan isian utama tetap terbuka.
- Bagian yang tertutup secara bawaan wajib menyebut isinya lewat ringkasan, supaya pengguna tidak perlu membukanya hanya untuk tahu apakah perlu dibuka.
- Panduan yang harus dibaca sebelum bertindak tidak dipindahkan ke dalam bagian tertutup.
