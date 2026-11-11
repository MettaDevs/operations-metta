# operations-metta

- Repo ini runtime ERP yang dijalankan untuk klinik, di SaaS maupun on-prem, dan ditulis dengan Bun + Elysia. Praktik Dokter direncanakan berjalan di runtime yang sama. Kode Praktik Dokter belum ada di repo ini.
- Onboarding, trial gratis Praktik Dokter, pengelolaan tenant dan lingkungan, rilis, dan agen server milik repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta). Pengelolaan pengguna dan role di dalam tenant tetap milik repo ini.
- **CoreERP tetap acuan perilaku sampai setiap alur selesai dipindah.** Kodenya ada di [repo CoreERP](https://github.com/MettaDevs/coreERP). Keputusan pindah ke Bun + Elysia beserta hasil pengukurannya ada di [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md). Alur layar, permintaan, dan data CoreERP tanpa ikatan framework ada di [`docs/design-system/`](docs/design-system/index.md), dipindah dari CoreERP pada 9 November 2026. Folder itu potret kode CoreERP pada satu commit. Bila isinya berbeda dengan kode CoreERP, yang benar adalah kodenya.
- Jaga perubahan dan dependency tetap minimal. Jangan membuat abstraksi atau compatibility layer spekulatif. Kalau ada yang membingungkan, tanyakan langsung ke pemilik produk dan berhenti dulu sampai konteksnya jelas.
- SaaS dikelola lewat control plane. On-prem perpetual berdiri sendiri, memakai update bertanda tangan, dan tidak mewajibkan telemetry.

## Susunan repo

Keputusan pemilik produk, 9 November 2026: susunan folder mengikuti Business Central. Folder disusun per area bisnis lalu per fitur, bukan per jenis teknis, dan semua berkas satu fitur ada di satu folder. Sumbernya bisa dibaca di BCApps, misalnya `src/Layers/W1/BaseApp/FixedAssets/` dan `src/System Application/App/Email/`.

Repo ini tumbuh dengan menambah folder dan berkas di tempat yang sudah ditetapkan tabel berikut, tanpa menyusun ulang yang sudah ada. Kalau sesuatu yang baru tidak punya tempat di tabel, tanyakan ke pemilik produk sebelum membuat tempat baru.

| Yang bertambah                                                                                   | Tempatnya                                                                                                                                                                                                                                                                                   | Contoh                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proses yang di-deploy                                                                            | Satu berkas di akar `src/`                                                                                                                                                                                                                                                                  | `src/main.ts` untuk HTTP, `src/client.tsx` untuk peramban (dibuat `scripts/generate-client.ts`). `src/worker.ts` untuk worker lingkungan, `src/migrate.ts` untuk migration database runtime. Nanti `src/cli.ts` |
| Kemampuan Core                                                                                   | `src/platform/<kemampuan>/` atau `src/foundation/<layanan>/`, masing-masing dengan `index.ts`                                                                                                                                                                                               | `src/platform/identity/`, `src/foundation/number-sequence/`                                                                                                                                                     |
| Unit yang bisa dibeli atau dipasang tersendiri oleh pelanggan, baik ERP maupun layanan kesehatan | `modules/<module>/`                                                                                                                                                                                                                                                                         | `modules/asset-management/`                                                                                                                                                                                     |
| Pustaka yang dipakai Core dan module                                                             | `packages/<package>/`, bernama `@operations-metta/<package>`                                                                                                                                                                                                                                | `packages/ui/` = `@operations-metta/ui`                                                                                                                                                                         |
| Design system: token tampilan, kontrak perilaku komponen, dan alur dari layar sampai database    | `docs/design-system/`                                                                                                                                                                                                                                                                       | `docs/design-system/components/InlineLookup/README.md`                                                                                                                                                          |
| Area bisnis, lalu fitur                                                                          | `modules/<module>/src/<area>/<fitur>/`                                                                                                                                                                                                                                                      | `modules/asset-management/src/fixed-asset/asset-receipt/`                                                                                                                                                       |
| Peran berkas                                                                                     | Akhiran `.schema.ts`, `.service.ts`, `.routes.ts`, `.posting.ts`, dan nanti `.page.tsx`                                                                                                                                                                                                     | `asset-receipt.posting.ts`                                                                                                                                                                                      |
| Test                                                                                             | Core di `test/` dengan susunan folder yang sama dengan `src/` (atau `scripts/` untuk test skrip). Module di `modules/<module>/test/` dan package di `packages/<package>/test/`, masing-masing dengan susunan folder yang sama dengan `src/`-nya. Bantuan test di `support/` folder test itu | `modules/asset-management/test/depreciation/depreciation-start.test.ts` untuk `modules/asset-management/src/depreciation/depreciation-start.ts`                                                                 |
| Pemanggil route                                                                                  | `.routes.ts` untuk pengguna klinik, `.internal.routes.ts` untuk panggilan dari control plane, `.integration.routes.ts` untuk sistem luar                                                                                                                                                    | `asset.internal.routes.ts`                                                                                                                                                                                      |
| Migration                                                                                        | Milik Core di `database/migrations/`. Milik module di `modules/<module>/database/migrations/`                                                                                                                                                                                               | `modules/asset-management/database/migrations/`                                                                                                                                                                 |
| Kontrak                                                                                          | `contracts/internal/` untuk endpoint yang dipanggil control plane, `contracts/integration/<domain>/` untuk sistem luar, `contracts/events/` untuk event                                                                                                                                     | `contracts/integration/finance/`                                                                                                                                                                                |
| Layar                                                                                            | `.page.tsx` di folder fitur, aturannya di [Layar](#layar). Bingkai layar (layout, menu, login) dan stylesheet aplikasi di `src/platform/shell/`, yang hanya berisi kode peramban                                                                                                            | `asset-receipt.page.tsx`, `src/platform/shell/app.css`                                                                                                                                                          |
| Docs module                                                                                      | `modules/<module>/README.md`                                                                                                                                                                                                                                                                | `modules/asset-management/README.md`                                                                                                                                                                            |

- `src/` adalah Core, setara System Application dan Business Foundation di BC. `src/platform/` berisi bagian yang dipakai setiap request. `src/foundation/` berisi layanan bisnis bersama.
- `index.ts` adalah satu-satunya pintu publik sebuah folder kemampuan atau layanan, setara pasangan `Email` dan `Email Impl` di BC. Kode di luar folder itu hanya meng-import `index.ts`-nya. Berkas di dalam satu folder boleh saling meng-import langsung.
- Setiap module adalah satu package Bun workspace. `src/index.ts` adalah pintu publik module dan tempat route semua fiturnya didaftarkan. `src/module.ts` memegang kode module dan konteks kerjanya.
- Package di `packages/` adalah pustaka yang dipakai Core dan module, bukan proses yang di-deploy dan bukan unit yang dibeli pelanggan. Core dan module memakainya lewat nama package-nya, misalnya `@operations-metta/ui/button`. Package tidak meng-import Core atau module.
- Nama area dan fitur mengikuti nama di manifest CoreERP.
- `.schema.ts` memegang bentuk baris dan input, `.service.ts` memegang aturan bisnis, dan `.routes.ts` memegang endpoint. Peran berkas di luar tabel boleh ditambahkan bila memang perlu, misalnya `asset.code.ts`.
- Test ada di folder test, tidak di `src/`, mengikuti contoh di dokumentasi Elysia ([Unit Test](https://elysiajs.com/patterns/unit-test.html)) dan contoh project references TypeScript. `src/` hanya berisi kode yang di-deploy, dan folder fitur tidak tercampur test. Keputusan pemilik produk, 9 November 2026, menggantikan aturan lama yang menaruh test di samping berkasnya.
- Folder test mengikuti folder kode yang diujinya, jadi test sebuah berkas dicari di path yang sama di bawah folder test. Test module ada di module itu sendiri, supaya module tetap bisa dipindah atau dipasang sebagai satu package.
- Route ditulis sebagai procedure oRPC, bukan controller Elysia. Elysia hanya server HTTP: satu route `app.all('*')` yang meneruskan request ke handler OpenAPI oRPC, karena hanya bentuk itu yang diukur di [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md). Ini sengaja menyimpang dari [best practice Elysia](https://elysiajs.com/essential/best-practice.html) yang menjadikan satu instance Elysia sebagai satu controller. Yang tetap diikuti dari halaman itu: satu folder per fitur, schema sebagai satu-satunya sumber tipe dan validasi (`z.infer`, tanpa `interface` kembaran), dan service yang menerima nilai yang ia butuhkan (misalnya `db` dan `workspace`), bukan seluruh context request.
- Layar ditulis dengan React dan komponen `@operations-metta/ui`. Keputusan pemilik produk, 9 November 2026: style, font, dan panduan UI CoreERP dipakai di repo ini, dan rinciannya ada di `docs/design-system/`. Rupa dan perilaku milik komponen; halaman memegang data, izin, dan aksi bisnis. Cara layar disajikan, dirakit, dan mengambil data ada di bagian [Layar](#layar).
- Core meng-import module hanya dari berkas proses di akar `src/`. Module tidak pernah meng-import module lain, baik lewat path relatif maupun lewat `@operations-metta/<module>`.
- Berkas milik satu pemanggil tidak meng-import berkas milik pemanggil lain. Aturan bisnis yang dipakai beberapa pemanggil ada di `.service.ts`, yang namanya tidak membawa pemanggil.
- `bun run new-feature <module>/<area>/<fitur>` membuat `.schema.ts`, `.service.ts`, dan `.routes.ts` di folder fitur, `.test.ts` di folder yang sama di bawah `test/` module, lalu mendaftarkan route-nya di `src/index.ts` module. Tambahkan `--audience internal` atau `--audience integration` untuk route control plane atau sistem luar. Route untuk kedua pemanggil itu dibuat kosong sampai Core punya autentikasinya. Perintah ini menolak menimpa berkas yang sudah ada.
- `bun run check:boundaries` menolak impor dari Core ke module di luar berkas proses, impor yang melewati `index.ts` sebuah kemampuan, module yang meng-import Core tanpa `@core/`, module yang meng-import module lain, berkas satu pemanggil yang meng-import berkas pemanggil lain, nama tabel module di `src/`, test di luar folder test, folder test yang tidak punya pasangan di kode yang diujinya, kode yang meng-import folder test, dan package yang meng-import Core atau module. Pengecualiannya satu: `src/client.tsx` meng-import `.page.tsx` langsung, karena ia merakit route tree. `@operations-metta/<nama>` dihitung module hanya bila folder `modules/<nama>` ada, jadi impor `@operations-metta/ui` dari module tidak ditolak.

## Layar

Keputusan pemilik produk, 9 November 2026: layar adalah SPA dengan TanStack Router dan TanStack Query di atas API oRPC, bukan Inertia. Server tidak merender halaman dan tidak mengirim props halaman. Ia menyajikan satu dokumen yang sama untuk setiap URL layar, dan layar mengambil datanya sendiri dari `/api/`.

- **URL layar dan URL data terpisah.** Data hanya di bawah `/api/`. URL lain milik layar, misalnya `/sysadmin/dashboard` dan `/sysadmin/organization/legal-entities`. Pengecualiannya `POST /login` dan `POST /logout`, yang tetap di tempatnya.
    - Route Elysia yang satu-satunya itu lebih dulu memeriksa dua hal, tanpa membuka sesi atau database (`src/platform/http/spa.ts`). `GET /build/<berkas>` mendapat berkas build ber-hash yang tercatat di manifest. GET lain di luar `/api/` mendapat dokumen layar.
    - Selain dua hal itu, semuanya diteruskan ke oRPC. Permintaan `/api/...` tidak pernah mendapat dokumen layar, dan 404-nya tetap JSON.
    - Procedure baru yang dibaca layar ditulis di bawah `/api/v1/...`. Jangan menulis GET oRPC di luar `/api/`, karena dokumen layar akan menutupinya.
- **Halaman** adalah berkas `<fitur>.page.tsx` di folder fiturnya, yang meng-export `page`:

    ```tsx
    export const page = definePage({
        path: '/sysadmin/organization/legal-entities',
        previousPaths: ['/settings/legal-entities'],
        layout: 'app',
        title: 'Perusahaan',
        validateSearch: z.object({ q: z.string().optional() }),
        component: LegalEntitiesPage,
    });
    ```

    - `path` adalah URL layar dan ditulis sebagai teks literal. Nama dan folder berkas tidak menentukan URL, tetapi URL berawalan area lalu folder fiturnya: `/sysadmin/<folder>/...` untuk halaman Core dan `/<module>/<folder>/...` untuk halaman module.
    - `previousPaths` (opsional, teks literal) adalah URL lama halaman itu. Route tree mengalihkannya ke `path` beserta search params-nya, supaya tautan dan bookmark lama tetap jalan. URL lama tidak boleh menunjuk dua halaman.
    - `layout: 'app'` memasang halaman di dalam Shell dan mewajibkan login. `'auth'` dipakai untuk halaman sebelum login.
    - Search params divalidasi schema zod di `validateSearch`.
    - Id route adalah id layout ditambah path, sama dengan layout tanpa path di TanStack Router: `/_app/sysadmin/organization/legal-entities` atau `/_auth/login`. Di dalam komponen, `getRouteApi('<id>').useSearch()` memberi search params dengan tipe dari schema. `Link`, `navigate`, dan `redirect` memakai path. TypeScript menolak id, path, dan search param yang tidak ada.
    - Komponen halaman dan layout menulis tipe kembaliannya (`(): ReactNode`). Tanpa itu, TypeScript dapat kehilangan tipe route tree tanpa pesan apa pun, karena tipe komponen dan route tree saling bergantung.

- **Route tree dirakit otomatis.** `scripts/generate-client.ts` membaca setiap `.page.tsx` di `src/` dan `modules/*/src/`, lalu menulis dua berkas:
    - `src/client.tsx`, entry peramban beserta route tree-nya;
    - `src/platform/shell/api-contract.generated.json`, bentuk route oRPC yang dibutuhkan klien di peramban.

    Keduanya di-commit supaya TypeScript mengenalnya, dan tidak pernah disunting tangan. `bun run build` dan `bun run dev` menulisnya ulang. `bun run check:generated` menolak berkas yang tertinggal, dan CI menjalankannya. `src/client.tsx` satu-satunya berkas yang meng-import `.page.tsx` langsung, dan `check:boundaries` mengizinkan itu.

- **Data.** Halaman memanggil API lewat `api` (klien oRPC) dan `orpc` (TanStack Query) dari `src/platform/shell/index.ts`.
    - Tipe input dan output datang dari router di `src/main.ts`, jadi tidak ditulis ulang di layar.
    - Body yang divalidasi service, bukan oRPC, diberi tipe lewat `typedBody<z.input<typeof schema>>()`. Dengan begitu pesan 422-nya tetap milik service.
    - Query string yang dibaca handler dari URL-nya sendiri diberi tipe lewat `typedQuery<z.input<typeof schema>>()`, misalnya `organizationPageQuerySchema`.
    - Kegagalan API menjadi `ApiError`, berisi status, pesan, error per field, dan kodenya.
- **Data bersama Shell** datang dari `GET /api/v1/shell` di `src/platform/access/`, berisi pengguna, workspace aktif beserta pilihannya, menu, dan lingkungan. Endpoint ini pengganti shared props CoreERP.
    - Susunannya mengikuti Shell CoreERP (keputusan pemilik produk, 11 November 2026). Paling atas rail ada katalog aplikasi (`product-launcher.tsx`): **Sys Admin** untuk semua halaman Core, dan satu aplikasi per module yang dihak tenant dan sudah terpasang, dengan nama dari baris `apps` module itu. Di bawahnya rail berisi grup menu aplikasi yang sedang dibuka, sama persis dengan folder fitur di kode, dan sidebar berisi halaman grup yang dipilih. Di kode aplikasi ini disebut area.
    - Setiap area dibuka dengan dashboard-nya sendiri sebagai grup pertama; tidak ada dashboard bersama. Dashboard Sys Admin di `src/platform/dashboard/`, dashboard module di `modules/<module>/src/dashboard/`. Dashboard tidak membawa permission dan tidak membuat areanya tampil: area hanya tampil bila pengguna boleh membuka halaman lain di dalamnya.
    - Halaman awal setelah login (`/`) adalah dashboard area terakhir yang dibuka pengguna bila masih boleh, kalau tidak dashboard area pertama yang boleh. Area terakhir disimpan di localStorage peramban per pengguna (`src/platform/shell/home.ts`).
    - Menu Core ditulis di `src/platform/access/navigation.ts` beserta permission tiap entri, dan disaring di server. Menu module ditulis migration module ke `apps.navigation`; mengubahnya berarti menulis migration baru.
    - Hanya halaman yang sudah ada yang masuk menu, dan test memeriksanya.
    - Pesan berhasil tampil sebagai toast di layar.
- **Sesi dan CSRF** memakai mekanisme `src/platform/identity/`: cookie sesi, header `X-XSRF-TOKEN` dari cookie `XSRF-TOKEN`, dan `Sec-Fetch-Site`.
    - Data halaman yang dijawab 401 membawa pengguna ke `/login?redirect=<asal>`.
    - Simpan yang gagal karena sesi habis (401 atau 419) menampilkan pesan, dan isian form tetap ada.
- **Kode peramban dan kode server tidak bercampur.** `src/platform/shell/` hanya berisi kode peramban, dan server tidak meng-import-nya. Halaman tidak meng-import berkas server di folder fiturnya sendiri, misalnya `.service.ts` atau `.schema.ts` yang menarik database. Yang dibutuhkan layar datang dari API.
- **Build.** `Bun.build` membundel `src/client.tsx` dan `src/platform/shell/app.css` ke `dist/client/` dengan nama `<nama>-<hash>.<ext>`, dan menulis `dist/client/manifest.json`. Server dibundel ke `dist/main.js`.
    - Tailwind v4 dijalankan lewat `@tailwindcss/node` dan `@tailwindcss/oxide`, versi yang sama dengan `tailwindcss`. Plugin Tailwind kecil di `scripts/build.ts` yang menjalankannya.
    - Font `@fontsource` ditulis sebagai berkas sendiri, bukan disisipkan ke CSS.

### Menjalankan layar di laptop

Server butuh database yang sudah dimigrasi dan `APP_KEY` (32 byte, `base64:...`), sama dengan test. Salin `.env.example` ke `.env` dan isi `APP_KEY` (cara membuatnya ada di berkas itu), lalu:

```bash
bun run dev:setup  # migration, lalu lingkungan contoh dari dev/tenants.json
bun run dev        # http://klinik-contoh.localhost:8000 dan http://klinik-contoh.demo.localhost:8000
```

`bun run dev:setup` memigrasi database runtime dev, lalu membuat setiap lingkungan tenant di `dev/tenants.json`, masing-masing dengan database sendiri, beserta admin pertamanya. Ia memakai `provisionEnvironment`, fungsi yang juga dipakai penyiapan di server, dan mencetak alamat setiap lingkungan. Login dengan email dan kata sandi admin di berkas itu. Peramban mengarahkan `*.localhost` ke mesin sendiri, jadi berkas hosts tidak perlu diubah. Perintah ini aman diulang: lingkungan yang alamatnya sudah tercatat dilewati. Tambah tenant atau lingkungan contoh dengan menambah entri di berkas itu; isinya data sintetis, dan kata sandinya hanya untuk laptop. Di server, tenant hanya lahir dari admin.erp, dan perintah ini tidak ikut ke image.

`bun run dev` menjalankan server dengan `bun --watch`, dan server dinyalakan ulang bila kode server berubah. Build peramban diulang setiap kali berkas di `src/`, `modules/`, atau `packages/ui/src/` berubah. Muat ulang halaman untuk melihat hasilnya. Untuk menjalankan hasil build seperti di image: `bun run build`, lalu `bun dist/main.js`.

## Aturan module

Aturan ini dibawa dari bagian [Satu bentuk module](https://github.com/MettaDevs/coreERP/blob/main/AGENTS.md#satu-bentuk-module) di CoreERP dan tidak boleh dilonggarkan dengan alasan apa pun.

- Sebuah module tidak boleh membaca atau menulis tabel milik module lain. PostgreSQL tidak menolak `JOIN` lintas module, jadi jangan mengandalkan database untuk menjaga batas ini.
- Setiap module memakai awalan nama tabelnya sendiri, lalu `m_` untuk master dan `tr_` untuk transaksi, mengikuti pola legacy sistem lama (keputusan pemilik produk, 10 November 2026). `asset-management` memakai `aset_` (`aset_m_kondisi_aset`, `aset_tr_mutasi_aset`; beberapa tabel baseline CoreERP seperti `aset_pengaturan_aset_tetap` tidak membawa `m_` atau `tr_`). `healthcare` memakai `sim_` (`sim_m_pasien`; transaksi kelak `sim_tr_`). Detail master ikut `m_`, detail transaksi ikut `tr_`.
- Setiap tabel module membawa `tenant_id`, dan setiap query menyaringnya. Tenant diambil dari konteks tepercaya di `src/platform/`, bukan dari nilai kiriman klien yang belum diperiksa.
- Nama event `module.aggregate.action.vN`, envelope, dan aturan versinya tidak berubah. Event yang sudah terbit tidak diubah di tempat. Menambah atau menghapus field wajib berarti `vN+1`. Bentuk envelope ada di [Kontrak wajib](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/04-api-and-integration.md#kontrak-wajib).
- Core boleh membaca tabel module secara langsung, misalnya untuk laporan dan analitik. Ini keputusan pemilik produk pada 3 Oktober 2026. Bacaan itu wajib memenuhi syarat dari [Ownership dan data](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#ownership-dan-data):
    - Nama tabel dan kolom datang dari yang didaftarkan module, tidak ditulis mati di kode Core.
    - Tenant disaring, dan kebijakan data yang dinyatakan module diterapkan.
    - Bacaan yang menggabungkan beberapa module hanya ditawarkan bila semuanya terpasang untuk tenant itu.
    - Core hanya membaca. Menulis tetap lewat module pemiliknya.
- Katalog, entitlement, dan pemasangan module tidak sama. Katalog berarti produk dikenal, entitlement berarti tenant berhak memakai, dan `installed` hanya sah setelah migration module berhasil dan tercatat di `core_module_installations`. Layar berlabel "terpasang" membaca catatan pemasangan itu, tidak menyimpulkannya dari entitlement.

## Database

- Skema CoreERP adalah titik awal, bukan batas. Keputusan pemilik produk 9 November 2026: perubahan yang membuat skema lebih baik boleh dilakukan, misalnya nama yang lebih jelas, tipe kolom yang lebih tepat, atau index yang lebih berguna. Setiap perubahan:
    - alasannya ditulis di PR-nya;
    - dikerjakan lewat migration, tidak pernah diubah tangan di database;
    - ikut memperbarui harness kesetaraan, termasuk pemetaan nama lama ke nama baru, supaya alur yang sudah pindah tetap terbukti setara;
    - tidak mengubah bentuk respons API yang sudah dipakai. Bentuk baru dirilis sebagai versi API baru.
- Repo ini pemilik skemanya sendiri. Keputusan pemilik produk 9 November 2026: repo CoreERP tidak disentuh lagi, dan setiap perubahan baru hanya ada di sini.
    - `database/migrations/0001_coreerp_baseline.sql` adalah skema CoreERP pada commit `6b3cf584` tanpa module aset, dan `modules/asset-management/database/migrations/0001_baseline.sql` adalah skema module aset dari commit yang sama dalam bentuk `uuid`. `0002_ids_to_uuid.sql` mengubah setiap id ULID `character(26)` menjadi `uuid` dengan nilai 128 bit yang sama, termasuk id yang tertanam di teks dan JSON milik Core. `0002_coreerp_ids.sql` milik module melakukan hal yang sama untuk teks dan JSON module.
    - `0003_user_ids_to_uuid.sql` mengubah `users.id` dan setiap kolom id pengguna dari `bigint` menjadi `uuid`, karena identitas pengguna pindah ke control-plane-metta yang memberi id uuid (keputusan pemilik produk, 9 November 2026). Id `n` menjadi uuid bernilai `n` (`12` menjadi `00000000-0000-0000-0000-00000000000c`), dan teks atau JSON yang menyimpan id pengguna ditulis ulang ke teks uuid. `0003_user_ids_to_uuid.sql` milik module melakukan hal yang sama untuk tabel module. `database/find-user-ids.sql` menemukan kolom, function, teks, dan JSON yang memegang id pengguna.
    - Database hasil restore dump CoreERP memakai `bun run migrate --adopt-coreerp`: `0001` setiap pemilik dicatat tanpa dijalankan setelah tabelnya terbukti ada, lalu sisanya diterapkan. Jalur ini dipakai alat uji kesetaraan untuk mengonversi seed CoreERP.
    - Tidak ada pemindahan data pelanggan dari CoreERP atau sistem lama. Pelanggan lama tetap di aplikasi lama sampai batas waktu yang ditentukan, dan repo ini mulai dari database kosong (keputusan pemilik produk, 9 November 2026).
    - Perubahan skema CoreERP sesudah `6b3cf584` tidak ikut otomatis. Bila dibutuhkan, tulis sebagai migration baru di sini. `database/find-ulid-text.sql` menemukan id ULID di kolom teks dan JSON pada dump yang lebih baru.
- Migration tinggal bersama pemiliknya, karena module dibeli dan dipasang per lingkungan. Foldernya ada di tabel [Susunan repo](#susunan-repo), dan `migrate` di `src/platform/migration/` mencatat migration per pemilik di `schema_migrations`. `src/migrate.ts` hanya pembungkusnya, dan image membawanya sebagai `bun dist/migrate.js` untuk database runtime. Core berjalan lebih dulu, lalu module. Migration Core tidak membuat atau merujuk tabel module.
- Lingkungan disiapkan oleh `provisionEnvironment` di `src/platform/environment/`: database lingkungan dibuat dan hanya Core yang dimigrasi di dalamnya, lalu customer, tenant, admin pertama, dan role pemilik dengan semua duty Core ditulis dalam satu transaksi. Id datang dari control plane, jadi penyiapan yang diulang menemukan tenant yang sama dan tidak menulis apa pun. Admin pertama dibuat di database lingkungan sampai identitas pusat ada (keputusan pemilik produk, 9 November 2026). Module belum ikut; module dipasang dari entitlement.
- `src/worker.ts` (di image: `bun dist/worker.js`) menarik operasi lingkungan dari control-plane-metta lewat API worker (`contracts/worker/openapi.yaml` di repo itu) dan menjalankannya di database host ini, satu per satu. Klien bertanda tangannya di `src/platform/control-plane/`. Setiap langkah dilaporkan sebelum dijalankan, sehingga tenggatnya diperpanjang dan worker berhenti di antara langkah bila control plane menjawab operasinya tidak lagi dipegang. Kegagalan ditutup `failed` dengan sebabnya. Setelan: `CONTROL_PLANE_URL` (proses agen control plane), `WORKER_HOST_ID` (dicetak `add-runtime-host`), `WORKER_PRIVATE_KEY_PATH` (PEM RSA pasangan kunci publik yang didaftarkan), dan `WORKER_POLL_SECONDS`. Image membawa berkas migration karena worker memigrasi database lingkungan. Operasi yang dikenal: `provision` (`provisionEnvironment`) dan `migrate` (`migrateEnvironment`), yang membawa database lingkungan yang sudah disiapkan ke skema kode ini: Core dan module yang sudah tercatat terpasang di `schema_migrations` database itu, tanpa memasang module baru. Lalu `convert` (`convertEnvironment`), yang menjadikan demo produksi di tempat: alamat `<tenant>.demo.<base>` di `environment_routes` pindah ke `<tenant>.<base>` dan tetap menunjuk database yang sama. Lalu `expire` (`expireEnvironment`), yang mengisi `disabled_at` alamat demo yang kedaluwarsa sehingga runtime menjawabnya 404; database dan isinya tidak disentuh sampai dibuang. Lalu `restore` (`restoreEnvironment`), pasangannya, yang mengosongkan `disabled_at` lagi selama alamat itu masih menunjuk database yang sama. Terakhir `purge` (`purgeEnvironment`), satu-satunya yang tidak dapat dibatalkan: database lingkungan bukan produksi dibuang dengan `DROP DATABASE ... WITH (FORCE)` setelah masa tenggangnya habis, alamatnya tetap tercatat nonaktif, dan database yang masih ditunjuk alamat aktif mana pun tidak pernah dibuang. Lalu `copy` (`copyEnvironment`), yang menyalin produksi menjadi sandbox tanpa menghentikannya (`pg_dump` satu snapshot ke berkas, `pg_restore --single-transaction`; image membawa `postgresql-client-17`), melucuti efek keluar yang ikut tersalin (antrean event, ekspor laporan, reservasi nomor, job, kredensial layanan, sesi, cache, registri salinan), memigrasi, memeriksa tidak ada yang tersisa, lalu terakhir mencatat alamat `<tenant>.sandbox.<base>`.
- Alamat request menentukan lingkungan: `<tenant>.<BASE_DOMAIN>` untuk produksi dan `<tenant>.<kind>.<BASE_DOMAIN>` untuk demo dan sandbox (keputusan pemilik produk, 9 November 2026: subdomain per tenant, demi isolasi origin antar-klinik). Penyiapan mencatat alamat itu di `environment_routes` di database runtime, terakhir, sesudah tenant lengkap. Runtime membaca tabel itu untuk memilih database lingkungan dan membatasi workspace ke tenant pemilik alamat. Alamat yang tidak tercatat, label cadangan (`admin`, `www`, `api`, `registry`), dan alamat di luar domain dasar dijawab 404. `BASE_DOMAIN` kosong mematikan semua itu, seperti di test lama dan server satu lingkungan. Cookie sesi berawalan `__Host-`, jadi selalu Secure, tanpa Domain, dan tidak bisa ditimpa subdomain lain.
    - `bun run migrate` memigrasi Core dan semua module. `bun run migrate --modules a,b` memigrasi Core ditambah module yang disebut saja, dan `--modules ''` hanya Core.
- Id baru dibuat dengan `Bun.randomUUIDv7()`, termasuk id pengguna. API dan URL memakai teks UUID huruf kecil.
- Konfigurasi runtime dan aturan database ditetapkan skill `operations-metta-bun-elysia` dan [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md), antara lain jumlah proses Bun, pool koneksi, `idleTimeout`, prepared statement, tipe parameter, tempat sesi, actor audit, dan setelan PostgreSQL yang dilarang. Berkas ini sengaja tidak menyalin angkanya. Baca dari sumbernya.
- Tidak ada baris yang dihapus fisik. Menghapus berarti mengisi `deleted_at`. Indeks unik pada kode bisnis wajib parsial (`WHERE deleted_at IS NULL`), supaya kode yang sudah dihapus bisa dipakai lagi. Rinciannya di [Penghapusan lunak](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#penghapusan-lunak).

## Kode dan nomor dokumen

Keputusan pemilik produk, 4 November 2026. Di CoreERP hampir setiap master diberi kode otomatis. Mulai sekarang kode hanya ada bila memang dipakai orang.

- Mesin number sequence di `src/foundation/number-sequence/` membawa scope, reset fiskal, mode continuous dan non-continuous, dan preallocation dari CoreERP. Sejak 10 November 2026 ia mengikuti F&O: satu reference boleh punya banyak sequence, satu per nilai scope (tenant, legal entity, operating unit, atau legal entity + periode fiskal), dipilih dari organisasi dan tanggal dokumen, dan nomor diambil di dalam transaksi dokumen. Rinciannya di skill `number-sequence-design`.
- Nomor otomatis hanya untuk dua hal: dokumen transaksi (penerimaan, mutasi, penjualan, pemusnahan, work order, dan sejenisnya) dan master utama yang dicari orang lewat kodenya, misalnya aset.
- Master setup kecil, misalnya kondisi aset, tipe lokasi, dan sebab kerusakan, tidak memakai number sequence. Bila orang memang mengetik atau menyaring dengan kode, kodenya pendek dan diketik pengguna, seperti field `Code` di Business Central. Bila tidak, cukup nama dan ID internal.
- Baris dokumen dan entri ledger tidak punya kode bisnis.
- Master memakai mode non-continuous, jadi nomornya boleh bolong. Mode continuous hanya untuk dokumen yang memang diaudit.
- Diputuskan per master saat master itu dipindah. Kolom kode yang tidak lagi diisi otomatis dibuat opsional lewat migration di CoreERP, bersama pencabutan referensi nomornya di manifest, karena skema masih milik CoreERP.

## Kapan sebuah alur dianggap pindah

Keputusan pemilik produk, 9 November 2026: harness kesetaraan hanya wajib untuk alur yang menyentuh uang dan nomor. Kesalahan kecil di alur itu langsung menjadi angka keuangan yang salah, sedangkan alur lain cukup dibuktikan test.

- **Alur yang dipindah dari CoreERP dan menghitung atau mencatat uang atau nomor** dianggap pindah hanya setelah harness kesetaraan melaporkannya identik dengan CoreERP untuk input yang sama. Termasuk di sini posting ke finance, penyusutan, penomoran dokumen, dan nilai uang lain yang disimpan. Harness itu terdiri dari:
    - Golden run, yang membandingkan respons HTTP dan jejak SQL.
    - Conformance, yang antara lain menguji pencabutan akses, rollback, dan throttle.
    - Oracle SQL, yang memeriksa isi database langsung tanpa memakai kode aplikasi.
- **Alur lain yang dipindah dari CoreERP**, misalnya master seperti Organization dan buku alamat, dianggap pindah setelah test berbasis database di repo ini membuktikan perilaku CoreERP yang dipindah: validasi, kasus tolak, efek ke database, dan izin. Acuannya tetap kode dan test CoreERP.
- **Alur baru yang tidak ada di CoreERP**, misalnya alur layanan kesehatan, tidak punya acuan kesetaraan. Buktinya test berbasis database ditambah syarat beban dan kebenaran.
- Harness itu ada di `parity/` repo ini, dipindah dari eksperimen CoreERP. Hasil CoreERP yang tersimpan memakai ULID dan dipetakan ke uuid saat dibaca. Cara menjalankannya dan daftar waiver-nya ada di `parity/README.md`. Data acuan dan secret fixture tetap di server lab, tidak pernah masuk repo. Golden run dan conformance hanya bisa dijalankan di lab; test untuk harness itu sendiri berjalan di CI.
- Sebuah module boleh disebut sudah pindah setelah [pemeriksaan kesetiaan](docs/design-system/04-pemeriksaan-kesetiaan.md) terpenuhi seluruhnya, termasuk syarat beban dan kebenarannya.

## Kontrak

- Repo ini pemilik endpoint `internal/v1` yang dipanggil control plane. Setiap endpoint, event, dan webhook yang dipakai dari luar runtime wajib punya kontrak.
- Kontrak ditulis tangan, tidak pernah di-generate dari kode.
- REST untuk perintah dan permintaan data. Event untuk fakta yang sudah terjadi. Jangan mengontrakkan panggilan REST sebagai event, atau sebaliknya.
- Kontrak menggambarkan keadaan sebenarnya. Kalau kode belum memenuhi aturan, tulis gap-nya di `info.description`, bukan bentuk ideal yang belum dikirim kode.
- Mengubah kontrak berarti mengubah repo penerbit dan repo pemanggil dalam pekerjaan yang sama.
- Test sisi pemanggil memvalidasi permintaannya terhadap berkas kontrak, bukan terhadap fake berjawaban tetap. Di CoreERP, Core memeriksa `Authorization: Bearer`, konsol mengirim header lain, dan kedua suite tetap hijau.

## Bahasa

- **Nama di dalam kode ditulis bahasa Inggris, tanpa kecuali.** Ini berlaku untuk berkas, folder, fungsi, class, type, variabel, properti, nama route, kunci config, variabel env, nama perintah CLI, dan komponen UI. Contohnya, `siapkanLingkungan` menjadi `provisionEnvironment`.
- Yang tetap bahasa Indonesia, dan ini disengaja: nama tabel, kolom, index, dan constraint database, teks yang dibaca pengguna di layar, alamat URL layar yang diketik operator, komentar, docs, dan pesan commit.
- Kalau sebuah istilah tidak punya padanan Inggris yang jelas, pakai istilah Dynamics 365 untuk hal yang sama. Jangan mengarang terjemahan harfiah.
- Istilah teknis yang sudah baku ditulis apa adanya, misalnya push, pull, scope, token, signing secret, webhook, endpoint, GET, POST, dan PUT. Ini berlaku di layar, pesan, kontrak, dan docs. Tulis "scope `vendors.read`", bukan "cakupan `vendors.read`". Batasnya ada di skill `operations-metta-docs`, bagian [Where the loanword boundary sits](.agents/skills/operations-metta-docs/SKILL.md#where-the-loanword-boundary-sits).
- Teks layar untuk pengguna bisnis memakai bahasa sehari-hari yang menjelaskan tindakan atau dampaknya. Istilah internal seperti `tenant_id`, entitlement, atau nama class tidak tampil di layar itu. Pengecualiannya hanya layar yang memang untuk developer atau operator teknis.

## Nama datang dari database

- Jangan menulis mati nama perusahaan, nama orang, atau nama module besar seperti Praktik Dokter di kode. Nama itu datang dari konfigurasi di database. Kalau belum jelas sebuah nama termasuk atau tidak, tanyakan ke pemilik produk.

## Repo ini publik

Siapa pun bisa membaca isi repo ini, termasuk berkas yang sudah dihapus, karena riwayat git menyimpannya.

- Tidak ada secret di repo. Secret hanya disimpan di GitHub Actions secrets.
- Tidak ada data pasien. Fixture dan data uji dibuat sintetis.
- Alamat server, IP, user SSH, dan nama service di server ditulis sebagai contoh, misalnya `server.example.com` dan `203.0.113.10`, bukan nilai sebenarnya.
- Tidak ada self-hosted runner. Pull request dari fork dapat menjalankan kode apa pun di runner semacam itu.
- Workflow deploy hanya berjalan di `main` atau tag, tidak pernah pada event `pull_request`.

## Skill

- Skill hanya ada di `.agents/skills/`. Keputusan pemilik produk, 9 November 2026: folder `.claude/` dihapus dan tidak ada salinan kedua. Akibatnya, menurut dokumentasi Claude Code saat ini skill proyek dibaca dari `.claude/skills/`, jadi sesi Claude Code tidak memuat skill repo ini sampai Claude Code membaca `.agents/skills/`. Sampai saat itu, buka `SKILL.md` yang relevan secara langsung.
- Skill CoreERP yang dipindah ke sini pada 9 November 2026 diganti nama dari awalan `coreerp-` menjadi `operations-metta-`, dan versi yang berlaku ada di sini, karena repo CoreERP tidak disentuh lagi. Skill generik, misalnya `module-discovery` dan `number-sequence-design`, tetap memakai namanya.
- Isi skill menggambarkan keadaan repo ini. Bagian yang belum dipindah dari CoreERP disebut terus terang dan ditautkan ke kode atau docs CoreERP sebagai acuan perilaku. `operations-metta-bun-elysia` memegang angka runtime yang sudah diukur; path `docs/...` di dalamnya ditulis sebagai tautan ke repo CoreERP.

## Alur kerja

Keputusan pemilik produk, 9 November 2026: setiap perubahan masuk `main` lewat pull request, supaya CI selalu lulus sebelum perubahan sampai di `main`. PR tidak dibuat sebagai draft dan tidak menunggu review.

- Kerjakan di worktree sendiri, lalu jalankan pemeriksaan di bagian [Sebelum menyatakan hijau](#sebelum-menyatakan-hijau).
- Push branch-nya dan langsung buka PR biasa: `gh pr create --base main`. Jangan `--draft`.
- Langsung pasang auto-merge: `gh pr merge --auto --squash`. GitHub me-merge PR itu sendiri begitu check `check` hijau, jadi tidak ada yang perlu menunggu. CI yang merah diperbaiki di branch yang sama.
- Branch `main` dijaga ruleset GitHub: setiap perubahan wajib lewat PR, check `check` wajib lulus, dan force push serta penghapusan `main` ditolak. Push langsung ke `main` ditolak, juga untuk admin.
- **Hotfix.** Admin repo boleh me-merge PR tanpa menunggu CI dengan `gh pr merge --admin --squash`. Jalan ini hanya dipakai bila pemilik produk menyatakan perubahannya hotfix. Tulis "Hotfix" beserta alasannya di judul atau badan PR. Bila CI PR itu ternyata merah, perbaikannya menjadi PR berikutnya sebelum pekerjaan lain dilanjutkan.
- Jangan mematikan ruleset untuk meloloskan perubahan.
- Sebelum menyentuh folder yang mungkin sedang dikerjakan sesi lain, periksa `git worktree list` dan kabari sesi itu lebih dulu.

## Worktree

Keputusan pemilik produk, 9 November 2026: worktree tidak dibuat di folder kerja di luar repo, supaya folder kerja tidak dipenuhi salinan repo yang lupa dihapus.

- Worktree hanya dibuat di `.worktrees/<nama>` di dalam clone ini: `git worktree add .worktrees/<nama> -b <branch> origin/main`. Folder `.worktrees/` sudah di-ignore git.
- Hapus begitu PR-nya di-merge: `git worktree remove .worktrees/<nama>`, lalu `git branch -D <branch>`. Jangan menghapus foldernya dengan `rm -rf`.
- `git worktree list` menampilkan semua worktree yang masih ada. Periksa sebelum memulai pekerjaan baru.
- `bun scripts/prune-worktrees.ts`, dijalankan dari clone utama, menghapus worktree di `.worktrees/` yang commit-nya sudah ada di `main` dan HEAD-nya tidak bergerak 24 jam, atau yang PR-nya sudah di-merge atau ditutup, beserta branch lokalnya. Batas 24 jam melindungi worktree yang baru dibuat dari `main` dan belum diisi. Worktree yang masih punya perubahan belum di-commit atau commit yang belum masuk `main` tidak disentuh. Tambahkan `--dry-run` untuk melihat hasilnya tanpa menghapus apa pun.
- Setiap worktree yang dibiarkan dilaporkan tertinggal berapa commit dari `main` dan sudah berapa hari tidak disentuh, dengan tanda `LAMA` sesudah tujuh hari. Jalankan perintah itu di awal setiap sesi. Worktree `LAMA` diputuskan saat itu juga: selesaikan dan merge PR-nya, gabungkan `main` terbaru ke branch-nya sebelum dilanjutkan, atau tutup PR-nya supaya terhapus pada putaran berikutnya.
- Nama foldernya harus tetap berawalan titik. Prettier mengabaikannya karena tercantum di `.gitignore`, `bun test` tidak masuk ke folder berawalan titik, dan `tsconfig.json` hanya membaca folder yang disebut. Folder tanpa titik akan ikut dijalankan `bun test`.

## Sebelum menyatakan hijau

Jalankan dari akar repo. Keenam pemeriksaan ini wajib lulus untuk setiap perubahan:

```bash
bun run check:generated
bun run typecheck
bun run lint
bun test
bun run format:check
bun run check:boundaries
```

`bun run lint` menjalankan ESLint dengan aturan type-aware typescript-eslint (`eslint.config.js`). Ia menolak antara lain nilai `any` yang mengalir ke kode bertipe, promise yang tidak ditunggu, `!` di luar test, `switch` atas union yang tidak lengkap, `interface` untuk bentuk data, dan cast `as` di luar test (`as const` tetap boleh). Nilai yang belum bertipe dipersempit dengan pemeriksaan yang benar-benar memeriksanya atau di-parse schema zod, bukan di-cast. `bun install` memasang `.githooks/pre-push`, jadi push ditolak bila lint gagal, dan CI menjalankan perintah yang sama. Temuan diperbaiki di kodenya. `eslint-disable` hanya untuk kode yang benar tetapi tidak terlihat oleh aturannya, satu baris, dengan alasan di komentar di atasnya. Aturan di `eslint.config.js` tidak dilonggarkan untuk meloloskan perubahan.

Test yang memanggil route lewat database (`test/support/operations-app.ts`) hanya berjalan bila `DB_HOST` diisi, dan dilewati bila kosong. Test sesi di Valkey juga butuh `VALKEY_HOST`. CI selalu mengisi keduanya. Di laptop, pakai PostgreSQL dan Valkey sekali pakai, lalu hapus containernya:

```bash
docker run -d --name ops-test-db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci-only-not-a-secret \
    -e POSTGRES_DB=operations_test -p 127.0.0.1:55432:5432 postgres:17
docker run -d --name ops-test-valkey -p 127.0.0.1:56379:6379 valkey/valkey:9.1.2-alpine
export DB_HOST=127.0.0.1 DB_PORT=55432 DB_DATABASE=operations_test DB_USERNAME=ci DB_PASSWORD=ci-only-not-a-secret
export VALKEY_HOST=127.0.0.1 VALKEY_PORT=56379
bun run migrate && bun test
docker rm -f ops-test-db ops-test-valkey
```

`bun run build` hanya perlu dijalankan bila perubahan menyentuh hasil build: `package.json`, `bun.lock`, `tsconfig.json`, `Dockerfile`, `src/main.ts`, `scripts/build.ts`, atau kode peramban (`.tsx`, `src/platform/shell/`, `packages/ui/`). Untuk perubahan lain, lewati saja, karena build memakan waktu dan CI tetap menjalankannya di setiap PR. Bila `check:generated` gagal, jalankan `bun scripts/generate-client.ts` lalu commit hasilnya.
