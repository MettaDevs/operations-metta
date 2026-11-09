Sistem desain CoreERP yang tidak terikat bahasa pemrograman atau framework. Isinya tiga lapis: **nilai** (token di `tokens.json`), **bentuk dan perilaku** (kartu komponen), dan **alur** (bagian Alur layar, Alur data, dan seterusnya). Implementasi di stack mana pun dianggap setia bila menghasilkan nilai yang sama, perilaku yang sama, dan membaca serta menulis database yang sama persis. Skema database tidak berubah; yang boleh berbeda hanya cara sebuah stack menangani alurnya.

## Cara memakai sistem ini

- `tokens.json` adalah satu-satunya sumber nilai. Petakan setiap token ke variabel tema stack baru **dengan nama yang sama** (`background`, `primary`, `radius-md`, `control-height`, …). Jangan menyalin nilai mentah ke stylesheet halaman.
- Setiap kartu komponen adalah kontrak perilaku: anatomi, keadaan, alur interaksi, apa yang dipegang komponen, dan apa yang wajib disediakan halaman. Pratinjaunya hanya rendisi statis HTML/CSS untuk dilihat, bukan kode yang harus dipakai.
- Pembagian tanggung jawab berlaku di semua stack: **komponen bersama memiliki rupa dan perilaku; halaman memiliki data, izin, dan aksi bisnis.** Halaman tidak menimpa jarak, warna, tinggi, atau markup internal komponen. Tampilan baru yang memang benar dijadikan varian komponen supaya semua layar ikut berubah.
- Shell memiliki header, rail, submenu, pencarian, notifikasi, tema, dan akun. Module hanya merender isi bisnisnya di dalam Shell; ia tidak membuat Shell kedua, iframe, atau bingkai halaman bertepi bulat tambahan.
- Setiap kartu menyebut berapa layar yang memakai komponennya hari ini. Komponen yang belum dipakai layar mana pun (misalnya Drawer, ContextMenu, Attachment, dan komponen percakapan) tidak wajib ikut dipindahkan sebelum ada kebutuhannya.
- Beberapa bagian SDK sengaja tidak punya kartu karena hanya perekat framework: penyedia arah teks, perekat form ke pustaka validasi, pembungkus ikon, dan hook (pemuatan bertahap, navigasi record, konfirmasi, transisi record). Perilaku yang mereka jaga sudah tertulis di kartu yang memakainya.
- Bagian alur memakai nama tabel dan kolom database persis seperti sekarang. Penulisan ulang di stack baru harus lolos pemeriksaan yang sama: nol kebocoran lintas tenant, nol nomor dokumen ganda, nol eskalasi hak.

## Isi dan bahasa

**Bahasa sehari-hari yang menjelaskan tindakan atau dampaknya.** Semua teks layar (label, hint, dialog, keadaan kosong, error, status) berbahasa Indonesia sehari-hari, kalimat pendek, huruf kapital hanya di awal kalimat. Sapaan untuk pengguna adalah *kamu*: "Data sudah berubah sejak kamu membukanya."

**Istilah teknis yang baku tidak diterjemahkan.** push, pull, scope, token, signing secret, webhook, endpoint, prefix, cursor, timestamp, raw body, rate limit, ack, serta GET/POST/PUT ditulis apa adanya; kalimat di sekitarnya tetap bahasa Indonesia.

| Salah | Tulis |
| --- | --- |
| Mode Dorong, Mode Tarik | push, pull |
| cakupan `vendors.read` | scope `vendors.read` |
| rahasia penanda tangan | signing secret |
| mengakui posting | mengirim ack |

**Istilah arsitektur tidak muncul di layar bisnis.** Jangan tampilkan entitlement, artifact, deployment/installation registry, `TenantContext`, `tenant_id`, nama exception, SQL, atau stack trace kecuali layarnya memang untuk operator teknis. Jelaskan dampaknya: "Posting ini belum pernah sampai ke aplikasi finance."

