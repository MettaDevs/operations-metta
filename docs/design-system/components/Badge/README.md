# Badge

Penanda status atau jumlah yang pendek, berbentuk pil, selalu berisi kata.

## Rupa

- Radius `radius-full`, padding 2px × `space-2`, teks `badge` (12px weight 500), ikon 12px, satu baris.
- Fokus: cincin 3px `ring`.

## Varian yang dipakai

| Varian | Rupa | Dipakai untuk |
| --- | --- | --- |
| `default` | isian `primary`, teks `primary-foreground` | Status aktif, setelan menyala |
| `secondary` | isian `secondary` | Status nonaktif, label kategori |
| `outline` | garis `border`, teks `foreground` | Status netral, jumlah halaman terbuka di kartu |
| `destructive` | isian `destructive` | Gagal, ditolak |

Varian `ghost` dan `link` ada untuk Badge yang berupa tautan.

## Aturan

- Warna tidak pernah menjadi satu-satunya tanda; teks status selalu ada.
- Pemetaan status ke varian diputuskan per resource dan konsisten di semua layar resource itu.
- Status berhasil dan peringatan di luar Badge ditulis sebagai teks atau ikon bertoken `success` dan `warning`, bukan dengan warna palet mentah.
- Teks pada `default` hanya 3.49:1 (terang) dan 2.72:1 (gelap), di bawah AA untuk 12px; nilai sumber dipertahankan.
