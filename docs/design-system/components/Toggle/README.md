# Toggle

Tombol dua keadaan (menyala/padam) untuk pilihan tampilan, bukan untuk menyimpan data.

- Varian `default` (tanpa latar) dan `outline` (border `input`, `shadow-xs`; hover `accent`).
- Ukuran `sm` 32px, `default` 36px, `lg` 40px; lebar minimum sama dengan tinggi. `radius-md`, teks 14px weight 500, ikon 16px.
- Menyala: latar `accent`, teks `accent-foreground`. Hover: latar `muted`, teks `muted-foreground`. Fokus: cincin 3px `ring`. Nonaktif: `opacity-disabled`.
- Keadaan menyala diumumkan sebagai tombol tertekan.
- Dipakai di satu layar; kelompok pilihan memakai ToggleGroup.
