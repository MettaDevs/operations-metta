---
name: operations-metta-page-standard
description: Build or review operations-metta screens with consistent typography, page hierarchy, cards, actions, hints, filters, tables, empty states, responsive behavior, and Shell navigation. Use whenever creating a `.page.tsx`, adding a module screen, changing a list/detail/form screen, porting a CoreERP screen, translating a mockup into UI, or auditing visual consistency, even when the user only asks to add a page or CRUD screen.
---

# operations-metta page standard

Apply `operations-metta-ui` first. Layar yang sudah dipindah ke repo ini menjadi acuan untuk layar dengan pekerjaan yang sama. Untuk pekerjaan yang belum punya layar di sini, layar CoreERP adalah kontrak visualnya, dan alurnya tanpa ikatan framework ada di `docs/design-system/`. Cara menulis halaman (`definePage`, route, search params, data) ada di bagian [Layar](../../../AGENTS.md#layar) `AGENTS.md`.

## Workflow

1. Find the closest existing screen by behavior: directory/list, settings, form, detail, or dashboard — in this repository first, otherwise in CoreERP.
2. Inspect the public `@operations-metta/ui` primitives it uses. Do not copy screen source from control-plane-metta or from another screen.
   Ensure required root providers such as `TooltipProvider` are installed once before using composed primitives like `CardDescription`.
3. Identify ownership: the Shell in `src/platform/shell/` owns global header, rail, sidebar, search, theme, and account controls; the module screen renders business content only.
4. Implement the smallest composition that matches the reference.
5. Compare desktop/mobile, light/dark, keyboard focus, loading, error, populated, and empty states.
6. Run `bun run typecheck` and `bun run format:check`.

## Memilih daftar dan kartu record

Entitas kompleks, misalnya aset dengan banyak field dan relasi, memakai DataTable sebagai daftar dan `PageDialog` SDK sebagai kartu Baru/Detail/Ubah. Split view dipilih untuk alur konfigurasi atau pemeriksaan berdampingan yang memang memerlukannya; banyak field saja tidak membuat split view menjadi pilihan yang benar. Pertahankan konteks daftar saat kartu dibuka, pisahkan izin baca/edit/create, dan jaga draft serta error penyimpanan.

## Page hierarchy

- Use one content title. Do not add uppercase category eyebrows such as "MASTER DATA" unless the reference page has one for a real user need.
- Gunakan hierarki tipografi SDK: judul halaman pada bar perintah 14 px semibold, teks operasional 14 px, header kolom tabel 12 px regular, dan judul FastTab 18 px semibold dengan header ringkas. Identitas record boleh lebih menonjol, tetapi jangan membesarkan seluruh header CRUD dengan `text-xl`, `text-3xl`, atau `text-4xl`. Pilihan font pengguna tetap dihormati.
- Keep page/card descriptions optional and page-wide. Do not add a hover/info hint to every heading. Give complex or non-obvious fields optional help text attached to that field; use `FieldDescription` when the guidance must be visible before entry, and keep field-specific meaning out of the page/card header.
- Modules render in the Core Shell and inherit its React tree and theme. Do not recreate Shell chrome or iframe hosting.

## State the page does not own

- **A value owned by the URL is derived on every render, never copied into `useState`.** Shell navigation moves between sections by changing the query string (`?section=members` → `?section=invitations`). Visiting the same page component does not remount it, so a `useState` initialiser reads the URL once and then freezes; the address bar changes and the screen does not. The symptom looks like a broken menu, and the cause is three lines away in a file nobody suspects.
- Props and responses are what the server actually sends. Do not add optional fields to a props or response type speculatively — a reader takes `avatar_url?: string | null` as evidence the backend provides it. Either send it from the procedure in the same change, or leave it out. In this repository the screen reads its data through the oRPC client (`api` and `orpc` from `src/platform/shell/index.ts`), whose input and output types come from the router in `src/main.ts`; use those types instead of writing a twin `interface`.
- Read the procedure (`.routes.ts`) and its service before trusting a field. If it is absent there, the fallback you wrote is the only branch that will ever run.

## Draft dan bagian kosong

Alur record baru adalah **Baru → isi identitas dan rincian → Simpan sekali**. Semua bagian yang boleh diisi tersedia sejak kartu dibuka, sesuai izin dan pilihan pada form. Draft berarti isian sementara pada kartu yang sedang terbuka; belum menjadi record tersimpan dan tidak dijanjikan pulih setelah refresh browser.

- **Baru** membuka kartu record baru. **Tambah** menambahkan baris rincian. Pada popup rincian yang masih berupa draft, Tambah memasukkan baris ke draft induk dan Selesai menerima perubahan baris; hanya Simpan utama yang menyimpan seluruh record ke server. Baris yang baru ditambahkan langsung terlihat pada bagian induknya.
- Bagian rincian tidak boleh kosong tanpa penjelasan. Jika bisa diisi, tampilkan keadaan kosong singkat beserta tindakan yang tersedia, misalnya “Belum ada alamat. Pilih Baru untuk mengisi.” atau “Belum ada barang. Pilih Tambah untuk menambahkan baris.” Sesuaikan label dengan kontrol SDK yang benar-benar tampil dan izin pengguna.
- Bedakan keadaan berikut; jangan mengubah semuanya menjadi “Belum ada data”.

| Keadaan | Yang dilihat pengguna |
| --- | --- |
| Belum ada rincian pada draft | Pesan kosong singkat dan aksi untuk mengisi, sesuai izin. |
| Record tersimpan memang tidak memiliki rincian | Pesan kosong yang sesuai; aksi hanya bagi pengguna yang boleh mengubahnya. |
| Data sedang dimuat | Status memuat, bukan pesan kosong. |
| Pemuatan gagal | Pesan gagal dan cara mencoba lagi; jangan menyimpulkan data tidak ada. |
| Tidak punya izin | Sembunyikan bagian atau jelaskan batas akses bila bagian perlu tetap terlihat; jangan menampilkan data kosong palsu. |
| Tidak berlaku untuk pilihan saat ini | Sembunyikan bagian, atau jelaskan pilihan yang membuatnya berlaku bila itu membantu pengisian. |
| Hasil yang memang baru ada setelah proses bisnis | Jelaskan pemicunya, misalnya nomor diisi saat disimpan atau hasil penyusutan tersedia setelah proses penyusutan. Jangan mengunci rincian biasa dengan alasan ini. |

- Batal pada kartu induk membuang draft induk beserta rincian barunya. Batal pada popup rincian hanya membuang perubahan popup itu. Back, Close, Baru, dan navigasi record menjaga perubahan yang belum disimpan melalui konfirmasi atau guard yang sama.
- Bila Simpan gagal, pertahankan semua isian dan baris, tampilkan kesalahan pada bagian yang tepat, lalu izinkan pengguna memperbaiki dan mencoba lagi. Keberhasilan harus menampilkan record dan rincian hasil simpan; pengguna tidak perlu mengisi ulang atau melakukan Simpan kedua.
- Saat memindahkan layar CoreERP, audit seluruh alur Baru, Detail, dan Ubah, termasuk bagian yang ditampilkan bersyarat dan empty state. Jangan sekadar mengganti teks “simpan dahulu” atau menyembunyikan bagian. Alur baru memerlukan dukungan draft pada UI dan penyimpanan rincian bersama induknya. Nyatakan halaman yang belum mengikuti alur ini; perubahan SDK tidak otomatis memigrasikan logika halaman.

## Setelah menyimpan master

- Respons `POST`/`PATCH` yang berhasil harus mengembalikan record lengkap yang baru disimpan, sekurangnya `id`, `kode`, `nama`, dan status. Teruskan record itu ke state halaman; jangan hanya meneruskan `id` lalu berharap pemuatan ulang daftar mengisi form.
- Masukkan atau perbarui record hasil respons di state daftar sebelum memulai refresh. Jika panel detail bisa terpasang ketika data daftar masih kosong, ia dapat menginisialisasi state form dari `null`: kode akhirnya terlihat dari props, tetapi nama tetap kosong karena state lokal sudah terlanjur dibuat.
- Setelah membuat record baru, pilih record hasil respons dan ikuti tujuan alur halaman: tampilkan kartu tersimpan atau kembali ke daftar dengan record tersebut terpilih. Rincian biasa sudah dapat diisi dalam draft sebelum Simpan; jangan memaksa pengguna masuk edit lagi untuk melengkapi alamat, kontak, nilai checklist, model, atau baris rincian. Data yang bergantung pada proses bisnis berikutnya mengikuti lifecycle proses tersebut.
- Setelah `PATCH` pada record yang sedang diedit, pertahankan perilaku halaman yang sudah disepakati (biasanya kembali ke baca). Jangan menampilkan kartu `Belum disimpan` setelah respons sukses; kartu itu hanya untuk draft sebelum `POST` berhasil.

## Cards and actions

- A full-height operational list uses SDK `ListPageLayout` with header/filter/footer slots and a DataTable child. The layout owns the height rules and automatically gives the table viewport scrolling. Card-based settings/list pages keep one primary `Card`; when their main table is bounded, use `scrollMode="viewport"` and keep the Card header/footer outside that scroll area.
- Put its title in `CardHeader`. Add a hint there only when it explains the whole list, not an individual field.
- Aksi halaman memakai `RecordActionBar`; pada halaman berbasis Card gunakan `CardAction` di `CardHeader`. Tombol Baru/Tambah berada di kiri, bersama perintah lain. Jangan memakai `justify-between`, `justify-end`, atau `ms-auto` untuk mendorong aksi tersebut ke kanan. Status dan menu tambahan yang memang berbeda fungsi boleh berada di ujung kanan.
- Simpan tetap eksplisit dan berada di kiri atas, sebelum Batal. Pada kartu form gunakan `PageDialogToolbar`/`DialogToolbar` sebelum body, di dalam form yang sama, atau pertahankan atribut `form` jika tombol sudah mengacu ke form terpisah. Urutan DOM mengikuti urutan visual dan keyboard; jangan memindahkan tombol dengan CSS `order` atau portal. Konfirmasi dan pemilih bantu tetap mengikuti tindakan masing-masing.
- Perintah record memakai label dan ikon SDK: **Baru (+)**, **Ubah**, **Simpan**, **Batal (X)**, serta **Delete (tempat sampah)**. Jangan mengganti Baru dengan “Tambah [nama bagian]”. Tampil inline tanpa border/latar berisi. Delete tetap mengikuti handler penghapusan lunak (`deleted_at`). Pada daftar DataTable, kartu create/detail/edit dibuka di atas daftar yang tetap terpasang; bukan form pengganti seluruh layar.
- Bedakan **Baru** (`create`) untuk membuka kartu record baru dengan **Tambah** (`add`) untuk menambah baris atau memasukkan record ke kelompok/dokumen. Baris kosong baru di rincian dokumen tetap memakai Tambah. Contoh: membuat polis memakai Baru; menambah baris aset pada polis atau penerimaan memakai Tambah.
- Kartu memakai header otomatis SDK dengan urutan tetap: Back dan nama fitur; ikon Ubah, Bagikan, Baru (+), Delete; di kanan buka di tab baru, expand, Close. Bar berikutnya menampilkan kode/nomor dan nama record sebagai identitas besar yang terpisah, lalu navigasi utama, navigasi sekunder, dan isi. Gunakan `PageDialogContent title` untuk fitur dan `recordTitle` untuk identitas record. Komponen anak dapat mendaftarkan state/handler melalui `usePageDialogRecord`; jangan mendobel Back, Ubah, Delete, atau judul fitur di body. URL Bagikan/tab baru harus benar-benar membuka record tersebut. Navigasi sebelumnya/berikutnya mengikuti daftar aktual serta guard busy/dirty. Simpan/Batal tetap eksplisit di kiri atas area perintah form. Alamat, kontak, dan rincian record baru diisi sebagai draft lalu disimpan bersama induknya sekali; kegagalan menyimpan detail membatalkan seluruh transaksi.
- Put filters and data in `CardContent`. Daftar record dimuat bertahap saat scroll memakai mekanisme bersama pada skill `operations-metta-ui`; jangan menyediakan navigasi nomor halaman. Search, filter, dan sort tetap di server. Footer boleh menampilkan status pemuatan/error dan jumlah yang sudah dimuat.
- Use the SDK `Empty` composition when the comparable screen does.
- Collapsing a section hides secondary material, never the reason the user opened the page. A directory page whose record list starts closed shows a form and two clickable headings; the data it exists to show is behind a guess. Keep the primary list open and collapse what supports it. A section that is closed by default must still say what is inside it on its header line — `@operations-metta/ui/collapsible-section` exists for exactly that — or the user has to open it just to learn whether it was worth opening.
- Guidance the user needs before acting stays visible. Moving an explanation inside a collapsed section hides it from precisely the person it was written for: the one who does not yet know there is something to open.

## Filters

- Desktop filter bars are horizontal with wrapping: `flex flex-col ... sm:flex-row`.
- Inspect component wrappers. `NativeSelect` owns a `w-full` wrapper, so constrain it with a parent such as `<div className="w-full sm:w-52">`; setting width only on the select does not fix stacking.
- Keep search first and related filters next. Every control needs a visible label or `aria-label`.
- Vertical stacking is the mobile fallback, not the desktop default.

## Shared master pages

- A master owned by Foundation (`src/foundation/`; Vendor in CoreERP today, later Customer, Item, Worker) has **one** page. A module never builds its own copy of it, its own vendor dropdown endpoint, or its own vendor setup screen.
- Fields only one module needs appear as a section of that same page, owned and stored by the module — Business Central's `pageextension` on `Vendor Card`. The section shows only when the module is installed.
- A module reaches the master page from its own menu, so its users never have to know the Core settings menu.
- The section slot and module menu entries pointing to Core pages were not built in CoreERP either; the plan is in CoreERP's [`docs/todo/master-bersama/README.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/master-bersama/README.md). Until they exist, link to the Core page instead of rebuilding it.

## Navigation

- Navigation labels and the permissions that guard them are declared per module; the Shell renders navigation. In CoreERP they came from the module manifest (`app.yaml` and `manifest/`); this repository has no manifest yet, so Core entries are declared with their permission in `src/platform/access/navigation.ts` and served, already filtered, by `GET /api/v1/shell`. Only screens that exist are listed.
- Do not invent placeholder dots or circles for items without meaningful icons. Text-only child navigation is valid.
- Use a real icon only when it consistently communicates the destination.
- Label menu sidebar tampil penuh tanpa titik-titik atau line clamp. Label panjang membungkus dan tinggi item mengikuti isinya. Menu aktif tidak mengubah ukuran maupun ketebalan huruf; gunakan warna, latar, atau indikator untuk menandainya.
- Modules render inside the Core Shell; they do not announce readiness through an iframe/message handshake.

## Acceptance

- Write everyday Indonesian that explains the action or consequence. Standard technical terms (push, pull, scope, token, webhook, endpoint, GET/POST/PUT) stay as they are.
- Never expose internal architecture terms (`tenant_id`, entitlement, class names) on business screens.
- Verify: one clear title; page-level hint is optional; field help is attached to its field; hover opens it after roughly one second and closes it when the pointer leaves; label/title click toggles a persistent open state; keyboard can perform the same toggle; action inside the card; desktop filters horizontal; no decorative navigation bullets; SDK font/theme inherited; Shell header stays visible; list scrollbars remain reachable without scrolling to the last record; empty and error states readable.
