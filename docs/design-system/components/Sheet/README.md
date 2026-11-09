# Sheet

Panel yang meluncur dari tepi layar untuk konteks atau bantuan, bukan untuk form record.

- Penutup layar `scrim-dialog`. Panel: latar `background`, `shadow-lg`, jarak isi `space-4`; masuk 500ms, keluar 300ms.
- Header padding 12px × 16px: judul 14px semibold, deskripsi 14px `muted-foreground`. Footer di bawah dengan padding `space-4`.
- Tombol tutup di kanan atas (`radius-xs`, cincin fokus 2px).
- Select dan lookup di dalam sheet wajib dirender ke wadah sheet.
- Banyaknya field bukan alasan memakai Sheet; form record memakai PageDialog. Dipakai di 7 layar.
