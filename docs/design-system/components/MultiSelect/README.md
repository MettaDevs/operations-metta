# MultiSelect

Pilihan banyak dari daftar terbatas, misalnya filter laporan "lokasi A atau B".

- Rupa field sama dengan Select: label di dalam field, tinggi minimum 36px, border `input`, `radius-md`; pilihan ringkas dalam satu baris yang dipotong.
- Opsi boleh berupa teks saja atau pasangan nilai dan label (yang disimpan id, yang dibaca orang namanya).
- Nilai yang tidak ada di daftar (master terarsip, atau daftar yang belum selesai dimuat) tidak ditampilkan sebagai id; ia ikut terbuang begitu pengguna mengubah pilihannya.
- Di dalam dialog, popup wajib dirender ke wadah dialog; tanpa itu klik pada item ditelan dialog.
- Daftar besar atau yang perlu dicari memakai multi-lookup berbasis server. Dipakai di 7 layar.
