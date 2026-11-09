---
name: operations-metta-runtime-operations
description: Change runtime settings, run business load tests, and profile Bun/PostgreSQL for operations-metta with repeatable evidence and rollback. Use for load-test runs and their results, capacity investigations, tuning `DB_POOL_SIZE`, process count, session backend (Valkey), or PostgreSQL settings, profiling a slow procedure with `TRACE_FILE` or `EXPLAIN`, and preparing or checking a runtime node; not for release/image delivery (control-plane-metta), database sharding design, or unrelated application features.
---

# Operasi runtime operations-metta

Hasil harus dapat diulang: konfigurasi tersimpan sama dengan runtime yang diukur dan kesimpulan menyebut apa yang benar-benar terbukti. Jumlah proses atau ukuran pool hasil satu server bukan default untuk server lain. Angka dan setelan yang sudah diukur ada di `operations-metta-bun-elysia`; skill ini mengatur cara mengukur dan mengubahnya.

## Temukan keadaan yang aktif

- Baca alias server di konfigurasi SSH pengguna. Gunakan dokumentasi proyek dan runtime untuk peran node; jangan menyalin IP, user, atau key dari catatan lama, dan jangan menuliskannya ke repo ini (`AGENTS.md`, Repo ini publik).
- Catat commit, digest image, topology API/database/proxy, cgroup CPU/RAM, jumlah proses Bun, `DB_POOL_SIZE`, `SESSION_BACKEND`, koneksi, serta beban lain pada host dan generator. Simpan baseline dan cara rollback sebelum mengubah setting.
- Cocokkan deployment dengan container aktif. Variabel di berkas `.env` bukan bukti nilai yang dibaca proses; jumlah proses container database bukan jumlah koneksi. Ukur pertambahan sesi database (`pg_stat_activity`) untuk membuktikan pool benar-benar dipakai ulang.
- Jalur rilis, image, dan agen server milik control-plane-metta. Pertahankan perubahan lain di checkout pengguna.

## Pemasangan atau penambahan node

Gunakan image rilis terverifikasi dan lokasi secret operator; jangan membangun image di server. Periksa database, sesi bersama (Valkey bila `SESSION_BACKEND=valkey`), object storage, trusted proxy, domain/TLS, serta scheduler/migration sesuai topology. Migration dijalankan sekali per lingkungan lewat `bun run migrate`, bukan oleh setiap instance yang menyala. Jangan menduplikasi penjadwal tanpa mekanisme yang menjaganya.

Verifikasi dari runtime: health, login, operasi bisnis terautentikasi, nomor nyata, tenant scope, dan error. Health perlu menguji aplikasi tanpa ikut antre dengan seluruh transaksi; jangan menggantinya dengan respons statis yang selalu 200. Health hijau bukan bukti SLO transaksi lulus.

Perubahan harus bertahan setelah recreate. Pertahankan digest image dan setting rilis aktif; nilai env lama tidak boleh menurunkan versi image. Recreate hanya layanan yang berubah, lalu periksa konfigurasi aktif kembali.

Jangan merestart database runtime lokal bersama demi memperbaiki lingkungan tes. Database tes terpisah dalam cluster yang sama tetap berbagi proses PostgreSQL dan batas lock. Perubahan parameter yang memerlukan restart dilakukan pada cluster tes tersendiri; koordinasikan pemilik runtime sebelum menyentuh cluster bersama. Sebelum restart yang memang diperlukan, periksa jumlah database/berkas, waktu checkpoint, dan grace period shutdown agar tidak memicu recovery panjang.

## Load test dan tuning

