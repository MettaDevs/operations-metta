# Calendar

Kalender bulanan untuk memilih tanggal atau rentang; dipakai DatePicker di dalam popover.

- Padding `space-3`, sel 32px, nama hari 12.8px `muted-foreground`.
- Lokal Indonesia: minggu dimulai Senin, nama hari Sen–Min, nama bulan bahasa Indonesia.
- Hari ini berlatar `accent`. Terpilih: isian `primary`. Di luar bulan: `muted-foreground`. Nonaktif: `opacity-disabled`.
- Rentang: ujung membulat `radius-md`, hari di antaranya berlatar `accent`.
- Pindah bulan dengan chevron; bulan dan tahun bisa dipilih dari dropdown.
- Fokus hari: cincin 3px `ring`; panah berpindah hari.
- Tanggal yang dipilih adalah tanggal lokal tanpa konversi zona waktu.
