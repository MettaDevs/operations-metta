# Sesi, cookie, dan Valkey

Halaman ini menjelaskan di mana sesi disimpan, bagaimana cookie dan CSRF bekerja, dan apa yang berubah bila sesi dipindah ke Valkey. Kodenya `src/platform/identity/session.ts` dan `valkey-sessions.ts`; setelannya di `src/platform/config/index.ts`.

Angka runtime yang sudah diukur, misalnya pool database dan jumlah proses, ada di skill `operations-metta-bun-elysia`. Cara mengubah setelan runtime dan menguji bebannya ada di skill `operations-metta-runtime-operations`.

## Dua tempat sesi

`SESSION_BACKEND` memilih penyimpan sesi:

| Nilai | Sesi disimpan di | Kedaluwarsa |
| --- | --- | --- |
| `database` | Tabel `sessions` di database lingkungan yang dilayani request | `last_activity` dibandingkan `SESSION_LIFETIME`; baris lama dibuang secara acak sesuai `SESSION_LOTTERY_HITS` dan `SESSION_LOTTERY_OUT_OF` |
| `valkey` | Kunci `SESSION_KEY_PREFIX` + id sesi di `VALKEY_HOST`:`VALKEY_PORT` | TTL kunci, sama dengan `SESSION_LIFETIME` |

Bawaannya `database`. Isi sesinya sama di kedua tempat: payload yang dibaca `Session.open`. Satu klien Valkey dipakai per proses Bun, dan ia tidak menyimpan apa pun milik request.

**Valkey yang gagal membuat request gagal 503**, dicatat sebagai `native-valkey-failed`. Ia tidak jatuh diam-diam ke tabel `sessions`, karena sesi yang berpindah tempat di tengah jalan berarti logout dan pencabutan yang tidak sampai.

Yang tidak ikut ke Valkey: pembatas percobaan login (`login-limiter.ts`), yang tetap memakai tabel `cache` di database lingkungan, dan seluruh data bisnis, nomor, dan audit. Pemindahan sesi tidak membuat respons API di-cache dan tidak menambah CPU untuk transaksi. Ia hanya memindahkan tulisan sesi dari PostgreSQL; `appendfsync always` di Valkey memindahkan fsync, bukan menghapusnya. Belum ada hasil uji beban yang membuktikan sesi di Valkey menaikkan kapasitas, jadi jangan menyebutnya wajib.

## Cookie

- Nama cookie sesi bawaannya `__Host-session`. Awalan `__Host-` membuat peramban menolaknya bila dikirim tanpa Secure, dengan Domain, atau dari subdomain lain. Lingkungan di subdomain sebelah tidak dapat menimpa atau membaca sesi lingkungan ini. `localhost` dan `*.localhost` dianggap aman oleh peramban, jadi aturan ini juga berlaku di laptop.
- Cookie sesi HttpOnly dan SameSite=Lax. Isinya id sesi yang dienkripsi `APP_KEY`.
- Cookie `XSRF-TOKEN` membawa token CSRF terenkripsi untuk dibaca layar.

Id sesi diganti saat login, supaya id sebelum login tidak pernah menjadi sesi yang sudah login. Sesi yang dimuat dari penyimpan hanya diperbarui selama masih ada; logout di request lain yang menghapusnya lebih dulu menang, dan cookie sesi yang sudah dihapus tidak dikirim ulang. Di Valkey ini ditegakkan dengan `SET ... XX`.

## CSRF

Request selain GET, HEAD, dan OPTIONS lolos bila salah satu benar:

- `Sec-Fetch-Site: same-origin`;
- `_token` di body atau header `X-CSRF-TOKEN` cocok dengan token sesi;
- header `X-XSRF-TOKEN` yang didekripsi cocok dengan token sesi.

Selain itu dijawab 419. Layar mengirim `X-XSRF-TOKEN` dari cookie `XSRF-TOKEN`.

## Batas lingkungan

Alamat request memilih database lingkungan sebelum sesi dibuka. Dengan `SESSION_BACKEND=database`, sesi tinggal di database lingkungan itu sendiri, jadi sesi satu lingkungan tidak pernah terbaca di lingkungan lain.

Dengan `SESSION_BACKEND=valkey`, semua lingkungan di host ini berbagi satu keyspace di bawah `SESSION_KEY_PREFIX`, dan kuncinya tidak membawa identitas lingkungan. Yang memisahkan lingkungan adalah cookie `__Host-` yang terikat host, pengguna sesi yang dibaca dari database lingkungan yang sedang dilayani, dan keanggotaan yang dibatasi ke tenant pemilik alamat oleh `Workspace`. Alamat bukan bukti hak.

Kunci cache lain yang kelak berisi data lingkungan wajib membawa identitas sumbernya. Data tenant tidak pernah disimpan di memori proses, karena beberapa proses dan instance melayani tenant yang sama.

## Logout dan pencabutan

- **Logout biasa** menghapus sesi dari penyimpannya dan memberi sesi kosong dengan id baru.
- **Back-channel logout SSO** mengisi `users.sessions_revoked_at` untuk semua pengguna yang tertaut ke identitas itu di setiap lingkungan host ini, dan menghapus baris `sessions` mereka. Valkey tidak dapat dicari per pengguna, jadi pencabutannya lewat perbandingan waktu: sesi menyimpan `login_at`, dan sesi yang login sebelum `sessions_revoked_at` dibaca sebagai belum login. Kedua waktu diambil dari jam database, supaya jam proses yang tertinggal tidak membuat login sesudah pencabutan terbaca sebagai login sebelumnya.

Penanda pencabutan tinggal di tabel `users`, bukan di Valkey, jadi ia bertahan walau isi Valkey hilang. Alurnya di [SSO](32-sso.md#back-channel-logout).

## Mengganti penyimpan sesi

Mengganti `SESSION_BACKEND` membuat setiap sesi di penyimpan lama tidak terbaca, jadi semua pengguna harus login ulang. Repo ini belum punya perintah pemindah sesi seperti CoreERP. Rencanakan pergantian di luar jam kerja klinik, dan jangan memakai flush global atau fallback per instance untuk menutupi kegagalan penyimpan bersama.

Aturan operasional Valkey dari CoreERP tetap berlaku bila Valkey dipakai, misalnya akun ACL terpisah tanpa perintah administrasi, port yang tidak dibuka ke internet, `maxmemory-policy noeviction` supaya sesi tidak dibuang demi memberi tempat, dan persistence AOF. Rinciannya di [cache dan sesi CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/36-cache-and-sessions.md#penyimpan-dan-hak). Berkas deploy Valkey milik penempatan, bukan repo ini.

## Pemeriksaan

`test/platform/identity/session.test.ts` dan `valkey-sessions.test.ts` menjaga perilaku sesi, antara lain logout yang menghapus kunci lama, TTL sesi baru, sesi lama berid angka yang terbaca belum login, dan kegagalan Valkey yang menjadi 503. Test sesi di Valkey sungguhan butuh `VALKEY_HOST`; CI selalu mengisinya.

## Lihat juga

- [SSO](32-sso.md)
- [Identity dan access](09-identity-and-access.md)
- [Grand design](01-grand-design.md#alamat-menentukan-lingkungan)
