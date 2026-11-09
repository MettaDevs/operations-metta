# RecordActionBar

Bar perintah di puncak halaman atau kartu: judul, pencarian, perintah, grup ribbon, filter, dan slot pesan, tetap terlihat saat isi digulir.

## Anatomi (kiri ke kanan)

1. Judul halaman bergaya `page-title`; bila judulnya punya bantuan, judul itu sendiri menjadi pemicu bantuan (hover ±1 detik, klik untuk menahan).
2. Pemisah vertikal 20px `border`.
3. Pencarian: tombol ikon `search`; klik membuka kotak cari selebar `search-width` dengan placeholder "Cari...". Panjang maksimum bawaan 200 karakter.
4. Perintah dari halaman (ActionButton dan tombol ghost).
5. Grup ribbon, misalnya Home. Grup aktif bergaris bawah `primary`.
6. Di ujung kanan: tombol filter dan isi tambahan yang fungsinya berbeda (status, menu widget).
7. Di bawah baris: strip ribbon yang disematkan, lalu slot pesan (ringkasan error form).

Bar memakai latar `background`, garis bawah `border`, padding `space-1` × `space-4`, lengket di atas (`z-command-bar`), dan membungkus tombolnya pada layar sempit, bukan memotongnya.

## Alur ribbon

- Tertutup → pilih grup → **melayang** (popover tepat di bawah bar).
- Melayang → pilih grup yang sama → tertutup; pilih grup lain → melayang dengan grup itu.
- Melayang → sematkan (`pin`) → **tersemat**: strip menetap di bawah bar dengan garis atas.
- Tersemat → lepas (`pin-off`) → melayang. Memilih grup lain saat tersemat mengganti isi strip.
- Klik di luar atau Escape hanya menutup ribbon yang melayang. Perintah yang dijalankan dari ribbon melayang menutup ribbon; dari ribbon tersemat tidak.
- Pilihan sematan disimpan per pengguna dan per halaman bila halaman memberi kunci preferensi. Tanpa kunci tidak ada yang disimpan; bila penyimpanan peramban ditolak, bar tetap bekerja.
- Mode dropdown menampilkan setiap grup sebagai menu turun, dengan definisi aksi yang sama.

## Alur pencarian

- Klik ikon cari → kotak terbuka dan langsung difokuskan.
- Enter menjalankan pencarian bila halaman menyediakannya.
- Escape pada kotak kosong menutup kotak dan mengembalikan fokus ke ikon cari.
- Kehilangan fokus dengan kotak kosong menutup kotak; kotak berisi tetap terbuka.
- Pencarian berjalan di server terhadap seluruh hasil yang diizinkan, bukan terhadap baris yang sudah dimuat.

## Filter

- Tombol ikon `filter` membuka/menutup panel filter. Saat ada filter yang berbeda dari bawaannya, ikon diisi `primary` 20%.
- Menutup panel tidak menghapus pilihan filter dan tidak melepas tabel.

## Kepadatan

Bar ini yang menetapkan kepadatan tombol di dalamnya: tinggi `command-height`, padding `space-1` × `space-2`, radius `radius-command`, teks 14px regular, ikon 14px, teks `primary` tanpa latar, hover `accent`. Halaman tidak menimpa tinggi, font, atau border tombol satu per satu.

## Yang disediakan halaman

Judul, perintah beserta izin dan keadaan diproses, definisi grup ribbon, nilai pencarian, keadaan filter, kunci preferensi, dan isi slot pesan. Penyimpanan tetap milik form.
