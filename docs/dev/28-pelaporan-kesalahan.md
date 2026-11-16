# Pelaporan kesalahan

Ketika sesuatu gagal di runtime, dua hal terjadi: satu baris JSON ditulis ke stderr proses, dan kesalahannya dikirim ke Sentry bila Sentry disetel. Halaman ini menjelaskan apa yang dikirim, apa yang sengaja tidak dikirim, dan bagaimana menyalakannya.

Kodenya di `src/platform/error-reporting/index.ts`, memakai `@sentry/bun`. CoreERP punya pelapor yang jauh lebih lengkap, termasuk laporan berkas, notifikasi Discord, dan jalur OpenTelemetry. Bagian itu belum dipindah. Acuan perilakunya: [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/28-pelaporan-kesalahan.md).

## Apa yang dilaporkan

Yang dikirim ke Sentry adalah kesalahan yang tidak diharapkan. Jalurnya hari ini antara lain:

- Jawaban 500 dari procedure oRPC. `base` di `src/platform/http/rpc.ts` menangkap exception yang bukan `HttpFailure`, memanggil `reportError`, lalu menjawab 500.
- Kegagalan di `src/main.ts` di luar procedure, misalnya saat membuka sesi, menyelesaikan alamat lingkungan, atau di alamat SSO.
- Kegagalan operasi di `src/worker.ts`.
- Exception dan promise ditolak yang tidak tertangkap di proses.

Penolakan yang memang bagian dari aturan tidak dikirim, misalnya 401, 403, 404, 409, 422, dan 429. Penolakan itu bukan kesalahan program. Jangan mengubah bug, misalnya indeks unik yang bentrok tanpa diduga, menjadi validasi 422 supaya hilang dari pemantauan.

Setiap kesalahan juga ditulis ke stderr sebagai satu baris JSON, misalnya `native-request-failed` atau `native-session-failed`, berisi nama exception, kode SQLSTATE bila ada, dan pesannya. Baris itu tetap ada walau Sentry mati.

## Yang sengaja tidak dikirim

Isi request, header, cookie, dan query string bisa memuat kata sandi, token, atau data klinik. SDK Sentry mengumpulkan semuanya secara bawaan, jadi `startErrorReporting` mematikan setiap jenis lewat `dataCollection`, lalu `beforeSend` membuang sisanya:

| Dikirim                                                      | Tidak dikirim                                      |
| ------------------------------------------------------------ | -------------------------------------------------- |
| Stack trace dan pesan exception                              | Body, header, cookie, dan query string request     |
| Method dan path, tanpa query string                          | Data pengguna, termasuk id, nama, dan email        |
| Tag `process`, `http.method`, dan `http.route`               | Alamat IP klien                                    |

Tag dipasang di dalam `Sentry.withScope`. Satu proses Bun melayani banyak request berturut-turut, dan tag yang dipasang di scope bersama akan menandai kesalahan request lain.

Integrasi bawaan Sentry dimatikan. Hanya integrasi untuk kesalahan yang dipasang, karena instrumentasi bawaan menambah kerja di setiap request dan angka kapasitas stack ini diukur tanpanya. `tracesSampleRate` bernilai 0, jadi tidak ada jejak performa.

## Menyalakan dan mematikan

| Variabel             | Arti                                                        |
| -------------------- | ----------------------------------------------------------- |
| `SENTRY_DSN`         | Kosong berarti tidak ada yang dikirim ke mana pun. Ini bawaannya |
| `SENTRY_ENVIRONMENT` | Penanda lingkungan di Sentry                                |
| `SENTRY_RELEASE`     | Nama rilis di Sentry                                        |

Bawaannya mati karena on-prem tidak boleh punya telemetry wajib. Sentry hanya menyala di server yang sengaja diberi DSN. DSN tidak pernah ditulis di repo. Sesuai `AGENTS.md`, bagian **Repo ini publik**, secret hanya disimpan di GitHub Actions secrets. Klien on-prem yang mau memakai Sentry mengisi DSN project miliknya sendiri.

`src/main.ts` memanggil `startErrorReporting(config, 'http')` dan `src/worker.ts` memanggil `startErrorReporting(config, 'worker')`. Sebelum proses berhenti, `flushErrorReporting` menunggu sebentar supaya kesalahan terakhir sempat terkirim.

Test-nya di `test/platform/error-reporting/error-reporting.test.ts`: tanpa DSN tidak ada yang dikirim, dan kesalahan 500 dikirim dengan route-nya tanpa data request.

## Kegagalan yang terlihat oleh pengguna

Laporan di Sentry dan pesan di layar menjawab dua kebutuhan berbeda. Kesalahan yang tercatat di Sentry belum berarti pengguna tahu simpanannya gagal.

- Layar menyebut tindakan yang belum berhasil, mempertahankan isian yang belum tersimpan, dan menampilkan pesan yang tetap terlihat sampai ditutup. Toast singkat saja tidak cukup untuk kegagalan simpan.
- Kegagalan API sampai ke layar sebagai `ApiError` dari `src/platform/shell/`, berisi status, pesan, error per field, dan kodenya.
- Ringkasan error ditampilkan `FormErrorSummary` dari `@operations-metta/ui/form-feedback`, di bawah toolbar, dan setiap field tetap menampilkan pesannya sendiri. Kontrak perilakunya di `docs/design-system/components/FormErrorSummary/`.
- Pesan untuk 5xx tidak menampilkan teks exception. Detail SQL dan exception tetap di laporan server.
- Konflik versi mempertahankan draft dan meminta pengguna meninjau data terbaru, tanpa muat ulang otomatis yang membuang isian.
- Konfirmasi memakai `useConfirmation` dari `@operations-metta/ui`, bukan `alert`, `confirm`, atau `prompt` peramban. `bun run check:ui` menolak dialog bawaan peramban.

## Yang belum dipindah dari CoreERP

- Laporan berkas lengkap per kesalahan, termasuk bagian database dan tersangka nilai yang terlalu panjang untuk kolomnya.
- Tag tenant, legal entity, unit, dan module di Sentry.
- Notifikasi ke channel tim.
- Sesi peramban di Sentry untuk Crash Free Sessions.

## Lihat juga

- [API, event, dan integrasi module](04-api-and-integration.md)
- [Standar module](02-module-standard.md)
- Skill `operations-metta-bun-elysia`, untuk alasan instrumentasi dimatikan
