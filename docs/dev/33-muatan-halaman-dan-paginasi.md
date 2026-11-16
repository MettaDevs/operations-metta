# Muatan halaman: apa yang diambil, dan kapan

Halaman ini mengatur **berapa banyak data yang diambil satu layar**, dan kapan. Ia berlaku untuk setiap layar `.page.tsx`, milik Core maupun module, dan untuk setiap procedure yang memberinya data.

Rupa layar diatur skill `operations-metta-page-standard` dan `docs/design-system/`. Cara layar disajikan dan mengambil data ada di `AGENTS.md`, bagian **Layar**. Yang di bawah ini mengatur isinya.

## Kenapa aturan ini ada

Di CoreERP, satu halaman pengaturan akses diukur pada 18 September 2026 dengan tiga anggota, tiga role, dan dua module. Jawabannya hampir 118 KB, dan sekitar 109 KB di antaranya katalog izin yang hanya dibaca satu dialog. Halaman itu tidak terasa lambat, dan justru itu masalahnya: setiap angkanya tumbuh mengikuti sesuatu yang pasti bertambah, yaitu jumlah module, pegawai, dan role. Rinciannya di [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/33-muatan-halaman-dan-paginasi.md).

Kegagalan seperti ini tidak pernah muncul di mesin tempat kodenya ditulis. Ia muncul di klinik terbesar, beberapa bulan sesudah rilis.

Di repo ini server tidak mengirim props halaman. Layar mengambil datanya sendiri dari `/api/` lewat `api` dan `orpc` dari `src/platform/shell/`, dan setiap pengambilan adalah procedure oRPC. Aturan di bawah ditulis untuk bentuk itu.

## Empat aturan

### 1. Daftar dipaginasi di server, tanpa pengecualian "datanya sedikit"

Daftar yang panjangnya ditentukan pemakaian tenant dibaca bertahap dari server. Contohnya anggota, dokumen, transaksi, master, dan kode undangan. Mengambil semua baris lalu menyaring atau mengurutkannya di peramban adalah cacat, bukan pilihan.

Yang boleh diambil utuh hanya **daftar tertutup**: himpunan yang besarnya ditentukan rilis produk, bukan pemakaian tenant, seperti access level atau klasifikasi organisasi.

Ambang menilainya: kalau seorang pelanggan dapat membuat baris ke-10.000 tanpa meminta izin siapa pun, daftarnya wajib dipaginasi.

Bentuknya di repo ini:

- **Server.** `incrementalList(db, {...})` dari `src/platform/http/` menerima query yang sudah disaring tenant, izin, dan organisasinya, lalu menerapkan pencarian, sort dari allowlist kolom, dan cursor keyset di SQL. Ia memulangkan `{ data, next_cursor }`. Search params-nya `q`, `sort`, `direction`, `cursor`, `per_page` dengan batas 100 dan bawaan 40, serta `record_id` untuk memuat satu nilai terpilih. Contohnya `list` di `src/foundation/billing/discount/discount.service.ts`.
- **Layar.** `useIncrementalList` dari `@operations-metta/ui/use-incremental-list` memuat batch berikutnya saat pengguna mendekati akhir scroll, dan `DataTable` menerimanya lewat prop `incremental`. Tidak ada nomor halaman. Contohnya `src/foundation/billing/discount/discounts.page.tsx`.

Pencarian, saringan, dan pengurutan diterapkan server pada seluruh hasil yang diizinkan, **sebelum** batas batch. Cursor memakai `id` sebagai pembeda untuk nilai urutan yang sama, dan menangani NULL serta urutan angka. Jumlah yang dihitung dari batch berarti **sudah dimuat**, bukan total database, dan ditulis begitu di layar. Ekspor, agregat, dan pilih semua adalah operasi server tersendiri.

### 2. Data yang tidak dibaca tampilan pertama diambil saat dibutuhkan

