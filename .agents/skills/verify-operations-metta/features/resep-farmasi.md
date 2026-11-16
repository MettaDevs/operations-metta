# Resep ke farmasi

Dokter menulis e-resep di halaman pemeriksaan dan mengirimnya ke farmasi. Resep muncul di antrean resep farmasi dengan status Menunggu. Petugas farmasi memilih Siapkan, lalu obatnya masuk tagihan kunjungan di kasir. Sesudah diserahkan, obat yang dikembalikan pasien dicatat sebagai retur, kecuali tagihannya sudah dibayar di kasir.

## Sub-features

- `resep-tulis` menambah baris obat bukan racikan ke e-resep.
- `resep-kirim` mengirim e-resep dan memberi nomor resep.
- `resep-siapkan` menyiapkan resep di farmasi dan menerbitkan bill farmasi.
- `resep-serahkan` menyerahkan obat yang sudah disiapkan ke pasien.
- `resep-retur-sesudah-bayar` (retur sesudah dibayar ditolak) menolak retur obat dari kunjungan yang sudah dibayar di kasir.
- `resep-retur-buka-pembayaran` (jalan keluar dari penolakan) membuka pembayaran kasir dari tombol di kotak error retur, membatalkannya di jendela itu, lalu Simpan retur yang sama berhasil tanpa mengetik ulang.

## How to get to it (user POV)

- Halaman pemeriksaan, region `E-Resep`: tombol `Tambah`, `Tambah banyak`, `Tambah racikan`, dan `Kirim ke farmasi`.
- Menu aplikasi Farmasi › Pelayanan resep › Antrean resep (`/pharmacy/dispensing/prescriptions`), tombol `Tindakan untuk <nomor resep> <nama>`, menu `Siapkan`, `Panggil`, `Serahkan ke pasien`, atau `Buka`.
- Halaman `Penyerahan obat` (menu `Buka`): tombol `Serahkan`, lalu `Retur` sesudah obat diserahkan.

## Driving it with verify.ts

Prasyarat:

- Pemeriksaan sudah dimulai dan periksa fisik wajibnya terisi, mengikuti [pemeriksaan di poli](./pemeriksaan-poli.md).
- Obat dan aturan pakai diambil dari `sample.clinic.visits[0].prescription[0]` di `dev/tenants.json`; nama obat dari `sample.inventory.drugs`.

- **Tambah obat.** Jalankan `bun scripts/verify.ts click button Tambah --within E-Resep --exact`, `fill combobox "Nama Obat, baris 1" "Parasetamol 500 mg" --within E-Resep`, dan `click option "Parasetamol 500 mg"`. Satuan baris terisi otomatis.
- **Isi aturan.** Jalankan `fill textbox "Signa, baris 1" 3x1 --within E-Resep`, `fill combobox "Aturan Pakai, baris 1" "Setelah Makan" --within E-Resep`, `click option "Setelah Makan"`, `fill textbox "Kali sehari, baris 1" 3 --within E-Resep`, `fill textbox "Dosis, baris 1" 1 --within E-Resep`, `fill combobox "Rute, baris 1" O --within E-Resep`, `click option "O " --prefix`, `fill textbox "Lama (hari), baris 1" 3 --within E-Resep`, dan `fill textbox "Qty, baris 1" 10 --within E-Resep`.
- **Simpan pemeriksaan.** Jalankan `bun scripts/verify.ts click button Simpan --exact`. Status e-resep tetap `Draf` dan `No Resep` masih `Diberi saat dikirim ke farmasi`.
- **Kirim.** Jalankan `bun scripts/verify.ts click button "Kirim ke farmasi" --within E-Resep`. Teks `<nomor resep> · Dikirim ke farmasi` muncul, mis. `KCS-01-RSP-00000004`.
- **Bukti kirim.** Jalankan `bun scripts/verify.ts sql "select r.nomor, r.status, f.no_reg, f.nama_section from sim_tr_resep r join far_tr_resep f on f.nomor_resep = r.nomor where r.nomor = '<nomor resep>'" --save resep`. Resep `dikirim`, dan farmasi punya salinannya dengan NoReg kunjungan.
- **Buka antrean resep.** Jalankan `bun scripts/verify.ts go pharmacy/dispensing/prescriptions`. Baris `<nomor resep>` berstatus `Menunggu` di saringan `Menunggu`.
- **Siapkan.** Jalankan `bun scripts/verify.ts click button "Tindakan untuk <nomor resep> " --prefix` lalu `click menuitem Siapkan --exact`. Toast `Resep <nomor resep> disiapkan.` muncul, barisnya hilang dari saringan Menunggu, dan hitungan `Disiapkan` bertambah satu.
- **Bukti siapkan.** Jalankan `bun scripts/verify.ts sql "select b.nomor, b.status, f.nomor_resep from bill_farmasi b join far_tr_resep f on f.id = b.resep_id where f.nomor_resep = '<nomor resep>'" --save farmasi` dan `sql "select d.sumber_module, d.jenis_biaya_nama, d.qty, d.nilai, d.status from tagihan_kasir_detail d join tagihan_kasir t on t.sumber_dokumen_id = d.tagihan_sumber_dokumen_id where t.sumber_nomor = '<NoReg>'" --save tagihan-obat`. `bill_farmasi` berstatus `disiapkan`, dan tagihan kunjungan punya rincian `pharmacy` berstatus `terbuka`.

