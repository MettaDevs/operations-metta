# Profiling Bun dan PostgreSQL

Gunakan sesuai pertanyaan pengukuran, bukan sebagai daftar setting yang selalu diaktifkan.

## Pisahkan waktu yang berbeda

Catat waktu HTTP klien, waktu sejak request masuk ke proses Bun sampai response siap, waktu menunggu koneksi dari pool, waktu database dari aplikasi, serta CPU/scheduler bila tersedia. Selisih HTTP dan waktu di proses mencakup antrean serta jaringan; ukur biaya jaringan idle sebelum menyebut semuanya antrean.

Periksa waiting, receiving, jumlah baris, ukuran respons, dan encoding. Endpoint yang mengabaikan limit dapat mengirim seluruh dataset walaupun query-nya cepat. Bandingkan encoding secara eksplisit sebagai faktor terpisah; jangan menganggap request k6 otomatis memakai header browser.

Satu proses Bun menjalankan JavaScript di satu thread. CPU proses yang penuh berarti request lain di proses itu menunggu, sekalipun database diam. Waktu database dari aplikasi mencakup round trip dan tunggu; waktu di luar database bukan otomatis CPU, karena request bisa sedang menunggu `pool.reserve()`.

`TRACE_FILE` (lihat `Database.run` di `src/platform/database/`) menulis satu baris JSON per query: id request, urutan, fingerprint dan template query tanpa nilai parameter, durasi, serta status gagal. Pakai untuk mengelompokkan bentuk query, jumlah panggilan per request, dan total waktunya. Jangan menambahkan nilai parameter ke trace. Bedakan list/show/write, respons diterima/ditolak, dan volume data per tenant.

Instrumentasi yang dibaca saat proses mulai perlu restart saat dipasang/dilepas. Simpan log privat dengan batas ukuran; jangan menambah write contention pada disk yang diukur. Ukur overhead lewat kontrol tanpa instrumentasi.

Bila log berada pada tmpfs container, ekspor lewat `docker exec` dari namespace runtime ke berkas privat host. Verifikasi jumlah record; pembacaan archive container dapat tidak melihat isi mount seperti `/dev/shm`.

## Query PostgreSQL

Ambil query yang benar-benar dijalankan, jumlahnya per request, wait events/blockers, pertambahan sesi/transaction, buffer/IO dan WAL. Satu sampel backend menunggu belum membuktikan bottleneck dominan.

Untuk SELECT representatif, pakai EXPLAIN ANALYZE dengan BUFFERS dan TIMING OFF dalam transaksi read-only, statement timeout, dan parameter fixture yang benar. Periksa actual rows versus estimasi, loops, scan/join/sort, serta buffer reads/hits. Jangan memakai EXPLAIN ANALYZE pada write karena ia benar-benar menjalankannya.

Query di repo ini berjalan sebagai prepared statement (`prepare: true`). Rencana yang dipakai bisa berupa generic plan setelah beberapa eksekusi; bila rencana berbeda dari EXPLAIN dengan nilai literal, periksa dengan `PREPARE` lalu `EXPLAIN EXECUTE` dan perhatikan `plan_cache_mode`. Parameter yang di-cast ke tipe selain tipe kolomnya membuat indeks tidak terpakai.

Jika perlu `auto_explain`, periksa versi dan setting awal. Batasi durasi/sampling, nonaktifkan parameter logging, matikan per-node timing bila tidak dibutuhkan, dan siapkan restore. `log_analyze` dapat menambah overhead walau query tidak dicatat. Jangan memulai dengan logging semua query berparameter untuk seluruh server.

Bedakan query tunggal lambat, banyak query murah, serialisasi/otorisasi di aplikasi yang mahal, tunggu koneksi pool, WAL/row locks, CPU steal/scheduler, dan antrean proses. Buktikan lewat trace/plan serta kontrol sebelum mengubah index, query, jumlah proses, ukuran pool, atau setting database.

Untuk biaya trigger PL/pgSQL, statistik `pg_stat_user_functions` dapat membantu. `track_functions = 'pl'` dapat dipasang sementara pada koneksi aplikasi tanpa restart database; ambil delta, jangan reset statistik cluster bersama. Total waktu fungsi adalah elapsed time, bukan CPU. Kembalikan koneksi/setting sesudah profil dan jangan menganggap berkurangnya jumlah write otomatis menaikkan throughput.

## Biaya observability pada host bersama

Bila aplikasi dan layanan pelaporan kesalahan berada di host yang sama, ukur CPU ingestion/worker layanan itu bersama CPU API/database. Sampling tracing dan sampling error adalah setting berbeda. Uji sampling tracing sebagai faktor terpisah sambil mempertahankan pencatatan error, lalu ulangi kontrol. Jelaskan berkurangnya detail tracing sebagai tradeoff; angka sampling dari satu load test tidak menjadi default semua server.

## Batas penerapan

Pengukuran di satu server tidak menjadi default server baru; ulangi dengan workload yang dipasang. Keputusan Bun + Elysia beserta angka dan batasnya ada di [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md) CoreERP.

Rujukan utama:

- https://bun.com/docs
- https://github.com/porsager/postgres
- https://www.postgresql.org/docs/17/auto-explain.html
- https://www.postgresql.org/docs/17/sql-explain.html
- https://www.postgresql.org/docs/17/sql-prepare.html
- https://docs.kernel.org/scheduler/sched-stats.html
