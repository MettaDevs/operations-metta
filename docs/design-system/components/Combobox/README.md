# Combobox

Dasar pilihan yang bisa diketik; dipakai Select, InlineLookup, dan MultiSelect. Layar memakai ketiganya, bukan Combobox langsung.

- Popup selebar pemicu (boleh lebih lebar sampai batas ruang yang tersedia), padding `space-1`, tinggi maksimum 384px dikurangi tinggi field.
- Item: padding 6px, kanan 32px untuk tanda `check` pilihan, 14px, `radius-sm`; disorot `accent`. Nonaktif `opacity-disabled`.
- Label kelompok 12px `muted-foreground` (14px dan lebih lega pada layar sentuh). Tanpa hasil: teks tengah 14px `muted-foreground`.
- Pilihan banyak tampil sebagai chip: tinggi 22px, latar `muted`, 12px weight 500, `radius-sm`, tombol hapus per chip.
- Label di dalam field dengan `*` merah untuk field wajib; tidak valid → border dan cincin `destructive`.