- **Retur sesudah dibayar ditolak.** Prasyaratnya kunjungan ini sudah dibayar di kasir ([kasir](./kasir-bayar.md), atau `journey outpatient --prepare-cashier`). Jalankan `bun scripts/verify.ts go pharmacy/dispensing/prescriptions`, `click button Disiapkan`, `click button "Tindakan untuk <nomor resep> " --prefix`, `click menuitem Buka --exact`, dan `click button Serahkan --exact --within "Penyerahan obat"`. Judul kartu berakhir `Diserahkan`. Lalu `click button Retur --exact --within "Penyerahan obat"`, `fill textbox "Alasan retur" "Pasien mengembalikan obat" --within "Retur obat"`, `fill textbox "Diretur sekarang, baris 1" 2 --within "Retur obat"`, dan `click button Simpan --exact --within "Retur obat"`. Ringkasan error di bawah toolbar menulis `Retur belum disimpan` dan `Data ini sudah melakukan Pembayaran diKasir!`, dan dialog tetap terbuka dengan isiannya.
- **Bukti retur ditolak.** Jalankan `bun scripts/verify.ts shot retur-sesudah-bayar-ditolak`, `shot retur-sesudah-bayar-ditolak-ringkasan --alert` (close-up kotak `role=alert`), dan `sql "select count(*) from retur_farmasi" --save retur-sesudah-bayar-ditolak`. Tidak ada baris `retur_farmasi` baru. Server menjawab POST `.../prescriptions/<id>/returns` dengan 422 dan `errors._form` berisi pesan yang sama; ini terlihat di tab Network atau dengan membungkus `window.fetch` di halaman, karena `verify.ts` tidak merekam respons.

- **Buka pembayaran dari kotak error (`resep-retur-buka-pembayaran`).** Lanjutkan dari retur yang ditolak di atas. Pengguna yang memegang izin baca pembayaran kasir (admin data contoh) melihat tombol `Buka pembayaran <no bukti>` di kotak error. Jalankan `bun scripts/verify.ts click button "Buka pembayaran <no bukti>"`. Form pembayaran kasir terbuka sebagai jendela di atas form retur, dan hitungan tumpukan di kanan atas naik satu. Lalu jalankan `click button "Batal Pembayaran"`, `fill textbox "Alasan Batal" "Pasien meretur obat"`, dan `click button Proses --within "Batal Pembayaran"`. Toast batal muncul dan form pembayaran kembali ke `Detail Pembayaran`. Jalankan `click button "Tutup halaman"`. Form retur tampil lagi dengan alasan dan Qty yang sama, dan tidak ada Simpan otomatis. Terakhir jalankan `click button Simpan --exact --within "Retur obat"`. Toast `Retur <nomor> tersimpan` muncul.
- **Bukti buka pembayaran.** Ambil `shot` sesudah setiap langkah di atas. Lalu jalankan `sql "select no_bukti, status, alasan_batal from kasir where no_bukti = '<no bukti>'" --save kasir-batal` dan `sql "select nomor, status, alasan from retur_farmasi order by created_at desc limit 1" --save retur-tersimpan`. Kasir harus berstatus `batal` dengan alasannya, dan retur berstatus `diposting` dengan alasan yang diketik sebelum penolakan.

## Gotchas

- `Qty, baris 1` ada di region Biaya Tindakan dan E-Resep. Selalu tambah `--within E-Resep`.
- Pilihan rute bernama kode lalu nama, mis. `O Oral`. Pencocokan potongan `O` juga kena rute lain; pakai `--prefix` dengan kode diikuti spasi.
- Tombol `Kirim ke farmasi` baru muncul sesudah e-resep punya satu baris.
- Data contoh sudah mengirim tiga resep (`KCS-01-RSP-00000001` sampai `...03`) yang Menunggu di farmasi. Tuju resep dengan nomornya sendiri.
- Siapkan tidak sama dengan diserahkan. Status `sim_tr_resep` tetap `dikirim` sesudah Siapkan; obatnya sudah masuk tagihan.
- Tagihan obat lahir saat Siapkan, bukan saat resep dikirim. Kasir yang dibuka sebelum Siapkan hanya menampilkan tindakan.
- Tombol `Retur` hanya muncul saat status penyerahan `Diserahkan`. Resep yang baru Disiapkan harus Serahkan dulu.
- Antrean resep bawaannya saringan `Menunggu`. Resep yang sudah disiapkan ada di saringan `Disiapkan`.
- Tombol `Buka pembayaran …` hanya tampil bagi pengguna yang memegang izin baca pembayaran kasir. Pengguna tanpa izin itu mendapat nomor pembayaran di pesannya ("Minta kasir membatalkan pembayaran …") tanpa tombol. Ada dua tombol `Tutup halaman`; yang diklik pertama menutup jendela teratas.
