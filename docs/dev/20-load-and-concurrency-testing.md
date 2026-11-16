# Load dan concurrency testing

Halaman ini menetapkan kapan sebuah module boleh dinyatakan selesai. Test yang lulus tidak cukup: `bun test` menjalankan request satu per satu pada satu proses, sehingga secara struktur tidak dapat melihat pool koneksi habis, nomor yang terbit dua kali, batas tenant yang bocor hanya ketika request saling menyela, atau idempotency key yang berlomba dengan dirinya sendiri.

> **Status di repo ini:** belum ada stack load test atau skenario di repo ini. Gate di halaman ini tetap kanonik. Contoh implementasinya ada di CoreERP: stack di [`apps/core/loadtest/`](https://github.com/MettaDevs/coreERP/tree/main/apps/core/loadtest) dan skenario module di [`modules/apperp/management-aset/loadtest/`](https://github.com/MettaDevs/coreERP/tree/main/modules/apperp/management-aset/loadtest). Angka kapasitas runtime Bun yang sudah diukur ada di skill `operations-metta-bun-elysia`, dan cara menjalankan serta memprofilnya di skill `operations-metta-runtime-operations`.

## Syarat minimum

| Dimensi                                | Minimum                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Virtual user serentak                  | 1000+, ditahan, bukan lonjakan sesaat                                            |
| Tenant yang digerakkan bersamaan       | 100+                                                                             |
| Instance runtime di belakang load balancer | 2+                                                                           |
| Database                               | PostgreSQL, engine yang dipakai produksi                                         |
| Durasi pada beban penuh                | 90 detik+ setelah pemanasan                                                      |
| Number sequence                        | Penerbit sungguhan di dalam runtime; oracle-nya tabel terbitan Core, bukan tiruan |

Beberapa instance bukan hiasan. Itu satu-satunya cara membuktikan module tidak menyimpan counter, identitas tenant, atau cache izin di memori satu proses. Satu instance akan lulus test yang seharusnya gagal. Satu proses Bun hidup lama dan melayani banyak tenant berturut-turut, jadi keadaan yang tertinggal di variabel level berkas langsung tercatat sebagai pelanggaran oleh probe lintas tenant.

## Gate kebenaran

Nilainya wajib **nol**, di perangkat keras apa pun. Mesin lambat bukan alasan.

- Error 5xx yang berasal dari aplikasi.
- Kode bisnis ganda atau `creation_key` ganda dalam satu tenant.
- Baris anak yang induknya milik tenant lain, atau induknya tidak ada.
- Baca, daftar, atau tulis yang menembus batas tenant.
- Izin atas satu resource yang membuka resource sebelahnya.
- Dua request serentak dengan `Idempotency-Key` sama yang menghasilkan dua record.
- Nomor dengan prefix milik reference lain.

Verifikasi lewat SQL langsung ke database sesudah run, bukan lewat API. API adalah yang sedang diuji, jadi ia tidak boleh menjadi hakim atas dirinya sendiri. Probe lintas tenant dan probe eskalasi hak dijalankan **selama** beban penuh, bukan sesudahnya.

Bedakan 5xx aplikasi dari 502 atau 504 load balancer. Yang pertama cacat. Yang kedua berarti kapasitas terlampaui, dan wajib dinyatakan sebagai itu.

### Oracle yang tidak pernah bisa merah bukan oracle

Nol dari pemeriksa yang mati terbaca persis sama dengan nol dari sistem yang benar. Sebelum sebuah nol dipercaya, buktikan pemeriksanya bisa merah: jalankan sekali dengan salah satu pemeriksaan sengaja dilanggar, lalu catat angka merahnya di samping angka hijaunya. Contohnya probe lintas tenant yang diarahkan ke record milik sendiri, atau satu baris cacat yang disuntik ke database lalu dihapus lagi.

Yang dirusak adalah permintaan atau data uji, bukan produknya. Yang dibuktikan adalah pendeteksinya hidup.

Ada pemeriksaan yang tidak dapat dibuat merah lewat suntikan karena skema menolaknya lebih dulu. Foreign key gabungan `(tenant_id, parent_id)` menolak induk lintas tenant di database. Itu jawaban yang sah, dan ditulis sebagai itu: yang menahannya skema, bukan kode aplikasi.

**Status 0 bukan jawaban.** Klien yang menyerah menunggu tidak mengatakan apa-apa tentang benar atau salah. Pemeriksa yang menghitungnya sebagai jawaban memerah setiap kali mesin kehabisan napas, sehingga run yang kapasitasnya terlampaui terlihat sama dengan run yang datanya bocor. Karena itu `http_req_failed` dan `checks` k6 tidak layak menjadi gate kebenaran. Yang layak adalah pencacah yang hanya naik ketika jawaban benar-benar salah.

## Endpoint pengganti wajib mengunci baris yang digantinya

Endpoint yang mengganti sekumpulan baris sekaligus bekerja dengan menghapus lalu menyisipkan ulang. Transaksi saja tidak cukup. Dua pemanggil dapat saling menyela sehingga hasilnya gabungan dua daftar, yang tidak diminta siapa pun dan tidak ditolak batasan database mana pun. Ambil kunci baris pemiliknya dengan `select ... for update` di dalam transaksi, sebelum penghapusan. Versi baris induk yang diklaim lebih dulu memberi efek yang sama.

Tabel penghubung yang disunting dari dua arah wajib mengunci sisi yang sama dari kedua arah, atas gabungan daftar lama dan baru, dalam urutan tetap, misalnya urut `id`. Mengunci pemilik masing-masing arah tidak menyerialkan apa pun, dan urutan yang berlawanan membuat dua transaksi saling menunggu selamanya.

Test biasa dan review kode yang membaca satu request pada satu waktu tidak dapat memperlihatkan ini. Ia hanya terlihat di skenario yang benar-benar berebut.

### Skenario yang tidak pernah berebut tidak membuktikan apa pun

Menyebar pengguna merata ke seluruh tenant dan record adalah bentuk yang benar untuk profil saturasi, dan salah untuk balapan. Skenario balapan memusat: banyak pengguna, sedikit record, nilai yang sengaja bertabrakan. Lalu ia memastikan hasil baca-baliknya sama dengan salah satu nilai yang dikirim, bukan campuran. Simpan sebagai profil tersendiri di samping saturasi.

**Skenario ikut berubah bersama kontraknya.** Setiap perubahan dan penghapusan dalam skenario mengirim versi dari record yang baru dibacanya, sesuai [pengaman edit bersamaan](02-module-standard.md#pengaman-edit-bersamaan). Skenario yang belum ikut gagal di tahap setup dengan 428 `version_required`, dan kegagalan itu milik skenarionya. Jalankan skenario smoke lebih dulu setiap kali kontrak berubah. Di skenario balapan, dua penulis yang membaca versi yang sama berakhir satu 2xx dan satu 409, dan 409 di sana jawaban yang benar.

**Permukaan baru butuh skenarionya sendiri.** Cocokkan daftar resource di skrip dengan route yang terdaftar di `src/index.ts` module. Nama yang kebetulan mirip bukan cakupan.

## Gate latensi

Diukur pada concurrency tertinggi yang masih memenuhi SLO, bukan pada titik jenuh. Latensi saat jenuh mengukur panjang antrean, bukan biaya kode.

| Operasi                                                     | p95      | p99      |
| ----------------------------------------------------------- | -------- | -------- |
| Baca: detail dan daftar                                     | < 200 ms | < 500 ms |
| Tulis: buat, ubah, hapus, termasuk panggilan ke Core         | < 400 ms | < 900 ms |

Catat juga biaya request tunggal tanpa beban. Angka ini lebih mudah dipindahkan antar perangkat keras daripada persentil di bawah beban:

| Jalur                                          | Anggaran |
| ---------------------------------------------- | -------- |
| Tanpa sesi, tanpa database                     | < 25 ms  |
| Dengan sesi, baca satu tabel                   | < 50 ms  |
| Tulis dengan sesi, termasuk penerbitan nomor   | < 120 ms |

## Menyebut bottleneck adalah bagian dari gate

Angka request per detik tidak berarti tanpa perangkat keras yang menyertainya. Yang selalu berarti: resource mana yang jenuh lebih dulu, dengan bukti berupa CPU per container, jumlah koneksi, jumlah proses, dan I/O disk host. "Lambat" bukan hasil.

Yang diperiksa lebih dulu di stack ini ada di skill `operations-metta-bun-elysia`, antara lain:

- Jumlah proses Bun per core dan ukuran pool per proses, dikalikan jumlah instance, terhadap `max_connections` PostgreSQL.
- Prepared statement. Tanpanya setiap query di-parse dan direncanakan ulang.
- Biaya fsync per commit. Di disk yang lambat itu batasnya, bukan CPU. Angka dari mesin yang fsync-nya hampir gratis bukan kapasitas yang tahan lama.

Angka kapasitas tidak disalin ke halaman ini. Bacalah dari skill itu dan dari sumber yang ditunjuknya.

## Memisahkan antrean dari biaya request

Bandingkan waktu HTTP di klien dengan waktu sejak request diterima proses sampai jawaban siap, dan dengan waktu query. Selisih waktu HTTP dan waktu proses mencakup antrean dan jaringan.

Periksa juga ukuran jawaban dan jumlah baris. Parameter `per_page` yang dikirim skenario belum membuktikan endpoint memakainya. Jalankan SELECT representatif lewat `EXPLAIN (ANALYZE, BUFFERS)` di transaksi read-only. Jangan menjalankannya pada perintah tulis, karena perintah itu benar-benar dieksekusi.

Instrumentasi sementara butuh pembanding tanpa profiler, log privat, dan pemulihan setelan. Cookie, token, kata sandi, dan nilai parameter autentikasi tidak masuk laporan.

## Bila load test tidak dapat dijalankan

Nyatakan terus terang bahwa module belum terverifikasi di bawah concurrency, dan jangan melaporkannya selesai. Lingkungan yang tidak lengkap adalah gap yang dilaporkan, bukan gate yang dilewati.

## Setiap angka menyebut dirinya terukur atau perhitungan

Setiap angka di dokumen mana pun menyebut apakah ia terukur atau perhitungan, kapan diambil, dan cara mengulanginya. Tabel yang mengalikan angka terukur menyebut dirinya perhitungan dan menyebut angka dasarnya. Nama sebuah pengukuran juga mengikat: angka dari mesin yang sudah punya image atau cache tidak boleh dinamai "waktu pasang dari mesin bersih".

Bacaan memori container diambil saat idle dan sudah berhenti bergerak, sebelum pengukuran apa pun. Proses pengukur yang berjalan di dalam container ikut terhitung cgroup-nya.

## Aturan oracle dari pengalaman CoreERP

- Uji beban berjalan di runtime sebenarnya, tanpa tiruan Core. Tenant disiapkan lewat jalur penyiapan yang sama dengan server, lalu dipakai lewat sesi seperti pengguna biasa.
- Oracle nomor membaca tabel terbitan nomor dan menuntut setiap kode terikat pada satu terbitan untuk tenant **dan** reference yang benar. Menuntut keunikan saja akan lolos ketika dua tenant saling meminjam urutan.
- Label k6 tidak membawa id, karena label per request membuat k6 kehabisan memori.

## Lihat juga

- [Definition of done](../onboarding/definition-of-done.md)
- [Standar module](02-module-standard.md)
- [Penjaga dan pengujian](25-standar-penjaga-dan-pengujian.md)
- `AGENTS.md`, bagian **Kapan sebuah alur dianggap pindah**