Untuk Valkey dan sesi bersama, ikuti [`docs/dev/36-cache-and-sessions.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/36-cache-and-sessions.md) CoreERP: bedakan data tenant dari identitas pusat, pertahankan cookie host-only, audit namespace lingkungan (`SESSION_KEY_PREFIX`), ACL database, serta eviction untuk lock/rate limit. Jangan mengganti `SESSION_BACKEND` tanpa cutover sesi, dan jangan memakai flush global atau fallback per-instance untuk menutupi kegagalan penyimpan bersama. Verifikasi koneksi web sesudah recreate.

- Ikuti [`docs/dev/20-load-and-concurrency-testing.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/20-load-and-concurrency-testing.md) CoreERP dan gate pada `operations-metta-architecture`. Nyatakan gap topology, tenant, durasi, dan permukaan; satu instance tidak membuktikan multi-instance.
- Uji business flow lewat sesi nyata. GET login hanya uji halaman login. Provision fixture lewat jalur tepercaya yang berlaku; setup dan smoke harus selesai sebelum pengukuran. Jangan mematikan limiter atau memalsukan konteks tenant agar setup lolos.
- Pisahkan generator bila memungkinkan, tetapi periksa bebannya juga. Pakai fixture sama dan RUN_ID baru: idempotency key lama dapat mengembalikan dokumen selesai. Catat pertumbuhan data, warm-up, beban penuh, think time, dan drain terpisah.
- Periksa CPU/affinity/cgroup, memori, jaringan, dan batas file descriptor generator pada proses k6 yang aktif. Jika batas proses dinaikkan, catat nilai sebelum/sesudah serta pemakaian aktual; jangan mengaitkan seluruh perubahan throughput ke kode ketika setting generator juga berubah. Label k6 tidak memuat id per request, karena label beragam membuat k6 kehabisan memori.
- Tunggu proses k6 selesai beserta drain sebelum mengganti konfigurasi; hasil yang tercampur dua konfigurasi tidak menjadi kontrol. Setelah reload, beri kontrol dan kandidat warm-up yang sama. Catat tenant yang benar-benar disentuh: fixture 128 tenant dengan pemilihan tetap per VU hanya menyentuh delapan tenant pada delapan VU, sehingga perbandingan antar-concurrency juga dapat mengubah campuran data.
- Catat ukuran/cardinality respons dan header encoding klien. Pastikan parameter seperti `per_page` benar-benar membatasi hasil (`incrementalList` membatasinya paling banyak 100). Sesuaikan encoding dengan consumer yang diuji; jangan diam-diam mengganti compression antara baseline dan sesudah. Pisahkan waktu waiting/receiving dari proses di server sebelum menyebut selisihnya antrean.
- Untuk daftar bertahap, ukur batch pertama dan penelusuran cursor secara terpisah; search/filter/sort harus menemukan record di luar batch pertama. UI mengikuti scroll bertahap tanpa navigasi halaman sesuai `operations-metta-ui`. Ulangi workload bisnis yang sama dengan encoding, fixture, proses, dan beban yang dicatat; jangan menyebut pengurangan payload batch pertama sebagai perbaikan throughput seluruh transaksi sebelum diukur.
- Selaraskan monitor dengan waktu mulai/selesai setiap run; vmstat harus diberi timestamp atau dicatat ketelitian penyelarasannya. Pada VM, ukur CPU steal dan runnable queue selain CPU container. Steal tinggi membuktikan waktu CPU tertahan host virtualisasi, tetapi kontribusinya terhadap latensi perlu kontrol terpisah; jangan menyimpulkan bottleneck tunggal dari korelasi.
- Ukur I/O disk host. Setiap commit membayar satu fsync; pada disk lambat itulah batasnya, bukan CPU. Angka dari mesin yang fsync-nya hampir gratis bukan kapasitas yang tahan crash.
- Bandingkan kandidat di bawah/atas konfigurasi awal. Ubah satu faktor, ukur pada concurrency tertahan, dan ulangi kontrol bila hasil dekat atau host berubah. Pilih dari latency, pekerjaan selesai, error, CPU/steal, waits dan koneksi; bukan jumlah proses atau koneksi terbanyak. Ulangi lima kali pada titik lulus terakhir dan gagal pertama.
- Pisahkan correctness, delivery, dan latency. Delivery harus gagal pada proxy rejection/timeout; nol pekerjaan selesai tidak boleh hijau. Hitung probe yang mendapat penolakan sah, bukan hanya percobaan. Status 0 bukan jawaban.
- Cocokkan 5xx dengan upstream log proxy. Jangan menganggap semua 503 dari aplikasi atau semua 5xx dari proxy. Laporkan successful throughput dan completed flows terpisah dari request cepat ditolak; p95 yang didominasi 503 tidak membuktikan SLO.
- Pisahkan DNS dari health aplikasi bila resolusi domain tersendat: bandingkan request normal dengan request ke IP yang sama sambil mempertahankan Host/TLS. HTTP 000 belum mengidentifikasi kerusakan aplikasi. Bedakan timeout, connection reset, dan EOF lewat error asli meskipun counter harness menggabungkannya.
- Jalankan race yang sengaja berebut dan oracle SQL pada fixture. Buktikan oracle bisa merah bila belum pernah diverifikasi; gunakan rollback untuk suntikan sementara. Jangan menghapus baris tersimpan secara fisik.
- Optimasi (sesi di Valkey, cache konteks, tuning PostgreSQL) belum terbukti menaikkan batas. Jangan menyebut salah satunya wajib sebelum ada run A/B dengan gate kebenaran yang bersih.

## Profiling bila kapasitas tetap rendah

Untuk workload banyak tulis, jangan menutupi query mahal dengan TTL respons transaksi. Ukur pengulangan query, urutan yang menghalangi indeks, dan biaya commit. Pakai ulang bacaan referensi hanya dengan scope database/tenant yang benar serta invalidasi pada perubahan dan rollback; request berikutnya wajib melihat hasil simpan terbaru. Jangan menyimpan data tenant di memori proses: beberapa proses dan instance melayani tenant yang sama. Periksa kompatibilitas cursor, NULL, search/filter/sort ketika mempercepat daftar. Ukur batch pertama dan posisi scroll yang jauh; pemisahan kelompok NULL tetap harus membaca satu snapshot per batch.

Baca [profiling.md](references/profiling.md) untuk membedakan antrean runtime, eksekusi JavaScript, query, dan scheduler. Mulai tanpa beban dan pada concurrency tertahan; latensi saat jenuh terutama mengukur antrean.

Pakai profiler/tracing yang tersedia. Instrumentasi tambahan perlu sementara, dibatasi pada run/fixture, diukur overhead-nya, tidak merekam cookie/token/password/parameter sensitif, dan dilepas sesudahnya. Hindari restart database hanya demi profiler bila sampled traces dan EXPLAIN dapat menjawab pertanyaan.

## Hasil dan penyimpanan

Simpan konfigurasi sebelum/sesudah, manifest lingkungan, perintah pengulangan, metrics, trace/SQL tersanitasi, dan verifikasi pemulihan di luar repo ini. Pisahkan pengukuran, inferensi, dan hal yang belum diuji. Dashboard/dependency baru tidak wajib.

Ekspor k6 `--summary-export` dapat membawa `setup_data` berisi fixture beserta cookie sesi. Direktori hasil mentah harus private (0700, berkas 0600 pada Linux); buang `setup_data` dan periksa field autentikasi sebelum menyalin metrics ke artifact yang akan dibagikan. Ringkasan angka yang aman tidak membuat seluruh JSON mentah aman. Data acuan, secret fixture, dan hasil mentah tetap di server lab, tidak pernah masuk repo (`parity/README.md`, bagian Lab).

Bila diminta commit/push, stage hanya pekerjaan ini dengan path eksplisit, pisahkan format dari perilaku, dan ikuti alur PR di `AGENTS.md`.
