# DropdownMenu

Menu turun dari tombol pemicu; dipakai untuk menu baris `⋯`, menu kolom, grup ribbon mode dropdown, dan menu akun.

## Rupa

- Panel: latar `popover`, border, `radius-md`, padding `space-1`, `shadow-md`, lebar minimum 128px. Tingginya dibatasi ruang yang tersedia, lalu menggulir.
- Item: padding 6px × 8px, 14px, `radius-sm`, ikon 16px; disorot `accent`. Item nonaktif `opacity-disabled`.
- Item destruktif: teks `destructive`, sorotan `destructive` 10%.
- Label kelompok 14px weight 500; pemisah garis 1px `border`; pintasan di kanan 12px `muted-foreground` berjarak huruf lebar.
- Item centang dan radio memberi ruang kiri 32px untuk tandanya. Submenu ditandai chevron kanan dan terbuka ke samping dengan `shadow-lg`.

## Perilaku

- Panah atas/bawah berpindah, Enter memilih, Escape menutup dan mengembalikan fokus ke pemicu, huruf pertama melompat ke item.
- Di dalam kartu atau dialog, menu dirender ke wadah lapisan itu supaya bisa diklik.
- Aksi per baris tabel selalu lewat menu `⋯`, bukan tombol per baris.
- Dipakai di 13 layar.
