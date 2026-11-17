# Ubah harga obat per baris

Apoteker yang diberi izin ubah harga mengetik harga satuan, diskon, dan biaya racik atau resep per baris: sesudah resep disiapkan lewat tombol Ubah harga di kartu penyerahan, dan di loket penjualan obat bebas sebelum Simpan dan bayar. Hitungan sistem tetap tampil di sampingnya, alasan wajib bila berbeda, dan kasir menagih harga yang dipakai. Izin ini tidak dipegang role mana pun secara bawaan, termasuk role Pemilik, jadi admin data contoh tidak melihat isian harga sampai diberi role yang memegangnya. Sesudah kunjungan dibayar, Ubah harga ditolak dengan tombol Buka pembayaran.

## Sub-features

- `harga-tanpa-izin` menampilkan harga sebagai angka biasa, tanpa tombol Ubah harga dan tanpa isian harga di loket.
- `harga-role` membuat role dengan duty ubah harga dan memberikannya ke admin.
- `harga-resep` mengubah harga dan diskon satu obat sesudah Siapkan, dengan alasan wajib.
- `harga-kasir` membayar kunjungan itu dan menagih harga yang dipakai.
- `harga-terkunci` menolak Ubah harga sesudah dibayar, dengan tombol `Buka pembayaran <no bukti>`.
- `harga-loket` mengetik harga satuan di loket obat bebas dan membayarnya.

## How to get to it (user POV)

- Kartu penyerahan (Farmasi › Pelayanan resep › Antrean resep, saringan `Disiapkan`, menu `Buka`): tombol `Ubah harga` di toolbar, hanya untuk pemegang izin dan hanya sesudah Siapkan.
- Loket (Farmasi › Pelayanan resep › Penjualan obat bebas): kolom `Harga satuan` dan `Diskon %` menjadi isian, dan isian `Alasan ubah harga` muncul di bawah baris obat.
- Sys Admin › Akses › Role (`/sysadmin/access/roles`) untuk role, dan Sys Admin › Akses › Staf (`/sysadmin/access/staff`) untuk memberikannya.

## Driving it with verify.ts

Prasyarat:

