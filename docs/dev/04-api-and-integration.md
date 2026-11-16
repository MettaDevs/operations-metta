# API, event, dan integrasi module

Halaman ini menjawab satu pertanyaan: bagaimana melewati batas antar bagian sistem. Bentuk jawabannya bergantung pada batas mana yang dilewati.

| Batas                                   | Bentuk                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Module ke Core, di satu runtime         | Pemanggilan fungsi lewat `@core/<lapis>/<kemampuan>/index.ts`                                  |
| Module ke module, di satu runtime       | Event lewat `src/platform/events/`, dengan nama dan envelope yang sama seperti event terbit    |
| Control plane ke runtime                | Operasi worker yang ditarik `src/worker.ts`, dan kelak route `.internal.routes.ts`              |
| Sistem luar milik tenant                | REST dengan kontrak OpenAPI tulisan tangan, lihat [integrasi sistem eksternal](12-external-module-integration.md) |
| Layar ke runtime                        | Procedure oRPC di bawah `/api/`, dipanggil lewat `api` dan `orpc` dari `src/platform/shell/`   |

Yang tidak berubah karena bentuknya: nama event `module.aggregate.action.vN`, isi envelope, dan aturan versinya. Event yang hari ini diantar di dalam proses harus tetap bisa dikirim ke luar runtime tanpa mengganti namanya. Karena itu bentuknya tidak disederhanakan hanya karena pengirim dan penerimanya kebetulan satu proses.

Acuan perilaku untuk bagian yang belum dipindah adalah [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/04-api-and-integration.md).

## REST untuk perintah, event untuk fakta

REST adalah perintah atau permintaan data: "simpan pembayaran" atau "tampilkan daftar resep". Event adalah fakta yang sudah terjadi: "resep sudah diterbitkan". Event bukan pengganti REST, dan REST bukan koordinator transaksi lintas module. Jangan mengontrakkan panggilan REST sebagai event, atau sebaliknya.

## Module memanggil Core

### Lewat `index.ts`, dan hanya lewat situ

Module meng-import Core hanya lewat `@core/...`, dan hanya `index.ts` sebuah folder kemampuan. Contohnya `@core/platform/http/index.ts`, `@core/platform/events/index.ts`, dan `@core/foundation/finance-posting/index.ts`. `index.ts` adalah satu-satunya pintu publik folder itu, setara pasangan `Email` dan `Email Impl` di Business Central. Berkas lain di folder itu boleh berubah tanpa memberi tahu module.

`bun run check:boundaries` menolak impor yang melewati `index.ts`, impor Core dari module tanpa awalan `@core/`, dan impor dari module ke module lain. Ia membaca impor dari teks berkas lewat `ts.preProcessFile`, bukan dari analisa tipe, jadi impor tipe yang tidak dipakai pun ikut terbaca.

Daftar yang boleh dipanggil module adalah isi setiap `index.ts`. Jangan menyalin daftarnya ke halaman ini, karena salinan menyimpang pada hari sebuah export bertambah.

### Kontrak dibangun dari kebutuhan pemanggilnya

Export yang disusun dari yang kebetulan tersedia di layanan Core akan kehilangan hal yang justru dipakai. Di CoreERP, antarmuka kalender fiskal dibentuk mengikuti kembalian layanannya dan diam-diam kehilangan tanggal awal tahun fiskal yang dipakai pemanggilnya. Baca pemanggilnya dulu, baru tulis export-nya.

Module yang tidak punya pintu resmi tidak berhenti membutuhkannya. Ia akan menyentuh berkas Core langsung, dan `check:boundaries` baru menangkapnya setelah kodenya ditulis. Jadi kebutuhan nyata dijawab dengan export di `index.ts`, bukan dengan pengecualian.

### Module tidak melompat lewat HTTP ke Core

Module berada di proses yang sama dengan Core. Memanggil Core lewat HTTP berarti membayar serialisasi, jaringan, dan satu jalur kegagalan baru untuk sesuatu yang sebenarnya pemanggilan fungsi.

Akibatnya: penolakan validasi dari Core sampai ke module sebagai `HttpFailure` dengan status 4xx, misalnya 422 atau 409, bukan 503. Kegagalan database dan bug tetap mungkin terjadi di dalam proses. Exception aslinya diteruskan ke `base` di `src/platform/http/rpc.ts`, yang menjawab 500 dan melaporkannya lewat [pelaporan kesalahan](28-pelaporan-kesalahan.md). Jangan menangkap semua exception lalu menganggapnya validasi hanya karena tidak ada jaringan.

### Nomor, dokumen, dan event satu transaksi

