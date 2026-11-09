# DocumentLines

Editor baris rincian dokumen (penerimaan, permintaan, polis): tabel berisi kontrol per sel, toolbar Tambah/Delete, dan mode fokus untuk dokumen panjang.

## Anatomi

- **Toolbar** (padding `space-1` × `space-2`): Tambah (`add`), Delete (aktif hanya bila ada baris dipilih), aksi lain dari halaman, lalu ikon `maximize-2` "Mode fokus" di ujung kanan.
- **Tabel** dalam mode sel dokumen: padding sel `space-1` × `space-2`, kontrol setinggi `control-height-document`. Label kolom menggantikan label di tiap sel; kontrol tetap membawa nama aksesibel dari kolomnya. Kolom bantuan hanya muncul pada sel yang punya bantuan. Error tampil di dalam sel asalnya.
- **Footer**: total atau ringkasan dari halaman.

## Alur keyboard

- Enter pada input teks atau angka memindahkan fokus ke kontrol berikutnya, menyeberang ke baris berikutnya.
- Enter pada kontrol terakhir menambah baris baru dan memfokuskan kontrol pertama baris itu.
- Enter tidak berpindah bila sedang menyusun huruf (IME), ada tombol pengubah, field baca saja, popup sedang terbuka, field berupa lookup, atau field tanggal.

## Mode fokus

Editor dipindah ke area penuh tanpa dilepas, sehingga lebar kolom dan draft kontrol tetap. Ringkasan error ikut tampil di mode fokus.

## Draft

- Baris baru adalah draft dengan kunci lokal; ID database baru ada setelah Simpan dokumen berhasil.
- Baris dikirim bersama header dalam satu permintaan dan satu transaksi. Error dikembalikan per baris dan kolom (`details.{i}.{kolom}`) dan tampil di sel asalnya; draft tetap ada untuk diperbaiki.
- Mode baca saja memblokir tambah dan hapus baris; pemilihan tetap tersedia.
- Aksi pemilih banyak barang hanya muncul bila lebih dari satu rincian masih bisa ditambahkan.
