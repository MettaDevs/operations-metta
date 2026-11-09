# PageDialog

Kartu record yang dibuka sebagai halaman bertumpuk di atas daftar yang tetap terpasang; dipakai untuk Baru, Detail, Ubah, dan pemilih yang memang berbentuk halaman.

## Anatomi

1. **Bar atas** (tinggi minimum `page-dialog-header`), grid empat kolom:
   - **Kembali**: tombol bulat `arrow-left` berlatar `accent` 60%, keterangan "Kembali (Esc)".
   - **Nama fitur**: gaya `card-feature` (12px `muted-foreground`). Bila fiturnya punya bantuan, nama itu sendiri menjadi pemicunya.
   - **Aksi record** (ikon `primary`): Ubah (`pencil`, tampil tertekan bergaris `primary` saat sedang mengubah), Bagikan (`share`, menyalin tautan record), Baru (`plus`), Delete (`trash-2`).
   - **Aksi jendela** (kanan): jumlah halaman terbuka (Badge outline, hanya bila lebih dari satu lapis), aksi tambahan, bantuan halaman, Buka di tab baru (`external-link`), data sebelumnya/berikutnya, Perbesar (`maximize-2`/`minimize-2`), Tutup (`x`).
2. **Identitas record**: kode/nomor dan nama dalam `record-title`, inset `space-10`. Nama fitur dan identitas record adalah dua hal berbeda dan tidak digabung.
3. **Navigasi utama**: bagian kartu; bawaannya **Beranda** (aktif bergaris bawah `primary`) yang kembali ke awal isi. Bantuan halaman duduk di ujung kanan baris ini.
4. **Navigasi sekunder**: aksi milik bagian kartu.
5. **Toolbar form**: Simpan lalu Batal di kiri atas, sebelum body, di dalam form yang sama. Ringkasan error di bawah toolbar, di luar area yang bergulir.
6. **Body** yang bergulir.
7. **Tombol tepi**: data sebelumnya/berikutnya sebagai tombol bulat `secondary` di tepi kiri dan kanan kartu pada layar lebar.

## Tumpukan

- Kartu dibuka di area konten Shell; header dan pencarian Shell tetap bisa dipakai. Di luar Shell kartu memakai viewport.
- Area konten di belakang ditutup `scrim-page`. Kartu di bawah kartu aktif tetap terpasang, tidak bisa disentuh, diredupkan `scrim-inactive`, dan bergeser `stack-offset` ke kiri per lapis (maksimal 3 lapis). Draft, pilihan, posisi gulir, dan ukurannya bertahan.
- Lebar maksimum `page-max-width`, di tengah. Diperbesar: inset `page-expanded-inset` (geseran per lapis `stack-offset-expanded`).
- Area konten lebih sempit dari `breakpoint-page-stack`: kartu memenuhi area, lapisan bawah disembunyikan, tombol perbesar hilang, navigasi data pindah ke bar atas; jumlah lapis tetap terlihat. Kartu selebar `breakpoint-card-narrow` atau kurang: bar atas menjadi dua baris.
- Gerak geser 160ms ease-out; dimatikan bila pengguna memilih gerak dikurangi.

## Alur

- **Membuka**: fokus berpindah ke kartu; pemanggil diingat.
- **Kembali / Tutup / Escape**: tidak menyimpan dan tidak membatalkan record yang sudah tersimpan. Bila ada draft yang belum disimpan, konfirmasi "Buang perubahan yang belum disimpan?" muncul lebih dulu. Fokus kembali ke pemanggil.
- **Escape berlapis**: popup field (lookup, Select, kalender) ditutup lebih dulu, baru kartu teratas.
- **Klik di luar kartu**: tidak menutup kartu dan tidak membuang draft.
- **Sedang menyimpan**: Kembali, Tutup, Escape, dan navigasi data dikunci.
- **Baru (+)** dan **data sebelumnya/berikutnya** melewati penjaga draft yang sama. Navigasi data mengikuti urutan daftar yang sebenarnya (filter dan urutan yang sama), termasuk batch yang belum dimuat; jangan menebak ID.
- **Bagikan / Buka di tab baru** hanya tampil bila record punya alamat yang benar-benar dilayani router. Salin: "Tautan disalin." atau "Tautan belum dapat disalin."
- **Membuka kartu anak** (misalnya detail lookup) menumpuk lapis baru; induknya tidak ditutup.

## Draft dan simpan

- Record baru: semua bagian yang boleh diisi tersedia sejak kartu dibuka. Alamat, kontak, dan baris rincian diisi sebagai draft dengan kunci lokal, lalu dikirim bersama induk dalam **satu** permintaan dan satu transaksi. Tidak ada "simpan dulu" untuk mendapatkan ID.
- Simpan gagal: semua isian dan baris dipertahankan, error tampil di field dan ringkasan.
- Simpan berhasil: kartu menampilkan record hasil respons (lengkap dengan rincian); setelah Ubah tersimpan, kartu kembali ke mode baca.
- Batal di kartu induk membuang draft induk beserta rinciannya; Batal di popup rincian hanya membuang perubahan popup itu.

## Bukan PageDialog

Konfirmasi kecil, quick-create ringkas, tooltip, dan bantuan field tetap memakai dialog atau popover masing-masing. Halaman penuh biasa tidak otomatis menjadi kartu.
