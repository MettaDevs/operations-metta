# InputGroup

Field yang menggabungkan input dengan ikon, teks, atau tombol di kiri, kanan, atas, atau bawahnya.

- Bingkai sama dengan Input: border `control-border`, `radius-md`, `shadow-xs`, latar mengikuti permukaan. Input di dalamnya tanpa border dan tanpa cincin; fokus ditandai pada bingkai.
- Tambahan kiri/kanan: padding 12px, teks 14px weight 500 `muted-foreground`, ikon 16px. Tambahan atas/bawah membentang selebar field.
- Tombol di dalamnya: xs 24px atau sm 32px; tombol ikon 24px atau 32px persegi.
- Mengklik area tambahan memfokuskan input. Nonaktif: seluruh kelompok `opacity-disabled`.
- Dipakai di satu layar; lookup memakainya untuk tombol di dalam field.
