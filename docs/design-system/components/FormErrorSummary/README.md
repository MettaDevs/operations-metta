# FormErrorSummary

Ringkasan kegagalan yang menetap di bawah bar perintah form aktif, menyebut apa yang salah, dan membawa pengguna ke field yang perlu diperbaiki.

## Anatomi

- Wadah peringatan: latar `card`, border `border`, radius `radius-lg`, padding `space-3` × `space-4`, teks 14px `destructive`, ikon `circle-alert` 16px.
- Judul (weight 500): apa yang salah. Di ujung judul: tombol tampilkan/sembunyikan rincian (`chevron-down`/`chevron-up`) dan "Sembunyikan pesan" (`x`).
- Isi: pesan penyebab, dampak, dan langkah berikutnya, lalu daftar masalah. Setiap masalah adalah tautan ke field asalnya.
- Tindakan: tombol yang menyebut akibatnya; untuk gangguan sistem tersedia "Salin detail bantuan".
- Saat disembunyikan, tersisa tombol ringkas "Tampilkan pesan: {judul}".

## Penempatan

- Di bawah RecordActionBar atau toolbar kartu, di luar body yang bergulir, sehingga tetap terlihat.
- Field yang bermasalah juga ditandai sendiri: pesan di FormControl, status tidak valid, dan hubungan ke pesannya.
- Toast di sudut layar saja tidak cukup sebagai tanda Simpan gagal.

## Alur

1. Submit ditolak (validasi klien atau jawaban server) → ringkasan tampil dan menerima fokus, lalu diumumkan ke pembaca layar.
2. Klik sebuah masalah → bagian atau tab yang tertutup dibuka, form digulir, lalu kontrolnya difokuskan setelah tampil.
3. Pengguna memperbaiki → pemeriksaan ulang berjalan tanpa merebut fokus di setiap ketikan. Memperbaiki satu field tidak menghapus error field lain.
4. Simpan berhasil → error dibersihkan.
5. Isian tidak pernah dibuang selama pemulihan.

## Pemetaan jawaban server ke pesan

| Jawaban | Judul | Isi |
| --- | --- | --- |
| Validasi klien gagal | Periksa isian sebelum melanjutkan | Perbaiki isian yang ditandai. |
| 422 dengan daftar error | Periksa {n} isian yang perlu diperbaiki | Periksa isian yang ditandai, lalu ulangi tindakan ini setelah diperbaiki. |
| 409 `stale_version` | Data sudah berubah sejak dibuka | Perubahan kamu belum tersimpan. Tinjau data terbaru sebelum menyimpan lagi. Isianmu tetap tersedia; jangan muat ulang sebelum mengamankan perubahanmu. |
| 401, atau sesi/token form kedaluwarsa (sekarang 419) | Sesi login sudah berakhir | Masuk kembali sebelum melanjutkan. Isian masih ada selama form terbuka. Amankan isian sebelum berpindah atau memuat ulang halaman. |
| 403 | Kamu belum memiliki akses untuk tindakan ini | Minta pengelola akun memeriksa aksesmu. Mengulang tindakan yang sama tidak mengubah hak akses. Isian tetap tersedia di form. |
| 413 | Berkas melebihi batas upload | Pilih berkas yang lebih kecil sesuai batas upload pada form, lalu upload kembali. |
| 415 | Format berkas belum didukung | Pilih berkas dengan format yang diizinkan pada form, lalu upload kembali. |
| 5xx | Nama operasinya (misalnya "Penerimaan belum dapat disimpan") | Terjadi gangguan sistem. Isian masih tersedia di form. Salin detail bantuan untuk pengelola aplikasi agar penyebabnya dapat diperiksa. |

Detail bantuan untuk 5xx berisi nama operasi, status HTTP, dan kode masalah bila ada. Menyalinnya langsung menyalin dan menampilkan "Rincian sudah disalin." di dekat tombol; bila clipboard gagal, teksnya ditampilkan untuk disalin manual.

## Aturan isi

- Judul menyebut masalahnya; jangan "Oops" atau "Terjadi kesalahan" bila penyebabnya diketahui.
- "Belum tersimpan" hanya bila jawaban server membuktikannya. Status HTTP atau koneksi putus tidak membuktikan hasil commit.
- "Coba lagi" hanya bila mengulang memang bisa menyelesaikan masalah dan aman dari duplikasi.
- Perbaikan satu langkah (Fix-it) hanya bila kondisinya masih berlaku, pengguna berhak, dan server memvalidasi ulang. Tombol yang membawa ke tempat perbaikan (Show-it) hanya bila tujuan dan izinnya benar-benar ada.
- SQL, stack trace, `tenant_id`, dan nama exception tidak tampil di layar bisnis.
