# ListPage

Kerangka halaman daftar operasional: bar perintah di atas, panel filter di kiri, DataTable mengisi sisa ruang, footer di bawah, semuanya setinggi area kerja Shell.

## Anatomi

1. **Header**: RecordActionBar dengan judul, pencarian, perintah (Baru di kiri), grup Home, dan tombol filter di ujung kanan.
2. **Pesan** (opsional, di bawah header): pemberitahuan wajib dan ringkasan yang harus terbaca sebelum bekerja.
3. **Isi**: panel filter (kiri) dan DataTable dalam mode scroll viewport.
4. **Footer** (opsional): status pemuatan, jumlah baris yang sudah dimuat, ringkasan hasil.

Header, pesan, dan footer tidak ikut bergulir. Satu-satunya scroll adalah milik tabel, sehingga header kolom lengket dan scrollbar horizontal selalu ada di bawah area terlihat.

## Panel filter

- Di layar `breakpoint-lg` ke atas panel berada di samping tabel (lebar 320px, 384px mulai `breakpoint-xl`). Di bawahnya panel pindah ke atas tabel dengan tinggi maksimum 288px dan garis atas.
- Kepala panel: judul `page-title`, deskripsi 12px `muted-foreground` bila perlu, tombol tutup `x` bernama "Tutup …". Isi panel bergulir sendiri.
- Menutup panel tidak menghapus pilihan filter dan tidak melepas tabel. Tombol filter di bar menandai bila ada pilihan yang berbeda dari bawaannya.
- Isian filter, query, dan preset milik halaman. Pencarian teks tetap di bar, bukan di panel.

## Alur

1. Halaman dibuka → batch pertama dimuat dengan filter bawaan.
2. Mengubah pencarian, filter, atau urutan → daftar dikosongkan, permintaan lama dibatalkan, batch pertama dimuat ulang.
3. Menggulir ke akhir → batch berikutnya.
4. Baru, atau klik dua kali pada baris → kartu bertumpuk (PageDialog) terbuka di atas daftar; daftar, filter, urutan, dan posisi gulir tetap di belakangnya.
5. Setelah kartu menyimpan → record hasil respons dimasukkan atau diperbarui di daftar sebelum daftar disegarkan.

## Aturan

- Satu adaptor halaman daftar per module yang menyusun bar, panel filter, dan tabel. Jarak toolbar ke tabel ditetapkan di satu tempat; halaman tidak menyalin tata letak atau mesin buka-tutup filter.
- Jangan menambah ekspor, pilihan banyak, atau aksi kosong hanya agar mirip tangkapan layar.
- Wadah di atas halaman daftar meneruskan tinggi terbatas; mereka tidak ikut tumbuh mengikuti jumlah record.
- Dialog dan sheet ditempatkan bersebelahan dengan tata letak daftar, bukan di dalam tabel.
