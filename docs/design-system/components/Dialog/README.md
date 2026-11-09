# Dialog

Dialog seukuran halaman bergaya Dynamics 365 dengan empat ukuran; header dan footer diam, hanya badannya yang menggulir.

## Ukuran

| Ukuran | Bentuk | Untuk |
| --- | --- | --- |
| `full` | Hampir seluruh layar, jarak 8px dari tepi (24px mulai `breakpoint-sm`) | Form panjang, tabel, matriks |
| `wide` (bawaan) | Di tengah, lebar maksimum 896px, tinggi penuh berjarak 16px (40px mulai `breakpoint-sm`) | Form biasa |
| `panel` | Menempel di kanan, lebar maksimum 672px, tanpa radius dan border sisi luar | Detail pendamping |
| `compact` | Kotak kecil di tengah, lebar maksimum 512px, setinggi isinya | Konfirmasi, form satu-dua field |

## Anatomi

- Penutup layar `scrim-modal`. Permukaan: latar `background`, border, `radius-lg`, `shadow-2xl`.
- Header: padding 16px × 24px, garis bawah. Judul 18px semibold; deskripsi 14px `muted-foreground` yang selalu terlihat, bukan tooltip. Tombol tutup `x` 16px di kanan atas.
- Toolbar (opsional): bar perintah lengket di bawah header, padding 4px × 16px.
- Body: satu-satunya bagian yang menggulir, padding 16px × 24px.
- Footer: latar `muted` 30%, garis atas, padding 12px × 24px, tombol rata kanan dengan aksi utama lebih dulu lalu aksi netral (tata letak Fluent). Tepat satu aksi utama yang berwarna; tombol lain netral.

## Tumpukan

- Saat dialog kedua terbuka, dialog di bawahnya bergeser 40px ke kiri (ukuran `wide`: setengah lebarnya ditambah 40px), mengecil ke 97%, berkurang ke 60% opasitas, dan tidak bisa disentuh. Transisi 200ms ease-out, hanya transform dan opasitas; tanpa blur.
- Escape menutup dialog teratas.

## Kapan dipakai

- Konfirmasi, quick-create kecil, input alasan, dan pemilih bantu.
- Form record yang dibuka dari daftar memakai PageDialog, bukan Dialog.
- Select dan lookup di dalamnya dirender ke wadah dialog.
- Dipakai di 31 layar.