Layar mengambil datanya sendiri, jadi menunda sebuah data cukup dengan tidak memintanya sampai dibutuhkan. Yang ditunda:

- Isi dialog, card, dan panel yang belum terbuka. Komponennya baru dipasang saat dibuka, dan `useQuery` di dalamnya baru berjalan saat itu. Contohnya metadata di `src/foundation/billing/discount/discount-card.tsx`.
- Pohon referensi yang hanya dipakai pemilih, misalnya katalog izin, susunan organisasi, dan daftar wilayah.
- Apa pun yang besarnya tumbuh mengikuti jumlah module, bukan jumlah baris yang ditampilkan.

Data yang memang dibutuhkan tampilan pertama diambil di procedure yang sama, bukan dipecah menjadi banyak permintaan kecil berurutan. Setiap permintaan membuka sesi dan meminjam satu koneksi database sampai selesai.

Data bersama Shell datang dari satu procedure, `GET /api/v1/shell`. Ia memuat pengguna, workspace, menu, dan lingkungan. Jangan menambahkan data milik satu halaman ke sana, karena setiap layar membayarnya.

### 3. Yang dikirim adalah bentuk yang dibaca layar, bukan baris tabel

`select *` mengirim setiap kolom ke peramban, termasuk `tenant_id`, kolom jejak, dan kolom yang tidak dibaca layar. Susun bentuknya sendiri dan sebut kolomnya satu per satu. Di CoreERP, langkah ini saja memangkas katalog izin dari 109 KB menjadi 29 KB dengan isi yang terbukti identik.

Tipe output procedure mengalir ke layar lewat `router` di `src/main.ts`, jadi tipe di layar sudah sama dengan yang benar-benar dikirim. Jangan menambah field di tipe layar yang tidak dikirim procedure. Pembaca menganggapnya bukti bahwa server menyediakannya.

Unit kerja dan orang milik Core selalu dikirim bersama namanya, diterjemahkan saat dibaca di server. Layar tidak mengunduh seluruh direktori untuk menerjemahkannya sendiri.

### 4. Query tidak boleh tumbuh mengikuti jumlah baris

Pola yang dicari saat meninjau: query di dalam `map`, `for`, atau fungsi yang dipanggil per baris.

Bentuk yang benar: kumpulkan kuncinya, jalankan satu query untuk semuanya, lalu petakan di TypeScript. Untuk graf seperti role yang mewarisi role lain, CTE rekursifnya membawa kolom asal, sehingga satu penelusuran menjawab seluruh daftar:

```sql
with recursive reachable(root_id, role_id) as (
    select r.id, r.id from roles r where r.tenant_id = $1 and r.id = any($2)
  union
    select reachable.root_id, link.child_role_id
    from security_role_children link
    join reachable on reachable.role_id = link.parent_role_id
)
select root_id, role_id from reachable
```

Dengan tiga baris di laptop selisihnya tidak terlihat. Dengan lima puluh baris ia seratus query lawan dua, tanpa satu baris kode pun yang berubah di antara keduanya.

## Saat meninjau layar baru

1. Buka tab jaringan peramban, urutkan jawaban `/api/` menurut ukurannya. Jawaban terbesar harus punya alasan yang dapat diucapkan.
2. Hitung query per permintaan. Jalankan dua kali dengan jumlah baris berbeda. Kalau jumlah query ikut berubah, aturan 4 dilanggar.
3. Tanyakan tiap permintaan: apakah tampilan pertama membacanya? Kalau tidak, tunda sampai dibutuhkan.
4. Tanyakan tiap daftar: siapa yang menentukan panjangnya? Kalau jawabannya pelanggan, paginasi.

## Lihat juga

- [Standar module](02-module-standard.md)
- [API, event, dan integrasi module](04-api-and-integration.md)
- [Load dan concurrency testing](20-load-and-concurrency-testing.md)
- `AGENTS.md`, bagian **Layar**
