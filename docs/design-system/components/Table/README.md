# Table

Bingkai tabel dasar. **Dilarang di UI module**: daftar operasional dan tabel rincian memakai DataTable.

- Tabel 14px dengan scroll horizontal sendiri. Header tinggi 32px, 12px regular `foreground`, padding 8px. Sel padding `space-2`.
- Baris bergaris bawah; hover `muted` 50%; terpilih `muted`. Footer `muted` 50% weight 500. Caption 14px `muted-foreground`.
- Pemeriksaan lint menolak impor Table dan elemen tabel HTML di UI module. Baris komposit memakai fasilitas render baris DataTable di dalam bingkai yang sama.
- Dipakai di 19 layar Core dan konsol operator untuk tabel kecil yang bukan daftar record.
