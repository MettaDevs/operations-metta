# Engine analitik

> **Status di repo ini:** belum dipindah. Tidak ada kode engine, deklarasi dataset, atau layar dasbor. Yang sudah ada adalah tabel `analytics_*` dari skema CoreERP di `database/migrations/0001_coreerp_baseline.sql`, tanpa baris katalog izinnya. Acuan perilaku: [`docs/dev/35-analitik.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/35-analitik.md) dan `apps/core/app/Platform/Analytics/` di [repo CoreERP](https://github.com/MettaDevs/coreERP).

Engine analitik menjawab pertanyaan "berapa" atas data module, misalnya berapa aset per kelompok atau berapa nilai perolehan tahun ini, tanpa menulis laporan baru untuk setiap pertanyaan. Module menyatakan **dataset**: tabel yang boleh dianalisis, kolom yang boleh dikelompokkan, nilai yang sah dijumlah, dan kolom yang menegakkan kebijakan datanya. Core mengubah query JSON menjadi SQL atas tabel itu dan menjalankannya baca-saja. Pengguna menyusun hasilnya menjadi **dasbor** tanpa rilis baru.

Aturan teknis lengkap untuk memindahkan dan mengubah engine ada di skill `operations-metta-analytics`, `.agents/skills/operations-metta-analytics/SKILL.md`: batas yang tidak boleh dilonggarkan, cara menyatakan dataset, aturan pembuatan SQL, dasbor, layar, dan jebakan yang pernah memakan waktu di CoreERP. Halaman ini menjelaskan konsepnya dan alasannya. Bila keduanya berbeda, skill itu yang diperbarui bersama kode.

## Konsep yang mudah tertukar

### Dataset analitik dan dataset laporan

Keduanya disebut dataset dan keduanya milik pemilik data, tetapi menjawab pertanyaan yang berbeda.

| | Dataset laporan | Dataset analitik |
| --- | --- | --- |
| Pertanyaan | Isi dokumen ini apa? | Berapa, dikelompokkan menurut apa? |
| Bentuk hasil | Baris dan kolom tetap, dibaca layout Word atau Excel | Kelompok dan nilai agregat, bentuknya ditentukan query |
| Siapa yang menjalankan query | Pemilik data: Core meminta, pemilik menyaring dan menyerahkan baris | Core: engine menyusun SQL dari definisi yang dinyatakan module |
| Mesin pemakainya | [Mesin cetak dan ekspor](23-document-rendering.md) | Engine analitik dan dasbor |

Laporan baru tidak otomatis menjadi dataset, dan dataset tidak menggantikan laporan. Karena keduanya membaca tabel yang sama dengan aturan yang sama dengan layar daftarnya, keduanya wajib memberi himpunan baris yang sama bagi pengguna yang sama. Business Central memisahkan hal yang sama: [report object](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-report-object) untuk dokumen dan [query object](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-query-totals-grouping) untuk agregat.

### Dataset bukan tabel, kolom angka bukan measure

Satu dataset dapat memakai satu tabel, tabel dengan join, atau query sumber. Yang dijanjikan kepada dasbor tenant adalah kode dataset dan kunci field serta measure-nya, bukan nama tabel.

Hanya measure yang dinyatakan dataset yang sah dihitung. Nilai perolehan sah dijumlah, tetapi tahun perolehan atau nomor urut tidak, walau tipenya angka. Business Central membolehkan agregat pada kolom angka mana pun. Engine ini sengaja lebih sempit, karena hanya pemilik tabel yang tahu bedanya. `count` menghitung baris, dan `count_distinct` menghitung benda.

### Membagikan dasbor tidak membagikan hak

Dasbor pribadi hanya terlihat pemiliknya. Dasbor bersama terlihat setiap pemegang izin melihat dasbor di tenant itu. Angka di dasbor mana pun dihitung dengan hak orang yang membukanya, bukan hak penyusunnya. Kepala unit A yang membuka dasbor buatan direktur hanya melihat angka unit A. Tanpa aturan ini, menyusun dasbor bersama menjadi jalan pintas untuk meminjamkan hak.

### Izin fitur dan izin data

Izin fitur dan izin data adalah pemeriksaan yang berbeda, dan keduanya harus lulus:

- **Izin fitur analitik** menjawab "boleh memakai dasbor dan analisis?". Kodenya milik Core, dari katalog yang disetujui pemilik produk pada 3 Oktober 2026.
- **Izin data** menjawab "boleh membaca angka resource ini?". Kodenya izin baca resource module yang sama dengan layar daftarnya. Module tidak menambah kode izin untuk analitik.

Hak dataset tidak disalin ke kode izin analitik, karena dua daftar yang menjawab pertanyaan yang sama pasti menyimpang. Angka di dasbor tidak boleh lebih luas daripada daftar yang dapat dibuka orang yang sama. Data pribadi punya izin tersendiri di luar keduanya.

## Batas dengan module

Core boleh membaca tabel module, dengan syarat di `AGENTS.md`, bagian *Aturan module*. Engine analitik adalah pemakai utama izin itu, dan ia memenuhinya dengan cara ini:

- Nama tabel dan kolom hanya datang dari dataset yang didaftarkan module. Engine tidak pernah menulis nama tabel module. `bun run check:boundaries` sudah menolak nama tabel module di `src/`.
- Tenant disaring dari konteks tepercaya, lalu kebijakan data yang dinyatakan dataset diterapkan, lalu saringan pengguna. Saringan pengguna hanya mempersempit.
- Module yang tidak terpasang untuk tenant itu tidak menawarkan datasetnya.
- Setiap query berjalan baca-saja, dibatasi waktu dan jumlah baris, lalu di-rollback.

Dataset sebuah module hanya memakai tabel module itu dan pintu publik Core, karena module tidak pernah membaca tabel module lain. Analisis lintas module, yang masih rencana di CoreERP, memakai dimensi bersama: setiap dataset diagregasi menurut dimensi yang sama, lalu hasilnya digabung pada nilai dimensi itu, bukan join baris.

## Tempatnya kelak

- Engine tidak membawa kosakata bisnis, jadi ia kemampuan Core di `src/platform/<kemampuan>/` dengan satu `index.ts`, sesuai tabel *Susunan repo* di `AGENTS.md`.
- Dataset setiap module tinggal di module itu, di samping area dan fitur yang dijelaskannya.
- Cara module mendaftarkan datasetnya ke Core belum diputuskan. CoreERP memakai registry yang diisi service provider setiap module, dan repo ini tidak punya mekanisme provider.
- Query yang menghitung uang atau nomor ikut aturan kesetaraan di `AGENTS.md`, bagian *Kapan sebuah alur dianggap pindah*.

## Yang sudah dikirim di CoreERP dan yang masih rencana

Di CoreERP fase 1 sudah dikirim, antara lain kontrak dataset dan registry, compiler dan eksekusi baca-saja, keamanan baca, dasbor beserta layarnya, cache, batas beban, log query, dan dataset module aset. Fase berikutnya, misalnya slicer, drill, rumus, perbandingan periode, publikasi, feed OData, dan embed, baru rencana di [folder rencana analitik CoreERP](https://github.com/MettaDevs/coreERP/tree/main/docs/todo/analitik). Kalimat rencana tidak pernah menjadi bukti bahwa kodenya ada.

## Lihat juga

- [Dokumen cetak, layout, dan ekspor](23-document-rendering.md)
- [Standar module](02-module-standard.md)