Nomor dokumen diambil di dalam transaksi dokumennya, lewat `src/foundation/number-sequence/`. `Database.transaction` yang bersarang menjadi SAVEPOINT. Yang mengikat adalah hasilnya: nomor, dokumen, dan event yang diterbitkan berada dalam satu transaksi. Ketika transaksi gagal, nomor berikutnya kembali seperti semula dan tidak ada baris outbox yang tersisa. Aturan number sequence ada di skill `number-sequence-design`.

### Titik perluasan Core

Selain event, Core boleh membuka titik perluasan yang didaftarkan module di fungsi pendaftaran `index.ts`-nya. Contohnya `onBeforePayment` dan `onPaymentHolds` dari `src/foundation/billing/`, yang dipakai farmasi supaya kasir menunggu resep yang belum disiapkan. Contoh lain `onOrganizationCreated` dari `src/platform/organization/`. Titik perluasan ditulis milik Core dan tidak menyebut module mana pun.

## Event antar module

Aturan lengkapnya di `AGENTS.md`, bagian **Event antar module**. Ringkasnya:

- `publishEvent(db, { type, tenantId, legalEntityId?, orgUnitId?, correlationId?, data })` dari `src/platform/events/` dipanggil di dalam transaksi yang mencatat faktanya. Di luar transaksi ia melempar.
- Ia menulis satu baris `outbox_events`, lalu menjalankan setiap handler untuk `type` itu di transaksi yang sama. Handler module hanya berjalan bila module pemiliknya `installed` untuk tenant itu. Handler Core, yang didaftarkan dengan module `core`, selalu berjalan.
- **Handler yang melempar membatalkan transaksi penerbit.** Karena itu handler hanya boleh gagal karena infrastruktur atau bug, tidak pernah karena aturan bisnis module penerima. Data yang tidak cocok dicatat ke log lalu dilewati.
- Handler didaftarkan dengan `onEvent(type, moduleId, handler)` di fungsi yang di-export `index.ts` module, yang dipanggil `src/main.ts` dan `src/worker.ts`.
- Penerima idempoten lewat tabel event yang sudah diproses milik module itu dan `alreadyProcessed(db, '<tabel>', envelope)`, dipanggil tepat sebelum efeknya ditulis.

**Pengiriman di dalam proses mengubah waktunya, bukan hanya jalurnya.** Handler berjalan sebelum penerbit selesai, jadi ia ikut transaksi penerbit. Itu keuntungan: dokumen dan akibatnya berubah bersama atau tidak sama sekali. Ia juga berarti handler yang lambat menahan transaksi penerbit, dan handler harus siap menerima urutan yang mustahil bila event tiba sesudah commit.

## Kontrak wajib

Setiap endpoint, event, dan webhook yang dipakai dari luar runtime wajib punya kontrak tulisan tangan di `contracts/`. Kontrak tidak pernah di-generate dari kode.

| Folder                            | Isi                                                      |
| --------------------------------- | -------------------------------------------------------- |
| `contracts/internal/`             | Endpoint yang dipanggil control plane                    |
| `contracts/integration/<domain>/` | Endpoint untuk sistem luar, satu folder per domain       |
| `contracts/events/`               | Event, satu berkas AsyncAPI per tipe dan versi           |

Hari ini baru `contracts/events/` yang berisi. Event di sana diantar di dalam runtime. Kontraknya tetap ditulis, dan test penerbit memvalidasi envelope yang benar-benar tertulis di `outbox_events` terhadap berkas itu lewat `test/support/event-contracts.ts`, bukan terhadap schema di kode penerbit.

### Envelope event

Nama event `module.aggregate.action.vN`. `publishEvent` menolak nama yang tidak cocok dengan pola itu. Envelope-nya:

```json
{
    "id": "0193c4a2-6f1e-7c3a-9b8d-2f4e5a6b7c8d",
    "type": "pharmacy.prescription.dispensed.v1",
    "occurred_at": "2026-11-16T03:00:00Z",
    "tenant_id": "0193c4a2-0000-7000-8000-000000000001",
    "legal_entity_id": "0193c4a2-0000-7000-8000-000000000002",
    "org_unit_id": "0193c4a2-0000-7000-8000-000000000003",
    "correlation_id": "0193c4a2-0000-7000-8000-000000000004",
    "data": {}
}
```

- `id` adalah id baris `outbox_events`, sekaligus id event untuk penerima yang idempoten.
- `tenant_id` wajib.
- `legal_entity_id` wajib ketika faktanya punya konsekuensi hukum atau akuntansi. `org_unit_id` diisi bila faktanya milik operating unit. Keduanya tidak ada di envelope bila tidak diisi. Penerbit tidak menebak legal entity dari posisi organisasi pada hierarki saat event diproses kemudian.
- `correlation_id` bawaannya correlation id request. Header `X-Correlation-Id` kiriman pemanggil dipakai bila berupa UUID.