**Nama tidak pernah ditulis mati.** Nama perusahaan, orang, unit organisasi, dan module dibaca dari data. Unit kerja dan orang selalu ditampilkan dengan namanya, bukan ID.

**Label perintah kanonik.** Perintah record memakai label yang sama di setiap layar: **Baru**, **Tambah**, **Ubah**, **Simpan**, **Batal**, **Delete**. Saat diproses label berganti menjadi *Membuat…*, *Menambahkan…*, *Menyimpan…*, atau *Memproses…*. **Baru** membuka record baru; **Tambah** menambah baris rincian atau memasukkan record ke kelompok/dokumen. Jangan menulis ulang menjadi "Tambah alamat".

**Teks status baku.**

- Memuat: "Memuat data…", "Memuat pilihan…"
- Akhir daftar: "Semua hasil sudah dimuat."
- Gagal muat: pesan penyebab diikuti "Coba lagi"
- Salin tautan: "Tautan disalin." atau "Tautan belum dapat disalin."
- Perubahan belum disimpan: judul "Buang perubahan yang belum disimpan?", isi "Perubahan pada kartu ini belum disimpan. Pilih Batal untuk melanjutkan mengisi kartu.", tombol "Buang perubahan"

**Keadaan kosong menyebut tindakannya.** "Belum ada alamat. Pilih Baru untuk mengisi." "Belum ada barang. Pilih Tambah untuk menambahkan baris." Memuat, gagal memuat, tidak berizin, dan memang kosong adalah empat keadaan berbeda (lihat kartu Empty).

**Pesan error ditulis dari fakta yang dimiliki proses.** Judul menyebut apa yang salah; isi menjelaskan penyebab yang diketahui, dampaknya, lalu langkah berikutnya. Tombol menyebut akibat klik ("Perbaiki jumlah", "Lihat pengaturan", "Pilih berkas lain"). "Belum tersimpan" hanya ditulis bila jawaban server membuktikannya. Angka yang membantu memperbaiki (ukuran berkas, batas upload) dibaca dari konfigurasi. Lihat kartu FormErrorSummary.

**Tanpa dialog bawaan peramban.** Konfirmasi memakai dialog sistem (ConfirmDialog), validasi tampil di field dan ringkasan, bukan bubble peramban.

**Field wajib** memakai tepat satu tanda `*` merah (`destructive`) di samping label yang bersih; tanda itu tidak pernah ditulis di dalam teks label.

**Tanggal** tampil `dd/mm/yyyy` dan disimpan dalam ISO. Elipsis memakai satu karakter "…". Tidak ada emoji.

## Fondasi visual

### Warna

- Netral lebih dulu, satu warna aksi. `primary` menandai yang bisa diklik (perintah, tautan, grup ribbon aktif, penunjuk baris aktif). Status memakai `destructive`, `success`, `warning`; jangan memakai warna palet mentah.
- Permukaan: `surface-shell` untuk latar luar dan area kerja Shell; `background` untuk halaman, kartu bertumpuk, dialog; `card` untuk Card; `popover` untuk menu; `sidebar` untuk navigasi.
- Teks: `foreground` untuk isi, `muted-foreground` untuk header kolom, keterangan, dan status. Teks di atas isian berwarna memakai pasangan `*-foreground`-nya.
- **Latar kontrol mengikuti permukaannya.** Input, Select, dan Textarea di dalam Card berlatar `card`; di dalam kartu bertumpuk, dialog, atau sheet berlatar `background`; popup yang dibuka dari sana ikut latar form tersebut. Label mengambang memakai latar yang sama supaya memotong garis tepi dengan rapi.
- **Warna tidak pernah menjadi satu-satunya tanda.** Setiap status dan aksi membawa ikon dan kata.
- Tema gelap memakai abu netral (`oklch` tanpa kroma) dengan `primary` yang lebih terang; warna status dicerahkan dan foreground-nya digelapkan.
- Pasangan dari sumber yang di bawah ambang kontras dipertahankan persis dan ditandai di catatan tokennya: `primary` sebagai teks 14px di tema terang (3.33:1), `primary-foreground` di atas `primary` (3.49:1 terang, 2.72:1 gelap), `control-border` (1.22:1), `control-placeholder` (2.79:1 terang), teks submenu aktif (2.79:1 terang), `chart-4` terang dan `chart-1` gelap. Memperbaikinya adalah keputusan merek, bukan bagian migrasi stack.

