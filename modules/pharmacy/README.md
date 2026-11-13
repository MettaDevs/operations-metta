# pharmacy

Module farmasi: antrean resep dari layanan kesehatan, penyerahan obat, dan retur obat pasien. Nama yang tampil di layar datang dari baris `apps` (`Farmasi`), bukan dari kode. Module ini bisa dijual sendiri: ia tidak membaca tabel module lain, stoknya milik persediaan Core, dan resep datang lewat event.

## Satu farmasi, lokasi diatur

Di sistem lama farmasi pusling dan farmasi biasa adalah kode terpisah, dan section yang menentukan resep masuk ke mana ditulis mati. Di sini hanya ada satu farmasi (keputusan pemilik produk, 12-13 November 2026). Pusling dan farmasi biasa hanya beda lokasi stok, dan lokasinya dipilih lewat setelan:

1. Lokasi yang dipilih petugas farmasi pada resep itu.
2. Baris **Lokasi layanan resep** untuk operating unit dan section asal resep.
3. Baris Lokasi layanan resep untuk operating unit itu tanpa section (bawaan unit).

Resep tanpa ketiganya tetap masuk antrean dan tampil sebagai "Belum ada lokasi". Satu pernyataan SQL (`servingLocationSql`) dipakai antrean dan penyerahan, jadi keduanya selalu sepakat. Section untuk layar setelan dikenal dari resep yang sudah diterima, karena module ini tidak membaca master section layanan kesehatan; id section disimpan tanpa foreign key ke tabel module itu.

## Nama tabel

Awalan `far_`, ditambah dua nama legacy yang dipertahankan: `bill_farmasi` (BILLFarmasi) dan `retur_farmasi` (RETURFARMASI). `bun run check:boundaries` menolak ketiganya di kode Core.

| Tabel                    | Isi                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `far_processed_events`   | Event yang sudah diproses, supaya event yang diantar dua kali dicatat sekali                                          |
| `far_m_golongan_obat`    | Golongan obat per legal entity (narkotika, psikotropika, obat keras, bebas terbatas, bebas): data, bukan kode         |
| `far_m_obat`             | Perluasan barang Core berkunci id barang: golongan, kelompok grading, generik, formularium                            |
| `far_m_kelompok_grading` | Kelompok grading obat per legal entity untuk harga obat (SIMmKelompokGrading)                                         |
| `far_m_grading_harga`    | % naik dan % diskon per kelompok harga, kelompok grading, Patient KTP, dan rentang harga dasar (SIMmGradingHargaObat) |
| `far_m_parameter`        | Yatim sejak 0008: desimal harga satuan obat pindah ke setelan keuangan Core                                           |
| `far_m_lokasi_layanan`   | Lokasi stok yang melayani resep dari satu operating unit, dan dari satu section asal                                  |
| `far_tr_resep`           | Antrean resep: potret resep dari event, ditambah lokasi pilihan petugas                                               |
| `far_tr_resep_detail`    | Baris resep apa adanya: obat tunggal, kepala racikan, dan komponen racikan                                            |
| `bill_farmasi`           | Penyerahan obat satu resep: nomor, status, lokasi stok keluar, apoteker, asisten, penerima, dan waktu setiap langkah  |
| `bill_farmasi_detail`    | Satu baris per obat resep: jumlah diserahkan, batch pilihan, alasan bila kurang dari resep, harga saat disiapkan      |
| `retur_farmasi`          | Retur obat dari pasien atas satu penyerahan: nomor, tanggal, lokasi, alasan, status                                   |
| `retur_farmasi_detail`   | Satu baris per obat dan batch yang kembali                                                                            |

## Resep masuk lewat event

`registerPharmacyEventHandlers()` di `src/index.ts` dipanggil `src/main.ts` dan `src/worker.ts`. Ia mendaftarkan penerima `healthcare.prescription.issued.v1` (kontrak `contracts/events/healthcare.prescription.issued.v1.yaml`).

