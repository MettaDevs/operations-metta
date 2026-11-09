# Button

Tombol dasar dengan enam varian dan sembilan ukuran; dipakai langsung untuk aksi di luar perintah record.

## Varian

| Varian | Rupa | Untuk |
| --- | --- | --- |
| `default` | isian `primary`, teks `primary-foreground`, hover 90% | Aksi utama di form autentikasi dan dialog konfirmasi |
| `destructive` | isian `destructive`, teks `destructive-foreground` | Konfirmasi tindakan yang menghapus atau membuang |
| `outline` | latar `background`, border, `shadow-xs`; hover `accent` | Batal di dialog, tombol "Daftar" di master-detail |
| `secondary` | isian `secondary` | Tombol navigasi tepi kartu |
| `ghost` | tanpa latar; hover `accent` | Aksi bisnis di bar perintah, tombol ikon |
| `link` | teks `primary`, garis bawah saat hover | Tautan di dalam teks |

Di dalam bar perintah, varian selain `destructive` kehilangan latar dan border lalu tampil sebagai teks `primary`; bar yang menetapkan rupanya.

## Ukuran

| Ukuran | Tinggi | Padding horizontal | Catatan |
| --- | --- | --- | --- |
| `default` | 36px | 16px (12px bila berikon) | |
| `xs` | 24px | 8px | teks 12px, ikon 12px |
| `sm` | 32px | 12px | |
| `command` | 28px | 8px | teks 14px regular, ikon 14px, radius `radius-sm` |
| `lg` | 40px | 24px | |
| `icon`, `icon-xs`, `icon-sm`, `icon-lg` | 36, 24, 32, 40px persegi | — | |

Teks 14px weight 500, radius `radius-md`, jarak ikon-label `space-2`, ikon 16px.

## Keadaan

- Fokus keyboard: border `ring` dan cincin 3px `ring` pada `opacity-ring`.
- Nonaktif: `opacity-disabled`, tidak menerima klik.
- Tidak valid: border dan cincin `destructive`.

## Aturan

- Setiap aksi berikon dan berlabel. Tombol ikon tanpa label wajib punya nama aksesibel dan keterangan hover/fokus.
- Warna aksi berasal dari token (`destructive`, `success`, `warning`), tidak dari palet mentah.
- Jangan merender tombol yang jalurnya belum ada di router.
