# MasterDetailLayout

Daftar ringkas di kiri dan detail di kanan, untuk pekerjaan yang berpindah antar-record sambil menjaga detail ringkas tetap terlihat.

## Kapan dipakai

- Konfigurasi atau pemeriksaan berdampingan, misalnya master kecil yang disunting satu per satu.
- **Bukan** untuk entitas kompleks dengan banyak field, FastTab, dan relasi; itu memakai DataTable plus kartu bertumpuk. Banyaknya field bukan alasan memilih pola ini.
- Bukan untuk navigasi kategori, editor workflow, tabel dengan rincian di bawah, atau drill-down banyak kolom.

## Perilaku

- Mulai `breakpoint-xl`: daftar 25% (antara `master-list-min` dan `master-list-max`) dan detail 75% (minimal `master-detail-min`), dipisah divider polos yang bisa diseret dan dioperasikan dengan keyboard. Lebar hasil seretan diingat selama halaman terbuka.
- Di bawah `breakpoint-xl`: hanya satu panel tampil. Membuka detail menyembunyikan daftar; tombol **Daftar** (outline, ikon `arrow-left`) di atas detail kembali ke daftar.
- Kedua panel tetap terpasang saat berganti, sehingga draft dan posisi gulir tidak hilang. Panel yang tersembunyi tidak bisa difokuskan.
- Setelah memilih atau membuat record, atau meminta Ubah, halaman membuka detail.

## Yang disediakan halaman

Isi daftar, isi detail, keadaan detail terbuka, pilihan record, izin, konfirmasi draft, dan penyimpanan. Detail punya baris aksi dan scroll sendiri.
