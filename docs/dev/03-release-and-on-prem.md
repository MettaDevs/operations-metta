# Release dan on-prem dari sisi runtime

Halaman ini hanya sisi runtime: apa yang dibawa image, bagaimana database dibawa ke skema baru, apa yang dikerjakan worker, dan aturan skema yang membuat image boleh dimundurkan. Penomoran rilis, pembangunan dan penyimpanan image, registry, agen server, dan lisensi milik [control-plane-metta](https://github.com/MettaDevs/control-plane-metta); bacalah dokumentasi repo itu untuk bagian tersebut.

## Isi image

`Dockerfile` membangun satu image untuk semua klien. Isinya:

- hasil build server dan peramban di `dist/`;
- berkas migration Core dan setiap module, dengan susunan folder yang sama dengan repo;
- `modules/<module>/module.json` setiap module yang boleh dijual, yang dilaporkan worker sebagai katalog module.

Image membawa semua module. Module yang terbuka untuk sebuah tenant ditentukan entitlement dari control plane dan catatan pemasangan di database lingkungan, bukan isi image.

Build arg `RELEASE` mengisi `OPERATIONS_RELEASE`, yang dilaporkan worker sebagai rilis yang sedang berjalan. Build lokal bernilai `unreleased`.

Dari image yang sama dijalankan, antara lain:

| Perintah | Kapan |
| --- | --- |
| `bun dist/migrate.js` | Sekali, sebelum proses HTTP dan worker versi baru dinyalakan |
| `bun dist/main.js` | Proses HTTP |
| `bun dist/worker.js` | Worker lingkungan |

## Migration

`migrate` di `src/platform/migration/` membaca berkas `.sql` milik Core dari `database/migrations/` dan milik setiap module dari `modules/<module>/database/migrations/`, lalu:

- mengunci `pg_advisory_lock`, sehingga dua proses migrate yang berjalan bersamaan saling menunggu;
- mencatat setiap berkas per pemilik di `schema_migrations` beserta checksum-nya;
- menolak berjalan bila berkas yang sudah tercatat berubah atau hilang dari repo;
- menjalankan Core lebih dulu, lalu module, satu berkas per transaksi.

`bun run migrate` memigrasi Core dan semua module. `--modules a,b` memigrasi Core ditambah module yang disebut, dan `--modules ''` hanya Core. Database lingkungan tidak dimigrasi perintah ini; itu tugas operasi `migrate` milik worker.

Migration tidak punya langkah turun. Berkas yang sudah terbit tidak diubah; perubahan berikutnya selalu berkas baru.

CI memastikan database kosong bisa dimigrasi, migrasi kedua tidak mengubah apa pun, dan skema hasil memasang Core lalu module sama dengan skema hasil memasang semuanya sekaligus. Lihat `.github/workflows/ci.yml`.

## Worker dan operasi lingkungan

`src/worker.ts` menarik operasi dari control plane lewat API worker yang ditandatangani kunci privat host, lalu menjalankannya satu per satu di database host ini. Klien API-nya di `src/platform/control-plane/`, dan operasinya di `src/platform/environment/`.

- Setiap langkah dilaporkan sebelum dijalankan. Laporan itu memperpanjang tenggat operasi, dan worker berhenti di antara langkah bila control plane menjawab operasinya tidak lagi dipegang worker ini.
- Kegagalan ditutup `failed` beserta pesannya.
- SIGTERM ditunggu sampai operasi yang sedang berjalan selesai.
- Setiap operasi aman diulang.

Daftar operasi yang dikenal ada di `knownOperations` dalam `worker.service.ts`. Antara lain:

| Operasi | Yang dikerjakan |
| --- | --- |
| `provision` | Membuat database lingkungan, memigrasi Core di dalamnya, menulis tenant beserta admin pertamanya, lalu mencatat alamatnya di `environment_routes` paling akhir |
| `migrate` | Membawa database lingkungan yang sudah disiapkan ke skema kode ini: Core dan module yang sudah tercatat di `schema_migrations` database itu. Tidak memasang module baru |
| `convert` | Menjadikan demo produksi di tempat. Alamat demo pindah ke alamat produksi dan tetap menunjuk database yang sama |
| `expire` | Mengisi `disabled_at` alamat demo yang kedaluwarsa, sehingga runtime menjawabnya 404. Database tidak disentuh |
| `restore` | Pasangan `expire`: mengosongkan `disabled_at` lagi selama alamat itu masih menunjuk database yang sama |
| `purge` | Membuang database lingkungan bukan produksi setelah masa tenggangnya habis |
| `sync_entitlements` | Menyamakan hak module tenant dengan daftar dari control plane, memasang module yang belum terpasang, dan mencabut hak yang tidak lagi diberikan |
| `sync_identities` | Menautkan identitas SSO ke pengguna lingkungan. Rinciannya di [SSO](32-sso.md) |

`purge` satu-satunya operasi yang tidak dapat dibatalkan. Ia tidak pernah membuang database produksi, database bersama, atau database yang masih ditunjuk alamat aktif mana pun. Alamatnya tetap tercatat nonaktif.

Worker juga melapor saat mulai dan setiap `WORKER_REPORT_SECONDS`. Laporannya berisi rilis image dan, untuk setiap alamat aktif, migration terakhir per pemilik, ukuran database, serta sehat atau tidak. Isinya disusun `gatherHostReport`. Laporan yang gagal hanya dicatat; laporan berikutnya membawa keadaan terbaru.

Setelan worker: `CONTROL_PLANE_URL`, `WORKER_HOST_ID`, `WORKER_PRIVATE_KEY_PATH`, `WORKER_POLL_SECONDS`, dan `WORKER_REPORT_SECONDS`. Tanpa tiga yang pertama worker menolak menyala. Proses HTTP tidak membacanya dan tetap melayani pengguna tanpa worker.

## Mencabut module tidak menyentuh data

`sync_entitlements` yang mencabut hak hanya mengubah status entitlement menjadi `revoked`. Tabel module dan isinya tidak disentuh, jadi hak yang diberikan lagi menampilkan data lamanya. Tidak ada perintah pencabutan yang membuang data module; retensi rekam medis menuntut data bertahan lebih lama daripada masa langganan.

Data yang memang harus pergi, misalnya karena pelanggan berhenti dan memintanya, keluar lewat serah terima atau ekspor yang disepakati, bukan lewat pencabutan module.

## Perubahan skema dan mundur

**Yang dimundurkan saat rilis bermasalah adalah image, bukan database.** Memulihkan database dari cadangan membuang setiap transaksi yang ditulis sesudah pembaruan. Di server klinik, yang hilang adalah rekam medis dan kuitansi.

Karena itu setiap rilis wajib **kompatibel N-1**: skema sesudah migration rilis N tetap dapat dipakai kode rilis N-1.

| Perubahan di migration | Kode rilis sebelumnya | Boleh dalam satu rilis |
| --- | --- | --- |
| Tabel baru | tidak mengenalnya | ya |
| Kolom baru yang boleh kosong atau punya nilai bawaan | tidak menyebutnya | ya |
| Index, constraint yang melonggarkan | tetap menulis nilai yang sah | ya |
| Kolom wajib tanpa nilai bawaan pada tabel yang sudah ada | gagal saat menyisipkan baris | tidak |
| Menghapus atau mengganti nama kolom atau tabel | gagal saat membaca atau menulis | tidak |
| Mengubah tipe kolom, `SET NOT NULL`, constraint yang mengetatkan | gagal pada nilai yang dulu sah | tidak |

Perubahan yang memang merusak dikerjakan bertahap, expand lalu contract:

1. Tambah kolom atau tabel baru yang boleh kosong. Kode lama tetap jalan.
2. Kode baru menulis ke yang lama dan yang baru, dan data lama diisikan ke yang baru.
3. Kode baru membaca dari yang baru.
4. Yang lama dihapus, paling cepat satu rilis sesudah tidak ada kode yang membacanya.

Migration langkah terakhir menulis alasannya di komentar paling atas berkas SQL. Pola yang terlihat merusak tetapi aman bagi kode lama, misalnya melebarkan tipe kolom, juga menulis alasannya. CoreERP menjaga aturan ini dengan test; repo ini belum punya penjaga otomatis, jadi aturan ini dijaga di review. `0002_*` dan `0003_*` adalah konversi id sekali jalan atas baseline CoreERP sebelum ada data pelanggan, bukan contoh untuk migration berikutnya.

Masalah yang ketahuan sesudah pembaruan diselesaikan dengan urutan ini:

1. Matikan fiturnya, bila fitur itu punya sakelar.
2. Maju ke rilis perbaikan.
3. Jalankan image rilis sebelumnya di atas database yang ada. Ini aman karena aturan N-1.

Pemulihan database dari cadangan hanya untuk bencana, dan ia keputusan manusia, bukan tombol.

## On-prem perpetual

On-prem berdiri sendiri. Aturannya dari runtime:

- Proses HTTP tidak bergantung pada control plane. Server pelanggan boleh berjalan dengan satu alamat tanpa `BASE_DOMAIN`.
- Tidak ada telemetry wajib. Pelaporan kesalahan ke Sentry mati selama `SENTRY_DSN` kosong, dan itu bawaannya.
- Update memakai rilis bertanda tangan. Repo ini tidak memuat mekanisme pemasangan update maupun pemeriksa lisensi; keduanya milik control-plane-metta.
- Kode yang dijalankan di server pelanggan tidak dapat dibuat rahasia sepenuhnya. Kerahasiaan mutlak membutuhkan SaaS.

## Lihat juga

- [Grand design](01-grand-design.md)
- [Identity dan access](09-identity-and-access.md)
- [SSO](32-sso.md)
