# Pendaftaran kunjungan

Petugas pendaftaran memilih pasien lama, memilih poli rawat jalan, dan menyimpan registrasi. Layar menampilkan NoReg, NoBukti, dan nomor antrean, dan pasien masuk antrean poli itu dengan status Menunggu.

## Sub-features

- `daftar-tempat-kerja` memindahkan tempat kerja ke unit tempat data contoh berada.
- `daftar-cari-pasien` mencari pasien lama dari isian Pasien.
- `daftar-simpan` menyimpan registrasi rawat jalan ke satu poli dan memberi nomor antrean.

## How to get to it (user POV)

- Menu aplikasi Layanan kesehatan › Pendaftaran › Registrasi baru (`/healthcare/registration/visits/new`).
- Tombol `Registrasi baru` di halaman sesudah registrasi tersimpan.
- Pemilih tempat kerja di bilah atas (`Pilih tempat kerja: ...`).

## Driving it with verify.ts

Prasyarat:

- Run sehat menurut `bun scripts/verify.ts doctor`, dan sudah `login` sebagai admin.
- Pasien kunjungan contoh pertama ada di `dev/tenants.json` (`sample.clinic.visits[0].patient` adalah NIK-nya).

- **Pindah tempat kerja.** Buka pemilih, pilih legal entity dan unit, lalu Terapkan. Jalankan `bun scripts/verify.ts click button "Pilih tempat kerja"`, `click combobox "Legal entity" --within "Tempat kerja"`, `click option "PT Klinik Contoh Sehat" --exact`, `click combobox "Unit kerja" --within "Tempat kerja"`, `click option "Klinik Sehat Pusat" --exact`, dan `click button Terapkan --within "Tempat kerja"`. `find button "Pilih tempat kerja"` mencetak nama yang berakhir `PT Klinik Contoh Sehat · Klinik Sehat Pusat`.
- **Buka registrasi.** Jalankan `bun scripts/verify.ts go healthcare/registration/visits/new`. Judul `Registrasi kunjungan baru` dan tombol `Simpan registrasi` tampil.
- **Cari pasien.** Ketik nama pasien. Jalankan `bun scripts/verify.ts fill combobox Pasien --exact Budi`. Daftar pilihan berisi baris dengan NRM, nama, dan NIK.
- **Pilih pasien.** Jalankan `bun scripts/verify.ts click option 3171011204800001`. Panel Data pasien terisi NRM dan nama.
- **Pilih poli.** Jalankan `bun scripts/verify.ts click button "Poli Umum" --within "Poli atau ruangan" --exact`. Teks `Dokter hari ini` muncul di bawahnya.
- **Simpan.** Jalankan `bun scripts/verify.ts click button "Simpan registrasi"`. Layar berganti ke `Registrasi <NoReg>` dengan `Registrasi tersimpan`, `NoReg ... · NoBukti ...`, `Nomor antrean` (mis. `A-004`), dan status `Belum periksa`.
- **Bukti.** Jalankan `bun scripts/verify.ts shot daftar`, `snapshot daftar`, dan `bun scripts/verify.ts sql "select r.no_reg, r.status, t.kode_antrean, t.no_bukti, t.status from sim_tr_registrasi r join sim_tr_registrasi_tujuan t on t.registrasi_id = r.id where r.no_reg = '<NoReg>'" --save daftar`. Satu baris berstatus registrasi `terdaftar` dan tujuan `menunggu`, dengan kode antrean yang sama dengan layar. Belum ada baris `tagihan_kasir` untuk NoReg itu.

## Gotchas

- Sesudah login, tempat kerja admin adalah `PT Klinik Contoh Dua · Klinik Dua Selatan`, bukan `sample.workspace`. Di sana pencarian pasien menjawab `Pasien tidak ditemukan` dan poli contoh tidak ada. Pindah tempat kerja lebih dulu.
- Nama pasien contoh dipakai beberapa kali (`Budi Contoh` sudah punya kunjungan contoh). Pilih option dengan NIK, bukan nama.
- Pilih poli dengan `--exact` dan `--within "Poli atau ruangan"`. Tanpa itu `Poli Umum` juga cocok dengan teks lain di layar.
- Data contoh tidak membuat jadwal praktik untuk hari ini. Layar menulis `Tidak ada jadwal dokter di Poli Umum hari ini`, dan registrasi tersimpan tanpa dokter. Dokter dipilih di layar pemeriksaan.
- `Simpan registrasi` di bawah form dan `Simpan` di toolbar adalah dua tombol. Resep ini memakai `Simpan registrasi`.
- Snapshot yang diambil tepat sesudah `fill` di isian pencarian bisa belum memuat pilihannya. `click option` sudah menunggu sendiri.
