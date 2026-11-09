# ActionButton

Perintah record dengan label, ikon, dan ukuran yang sama di setiap layar: Baru, Tambah, Ubah, Simpan, Batal, Delete.

## Kapan dipakai

- Setiap perintah atas record: di bar perintah halaman, toolbar kartu, toolbar rincian dokumen.
- Aksi bisnis lain (misalnya Posting atau Hitung penyusutan) bukan ActionButton. Ia memakai tombol ghost berikon dan berlabel di bar yang sama.

## Intent

| Intent | Label | Ikon | Saat diproses | Warna teks |
| --- | --- | --- | --- | --- |
| `create` | Baru | `plus` | Membuat… | `primary` |
| `add` | Tambah | `plus` | Menambahkan… | `primary` |
| `edit` | Ubah | `pencil` | Memproses… | `primary` |
| `save` | Simpan | `save` | Menyimpan… | `primary` |
| `cancel` | Batal | `x` | Memproses… | `foreground` |
| `archive`, `delete` | Delete | `trash-2` | Memproses… | `primary`; hover `destructive` di atas `destructive` 10% |

- **Baru** membuka kartu record baru, termasuk dokumen, aturan, job, atau relasi bertanggal yang formnya memilih referensi.
- **Tambah** menambah baris rincian atau memasukkan record yang sudah ada ke kelompok/dokumen (aset ke polis, organisasi ke hierarki).
- **Delete** dipakai untuk pengarsipan dan penghapusan lunak. Labelnya tidak mengubah handler, izin, atau cara data disimpan: barisnya tetap hanya mendapat `deleted_at`.

## Yang dipegang komponen

- Label dan ikon kanonik; halaman tidak mengirim teks, ikon, atau ukuran sendiri.
- Rupa: tinggi `command-height`, padding `space-1` × `space-2`, radius `radius-command`, teks 14px regular, ikon 14px, tanpa border dan tanpa latar; hover `accent`.
- Keadaan diproses: ikon berganti `loader-circle` yang berputar, label berganti bentuk *…ing*, tombol menolak klik ulang dan menandai dirinya sibuk untuk pembaca layar.
- Pada perangkat pointer kasar target naik ke `touch-target`.

## Yang disediakan halaman

- Intent, handler, dan keadaan diproses.
- Izin. Perintah yang tidak boleh dijalankan pengguna tidak dirender. Delete mengikuti izin per record yang sama dengan yang ditegakkan server, bukan izin umum halaman.
- Jenis tombol untuk `save` dan `add` wajib dinyatakan: mengirim form atau menjalankan handler klik. Intent lain selalu tombol biasa; Batal tidak pernah mengirim form.

## Aturan

- Simpan selalu eksplisit, di kiri atas area perintah, mendahului Batal. Tidak ada simpan otomatis.
- Semua Baru/Tambah halaman berada di kiri bersama perintah lain.
- Jangan merender perintah yang endpoint-nya belum ada. Tombol yang mengirim ke jalur yang tidak pernah diimplementasikan adalah janji yang gagal saat diklik.