### Tipografi

- Keluarga bawaan Poppins (300–700); pengguna boleh memilih Geist Variable lewat pengaturan tampilan, dan pilihan itu berlaku ke seluruh aplikasi. Komponen tidak pernah menetapkan keluarga font sendiri.
- Hierarki tetap: judul bar `page-title` (14px, 600), teks kerja `body` (14px), header kolom `table-header` (12px, 400), judul FastTab `fasttab-title` (18px, 600), identitas record `record-title` (22px, 300). Jangan membesarkan header CRUD ke 20, 30, atau 36px; layar ERP padat, bukan halaman pemasaran.
- Satu judul konten per halaman. Tidak ada eyebrow huruf kapital seperti "MASTER DATA".
- Nilai Input memakai `body-touch` (16px) di bawah `breakpoint-md` agar ponsel tidak memperbesar halaman.
- Nomor baris memakai angka tabular.

### Jarak dan kepadatan

- Padat seperti aplikasi kerja: tombol perintah `command-height` (28px), kontrol `control-height` (36px), baris tabel `table-row-height` (36px), kontrol di sel rincian `control-height-document` (28px). Pada layar sentuh tombol perintah naik ke `touch-target` (44px).
- Form disusun FormGrid: satu kolom di bawah `breakpoint-sm`, dua kolom di atasnya, jarak `space-4`. Setiap field adalah FormControl dengan kolom bantuan tetap `help-slot` (32px) agar semua kontrol sejajar.
- Skala jarak 4px; pakai langkah yang tercantum di token, jangan mencampur jarak per bagian form.

### Radius, garis, dan bayangan

- `radius-md` (6px) untuk Input, tombol, Card, tooltip; `radius-sm` (4px) untuk trigger Select; `radius-command` (3px) untuk tombol di bar perintah; `radius-full` untuk Badge dan tombol bulat kartu; `radius-shell` (16px) hanya untuk bingkai area kerja Shell.
- Pemisah memakai garis 1px `border`. Divider antar-panel adalah garis polos tanpa grip, titik, atau tonjolan; area seret, kursor resize, dan akses keyboard tetap ada.
- Bayangan dipakai hemat: `shadow-xs` kontrol, `shadow-sm` Card dan bingkai Shell, `shadow-lg` tooltip dan panel melayang, `shadow-page` kartu bertumpuk. Tidak ada blur.

### Tata letak

- Shell: rail ikon `rail-width` dan panel submenu (total `sidebar-width`), lalu area kerja berbingkai `radius-shell` di atas `surface-shell`. Kartu bertumpuk menutup hanya area konten; header dan pencarian Shell tetap bisa dipakai.
- Pilih bentuk halaman dari pekerjaan pengguna: **daftar penuh** (ListPage + DataTable) untuk data operasional; **kartu bertumpuk** (PageDialog) untuk Baru, Detail, dan Ubah di atas daftar yang tetap terpasang; **master-detail** hanya bila pengguna perlu berpindah record sambil melihat detail ringkas; **Card** untuk halaman pengaturan.
- Banyaknya field bukan alasan memakai split view atau sheet samping.
- Daftar mengisi tinggi Shell: header, filter, dan footer tetap terlihat; scrollbar tabel selalu terjangkau tanpa menggulir ke record terakhir.

### Keadaan

