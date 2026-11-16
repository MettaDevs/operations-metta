# Grand design: runtime klinik dan control plane

Halaman ini peta besar repo ini. Ia menjelaskan apa yang dijalankan repo ini, apa yang bukan miliknya, dan batas yang tidak boleh dilanggar kode mana pun. Aturan kerja harian ada di [`AGENTS.md`](../../AGENTS.md); bila halaman ini berbeda dengan `AGENTS.md` atau kode, yang benar `AGENTS.md` dan kodenya.

## Dua repo, dua tanggung jawab

| | operations-metta (repo ini) | [control-plane-metta](https://github.com/MettaDevs/control-plane-metta) |
| --- | --- | --- |
| Isi | Runtime ERP klinik: layar, API, aturan bisnis, migration, pengguna dan role di dalam tenant | Onboarding, trial, registri tenant dan lingkungan, rilis, registry image, agen server, lisensi, identitas pusat |
| Database | Database runtime dan satu database per lingkungan | Database pusat sendiri |
| Dijalankan di | Server SaaS kami dan server on-prem | Server pusat kami |

Operations tidak pernah membaca database pusat. Yang dibutuhkannya dari control plane datang sebagai **operasi lingkungan** yang ditarik worker lewat API bertanda tangan. Arah sebaliknya juga sempit: control plane tidak menyentuh data bisnis klinik. Ia hanya meminta lingkungan disiapkan, dimigrasi, atau diubah statusnya, lalu membaca laporan keadaan yang dikirim worker.

Pengguna dan role di dalam tenant tetap milik repo ini. Identitas orangnya lahir di control plane dengan id uuid, lalu disampaikan ke lingkungan lewat operasi worker. Rinciannya di [Identity dan access](09-identity-and-access.md).

## Proses dari satu image

`Dockerfile` membangun satu image. Image itu membawa setiap proses yang di-deploy beserta seluruh berkas migration. Daftar prosesnya adalah berkas di akar `src/`, sesuai bagian Susunan repo `AGENTS.md`. Antara lain:

| Proses | Di laptop | Di image | Tugas |
| --- | --- | --- | --- |
| HTTP | `bun run dev` | `bun dist/main.js` | Melayani layar dan API untuk setiap lingkungan di host ini |
| Worker | `bun src/worker.ts` | `bun dist/worker.js` | Menarik operasi lingkungan dari control plane dan menjalankannya satu per satu |
| Migrate | `bun run migrate` | `bun dist/migrate.js` | Membawa database runtime ke skema kode ini, dijalankan sekali sebelum HTTP dan worker versi baru menyala |

Proses HTTP tidak pernah memanggil control plane. Kalau worker mati atau control plane tidak terjangkau, klinik tetap bisa bekerja; yang tertunda hanya operasi lingkungan berikutnya. Daftar operasi worker dan aturan migration ada di [Release dan on-prem](03-release-and-on-prem.md).

## Satu lingkungan, satu database

Tenant punya paling banyak satu lingkungan per jenis, misalnya `production`, `demo`, atau `sandbox`. Daftar jenisnya `environmentKinds` di `src/platform/environment/address.ts`. Setiap lingkungan bawaannya punya database PostgreSQL sendiri, yang dibuat `provisionEnvironment` di `src/platform/environment/`. Isinya Core ditambah module yang dipasang untuk tenant itu.

Kode masih mengenal satu bentuk lain. Permintaan penyiapan yang `database`-nya `null` menempatkan tenant di database runtime bersama, dipisah `tenant_id`. Bentuk itu dipertahankan sebagai pilihan paket termurah. Yang memilih bentuk mana adalah control plane, bukan runtime.

Database runtime sendiri berisi peta alamat (`environment_routes`), upacara SSO yang sedang berjalan, dan data tenant yang memakai database bersama. Migration Core berjalan di database runtime dan di setiap database lingkungan; migration module hanya di database tempat module itu dipasang.

### Alamat menentukan lingkungan

Alamat request memilih lingkungan, dan aturannya di `src/platform/environment/address.ts`:

- `<tenant>.<BASE_DOMAIN>` untuk produksi, misalnya `klinik-contoh.example.com`.
- `<tenant>.demo.<BASE_DOMAIN>` dan `<tenant>.sandbox.<BASE_DOMAIN>` untuk demo dan sandbox.
- Label yang dipakai layanan lain, misalnya `admin` dan `www`, tidak pernah menjadi tenant. Daftarnya `reservedLabels` di berkas yang sama.
- Domain dasar tanpa nama tenant hanya melayani alamat SSO yang didaftarkan di penyedia, misalnya alamat balik. Rinciannya di [SSO](32-sso.md).
- Alamat yang tidak tercatat di `environment_routes`, atau yang `disabled_at`-nya terisi, dijawab 404. Tidak ada request yang jatuh ke database runtime tanpa tenant.
- `BASE_DOMAIN` kosong mematikan semua aturan ini. Semua request memakai database runtime, seperti di test dan di server satu lingkungan.

Alamat hanya memilih database dan membatasi workspace ke tenant pemilik alamat. Ia bukan bukti hak. Keanggotaan dan izin tetap diperiksa `Workspace` di `src/platform/access/`. Cookie sesi berawalan `__Host-`, jadi tidak bisa dipakai atau ditimpa subdomain lingkungan lain.

### Jalan satu request

`src/main.ts` memasang satu route Elysia, `app.all('*')`. Untuk setiap request ia:

1. menyajikan berkas build atau dokumen layar tanpa membuka sesi maupun database (`src/platform/http/spa.ts`);
2. menguraikan alamat dan mencari lingkungannya;
3. mengambil satu koneksi dari pool database lingkungan itu;
4. membuka sesi (`src/platform/identity/session.ts`);
5. meneruskan request ke handler oRPC, yang memanggil procedure di `src/`, `src/foundation/`, atau `modules/`.

Layar adalah SPA TanStack Router di atas API `/api/...`. Server tidak merender halaman dan tidak mengirim props halaman. Aturannya di bagian Layar `AGENTS.md`.

## Lapis kode

Susunannya meniru Business Central: System Application, Business Foundation, lalu app.

| Lapis | Isi | Contoh |
| --- | --- | --- |
| `src/platform/<kemampuan>/` | Mesin yang dipakai setiap request, tanpa istilah bisnis | identity, access, environment, organization, address-book, events, migration |
| `src/foundation/<layanan>/` | Master dan layanan bisnis bersama | number-sequence, currency, inventory, purchasing, billing |
| `modules/<module>/` | Kemampuan yang dibeli dan dipasang tersendiri | asset-management, healthcare, pharmacy |
| `packages/<package>/` | Pustaka untuk Core dan module, bukan proses dan bukan produk | `packages/ui/` |

Ketergantungan hanya ke bawah. Platform tidak meng-import Foundation; yang perlu bereaksi saat organisasi lahir didaftarkan oleh berkas proses, misalnya `registerOrganizationDefaults()` di `src/main.ts`. Module memakai Core hanya lewat `index.ts` sebuah kemampuan dengan awalan `@core/`. Core meng-import module hanya dari berkas proses di akar `src/`. Module tidak pernah meng-import module lain.

`bun run check:boundaries` menegakkan aturan impor itu. Platform yang meng-import Foundation belum diperiksa skrip, jadi dijaga di review. Lapis hanya susunan kode: ia tidak pernah muncul di nama tabel, kode permission, nama event, atau URL.

## Module

Hanya ada satu bentuk module: folder di `modules/`, satu package Bun workspace, berjalan di proses yang sama dengan Core dan memakai database lingkungan yang sama.

- Tabel module berawalan sendiri, lalu `m_` untuk master dan `tr_` untuk transaksi. Setiap tabel membawa `tenant_id`, dan setiap query menyaringnya.
- Module tidak membaca atau menulis tabel module lain. Fakta yang perlu diketahui module lain dikirim sebagai event lewat `src/platform/events/`.
- Core boleh membaca tabel module, dengan syarat di bagian Aturan module `AGENTS.md`.
- Katalog, entitlement, dan pemasangan adalah fakta yang berbeda. Module yang boleh dijual punya `module.json`; entitlement datang dari control plane lewat operasi `sync_entitlements`; `installed` hanya sah setelah migration module berhasil dan tercatat di `core_module_installations`. Layar berlabel "terpasang" membaca catatan pemasangan itu. Penjelasan untuk pemula ada di [Tiga kebenaran](../onboarding/tiga-kebenaran.md).

Image membawa semua module. Yang membuat sebuah module terbuka untuk tenant adalah entitlement dari control plane, bukan isi image.

### Kapan bentuk satu runtime ditinjau ulang

Menjalankan Core beserta semua module dalam satu proses adalah pilihan untuk ukuran tim dan beban hari ini. Peninjauannya dipicu bukti, bukan selera:

- engineer yang saling menghambat di satu repo bertambah jauh melewati ukuran tim sekarang;
- satu module terbukti, lewat uji beban, punya kelas beban yang berbeda;
- sebagian kemampuan harus berjalan di runtime atau bahasa lain.

Yang ditarik keluar saat itu hanya module tersebut. Batas yang dijaga hari ini memang dibuat supaya penarikan itu tidak menuntut penulisan ulang module lain: tidak ada impor antar-module, tidak ada tabel bersama, dan nama event sama di dalam maupun di luar proses.

## SaaS dan on-prem perpetual

| | SaaS | On-prem perpetual |
| --- | --- | --- |
| Siapa yang mengelola | Control plane, lewat worker di server kami | Berdiri sendiri di server pelanggan |
| Update | Rilis dari control plane | Update bertanda tangan |
| Telemetry | Laporan host dari worker ke control plane | Tidak ada yang wajib |
| Alamat | Subdomain per tenant | Boleh satu alamat tanpa `BASE_DOMAIN` |

Kode aplikasinya sama. Yang berbeda hanya cara lingkungan disiapkan dan diperbarui. Pelaporan kesalahan ke Sentry mati selama `SENTRY_DSN` kosong, dan itu bawaannya, supaya on-prem tidak punya telemetry wajib.

## Invarian

1. Tenant diambil dari konteks tepercaya di `src/platform/`, tidak pernah dari body atau query string.
2. Module tidak membaca atau menulis data module lain.
3. Organisasi ada di dalam tenant. Legal entity dan operating unit bukan pengganti tenant, dan hubungan atas-bawahnya hidup di hierarchy bertujuan dan berversi. Rinciannya di [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md).
4. Katalog, entitlement, dan pemasangan module tidak saling disimpulkan.
5. Operations tidak membaca database control plane, dan proses HTTP tidak bergantung pada control plane untuk melayani pengguna.
6. On-prem perpetual tidak punya telemetry, heartbeat, atau pemeriksaan lisensi online yang wajib.
7. Tidak ada salinan source per pelanggan. Kebutuhan khusus mengikuti [Kebutuhan khusus pelanggan](05-customization-and-addons.md).
8. Tidak ada baris yang dihapus fisik. Menghapus berarti mengisi `deleted_at`, dan indeks unik kode bisnis parsial.

## Lihat juga

- [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md)
- [Release dan on-prem](03-release-and-on-prem.md)
- [Identity dan access](09-identity-and-access.md)
- [Peta kode](../onboarding/peta-kode.md)
