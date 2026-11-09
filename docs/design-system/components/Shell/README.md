# Shell

Bingkai aplikasi milik Core: rail ikon, panel submenu, header, dan area kerja tempat setiap module merender isinya.

## Anatomi

- **Rail** (lebar `rail-width`, latar `sidebar`, garis kanan `sidebar-border`):
  - kepala setinggi `nav-header-height` berisi logo produk di kotak putih 32px berradius `radius-md`;
  - item setinggi minimum `rail-item-height`: ikon 16px dalam kotak berpadding 4px, lalu label `nav-rail` (10px) yang membungkus;
  - footer versi produk 10px `muted-foreground`.
- **Panel submenu** (lebar `sidebar-width` dikurangi `rail-width`): judul `nav-heading` setinggi `nav-header-height`; item `nav-item` setinggi minimum `nav-item-height`, padding `space-1` × `space-2`, ikon 14px opsional.
- **Area kerja**: berjarak `space-2` dari atas, kanan, dan bawah; radius `radius-shell`, border, `shadow-sm`, latar `background`. Di dalamnya header (tinggi minimum 48px: tombol menu ponsel, breadcrumb, pencarian, notifikasi, akun) lalu area konten berlatar `surface-shell`.
- **Lapisan kartu**: wadah tak terlihat yang menutupi area konten; PageDialog dirender di sini sehingga header Shell tetap hidup.

## Keadaan navigasi

- Item rail terpilih: kotak ikon terisi `sidebar-primary` dengan ikon `sidebar-primary-foreground`, label `sidebar-foreground`. Hover/pratinjau: latar `sidebar-accent`.
- Item submenu aktif: latar `sidebar-primary` 15%, garis dalam `sidebar-primary` 30%, teks `sidebar-primary`. Hover: `sidebar-accent`.
- Fokus: garis 2px `sidebar-ring`.
- Status aktif ditandai warna, latar, atau indikator, **tanpa** mengubah ukuran atau ketebalan huruf, supaya memilih menu tidak menggeser teks.

## Aturan

- Label menu tampil penuh: tidak ada elipsis, pemotongan, atau batas baris. Label panjang membungkus dan tinggi item bertambah; daftar boleh digulir. Label penuh tidak diganti tooltip.
- Tidak ada titik atau lingkaran hias untuk item tanpa ikon bermakna.
- Navigasi dideklarasikan manifest module dan disaring izin pengguna; rail yang tidak punya item yang boleh dilihat disembunyikan. Module tidak menggambar navigasinya sendiri.
- Setiap rute baru wajib punya entri di navigasi Shell; rute yang hanya bisa dicapai dengan mengetik alamat dianggap belum selesai.
- Module tidak membuat Shell kedua, iframe, atau root aplikasi kedua; ia mewarisi tema dan font Shell.
- Keadaan buka-tutup sidebar disimpan per peramban; pada ponsel navigasi tampil sebagai panel selebar `sidebar-width-mobile`.
- Header, banner lingkungan, dan banner lisensi berada di luar area konten yang bergulir.
