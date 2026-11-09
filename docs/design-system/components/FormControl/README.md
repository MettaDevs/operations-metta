# FormControl

Satu susunan untuk setiap field form: kontrol berlabel di dalam field, kolom bantuan tetap di kanan, dan pesan error yang selalu terlihat di bawahnya.

## Anatomi

- Grid dua kolom: kontrol (lebar sisa) dan slot bantuan `help-slot` (32px). Jarak baris `space-1`, jarak kolom `space-2`, ruang atas `space-1.5` untuk label mengambang.
- Slot bantuan **selalu ada**, berisi atau kosong, supaya tepi kanan dan tinggi semua kontrol sejajar.
- Baris error membentang dua kolom.

## FormGrid

- Satu kolom di bawah `breakpoint-sm`, dua kolom di atasnya; bisa dipaksa satu kolom.
- Jarak antar-field `space-4`, sama di setiap FastTab. Jangan mencampur jarak lain per bagian.

## Kontrol berlabel di dalam field

Input, Select, Combobox, dan Textarea membawa labelnya sendiri di dalam field.

- Field kosong dan tidak difokuskan: label duduk di tengah field pada 14px dan berfungsi sebagai placeholder.
- Difokuskan atau terisi: label naik ke tepi atas (12px, `field-label`), berlatar sama dengan permukaan kontrol, dalam 150ms ease-out.
- Petunjuk format (misalnya `dd/mm/yyyy`) baru muncul saat difokuskan, dengan warna `control-placeholder`.
- Field wajib: tepat satu `*` merah setelah label, dan validasinya ditegakkan. Tanda itu tidak ditulis di teks label.
- Rupa: tinggi `control-height`, padding `space-3`, border `control-border`, radius `radius-md` (Select `radius-sm`), `shadow-xs`, teks `foreground` 14px (16px di bawah `breakpoint-md`). Fokus: border `control-focus` dan cincin 2px. Tidak valid: border dan label `destructive`.
- Latar kontrol mengikuti permukaannya: `card` di dalam Card, `background` di kartu bertumpuk, dialog, dan sheet.
- Label terpisah di samping kontrol hanya untuk Switch dan Checkbox.

## Bantuan field

Bantuan bersifat opsional dan hanya untuk field yang rumit atau tidak langsung jelas.

- Hover pada pemicu bantuan sekitar 1 detik → bantuan tampil sementara; kursor berpindah → bantuan hilang.
- Klik pemicu → bantuan tetap terbuka walau kursor pergi; klik lagi → tertutup.
- Keyboard: Tab ke pemicu, lalu Enter atau Space untuk membuka dan menutup.
- Pada field, pemicunya ikon `info` di slot bantuan, terpisah dari area ketik. Membungkus seluruh field sebagai pemicu pernah dicoba dan ditolak karena bantuan muncul setiap kali kursor sekadar melintas. Pada judul halaman atau bagian, judulnya sendiri yang menjadi pemicu.
- Rupa: `tooltip-surface`, `tooltip-foreground`, border `tooltip-border`, `radius-md`, teks 12px, lebar maksimum `tooltip-max-width`.
- Jangan menambahkan ikon atau deskripsi pada setiap judul halaman/kartu, dan jangan mengulang arti field di header.
- Panduan yang wajib dibaca sebelum mengisi tampil sebagai deskripsi terlihat, bukan bantuan tersembunyi.

## Error

- Pesan tampil di baris error (14px `destructive`), diumumkan sebagai peringatan, dan terhubung ke kontrolnya; kontrol ditandai tidak valid.
- Error tidak pernah disembunyikan di balik hover, dan tidak dipakai sebagai bantuan.

## Aturan isi form record

- Urutan: kode yang dibuat sistem lebih dulu, lalu nama, lalu klasifikasi dan pilihan yang bergantung, sesuai urutan bisnis.
- Record master atau konfigurasi yang punya tanda aktif lahir **aktif**, di form maupun di fallback server. Mengubah record nonaktif mempertahankan statusnya. Dokumen transaksi berstatus siklus (draft, diajukan, selesai) tidak memakai tanda aktif.
- Select hanya untuk pilihan tetap (enum). Referensi ke record lain memakai InlineLookup.
- Baca saja dinyatakan dengan field baca saja, bukan nonaktif (lihat RecordEditBoundary).