- Penerima berjalan di transaksi Kirim ke farmasi milik dokter, jadi ia kecil: memeriksa isi, mencatat id event, lalu menyalin potret resep. Tidak ada pekerjaan stok.
- Isi diperiksa schema zod milik module ini (`prescription.schema.ts`) yang mengikuti kontrak. Field yang tidak dikenal dilewati, supaya field opsional baru di versi yang sama tidak membuat resep terlewat.
- Isi yang tidak cocok (bentuk salah, teks lebih panjang dari kolom, barang atau satuan dosis yang bukan milik legal entity itu) dicatat ke log `pharmacy-event-skipped` lalu dilewati, tidak dilempar: lemparan membatalkan resep dokter. Event yang dilewati tidak dicatat sebagai sudah diproses.
- Baris obat menyimpan satuan yang ditulis dokter dan isinya dalam satuan dasar (`konversi`, dari `quantity_per_unit`). Pesan yang belum membawa `quantity_per_unit` ditulis dalam satuan dasar, jadi isinya 1.
- Kelompok harga pembeli (`price_group`, kelompok harga tipe pasien kunjungan) disimpan di `far_tr_resep.kelompok_harga_id` untuk harga obat. Pesan tanpa `price_group` disimpan kosong.
- Patient KTP kunjungan (`patient.ktp`) disimpan di `far_tr_resep.pasien_ktp` untuk harga obat. Pesan tanpa `patient.ktp` disimpan `true`, bawaan sistem lama.
- Dosis baris (`0009_prescription_dosage.sql`): kali sehari, dosis dan satuan dosisnya (satuan Core legal entity resep), rute sebagai kode dan nama yang disalin dari event karena daftar rute milik layanan kesehatan, dan lama hari. Layar penyerahan menampilkannya di samping signa, misalnya "3 x sehari 1 Tablet, Oral, 5 hari". Pesan yang belum membawa dosis disimpan tanpa dosis.
- Jenis racikan dan bentuk sediaan hasilnya (`0010_compound_type_form.sql`), pada baris racikan: `dtd` (d.t.d. atau dibagi rata) dan bentuk sediaan sebagai kode dan nama yang disalin dari event, karena daftarnya milik layanan kesehatan. Layar penyerahan menampilkannya pada baris racikan, misalnya "Racikan 1 · 10 Puyer · d.t.d.". Pesan yang belum membawanya disimpan tanpa keduanya.
- Event yang sama diantar dua kali, atau resep yang sama dalam event lain, dicatat sekali (`far_processed_events` dan indeks unik `resep_sumber_id`).
- Handler hanya berjalan untuk tenant yang memasang module ini.

## Penyerahan obat

Satu penyerahan aktif (`bill_farmasi`) per resep, dibuka dari antrean. Polanya pengiriman pesanan penjualan BC: Post Ship mencatat stok keluar, dan Undo Shipment membaliknya sebelum faktur.

