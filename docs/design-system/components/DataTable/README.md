# DataTable

Tabel daftar operasional yang padat: header bisa diurutkan dan diubah lebarnya, menu baris tepat setelah kolom kode, dan data dimuat bertahap saat digulir, tanpa nomor halaman.

## Susunan kolom

`[kotak centang] → # → kode → ⋯ → nama → kolom lain`

- Kotak centang hanya bila ada tindakan massal; aksi massal baru tampil setelah ada baris dipilih.
- Nomor baris 12px `muted-foreground`, angka tabular. Baris aktif ditandai panah `primary` di kolom ini.
- Menu baris `⋯` (`icon-button-xs`) diletakkan tepat setelah kolom identitas pertama, supaya terjangkau di tabel lebar tanpa menggulir ke kanan. Semua aksi per record (Ubah, Atur, Lihat, Delete) masuk menu ini; jangan memasang tombol per baris. Aksi mengikuti izin tiap record; aksi destruktif dipisah garis.

## Header dan sel

- Header: tinggi `table-row-height`, latar `table-header` (di daftar penuh menyatu dengan `surface-shell`), teks 12px regular `muted-foreground`, rata bawah, membungkus beberapa baris. Hanya satu kata yang lebih lebar dari kolom yang diberi elipsis.
- Sel: tinggi `table-row-height`, padding `space-2` × `space-3`, satu baris, elipsis bila melebihi kolom. Header dan sel menampilkan teks penuh saat hover. Teks tidak pernah menimpa kolom tetangga.
- Field wajib di tabel edit diberi `*` merah di header.

## Interaksi

- **Urutkan**: klik header → naik; klik lagi → turun; bergantian. Pada data bertahap pengurutan terjadi di server, tidak pada batch yang sudah dimuat.
- **Menu kolom** (`menu`) dan **filter kolom** (`filter`) muncul saat hover atau fokus pada header, bila layar mengaktifkannya; begitu pula bekukan kolom.
- **Resize kolom**: area seret `resize-handle` di tepi header. Selama ditekan, garis panduan 1px `primary` setinggi tabel bergerak; lebar baru diterapkan saat dilepas. Membatalkan seretan tidak mengubah lebar. Resize juga bisa lewat keyboard.
- **Membuka baris**: klik dua kali, atau Enter/Space saat fokus berada di baris itu. Klik sekali hanya dipakai untuk memilih baris aktif (master-detail). Menu `⋯`, kotak centang, tautan, dan kontrol di dalam baris tidak ikut membuka baris, dan tombol keyboard di dalam kontrol tetap bekerja normal.
- **Pilihan**: tidak ada baris terpilih saat tabel dimuat. Seluruh sel kotak centang bisa diklik; centang header memilih/membatalkan semua dan bisa menunjukkan sebagian. Klik baris (bukan kotak centang) adalah pilihan tunggal: tanda lain dihapus. Baris dicentang `accent` 40%, baris aktif `accent` 60%.
- **Edit List**: baris kosong di bawah dengan ikon `plus` untuk menambah data, bila layar mengaktifkannya.

## Pemuatan bertahap

- Server mengirim batch dengan cursor. Penanda di akhir tabel memuat batch berikutnya saat terlihat, memakai pemilik scroll yang benar (termasuk di dalam overlay).
- Status di baris terakhir: "Memuat data…", pesan gagal dengan "Coba lagi", atau "Semua hasil sudah dimuat." Tabel kosong menampilkan pesan kosong setinggi `table-empty-height`.
- Mengganti pencarian, filter, urutan, atau scope mengosongkan hasil, membatalkan permintaan basi, lalu memuat batch pertama. Tidak ada dua permintaan berjalan bersamaan dan tidak ada baris ganda.
- Tidak ada navigasi nomor halaman, sebelumnya/berikutnya, atau pengambilan seluruh tabel lalu dipotong di klien.

## Mode scroll

- **Viewport** (di halaman daftar): satu wadah scroll asli memegang kedua sumbu, header lengket, scrollbar horizontal di bawah area terlihat.
- **Inline** (di kartu, form, dialog, rincian): tabel mengikuti tinggi isinya; nomor baris boleh disembunyikan bila tidak bermakna.

## Kontrak data (server)

- Pencarian, filter, dan urutan berlaku di server terhadap seluruh hasil yang diizinkan, sebelum batas batch.
- Setiap batch menerapkan tenant, perusahaan, unit organisasi, induk/dependensi, dan izin.
- Kolom urut dan filter di-allowlist; nama kolom dari klien tidak pernah diteruskan ke SQL.
- Urutan stabil dengan pembeda `id`; NULL dan angka diurutkan dengan benar.
- Membuka daftar tidak memerlukan hitungan total. Ekspor, agregat, dan pilih-semua lintas hasil punya operasi server sendiri.