- Keadaan awal dan tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`, mengikuti [pendaftaran kunjungan](./pendaftaran-kunjungan.md).
- Resep contoh `KCS-01-RSP-00000001` (Budi Contoh, NoReg `KCS-01-REG-00000001`, Parasetamol 10 TAB dan Amoksisilin 15 KAP) masih Menunggu.

- **Siapkan tanpa izin.** Jalankan `bun scripts/verify.ts go pharmacy/dispensing/prescriptions`, `click button "Tindakan untuk KCS-01-RSP-00000001 " --prefix`, `click menuitem Siapkan --exact`, `click button Disiapkan`, `click button "Tindakan untuk KCS-01-RSP-00000001 " --prefix`, dan `click menuitem Buka --exact`. `find button "Ubah harga"` mencetak `tidak ada`.
- **Role ubah harga.** Jalankan `go sysadmin/access/roles`, `click button Baru --exact`, `fill textbox "Nama role" "Apoteker penanggung jawab harga" --exact`, `click button "Ubah harga obat, diskon, dan biaya racik" --prefix`, `click button "Pindahkan yang dipilih ke sisi kanan"`, dan `click button Simpan --exact`.
- **Berikan ke admin.** Jalankan `go sysadmin/access/staff`, `click button "Tindakan untuk Admin Klinik Contoh"`, `click menuitem Buka --exact`, `click button Tambah --exact --within "Akses staf"`, `click button "Tampilkan pilihan role"`, `click option "Apoteker penanggung jawab harga"`, `click button Tambah --exact --within "Tambah role"`, dan `click button Simpan --exact --within "Akses staf"`. Teks `Akses staf disimpan.` muncul.
- **Ubah harga.** Buka lagi kartu penyerahan resep itu, lalu `click button "Ubah harga" --exact`. Jendela `Ubah harga KCS-01-FAR-…` berisi `Harga sistem`, `Harga satuan, baris N`, `Diskon sistem %`, dan `Diskon %, baris N`. Jalankan `fill textbox "Harga satuan, baris 1" 120 --within "Ubah harga"`, `fill textbox "Diskon %, baris 1" 10 --within "Ubah harga"`, dan `click button Simpan --exact --within "Ubah harga"`. Ringkasan error menulis `Isi alasan harga atau biaya diubah dari hitungan sistem.` Lalu `fill textbox "Alasan ubah harga" "Harga langganan pasien lama" --within "Ubah harga"` dan Simpan lagi. Toast `Harga KCS-01-FAR-… disimpan. Tagihan kasir ikut berubah.` muncul, dan sel harga baris itu berbunyi `120 Sistem 156`.
- **Bukti ubah harga.** Jalankan `sql "select b.nama, d.harga_satuan, d.persen_diskon, d.harga_satuan_hitung, d.persen_diskon_hitung, d.alasan_ubah_harga, d.harga_diubah_oleh_user_id from bill_farmasi_detail d join gd_m_barang b on b.id = d.barang_id join bill_farmasi h on h.id = d.bill_farmasi_id where h.nomor = '<nomor penyerahan>'" --save harga` dan `sql "select d.jenis_biaya_nama, d.qty, d.nilai, d.disc, d.status from tagihan_kasir_detail d join far_tr_resep r on r.kunjungan_id = d.tagihan_sumber_dokumen_id where r.nomor_resep = 'KCS-01-RSP-00000001' and d.deleted_at is null" --save tagihan`. Baris yang diubah membawa hitungan, alasan, dan pengguna; baris lain hitungan = dipakai tanpa catatan. Tagihan kasir `terbuka` dengan Nilai 120 dan Disc 10.
- **Bayar.** Jalankan `go healthcare/examination/queue/KCS-01-REG-00000001/UMUM` dan `click button "Selesai periksa" --exact`. Buat jenis bayar tunai dan Clerk Start mengikuti [kasir](./kasir-bayar.md), lalu bayar `KCS-01-REG-00000001` dengan Tunai 10000. `Grand Total` sebelum bayar `9.855` (10 x 120 diskon 10 % + 15 x 585), dan `kasir.nilai` 9855.
- **Terkunci sesudah bayar.** Buka lagi kartu penyerahan, `click button "Ubah harga" --exact`, ubah satu harga, isi alasan, dan Simpan. Ringkasan error menulis `Harga belum disimpan` dan `Data ini sudah melakukan Pembayaran diKasir!` dengan tombol `Buka pembayaran KSR-…`. `click button "Buka pembayaran KSR-…"` membuka pembayaran kasir di atas jendela itu. Harga di `bill_farmasi_detail` tidak berubah.
- **Loket.** Atur lokasi penjualan mengikuti [penjualan obat bebas](./penjualan-obat-bebas.md), lalu di loket isi obat Oralit 2 SAC. Pemegang izin melihat `textbox "Harga satuan, baris 1"` kosong dengan hitungan sebagai placeholder dan `textbox "Alasan ubah harga"`. Jalankan `fill textbox "Harga satuan, baris 1" 500`, `fill textbox "Alasan ubah harga" "Promo pembeli langganan"`, `fill textbox "Tunai diterima" 1000`, dan `click button "Simpan dan bayar"`. `Harus dibayar` menjadi `1.000`, dan `bill_farmasi_detail` penjualan itu menyimpan harga 500, hitungan 600, dan alasannya, dengan `kasir.nilai` 1000.
- **Tanpa izin di loket.** Cabut role itu dari admin (`Tindakan untuk Apoteker penanggung jawab harga`, menu `Cabut`, Simpan). `find textbox "Harga satuan, baris 1"` dan `find textbox "Alasan ubah harga"` mencetak `tidak ada`; harga tampil sebagai angka.

## Gotchas

- Role Pemilik tidak memegang izin ini, jadi admin data contoh tidak pernah melihat isian harga sebelum diberi role tambahan. Itu perilaku yang diminta, bukan prasyarat yang hilang.
- Tombol `Ubah harga` hanya ada sesudah Siapkan. Pada draf, harga belum dihitung.
- Data contoh tidak punya setelan Biaya racik dan resep, jadi jendela Ubah harga resep contoh tidak punya baris biaya. Buat setelannya di Setup › Pelayanan resep › Biaya racik dan resep sebelum Siapkan bila biaya ikut diuji.
- Tagihan kunjungan baru tampil di daftar pembayaran sesudah Selesai periksa, walau baris obatnya sudah ada sejak Siapkan. Kunjungan contoh sudah berstatus Diperiksa, jadi cukup `Selesai periksa`.
- Batal siapkan lalu Siapkan lagi menghitung ulang harga; harga yang diubah ikut hilang.
- Data contoh tidak mengatur lokasi penjualan obat bebas, jadi loket kosong sampai lokasinya dibuat.
