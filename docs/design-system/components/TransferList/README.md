# TransferList

Pemilih dua sisi untuk menugaskan daftar acuan terbatas ke sebuah record: yang belum dipilih di kiri, yang sudah dipilih di kanan.

## Kapan dipakai

- Daftar acuan yang terbatas, ketika melihat yang sudah ditugaskan berdampingan dengan sisanya adalah intinya (jenis pekerjaan, loket, jenis atribut, templat kondisi).
- Daftar sumber besar atau yang perlu dicari memakai multi-lookup.

## Alur

- Klik baris di salah satu sisi hanya **menyorot** baris itu untuk tombol pindah; tidak menugaskan apa pun.
- Hanya tombol pindah yang mengubah penugasan: `chevron-right` (yang disorot ke kanan), `chevron-left` (ke kiri), `chevrons-right` (semua ke kanan), `chevrons-left` (semua ke kiri). Klik dua kali pada baris juga memindahkannya.
- Setiap sisi punya kotak cari sendiri.
- Pratinjau baris aktif terpisah dari pemindahan dan perubahan pilihan.
- Hasil penugasan ikut Simpan form induk.

## Rupa

- Judul sisi 12px semibold huruf kapital `muted-foreground`, kotak cari, lalu daftar bergaris pemisah.
- Baris: nama weight 500, keterangan 12px `muted-foreground`.
- Sisi kosong: "Tidak ada data." (kiri) dan "Belum ada yang dipilih." (kanan).
- Tombol pindah ditumpuk vertikal di antara kedua sisi, masing-masing dengan nama aksesibel ("Pindahkan yang dipilih ke sisi kanan", dan seterusnya).
