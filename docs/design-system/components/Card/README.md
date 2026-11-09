# Card

Wadah utama halaman pengaturan dan widget: header yang sekaligus bar perintah, isi, dan footer.

## Anatomi

- **Card**: latar `card`, border `border`, radius `radius-md`, `shadow-sm`, jarak antarbagian `space-3`, padding bawah `space-4`. Kontrol form di dalamnya berlatar `card`.
- **Header** (padding `space-1.5` × `space-4`): judul `page-title`, deskripsi opsional berupa ikon `circle-alert` yang membuka bantuan (hover ±1 detik, klik untuk menahan), lalu aksi. Header berperilaku sebagai bar perintah, jadi tombol di dalamnya memakai kepadatan bar.
- **Aksi**: menempel di kiri setelah judul. Perataan ke kanan hanya untuk menu widget tambahan, bukan untuk tombol Baru.
- **Isi** (padding horizontal `space-4`): filter dan data. Tabel yang dibatasi tingginya memakai scroll viewport dengan header dan footer card di luar area gulir.
- **Footer**: status pemuatan, galat, atau jumlah yang sudah dimuat.

## Aturan

- Satu Card utama per halaman pengaturan.
- Deskripsi card menjelaskan seluruh isi card, bukan field tertentu. Jangan memasang ikon bantuan di setiap judul.
- Jangan menimpa jarak header (misalnya menghapus padding-nya) dari halaman.
- Module yang tampil di dalam Shell tidak membungkus halamannya dengan Card bertepi bulat tambahan; bingkai halaman sudah disediakan Shell.
