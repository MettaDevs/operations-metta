# NativeSelect

Select bawaan peramban dengan rupa SDK, untuk pilihan tetap yang pendek seperti filter status.

- Tinggi 36px (kecil 32px), padding 12px dengan ruang kanan 36px untuk chevron, `radius-md`, border `input`, `shadow-xs`, 14px. Latar mengikuti permukaan.
- Label di dalam field di tepi atas (12px), sama dengan Input; tidak valid → label `destructive`.
- Daftar opsinya dirender peramban, jadi mengikuti warna sistem.
- Lebarnya 100% wadah; batasi lebarnya di wadah, bukan di elemen select.
- Referensi ke record memakai InlineLookup. Dipakai di 24 layar.
