# Kriteria review operations-metta

Baca aturan pada branch/revisi yang sedang dinilai dan aturan terbaru di `AGENTS.md`. Untuk alur yang
dipindah dari CoreERP, perilaku CoreERP adalah acuan. Untuk alur yang menghitung atau mencatat uang atau nomor,
harness kesetaraan di `parity/` buktinya; alur lain dibuktikan test berbasis database.
Jelaskan perbedaannya jika contoh lama belum mengikuti aturan terbaru. Jangan menjadikan legacy
sebagai pengecualian untuk source baru.

## Cakupan yang dicatat sebelum review selesai

Catat hasil tiap pemeriksaan yang relevan sebagai `verified`, `finding`, `source_only`,
atau `not_applicable`. `verified` membutuhkan bukti yang sudah diperiksa. `source_only`
menyebut batas pemeriksaan secara terbuka. `not_applicable` membutuhkan alasan berdasarkan
scope diff, bukan karena reviewer belum sempat mengecek.

| ID pemeriksaan | Berlaku ketika | Yang perlu diperiksa |
| --- | --- | --- |
| `scope` | Semua PR | Head/base tepat, perubahan langsung dibanding inherited, tujuan dan batas tugas |
| `behavior` | Semua PR | Perilaku pengguna, kasus gagal/kosong/batas, data contoh yang masuk jalur nyata |
| `code_quality` | Semua PR | Kepemilikan tanggung jawab, duplikasi aturan/state, identitas data, kode mati, penggunaan API SDK yang sebenarnya |
| `verification` | Semua PR | Bukti yang dijalankan, hasil dan keterbatasan. CI hijau bukan bukti alur bisnis benar |
| `shared_capability_ownership` | Resource/fitur bisnis melalui API, form atau lifecycle | Jika modul pertama tidak dibeli, master/kemampuan bersama yang diperlukan modul lain tetap tersedia; keputusan master ke `src/foundation/`, engine netral ke `src/platform/` |
| `authorization_and_input` | Endpoint/API atau perubahan security/grant | Permission resource/aksi (`Workspace.guard`), tenant/company/policy (`Workspace.filter`), input query/write divalidasi schema zod, ID dari sumber tepercaya |
| `n_plus_one` | Pembacaan database | Query pada ukuran batch berbeda, termasuk serialisasi; hitung lewat `TRACE_FILE`, dan tunjukkan kontrol yang sengaja query per baris memang menambah query |
| `payload_and_batch_bounds` | Pembacaan database | Batas server, jumlah child, field/proyeksi, alias JSON ganda, query per lookup/baris, respons saat input batch ekstrem |
| `datatable_incremental` | Daftar UI | Lazy loading/incremental saat scroll, cursor/batch terbatas, search/filter/sort server, pembatalan hasil request basi |
| `load_error_states` | Daftar UI | Loading, hasil kosong, gagal dan tanpa izin berbeda; error menetap pada pekerjaan aktif dan tidak disamarkan sebagai empty state |
| `error_header_and_fields` | Form UI | Ringkasan di bawah header/toolbar, state field sama, `noValidate` dan validasi aplikasi, draft tetap ada, busy/dirty guard |
| `numbering_concurrency_soft_delete` | Lifecycle/persistence berubah | Issuer nomor, scope indeks, retry/key/payload, versi baris (`expectedVersion`, 428/409), transaksi, identitas child, soft delete dengan indeks unik parsial |
| `contracts_and_docs` | Contract/integrasi berubah | Permukaan nyata tercatat di `contracts/`, versi/transport benar, consumer dan publisher selaras, docs tidak menjanjikan perilaku yang belum ada |

Daftar DataTable **tidak memakai navigasi nomor halaman**. Lazy loading UI berbeda dari
query per baris di service yang menimbulkan N+1. `renderRows` adalah API SDK yang sah; periksa
perilaku sebenarnya sebelum menuduh renderer manual rusak.

Untuk gate pemilik, bedakan fitur bersama yang benar-benar diperlukan modul lain dari
integrasi opsional atas fakta proses modul asal. Bila aturan dan makna sudah jelas,
langsung minta pemindahan ke Core; jangan menawarkan kepemilikan modul sebagai pilihan
setara. Pengujian harus menunjukkan master tetap tersedia ketika modul asal tidak
dipasang atau dinonaktifkan, dengan permission dan scope data tetap dijaga.

## Bukti performa yang tidak tertukar

- Pisahkan jumlah query, jumlah row/payload, dan write amplification. INSERT per rincian
  bukan otomatis read N+1. Query tetap bisa membawa payload yang membesar tanpa batas.
- Untuk klaim bebas read N+1 yang diuji, gunakan ukuran induk berbeda dan child terisi.
  Serialisasi respons ikut dihitung. Catat jumlah record yang benar-benar dimuat, bukan
  fixture yang ternyata terpotong default batch pertama.
- Jika membuat penghitung query, tunjukkan kontrol yang sengaja query per baris memang
  menghasilkan pertumbuhan query.
- Catat environment dan bagian yang dilewati. Database tiruan atau database tanpa trigger
  PostgreSQL bukan benchmark PostgreSQL, uji kapasitas, atau bukti efek trigger.
- Untuk hubungan master pada banyak row, cari pola batch satu query `in (...)` untuk sekumpulan id,
  seperti pembacaan permintaan pengadaan di `asset-receipt.service.ts`. Jangan memperkenalkan
  query per sel matriks/list.
- Jangan menyarankan bulk insert yang melewati penyaringan tenant, id uuid, audit/event, versi
  atau identitas child tanpa memeriksa kebutuhan tersebut.

## Kualitas dan kehilangan data

Jalankan kasus ubah Vendor, buka ulang edit, rincian bernama sama, baris yang baru terisi
sebagian, retry, serta tutup ketika dirty/busy bila diff menyentuhnya. Label/nama yang bisa
disunting bukan identitas record. Filter nama kosong bukan pengganti validasi baris parsial.

Panjang file, jumlah hook, cast, wrapper atau komentar adalah petunjuk untuk ditelusuri,
bukan temuan otomatis. Pilih perbaikan terkecil yang menghapus penyebab tanpa framework
generik atau compatibility layer spekulatif. Tandai cleanup opsional sebagai P3.

## Sumber kanonik dan contoh

- Aturan repo: `../../../../AGENTS.md`.
- UI dan lazy loading: `../../operations-metta-ui/SKILL.md`, `../../operations-metta-page-standard/SKILL.md`,
  dan CoreERP [`docs/dev/02-module-standard.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md)
  bagian daftar dimuat bertahap.
- Error terbaru: `../../operations-metta-ui/references/error-feedback.md`. Contoh toast lama tidak
  mengalahkan pola header.
- Scope/security/lifecycle/kontrak: `../../operations-metta-architecture/SKILL.md`, CoreERP
  [`docs/dev/09-identity-and-access.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/09-identity-and-access.md)
  dan [`docs/dev/14-number-sequences.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/14-number-sequences.md).
- Pola server yang relevan: `src/platform/access/workspace.ts`, `src/platform/http/listing.ts`,
  `modules/asset-management/src/fixed-asset/asset/asset.service.ts`, dan
  `modules/asset-management/src/fixed-asset/asset-receipt/asset-receipt.service.ts`.

Path skill dan `AGENTS.md` di atas relatif terhadap folder `references` ini; path kode relatif
terhadap root repository. Pilih contoh yang perilakunya benar-benar serupa, baca source-nya,
lalu berikan permalink revisi/baris yang sudah diverifikasi pada komentar GitHub.