- **Hover**: `accent` penuh pada tombol ghost dan perintah; `accent` 40% pada baris tabel.
- **Fokus**: tombol mendapat cincin 3px `ring` pada `opacity-ring`; kontrol form mendapat border `control-focus` plus cincin 2px pada `opacity-control-ring`; item navigasi mendapat garis 2px `sidebar-ring`. Fokus keyboard selalu terlihat.
- **Nonaktif**: `opacity-disabled` dan tidak menerima klik.
- **Baca saja ≠ nonaktif.** Field baca saja tetap bisa difokuskan dan diklik untuk masuk mode Ubah (RecordEditBoundary). Jangan menyatakan baca saja dengan disabled.
- **Tidak valid**: border `destructive`, cincin `destructive` 20%, label berwarna `destructive`, pesan tetap terlihat di bawah field.
- **Sedang diproses**: ikon berganti spinner, label berganti bentuk *…ing*, klik ulang ditolak.
- **Dipilih dan aktif** di tabel: baris dicentang `accent` 40%, baris yang detailnya terbuka `accent` 60% plus panah `primary` di kolom nomor.

### Gerak

- Label mengambang naik dalam 150ms ease-out. Kartu bertumpuk bergeser 160ms ease-out. Tooltip muncul dengan fade dan zoom kecil.
- Bila pengguna memilih gerak dikurangi, transisi kartu dimatikan. Tidak ada blur, parallax, atau animasi tata letak.
- Waktu tunggu yang disengaja: bantuan field muncul setelah hover sekitar 1 detik; pencarian ketikan di lookup diberi jeda 250ms; hasil lookup disimpan paling lama 30 detik per field.

## Ikonografi

- Set ikon Lucide (garis, stroke 2, sudut membulat). Ikon yang dipakai komponen ada di grup aset **Icons** sebagai SVG satu warna; set lengkapnya tersedia untuk hampir semua stack.
- Ukuran: 14px di bar perintah, menu kolom, dan tombol command; 16px bawaan; 12px di tombol kecil dan Badge; 24px di kotak ikon Empty.
- Ikon perintah kanonik: Baru/Tambah `plus`, Ubah `pencil`, Simpan `save`, Batal `x`, Delete `trash-2`, sedang diproses `loader-circle` (berputar), bantuan field `info`, deskripsi atau peringatan `circle-alert`, kembali `arrow-left`, bagikan `share`, tab baru `external-link`, perbesar `maximize-2`/`minimize-2`, data sebelumnya/berikutnya `chevron-left`/`chevron-right`, cari `search`, filter `filter`, sematkan `pin`/`pin-off`, menu baris `ellipsis`, menu kolom `menu`, urutan `arrow-up`/`arrow-down`/`arrow-up-down`, baris aktif `arrow-right`, tanggal `calendar`, lampiran `paperclip`.
- Perintah selalu berikon **dan** berlabel. Tombol ikon tanpa label (header kartu, aksi jendela) wajib punya nama aksesibel dan keterangan saat hover/fokus.
- Navigasi tidak memakai titik atau lingkaran hias; item anak tanpa ikon yang bermakna cukup berupa teks.

## Logo

- `coreerp-logo.png` (grup **Logos**) adalah tanda produk dua warna: biru tua untuk huruf C dan dua bilah, biru terang untuk bilah tengah. Di Shell ia duduk di kotak putih 32px berradius `radius-md`, berdampingan dengan nama produk bergaya `page-title`.
- Jangan mewarnai ulang, memotong, atau menggambar ulang tanda ini. Nama dan identitas tenant tidak menggantikan tanda produk; keduanya dibaca dari data.

## Peta alur

- **Alur layar**: daftar, kartu, draft, simpan, hapus lunak, lookup, filter, pemuatan bertahap, bantuan, error.
- **Alur permintaan**: satu permintaan dari alamat sampai jawaban; konteks tenant, organisasi, dan izin.
- **Alur data**: simpan agregat, nomor dokumen, hapus lunak, event, posting, workflow, module, lampiran, jejak perubahan.
- **Pemeriksaan kesetiaan**: daftar periksa untuk membuktikan stack baru berperilaku sama.
