# Standar penjaga dan pengujian

Halaman ini mengatur **penjaga**: test dan pemeriksaan otomatis yang menegakkan sebuah batas arsitektur, bukan yang menguji satu fitur. Aturannya lahir di CoreERP selama module dipindahkan ke satu runtime, dan hampir semuanya lahir dari kegagalan yang sama: sebuah pemeriksa melaporkan hijau padahal tidak memeriksa apa pun.

Cara menjalankan suite dan pemeriksaan wajib ada di `AGENTS.md`, bagian **Sebelum menyatakan hijau**, bukan di halaman ini.

## Penjaga yang ada

| Penjaga                      | Perintah                    | Yang dijaga                                                                                                   |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scripts/check-boundaries.ts` | `bun run check:boundaries` | Batas impor antara Core, module, dan package; pintu `index.ts`; nama tabel module di Core; letak test        |
| `scripts/check-ui.ts`        | `bun run check:ui`          | Pola layar yang di CoreERP dijaga ESLint dan skrip `check-*.mjs`, dan Core yang netral sektor                 |
| `scripts/generate-client.ts --check` | `bun run check:generated` | `src/client.tsx` dan kontrak API klien yang tertinggal dari kodenya                                      |
| `eslint.config.js`           | `bun run lint`              | Aturan type-aware, antara lain `any` yang bocor, promise yang tidak ditunggu, dan `switch` yang tidak lengkap |
| Job `migrations` di `.github/workflows/ci.yml` | CI saja     | Migration di database kosong, migration ulang tanpa perubahan, dan skema Core dulu lalu module                |
| `test/support/event-contracts.ts` | dipakai test penerbit  | Envelope di `outbox_events` cocok dengan kontrak di `contracts/events/`                                       |

Daftar lengkap yang diperiksa tiap penjaga ada di kodenya dan di `AGENTS.md`. Test ada di `test/` untuk Core dan skrip, dan di `modules/<module>/test/` untuk module, dengan susunan folder yang sama dengan kode yang diujinya.

## Penjaga dulu, pemindahan kemudian

Test yang menegakkan sebuah batas harus sudah ada **dan sudah terbukti bisa gagal** sebelum batas itu diandalkan. Penjaga yang ditambahkan belakangan dibuat hijau terhadap keadaan yang ada, termasuk terhadap pelanggaran yang sudah telanjur masuk.

Batas module di sini tidak ditegakkan mesin database. Ia ditegakkan pemeriksaan otomatis dan peninjauan, dan itu disebut apa adanya. Menulis bahwa "database menjaganya" membuat orang merasa aman tanpa alasan, dan orang yang merasa aman berhenti membaca diff. `check:boundaries`, misalnya, membaca impor dan nama tabel di kode Core, tetapi tidak membaca teks SQL di dalam module.

## Sebuah kriteria harus punya keadaan yang membuatnya merah

Sebelum menulis kriteria selesai, sebutkan satu keadaan yang membuatnya gagal. Kalau tidak ada, ganti kriterianya.

Bentuk yang tampak seperti pemeriksaan padahal bukan, semuanya pernah lolos di CoreERP:

| Terlihat seperti pemeriksaan                              | Kenapa tidak menguji apa pun                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Mencari jalur lama di satu repo                           | Rujukannya ada di repo lain, jadi pencariannya selalu hijau                    |
| Membangun situs dokumentasi untuk membuktikan folder hilang | Rujukannya bukan tautan, jadi pembangunan tidak pernah gagal karenanya       |
| Menghitung tabel pada database yang baru dibuat           | Nol memang jawaban yang selalu benar di sana                                  |

Polanya sama: pemeriksanya benar, tetapi subjeknya tidak pernah ada di tempat yang diperiksa.

## Pemeriksa yang belum pernah terlihat gagal tidak bisa dipercaya

Laporan sukses palsu lebih berbahaya daripada tidak ada laporan, karena ia menghentikan pencarian. Setiap penjaga harus pernah dilihat merah. Caranya ada dua:

- **Percobaan sekali jalan.** Rusakkan sesuatu dengan sengaja, catat pesannya apa adanya, kembalikan. Ia hanya membuktikan penjaga bisa gagal pada hari itu.
- **Test pendamping yang permanen.** Test memberi penjaga subjek buatan yang melanggar, lalu menuntutnya merah. Bentuk ini lebih baik.

Contoh bentuk kedua di repo ini: `test/scripts/check-ui.test.ts` menjalankan setiap aturan `check:ui` terhadap contoh yang ditolak lalu contoh yang diterima. `scripts/check-ui.ts` menerima akar repo sebagai argumen pertama justru supaya test bisa memberinya folder buatan. `test/scripts/new-feature.test.ts` membuktikan `new-feature` menolak menimpa fitur yang sudah ada.

`scripts/check-boundaries.ts` belum punya test pendamping. Sampai ada, setiap perubahan pada aturannya dibuktikan dengan percobaan sekali jalan, dan pesannya ditempel di pull request-nya.

## Dua lapisan yang menjawab pertanyaan sama membuat lapisan pertama tak terukur

Pola ini terlihat seperti test yang baik. Di CoreERP, route module dilindungi dua lapis: middleware konteks menolak pengguna tanpa izin, lalu controller memeriksa izin lagi. Test "pengguna tanpa izin mendapat 403" pada route sungguhan tetap hijau ketika penolakan di middleware dihapus, karena controller ikut menjawab 403.

Yang benar-benar bisa gagal adalah test yang memasang penangan yang **tidak ikut menjaga** di belakang lapis pertama, misalnya yang selalu menjawab 200. Kalau lapis pertama lenyap, jawabannya 200 dan testnya merah.

Di repo ini pola yang sama muncul pada `moduleWorkspace` dan `workspace.guard`. Dua lapis boleh ada. Yang tidak boleh adalah lapis pertama yang hilangnya tidak terlihat sampai ada route yang lupa memeriksa.

## Batas yang dipalsukan tidak menguji sisi seberangnya

Jawaban palsu tidak memvalidasi apa pun, jadi permintaan yang salah bentuk terlihat persis seperti yang benar. Di CoreERP sebuah test memalsukan Core dua kali, dan yang dibuktikannya hanya bahwa module bisa membaca amplop yang ditulisnya sendiri.

Aturannya: **jangan memalsukan Core.** Core dan module berjalan di satu proses, jadi test memanggil jalur sungguhan. Test route di repo ini berjalan di atas aplikasi sungguhan dan database yang sudah dimigrasi, lewat `test/support/operations-app.ts`. Test sesi berjalan di PostgreSQL dan Valkey sungguhan, karena tiruan yang menjawab tetap menyembunyikan penulisan yang membuat ulang sesi.

Untuk panggilan ke luar runtime, test sisi pemanggil memvalidasi permintaannya terhadap berkas kontrak, bukan terhadap tiruan berjawaban tetap. `test/support/event-contracts.ts` melakukannya untuk event. Bila sisi seberangnya protokol baku, test menjalankan server sungguhan yang mengikuti protokol itu. `test/support/oidc-provider.ts` adalah penyedia OIDC yang berjalan di port acak dengan kunci RSA sendiri, jadi klien SSO diuji lewat discovery, JWKS, dan endpoint token yang benar-benar berjalan.

## Pesan gagal menyebut nama yang salah dan bentuk yang sah

Penjaga dijalankan orang yang belum pernah membuka kodenya. Pesannya menyebut berkas dan baris yang melanggar, apa yang dilanggar, dan apa yang boleh. Contohnya dari `check:boundaries`:

```
modules/pharmacy/src/x.ts:3 imports ../../healthcare/src/index.ts; modules/pharmacy/ must not import another module.
```

Penjaga yang boleh punya pengecualian menulis pengecualiannya di kode penjaga itu sendiri, beserta alasannya. Pengecualian `src/client.tsx` yang meng-import `.page.tsx` langsung di `check-boundaries.ts` adalah bentuknya. Pengecualian yang hidup di berkas konfigurasi terpisah tidak terlihat di diff pull request berikutnya.

## Penjaga batas membaca berkas, bukan menganalisa tipe

Di CoreERP, aturan batas yang ditulis sebagai analisa tipe dibuang karena berlubang: baris impor yang tidak dipakai tidak pernah sampai ke aturannya. `check-boundaries.ts` karena itu membaca impor dari teks berkas lewat `ts.preProcessFile`. Untuk pertanyaan "apakah berkas ini menyebut nama itu", pembacaan berkas justru yang lengkap. TypeScript dan ESLint tetap dipakai untuk kebenaran tipe.

## Daftar yang boleh kosong tetap harus membuktikan aturannya

Daftar pengecualian yang kosong membuat setiap pemeriksaan yang membacanya hijau tanpa subjek. Penjaga tanpa subjek tidak membuktikan aturannya berlaku. Kalau daftarnya bisa kosong, aturannya diuji dengan subjek buatan di dalam test.

## Aturan yang batasnya belum jelas tidak dipasang sebagai penjaga

Aturan yang batasnya belum jelas lebih berguna sebagai catatan. Dipasang sebagai penjaga, ia merah pada hal yang benar, dan orang belajar melonggarkannya. Kebiasaan melonggarkan itu tidak berhenti di penjaga yang salah. Aturan di `eslint.config.js` tidak dilonggarkan untuk meloloskan perubahan, sesuai `AGENTS.md`.

## Bahan uji tidak boleh bocor ke tempat produksi

Module atau berkas buatan untuk menguji penjaga dibuat di folder sementara, bukan di `modules/` atau `src/`. Satu run yang mati di tengah meninggalkan sisa yang lalu terbaca penjaga lain, `bun test`, dan build. `test/scripts/check-ui.test.ts` dan `test/scripts/new-feature.test.ts` membuat folder buatannya di folder sementara sistem lewat `mkdtempSync`.

Fixture memakai id dan nama sintetis yang tidak akan pernah menjadi folder di `modules/`. Satu id yang menunjuk dua hal adalah dua sumber kebenaran, dan keduanya akan menyimpang. Repo ini publik: tidak ada data pasien atau nama pelanggan sungguhan di fixture.

## Data yang diisi migration jangan dikosongkan test

Test yang mengosongkan tabel untuk mendapat data yang benar-benar ter-commit tidak boleh menyentuh tabel yang diisi migration, misalnya `apps`, metadata keamanan, dan data acuan. Tidak ada yang memulihkan isinya di antara test, jadi kerusakannya muncul di test lain dengan pesan yang terbaca seperti bug berkas itu sendiri.

## Menjalankan suite

`AGENTS.md`, bagian **Sebelum menyatakan hijau**, menetapkan perintahnya. Jebakan lingkungan yang perlu diketahui, antara lain:

- **Test berbasis database dilewati bila `DB_HOST` kosong**, dan test sesi Valkey butuh `VALKEY_HOST`. `bun test` yang hijau tanpa keduanya tidak membuktikan route apa pun. CI selalu mengisi keduanya.
- **Satu database test untuk satu run.** CI membagi berkas test ke beberapa shard, masing-masing dengan PostgreSQL dan Valkey sendiri. Dua run yang memakai database test yang sama di laptop saling merusak, dan kegagalannya terbaca seperti regresi.

## Lihat juga

- [Standar module](02-module-standard.md)
- [Load dan concurrency testing](20-load-and-concurrency-testing.md)
- [Definition of done](../onboarding/definition-of-done.md)
- `parity/README.md`, untuk harness kesetaraan dengan CoreERP
