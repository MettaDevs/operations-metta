# Peta verifikasi operations-metta

Folder ini sumber yang dirawat untuk memverifikasi perilaku operations-metta yang dilihat pengguna klinik. Baca indeks ini sebelum menggerakkan aplikasi, lalu pakai berkas fitur yang cocok sebagai resepnya.

## Keadaan awal

- Run dinyalakan dengan `bun scripts/verify.ts up` dari worktree yang diuji, dan `bun scripts/verify.ts doctor` lulus semua.
- Database run baru lahir dari `scripts/dev-setup.ts`: tenant pertama di `dev/tenants.json`, lingkungan produksinya di `http://klinik-contoh.localhost:<port>`, module `healthcare` dan `pharmacy` terpasang, dan data contoh terisi.
- Data contoh sudah membuat tiga kunjungan yang berstatus Diperiksa dengan resep menunggu di farmasi. Antrean poli dan antrean resep tidak pernah kosong; selalu tuju baris dengan nomor antrean, NoReg, atau nomor resep milik langkah Anda sendiri.
- Masuk sebagai admin tenant contoh (`bun scripts/verify.ts login`). Akun petugas di data contoh hanya punya duty pendaftaran dan tidak bisa membuka pemeriksaan, farmasi, atau kasir.
- Sesudah login, pindah tempat kerja ke legal entity dan unit di `sample.workspace` (`PT Klinik Contoh Sehat · Klinik Sehat Pusat`). Caranya ada di [pendaftaran kunjungan](./pendaftaran-kunjungan.md).
- Jangan menggerakkan instance yang tidak dinyalakan run ini, termasuk `bun run dev` pemilik.

## Cara menggerakkan

- Mulai setiap resep dari keadaan awal kecuali prasyaratnya menyebut lain.
- Cari elemen dengan role dan nama aksesnya. Bila nama belum diketahui, `bun scripts/verify.ts snapshot <nama>` lalu baca berkasnya.
- Perintah ditulis apa adanya. Nama dalam tanda kutip dan flag tidak diubah.
- Satu perubahan data, satu bukti: `shot` dan `snapshot` sesudah aksi, `sql --save` untuk efeknya.
- Bukti tidak dihapus saat cleanup.

## Bukti dan laporan yang dilewati

- Rekam aksi pengguna dan keadaan sesudahnya, bukan hanya layar terakhir.
- Bukti layar terdiri dari snapshot aksesibilitas dan screenshot.
- Bukti perubahan data terdiri dari bacaan database sesudah aksi, lewat `sql`.
- Catat nomor dokumen (NoReg, nomor resep, nomor bill farmasi, no bukti kasir) bersama setiap bukti.
- Jalur yang tidak terjangkau dilaporkan bersama perintah yang dicoba dan prasyarat yang tidak terpenuhi.
- Jalur yang dilewati tidak dilaporkan terverifikasi lewat jalur lain.

## Kontrak berkas fitur

Setiap berkas fitur dibuka dengan judul H1 dan satu paragraf perilaku yang dilihat pengguna, lalu tepat empat H2 berurutan:

1. `Sub-features`: ID pendek, satu baris per perilaku.
2. `How to get to it (user POV)`: setiap pintu masuk pengguna.
3. `Driving it with verify.ts`: dibuka dengan `Prasyarat:`, lalu butir berlabel yang memasangkan aksi pengguna dengan perintah persis dan hasil yang teramati.
4. `Gotchas`: jebakan yang dapat membuang waktu atau membatalkan sebuah verifikasi.

Rincian implementasi tidak ditulis di sini. Yang ditulis hanya jalur pengguna, nama elemen, keadaan yang dibutuhkan, perintah, dan bukti yang teramati.

## Fitur

Urutan di bawah ini urutan satu pasien rawat jalan. `bun scripts/verify.ts journey outpatient` menjalankan empat fitur pertama berurutan.

- [Pendaftaran kunjungan](./pendaftaran-kunjungan.md): memilih tempat kerja, mendaftarkan pasien lama ke poli, nomor antrean.
- [Antrean dan pemeriksaan di poli](./pemeriksaan-poli.md): Mulai periksa, periksa fisik wajib, tindakan, Selesai periksa, dan rujuk internal.
- [Resep ke farmasi](./resep-farmasi.md): e-resep, Kirim ke farmasi, Siapkan dan Serahkan di antrean resep, retur sesudah dibayar ditolak, dan jalan keluarnya: buka pembayaran dari kotak error, Batal Pembayaran, lalu Simpan retur lagi.
- [Kasir bayar dan batal pembayaran](./kasir-bayar.md): jenis bayar, Clerk Start, Bayar, dan Batal Pembayaran.
- [Penjualan obat bebas](./penjualan-obat-bebas.md): lokasi penjualan, Simpan dan bayar di loket farmasi.

Belum dipetakan: pasien baru dari layar registrasi, batal registrasi, rujuk eksternal dan meninggal, retur yang berhasil (sebelum bayar) dan batal retur, nota kredit sesudah Clerk End, pembayaran hutang, Clerk End, serta semua layar setup dan Sys Admin.
