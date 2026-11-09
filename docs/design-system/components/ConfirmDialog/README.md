# ConfirmDialog

Dialog konfirmasi sistem untuk tindakan yang membuang atau menghapus; pengganti dialog bawaan peramban.

## Anatomi

- Layar di belakang ditutup `scrim-dialog`.
- Dialog di tengah: lebar maksimum 512px, padding `space-6`, jarak `space-4`, radius `radius-lg`, border, latar `background`, `shadow-lg`.
- Judul 18px semibold berupa pertanyaan; deskripsi 14px `muted-foreground` yang menjelaskan dampaknya dan **selalu terlihat**, tidak disembunyikan di balik bantuan.
- Footer: **Batal** (outline) lalu tombol konfirmasi. Label konfirmasi menyebut tindakannya ("Buang perubahan", "Delete"); bawaannya "Lanjutkan". Tindakan destruktif memakai varian `destructive`. Di layar sempit tombol ditumpuk, konfirmasi di atas.

## Alur

1. Halaman meminta konfirmasi dan menunggu jawabannya.
2. Konfirmasi → tindakan dijalankan. Batal, Escape, atau menutup dialog → jawabannya "tidak", tindakan dibatalkan.
3. Hanya satu konfirmasi pada satu waktu; permintaan kedua saat dialog masih terbuka langsung dijawab "tidak".
4. Bila halaman tertutup sebelum dijawab, jawabannya "tidak".

## Pemakaian baku

- **Penjaga draft**: "Buang perubahan yang belum disimpan?" — "Perubahan pada kartu ini belum disimpan. Pilih Batal untuk melanjutkan mengisi kartu." — tombol "Buang perubahan". Dipasang pada Kembali, Tutup, Baru, dan navigasi record di kartu.
- **Delete**: menjelaskan apa yang akan diarsipkan. Delete adalah penghapusan lunak; datanya tetap ada dengan `deleted_at` terisi.
- Input alasan (misalnya alasan penolakan) memakai dialog biasa dengan validasi di header dan field, bukan prompt peramban.
