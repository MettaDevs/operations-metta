# Tooltip

Keterangan singkat saat hover atau fokus; dengan mode klik-untuk-menahan ia menjadi dasar bantuan field dan deskripsi kartu.

- Latar `tooltip-surface`, teks `tooltip-foreground` 12px, border `tooltip-border`, `radius-md`, padding 6px × 12px, `shadow-lg`, panah 10px; baris teks diseimbangkan.
- Jeda muncul bawaan 1 detik. Bantuan field memakai jeda sendiri supaya tetap 1 detik walau aplikasi menyetel tooltip lain lebih cepat.
- Mode klik-untuk-menahan: klik pemicu menahan tooltip terbuka walau kursor pergi; klik lagi menutup. Pemicunya tombol sungguhan, jadi Tab lalu Enter/Space melakukan hal yang sama.
- Tombol ikon tanpa label memakai tooltip untuk namanya, dan tetap punya nama aksesibel.
- Sumber tidak punya varian gelap, jadi tooltip tetap putih di tema gelap.
- Dipakai di 5 layar dan di semua bantuan field.
