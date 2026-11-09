# DatePicker

Field tanggal kalender yang diketik sebagai `dd/mm/yyyy` dan disimpan sebagai tanggal ISO; varian tanggal-waktu memakai pola yang sama.

## Alur

1. Field kosong difokuskan → petunjuk `dd/mm/yyyy` tampil dalam `control-placeholder`.
2. Pengguna mengetik angka; pemisah `/` disisipkan mengikuti ketikan. Menghapus tidak memasang kembali garis miring di ujung.
3. Delapan digit yang membentuk tanggal sah → nilainya diteruskan sebagai `yyyy-mm-dd`.
4. Teks yang belum sah tetap disimpan sebagai draft induk, sehingga tidak hilang saat FastTab ditutup atau kartu berpindah bagian.
5. Ikon `calendar` di ujung kanan field membuka kalender dalam popover; memilih hari mengisi field.

## Aturan

- Tanggal kalender adalah tanggal lokal tanpa konversi zona waktu, sehingga harinya tidak bergeser.
- Tanggal-waktu lokal memakai varian tanggal-waktu; jangan merakit dua field terpisah.
- Jangan memakai pemilih tanggal bawaan peramban atau formatter tanggal per halaman.
- Di dalam kartu atau dialog, popover kalender dirender ke wadah lapisan itu.
- Rupa field sama dengan Input (label di dalam field, `control-height`, `radius-md`); tombol kalender adalah tombol ikon di dalam field.
