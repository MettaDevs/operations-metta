# Accordion

Daftar bagian yang bisa dibuka-tutup; menjadi dasar FastTab.

- Setiap item bergaris bawah `border`, kecuali item terakhir.
- Pemicu: padding vertikal 16px, 14px weight 500, teks bergaris bawah saat hover; chevron 16px `muted-foreground` berputar 180° saat terbuka. Fokus: cincin 3px `ring`.
- Isi 14px, membuka dan menutup dengan animasi tinggi.
- Satu atau banyak bagian boleh terbuka sekaligus; panah atas/bawah berpindah antarpemicu.
- Bagian kartu record memakai CollapsibleSection, yang menambahkan ringkasan saat tertutup. Dipakai langsung di satu layar.
