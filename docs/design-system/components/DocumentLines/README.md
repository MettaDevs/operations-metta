# DocumentLines

Editor baris rincian dokumen (penerimaan, permintaan, polis): tabel berisi kontrol per sel, toolbar Tambah/Delete, dan mode fokus untuk dokumen panjang.

## Anatomi

- **Toolbar** (padding `space-1` × `space-2`): Tambah (`add`), Tambah banyak (`add-many`, bila halaman memberi `selectRecords`), Delete (aktif hanya bila ada baris dipilih), aksi lain dari halaman, lalu ikon `maximize-2` "Mode fokus" di ujung kanan.
- **Tabel** dalam mode sel dokumen: padding sel `space-1` × `space-2`, kontrol setinggi `control-height-document`. Label kolom menggantikan label di tiap sel; kontrol tetap membawa nama aksesibel dari kolomnya. Kolom bantuan hanya muncul pada sel yang punya bantuan. Error tampil di dalam sel asalnya.
- **Footer**: total atau ringkasan dari halaman.

## Alur keyboard

- Enter pada input teks atau angka memindahkan fokus ke kontrol berikutnya, menyeberang ke baris berikutnya.
- Enter pada kontrol terakhir menambah baris baru dan memfokuskan kontrol pertama baris itu.
- Enter tidak berpindah bila sedang menyusun huruf (IME), ada tombol pengubah, field baca saja, popup sedang terbuka, field berupa lookup, atau field tanggal.

## Tambah banyak

Padanan aksi **Select items** di subform dokumen Business Central (`SelectMultipleItems` pada Sales Line, Purchase Line, dan Transfer Line). Halaman memberi `selectRecords`: kata benda (`barang`, `tindakan`), loader server yang sama dengan lookup baris, kolom, dan `onAdd`.

- Tambah banyak membuka dialog "Pilih {kata benda}" di atas dokumen: pencarian, tabel yang dimuat bertahap saat digulir, dan centang per baris. Pemilih memakai Dialog, bukan PageDialog, supaya tetap berada di atas saat baris dokumen ada di dalam dialog ringkas (misalnya Hitung baris pada opname). Pilihan tetap tersimpan saat pencarian diganti, dan footer menyebut jumlahnya.
- Tambah di footer memanggil `onAdd` dengan record terpilih, urut sesuai urutan dicentang. Halaman membuat satu baris per record dan mengisi nilai bawaannya (satuan, harga) seperti saat record dipilih lewat lookup baris. Jumlah dibiarkan kosong, sama dengan BC yang hanya memvalidasi nomor barang pada baris baru.
- Sesudah baris ditambahkan, fokus pindah ke kolom `focusColumnId` baris baru pertama, biasanya jumlah.
- Keyboard: panah bawah dari pencarian ke baris pertama, panah atas dan bawah antarbaris, Spasi mencentang, Enter menambah yang dicentang (atau baris yang sedang difokuskan bila belum ada yang dicentang), Ctrl+Enter menambah dari mana saja. Escape dan Batal hanya menutup pemilih; kartu dokumen tetap terbuka dan fokus kembali ke Tambah banyak.
- Mode baca saja tidak menampilkan Tambah banyak.

## Mode fokus

Editor dipindah ke area penuh tanpa dilepas, sehingga lebar kolom dan draft kontrol tetap. Ringkasan error ikut tampil di mode fokus.

## Draft

- Baris baru adalah draft dengan kunci lokal; ID database baru ada setelah Simpan dokumen berhasil.
- Baris dikirim bersama header dalam satu permintaan dan satu transaksi. Error dikembalikan per baris dan kolom (`details.{i}.{kolom}`) dan tampil di sel asalnya; draft tetap ada untuk diperbaiki.
- Mode baca saja memblokir tambah dan hapus baris; pemilihan tetap tersedia.
- Aksi pemilih banyak barang hanya muncul bila lebih dari satu rincian masih bisa ditambahkan. Daftar master dari server (barang, tindakan) dianggap memenuhinya, jadi Tambah banyak selalu tampil pada dokumen yang bisa diubah.