| Langkah       | Yang terjadi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simpan (draf) | Jumlah diserahkan dalam satuan resep atau satuan lain barang yang sama, dengan isi satuan disalin ke baris (0 sampai jumlah resep, dibandingkan dalam satuan dasar; kurang dari resep wajib beralasan), batch pilihan, lokasi, apoteker, asisten, catatan. Nomor dari `pharmacy.dispensing-number` per operating unit resep.                                                                                                                                                                                                |
| Siapkan       | Isian disimpan, harga obat dihitung dan disalin ke baris (bagian [Harga obat](#harga-obat)), lalu stok keluar diposting lewat `postItemLines` (jenis `penyerahan`) sebanyak jumlah x isi satuan, dalam satuan dasar, di lokasi yang melayani resep, di transaksi yang sama. Batch kosong diambil menurut cara pengambilan lokasi (FEFO bawaan); lokasi pilih manual mewajibkan batch. Stok kurang ditolak bila lokasi menolak stok minus, dan tidak ada yang tersimpan. Asisten diisi pengguna yang menyiapkan bila kosong. |
| Panggil       | Waktu dan pemanggil dicatat; Panggil ulang memperbarui waktunya.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Serahkan      | Waktu, penyerah, dan penerima obat dicatat; apoteker diisi penyerah bila kosong.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Batal siapkan | Hanya sebelum diserahkan. Stok kembali lewat `reverseItemEntries`, penyerahan ditutup sebagai dibatalkan, dan resep kembali menunggu. Siapkan berikutnya membuat penyerahan baru dengan isian yang sama, karena kunci posting kartu gudang penyerahan lama sudah terpakai (sama dengan batal posting dokumen persediaan Core).                                                                                                                                                                                              |

Setiap perubahan mengunci baris resep (`for update`), jadi Siapkan yang ditekan beberapa orang bersamaan memposting sekali; indeks unik kunci posting kartu gudang menjadi penjaga terakhir. Batch yang diambil dibaca dari kartu gudang lewat `issuedSlices` Core, bukan disalin ke tabel farmasi.

Apoteker dan asisten adalah pengguna tenant (`users`), dipilih dengan namanya. Di Kuta 1 keduanya dipilih di setiap penyerahan (`Pharmacy_id`, `Pharmacy_assistant_id`; 6 apoteker dan 7 asisten dalam 12.177 penyerahan, 425 di antaranya orang yang sama), jadi di sini keduanya boleh dipilih, dan terisi otomatis dari pengguna yang menyiapkan dan menyerahkan bila dibiarkan kosong.

Serahkan juga mencatat siapa yang menerima obat (`0011_dispensing_receiver.sql`): pasien sendiri (`diterima_pasien`), atau orang lain beserta namanya (`nama_penerima`). Pilihan penerima wajib saat Serahkan, dan namanya wajib bila penerimanya orang lain. Aksi Serahkan ke pasien di antrean mencatat pasien sebagai penerima; obat yang diambil orang lain diserahkan dari kartu resepnya. Sistem lama tidak mencatat penerima; kolom ini ditambahkan karena MedicationDispense SATUSEHAT membutuhkannya. Waktu siap, waktu serah, dan apoteker yang juga dibutuhkannya sudah tercatat, dan obat tidak pernah diganti karena penyerahan tidak bisa mengganti obat resep. Pemetaan lengkapnya ada di kepala migration itu.

## Harga obat

Makna fungsi sistem lama `GetHargaObatNew_WithStok` (Seroja dan Penta; Kuta 1 memakai rumus yang sama). Keputusan pemilik produk 13 November 2026 (opsi 8.3 A): grading tinggal di module ini, harga dihitung saat Siapkan dan disalin ke `bill_farmasi_detail`, dan kasir tidak menghitung ulang.

- **Harga dasar** milik barang Core (`gd_m_barang.harga_dasar`, Harga_Jual `mBarang`), per satuan dasar. Posting penerimaan menaikkannya ke harga beli per satuan dasar sebelum diskon bila lebih tinggi; batal posting tidak menurunkannya, dan pengguna boleh mengubahnya di kartu barang (FastTab Harga).
- **Kelompok grading** (Setup → Harga obat → Kelompok grading) dipasang di data obat farmasi. Obat tanpa kelompok sama dengan `'ALL'` sistem lama. Kelompok XX sistem lama adalah kelompok biasa.
- **Grading harga obat** (Setup → Harga obat → Grading harga obat): per kelompok harga (master Core), kelompok grading atau semua barang, Patient KTP (`pasien_ktp`, bawaan nyala), rentang harga dasar (kedua batas termasuk), % naik, % diskon, dan tanggal berlaku mulai. Rentang yang bertumpuk dengan baris lain berkunci sama (kelompok harga, kelompok grading, Patient KTP, tanggal berlaku) ditolak. Kelompok harga yang dipakai baris grading tidak bisa dihapus di Core.
- **Desimal harga satuan obat** adalah **Presisi harga satuan** setelan keuangan Core (Sys Admin → Keuangan → Setelan keuangan, `setelan_keuangan.desimal_harga_satuan`, per legal entity), sejak 0008 yang menyalin nilai `far_m_parameter` ke sana. Ketiga salinan sistem lama berbeda di sini: Kuta 1 dan Penta menyimpan `round(@HargaObat, 0)` (0, rupiah utuh), Seroja menyimpan `@HargaObat` money tanpa round (4). Legal entity tanpa baris memakai 0. Padanannya di BC adalah Unit-Amount Rounding Precision. Pembulatannya memakai `divideRounded` Core.
- **Aturan** (`drug-price.calculation.ts`, fungsi murni): baris kelompok grading obat yang cocok dulu, lalu baris semua barang, lalu 0 %; di antara yang cocok, tanggal berlaku terakhir yang sudah lewat pada tanggal penyerahan. Baris hanya cocok dengan resep yang Patient KTP-nya sama persis (`KTP=@KTP` sistem lama): resep tanpa baris untuk KTP-nya jatuh ke baris semua barang untuk KTP-nya, lalu 0 %, tidak pernah ke baris KTP lain. Resep tanpa kelompok harga dihargai harga dasar. Harga satuan baris = harga dasar x (1 + % naik / 100) x isi satuan baris, dibulatkan ke presisi harga satuan setelan keuangan, setengah menjauhi nol, sesudah dikali isi satuan (urutan `ConvertAmountByUnitOfMeasure` BC; sistem lama tidak pernah menjual dalam satuan lain). % diskon disimpan terpisah, dan nilai baris = jumlah x harga satuan x (100 - % diskon) / 100, dibulatkan ke sen.
- **Disalin saat Siapkan**: harga dasar, baris grading yang dipakai, % naik, harga satuan (`numeric(18,4)`), dan % diskon. Perubahan grading, harga dasar, atau setelan keuangan sesudahnya tidak mengubah baris itu; Batal siapkan lalu Siapkan lagi menghitung ulang. Kartu penyerahan menampilkan harga satuan, diskon, nilai per baris, dan totalnya.
- **Golden test** terhadap fungsi SQL sistem lama: `test/drug/drug-price/legacy-drug-prices.test.ts` memakai keluaran oracle `legacy-drug-prices.sql` (dijalankan read-only di Kuta 1, Seroja, dan Penta dengan KTP 1, dan di Seroja dan Penta sekali lagi dengan KTP 0) yang disimpan di `legacy-drug-prices.json`. Setiap kasus dihitung dengan KTP-nya dan presisi harga satuan sumbernya (`unit_price_decimals`: Kuta 1 dan Penta 0, Seroja 4) dan wajib sama dengan harga sistem lama kecuali yang tercatat di `expected_differences` beserta alasannya: satu barang Seroja berkelas ALKES di kelompok XX, yang salinan Seroja hargai 0 % untuk kedua nilai KTP karena juga mencocokkan kelas barang.
- **Tidak dibawa sebagai kode**: KTP 1 yang dipaksakan untuk BPJS (JenisKerjasamaID 9; kelompok harga yang tidak membedakan KTP cukup diberi baris untuk kedua nilai), TipePelayanan (mati di setiap salinan sistem lama: lookup-nya dikomentari dan yang hidup memakai `'STANDARD'`), kontrak penjamin dan HargaObatDigunakan, BPJS + Fornas tanpa kenaikan (cukup baris grading 0 %), dan diskon karyawan; semuanya bergantung pada id yang ditulis mati di sistem lama.

## Obat diserahkan: event ke layanan kesehatan

Serahkan menerbitkan `pharmacy.prescription.dispensed.v1` (kontrak `contracts/events/pharmacy.prescription.dispensed.v1.yaml`) di transaksi yang sama. Isinya: id dan nomor resep asal, nomor penyerahan, waktu, lokasi, apoteker, asisten, dan satu baris per obat resep dengan satuan dan jumlah resep, satuan dan jumlah yang diserahkan beserta isi satuan itu dan jumlahnya dalam satuan dasar, alasan, dan batch yang diambil (nomor, kedaluwarsa, jumlah dalam satuan dasar). Serahkan yang diulang tidak menerbitkan event kedua, dan penyiapan yang dibatalkan tidak menerbitkan apa pun.

Penerimanya module layanan kesehatan (`registerHealthcareEventHandlers()`, `modules/healthcare/src/examination/medical-record/dispensing.events.ts`): E-Resep menampilkan status "Diserahkan farmasi", waktu dan nomor penyerahan, serta jumlah yang diserahkan per baris. Ia idempoten lewat `sim_processed_events`, dan resep yang tidak dikenal dilewati dengan log.

## Retur obat

Retur langsung diposting saat disimpan (8 retur dari 12.177 penyerahan di Kuta 1 tidak membutuhkan draf). Stok masuk lagi ke lokasi penyerahan lewat `postItemLines` (jenis `penyerahan` dengan jumlah positif, seperti retur penjualan di BC yang tercatat sebagai Sale) dengan batch, kedaluwarsa, harga satuan, dan sumber dana yang sama dengan bagian stok yang keluar (`issuedSlices`; Appl.-from Item Entry di BC). Retur dicatat per obat dan batch dalam satuan yang dipilih, bawaannya satuan saat diserahkan, dengan isi satuan disalin ke baris; stok kembali dalam satuan dasar. Jumlah retur per obat dan batch, dalam satuan dasar, tidak pernah melebihi yang diserahkan dikurangi yang sudah diretur; bagian yang sudah kembali dicocokkan dengan batch, harga, dan sumber dana baris kartu gudang retur sebelumnya, jadi retur berikutnya mengambil bagian yang memang belum kembali. Batal retur membalik posting itu lewat `reverseItemEntries` dan ditolak bila stoknya sudah terpakai.

## Retur: event ke layanan kesehatan

Retur yang diposting menerbitkan `pharmacy.return.posted.v1`, dan Batal retur menerbitkan `pharmacy.return.reversed.v1` (kontrak `contracts/events/pharmacy.return.posted.v1.yaml` dan `pharmacy.return.reversed.v1.yaml`), masing-masing di transaksi yang sama. Isinya: id dan nomor resep asal, penyerahan yang diretur, nomor, tanggal, dan alasan retur, lokasi, lalu satu baris per obat resep yang diretur dengan satuan dan jumlahnya, jumlah yang sama dalam satuan dasar, batch yang kembali, dan total retur yang masih berlaku atas baris itu sesudah perubahan ini dalam satuan dasar (`returned_base_quantity`). Satuan baris event memakai satuan baris retur bila semua batch baris resep itu diretur dalam satuan yang sama, kalau tidak satuan dasar. Batal retur yang diulang tidak menerbitkan event kedua.

Maknanya dari sistem lama (Kuta 1): retur menambah `BILLFarmasiDetail.JmlRetur` dan tidak mengubah resep dokter (`SIMtrResepDetail` hanya punya `Qty`), dan CPPT menampilkan "Obat Direalisasi" sebagai `JmlObat - JmlRetur`. Padanannya di BC adalah Return Receipt atas Sales Shipment yang sudah diposting. Penerimanya module layanan kesehatan: kolom Diserahkan di E-Resep menampilkan yang diserahkan dikurangi yang dikembalikan.

## Golongan obat dan data obat farmasi

Golongan obat diisi trigger migration untuk setiap legal entity saat module dipasang (`core_module_installations`) dan untuk legal entity yang lahir sesudahnya, hanya bila legal entity belum punya golongan sama sekali. Legal entity bebas menambah, mengubah, dan menghapusnya; golongan yang masih dipakai data obat tidak bisa dihapus.

Data obat farmasi (`far_m_obat`) adalah table extension BC atas Item: barisnya lahir saat data farmasi sebuah barang pertama kali disimpan. Kode, nama, satuan, dan blokir tetap milik kartu barang Core.

## Hak akses

| Duty                          | Isi                                                                   |
| ----------------------------- | --------------------------------------------------------------------- |
| `pharmacy.dispensing.inquire` | Lihat antrean resep                                                   |
| `pharmacy.dispensing.prepare` | Siapkan dan panggil resep (asisten apoteker)                          |
| `pharmacy.dispensing.manage`  | Siapkan, panggil, serahkan, batal siapkan, dan retur (apoteker)       |
| `pharmacy.setup.inquire`      | Lihat lokasi layanan resep, golongan obat, data obat, dan harga obat  |
| `pharmacy.setup.manage`       | Kelola lokasi layanan resep, golongan obat, data obat, dan harga obat |

Role pemilik tenant mendapat semua duty saat module dipasang (`installModule`). Tahap ini tidak menyatakan kebijakan data per unit kerja: resep dan setelan dibatasi legal entity tempat kerja dan duty, sama dengan dokumen persediaan Core.

## Belum dikerjakan

- Pembatasan akses per lokasi atau unit kerja (petugas pusling hanya melihat resep pusling).
- Layar antrean di TV (display board).
- Obat bebas tanpa resep (OTC) dan resep luar. Di Kuta 1 keduanya hampir tidak dipakai (2 dan 0 dari 12.177 penyerahan, Desember 2025 sampai Juni 2026).
- Tagihan; menyusul lewat billing/kasir di Foundation, yang membaca harga yang sudah disalin ke baris penyerahan.
- Mengganti obat resep dengan obat lain (Item Substitution BC) dan menutup resep yang tidak pernah diambil pasien.
- Cetak etiket dan kuitansi; menunggu mesin cetak.
