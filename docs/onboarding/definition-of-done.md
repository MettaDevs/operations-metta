# Definition of done

Standar "selesai" di tim ini lebih keras dari kebanyakan tempat. Baca sebelum kamu mengirim PR pertama, bukan sesudah PR-mu ditolak.

## Aturan dasarnya

> Sebuah pekerjaan dianggap selesai hanya ketika mempunyai **penulis**, **pembaca**, **keadaan gagal**, dan **test yang membuktikan keadaan sebelumnya tidak dapat menyamar sebagai keadaan berikutnya.**

Kalimat terakhir itu inti seluruh aturan. Kalau kode "sudah terpasang" tidak bisa dibedakan dari "berhak memasang", kamu belum selesai, sekalipun semua test hijau.

## Empat tingkat

### 1. Setiap perubahan

- [ ] Pemeriksaan di [`AGENTS.md`, Sebelum menyatakan hijau](../../AGENTS.md#sebelum-menyatakan-hijau) lulus dari akar repo: `check:generated`, `typecheck`, `lint`, `bun test`, `format:check`, `check:boundaries`
- [ ] `bun test` dijalankan dengan `DB_HOST` terisi, sehingga test berbasis database benar-benar berjalan, bukan dilewati. Perubahan pada sesi juga butuh `VALKEY_HOST`
- [ ] Temuan lint diperbaiki di kodenya; aturan di `eslint.config.js` tidak dilonggarkan
- [ ] Perubahan lain yang tidak terkait tidak ikut terbawa
- [ ] Docs yang terdampak ikut diperbarui di PR yang sama (README module, halaman `docs/dev/`, kontrak)

### 2. Perubahan layar

Semua di atas, plus:

- [ ] `bun run check:ui` lulus
- [ ] `bun run build` lulus bila perubahan menyentuh hasil build. Daftar berkasnya ada di `AGENTS.md`
- [ ] Layar dicoba di peramban pada lingkungan contoh, termasuk keadaan kosong, error, dan sesi habis
- [ ] Teks layar memakai bahasa sehari-hari, tanpa istilah internal (lihat [Glosarium](glosarium.md))

### 3. Perubahan skema, kontrak, atau menu module

Semua di atas, plus:

- [ ] Perubahan skema lewat migration baru milik pemiliknya, dengan alasan di PR; migration yang sudah terbit tidak disunting
- [ ] Harness kesetaraan dan pemetaan nama lama ke baru diperbarui bila skema yang dipindah dari CoreERP berubah
- [ ] Kontrak di `contracts/` diperbarui di repo penerbit dan repo pemanggil dalam pekerjaan yang sama; event yang sudah terbit tidak diubah di tempat (`vN+1`)
- [ ] Menu module berubah lewat migration yang menulis `apps.navigation`

### 4. Alur yang dipindah atau module baru

Semua di atas, plus bukti yang diminta [`AGENTS.md`, Kapan sebuah alur dianggap pindah](../../AGENTS.md#kapan-sebuah-alur-dianggap-pindah) untuk jenis alurnya: harness kesetaraan di `parity/`, test berbasis database, atau syarat beban dan kebenaran. Bagian itu yang menentukan alur mana memakai bukti yang mana, dan daftarnya bisa bertambah.

Sebuah module boleh disebut sudah pindah setelah [pemeriksaan kesetiaan](../design-system/04-pemeriksaan-kesetiaan.md) terpenuhi seluruhnya.

**Gate kebenaran di bawah beban wajib nol**, apa pun perangkat kerasnya:

- error 5xx yang berasal dari aplikasi;
- kode bisnis atau nomor ganda dalam satu tenant;
- baris anak yang induknya milik tenant lain atau tidak ada;
- baca, daftar, atau tulis yang menembus batas tenant;
- permission satu resource yang membuka resource sebelahnya.

Diverifikasi lewat **SQL langsung ke database** sesudah run, bukan lewat API yang sedang diuji. Rinciannya, termasuk gate latensi dan dimensi minimum beban, di [Load dan concurrency testing](../dev/20-load-and-concurrency-testing.md).

## Kalau gate tidak bisa dijalankan

Nyatakan terus terang bahwa pekerjaannya belum terverifikasi, dan **jangan** melaporkannya selesai. Lingkungan yang tidak lengkap adalah gap yang dilaporkan, bukan gate yang dilewati.

Prinsip yang sama berlaku umum: kalau sesuatu belum ada, katakan belum ada. Jangan membuat compatibility layer, tabel placeholder, atau status layar palsu untuk menutupinya.

## Lihat juga

- [Load dan concurrency testing](../dev/20-load-and-concurrency-testing.md)
- [Standar penjaga dan pengujian](../dev/25-standar-penjaga-dan-pengujian.md)
- [Cara berkontribusi](kontribusi.md)