Kolom `org_unit_id` di `outbox_events` ditambahkan `database/migrations/0023_outbox_org_unit.sql`, sebelum event pertama diterbitkan, karena field asal fakta tidak bisa diisi belakangan untuk baris yang sudah ada.

### Versi

Versi yang sudah terbit tidak diubah di tempat. Menambah atau menghapus field wajib berarti `vN+1`, dan versi lama boleh tetap terbit berdampingan selama masih punya penerima. Contohnya `billing.invoice.posted.v1` dan `v2` di `contracts/events/`. Mengubah kontrak berarti mengubah penerbit dan penerima dalam pekerjaan yang sama.

### Kontrak menggambarkan keadaan sebenarnya

Kalau kode belum memenuhi aturan kanonik, tulis gap-nya di `info.description`, bukan bentuk ideal yang belum dikirim kode. Contohnya kalimat "Keadaan sebenarnya" di `contracts/events/billing.invoice.posted.v2.yaml`.

Kebalikannya juga berlaku: kode tidak boleh menerima field yang dilarang kontraknya. Bila skema memakai `additionalProperties: false`, field di luar daftar tidak pernah tiba lewat jalur yang sah. Handler yang tetap memvalidasinya mengiklankan kemampuan yang tidak ada.

### Outbox

Penerbit menyimpan event ke `outbox_events` dalam transaksi yang sama dengan data bisnisnya. Belum ada pengirim ke luar runtime, jadi untuk sementara `outbox_events` adalah catatan audit dan `published_at` tetap kosong. Pengirim yang kelak dibuat harus lebih dulu memutuskan nasib baris lama itu, karena semuanya tampak belum terkirim. Penerima di luar runtime menyimpan id event untuk menolak efek ganda, sama dengan penerima di dalam proses.

### Mengubah record yang sudah ada wajib membawa versinya

Setiap record tenant membawa `version`. Pemanggil yang mengubah, menghapus, atau mengganti baris anak sebuah record mengirim versi yang terakhir ia baca, sebagai header `If-Match: W/"<n>"` atau field `version` di body. Rinciannya di [pengaman edit bersamaan](02-module-standard.md#pengaman-edit-bersamaan).

| Keadaan                                          | Jawaban                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| Tanpa `If-Match` maupun `version`                | 428 `version_required`                            |
| Versi sudah berbeda: orang lain menyimpan lebih dulu | 409 `stale_version`; baca ulang, lalu putuskan lagi |

Integrasi tidak boleh "memperbaiki" 409 dengan membaca ulang lalu mengirim ulang secara otomatis. Itu menimpa perubahan orang lain tanpa ada yang memutuskannya.

### Kontrak yang tidak dijaga pemeriksa akan tertinggal

Tidak ada test yang gagal ketika sebuah endpoint absen dari kontraknya. Di CoreERP, pemeriksa cakupan membandingkan route yang terdaftar dengan kontraknya dua arah di CI. Repo ini belum punya pemeriksa itu, karena `contracts/internal/` dan `contracts/integration/` masih kosong. Pemeriksa itu dibuat bersama endpoint pertama di sana. Aturannya:

- Route dibaca dari `router` yang dipakai runtime, bukan dari teks berkas route.
- Celah yang ditunda disebut di daftar pengecualian beserta alasannya, dan entri yang tidak lagi cocok dengan route hidup membuat pemeriksa gagal.

Route yang hanya dipanggil layarnya sendiri tidak dikontrakkan sebagai OpenAPI terbit. Tipe input dan outputnya sudah mengalir dari `router` ke layar lewat `src/platform/shell/api-contract.generated.json`, dan `bun run check:generated` menolak berkas itu bila tertinggal.

## Saluran ke luar runtime

> **Status di repo ini:** belum dipindah. Acuan perilaku: [saluran keluar ke sistem di luar CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/04-api-and-integration.md#saluran-keluar-ke-sistem-di-luar-coreerp).

Aturan yang tetap berlaku:

- Endpoint `integration` dan push bertanda tangan adalah jalan sistem di luar runtime, tidak pernah jalan antar module.
- Klien integrasi memegang token, scope, dan IP yang diizinkan. Tenant datang dari token, tidak pernah dari URL, query, atau body.
- Data yang dikirim milik fiturnya masing-masing. Feed posting finance milik `src/foundation/finance-posting/`, dan aplikasi finance pelanggan hanyalah satu klien integrasi. Lihat [feed posting finance](34-feed-posting-finance.md).
- Kontrak integrasi yang sudah terbit tidak berubah di tempat. URL, payload, header signature, dan aturan ack-nya hanya berubah lewat versi baru yang berjalan berdampingan.

## Lihat juga

- [Standar module](02-module-standard.md)
- [Integrasi sistem eksternal](12-external-module-integration.md)
- [Reporting dan read replica](07-reporting-and-replicas.md)
- `AGENTS.md`, bagian **Event antar module** dan **Kontrak**
