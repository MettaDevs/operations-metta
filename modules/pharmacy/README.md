# pharmacy

Module farmasi: antrean resep dari layanan kesehatan, penyerahan obat, retur obat pasien, dan penjualan obat bebas di loket. Nama yang tampil di layar datang dari baris `apps` (`Farmasi`), bukan dari kode. Module ini bisa dijual sendiri: ia tidak membaca tabel module lain, stoknya milik persediaan Core, dan resep datang lewat event.

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
| `far_m_lokasi_penjualan` | Lokasi stok yang boleh menjual obat bebas, dengan kelompok harga bawaannya                                            |
| `far_tr_resep`           | Antrean resep: potret resep dari event, ditambah lokasi pilihan petugas                                               |
| `far_tr_resep_detail`    | Baris resep apa adanya: obat tunggal, kepala racikan, dan komponen racikan                                            |
| `bill_farmasi`           | Penyerahan obat satu resep, atau satu penjualan obat bebas tanpa resep: nomor, status, lokasi, orang, dan waktu       |
| `bill_farmasi_detail`    | Satu baris per obat: jumlah diserahkan, satuan, batch pilihan, alasan bila kurang dari resep, harga saat disiapkan    |
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

## Batal resep

Resep yang tidak diambil pasien dibatalkan dari kartu resepnya (**Batalkan resep**, `POST .../prescriptions/{id}/cancel` dengan alasan dan versi penyerahan aktif, atau `null` bila belum ada). Padanannya `SIMtrResep.Batal` sistem lama, yang dihitung antrean lama sebagai "Tidak Diambil" dan disaring antrean, E-Resep, dan pemeriksaan kasir. Sistem lama tidak punya tombol untuk mengisinya: Kuta 1 tidak punya satu pun resep batal dari 13.326, dan 12 resep batal di salinan lain diisi di luar aplikasi. Yang ada di kode sistem lama adalah hapus resep oleh poli sebelum realisasi ("Resep tidak bisa dihapus, karena sudah realisasi") dan kunci kasir Seroja. Di sini pembatalan milik farmasi, karena resep yang sudah dikirim tidak bisa diubah dokter.

- **Siapa.** Pemegang izin `pharmacy.prescription.cancel`, yang ada di duty apoteker (`pharmacy.dispensing.manage`) bersama Batal siapkan.
- **Kapan.** Selama obatnya belum diserahkan. Resep yang menunggu (termasuk yang drafnya sudah disimpan) langsung dibatalkan; drafnya dibiarkan karena belum memposting apa pun. Resep yang sudah disiapkan atau dipanggil dibatalkan bersama penyiapannya di transaksi yang sama, persis seperti Batal siapkan. Obat yang sudah diserahkan ditolak, karena pengembaliannya dicatat lewat retur.
- **Stok dan tagihan.** Hanya penyiapan yang memposting stok, jadi hanya resep yang sudah disiapkan yang stoknya kembali. Obatnya keluar dari tagihan kasir lewat `pharmacy.dispensing.charges-replaced.v1` dengan `lines` kosong.
- **Kunci kasir.** Sesudah kunjungan dibayar kasir, Batal resep yang sudah disiapkan ditolak dengan pesan lama "Data ini sudah melakukan Pembayaran diKasir!" sampai pembayarannya dibatalkan; pembayaran otomatis dibatalkan kasir lalu dilunasi ulang. Resep yang belum disiapkan tidak punya baris di tagihan, jadi pembatalannya tidak mengubah apa pun yang sudah dibayar dan tidak dikunci.
- **Sesudahnya.** Resep keluar dari antrean: tidak ikut Semua, hanya tampil di penghitung Dibatalkan, dan semua langkah penyerahan menolaknya dengan "Resep ini sudah dibatalkan.". Kartu resep menampilkan waktu dan alasan batal. Permintaan yang diulang tidak menulis apa pun.
- **Event.** `pharmacy.prescription.cancelled.v1` (kontrak `contracts/events/pharmacy.prescription.cancelled.v1.yaml`) terbit di transaksi yang sama. Penerimanya module layanan kesehatan: E-Resep menampilkan resepnya dibatalkan beserta waktu dan alasan.

Setiap perubahan mengunci baris resep (`for update`), jadi Siapkan yang ditekan beberapa orang bersamaan memposting sekali; indeks unik kunci posting kartu gudang menjadi penjaga terakhir. Batch yang diambil dibaca dari kartu gudang lewat `issuedSlices` Core, bukan disalin ke tabel farmasi.

Apoteker dan asisten adalah pengguna tenant (`users`), dipilih dengan namanya. Di Kuta 1 keduanya dipilih di setiap penyerahan (`Pharmacy_id`, `Pharmacy_assistant_id`; 6 apoteker dan 7 asisten dalam 12.177 penyerahan, 425 di antaranya orang yang sama), jadi di sini keduanya boleh dipilih, dan terisi otomatis dari pengguna yang menyiapkan dan menyerahkan bila dibiarkan kosong.

Serahkan juga mencatat siapa yang menerima obat (`0011_dispensing_receiver.sql`): pasien sendiri (`diterima_pasien`), atau orang lain beserta namanya (`nama_penerima`). Pilihan penerima wajib saat Serahkan, dan namanya wajib bila penerimanya orang lain. Aksi Serahkan ke pasien di antrean mencatat pasien sebagai penerima; obat yang diambil orang lain diserahkan dari kartu resepnya. Sistem lama tidak mencatat penerima; kolom ini ditambahkan karena MedicationDispense SATUSEHAT membutuhkannya. Waktu siap, waktu serah, dan apoteker yang juga dibutuhkannya sudah tercatat, dan obat tidak pernah diganti karena penyerahan tidak bisa mengganti obat resep. Pemetaan lengkapnya ada di kepala migration itu.

## Kasir menunggu resep

Kasir menolak Simpan pembayaran selama kunjungan itu masih punya resep yang belum disiapkan, seperti Simpan Seroja ("Masih Ada Resep Yang Belum Direalisasi") dan tombol Bayar Kuta (`SIMtrResep` `Realisasi = 0 AND Batal = 0`). Pesannya menyebut nomor resepnya dan meminta kasir menunggu farmasi atau meminta farmasi membatalkan resep yang tidak diambil pasien. Resep yang sudah disiapkan, diserahkan, atau dibatalkan tidak dihitung; draf penyerahan belum menyiapkan apa pun.

Pemeriksaannya milik module ini (`waitingPrescriptionRefusal`), karena hanya module ini yang membaca tabelnya. Ia didaftarkan ke kasir Core lewat `onBeforePayment`, padanan integration event `OnBeforePostSalesDoc` di BC, dari `registerPharmacyEventHandlers()`, dan kasir hanya menjalankannya untuk tenant yang memasang module ini.

Sistem lama memperingatkan kasir saat form pembayaran dibuka bila masih ada resep di farmasi. Di sini tidak ada peringatan saat dibuka. Kasir melihat statusnya langsung: Daftar Pembayaran memberi kunjungan itu lencana "2 resep menunggu farmasi", header Form Pembayaran menampilkan lencana yang sama, dan saringan Siap Dibayar hanya menampilkan kunjungan belum bayar yang tidak menunggu apa pun. Statusnya dibaca dari module ini lewat `onPaymentHolds` (`waitingPrescriptionHolds`), dengan satu query untuk semua kunjungan belum bayar di rentang tanggal daftar, dan layar membacanya ulang setiap 15 detik dan setiap layar kembali difokus. Resep yang dihitung sama dengan pemeriksaan Simpan, karena keduanya memakai query yang sama. `0014_prescription_visit_index.sql` menambah index `(tenant_id, kunjungan_id)` untuk query itu.

Pembayaran otomatis tipe pasien tidak menunggu, sama dengan sistem lama: Seroja melunasi pasien BPJS dari poli tanpa memeriksa resep, dan Kuta melunasi obat BPJS saat Siapkan. Di sini pembayaran otomatis dilunasi ulang begitu obatnya disiapkan.

## Harga obat

Makna fungsi sistem lama `GetHargaObatNew_WithStok` (Seroja dan Penta; Kuta 1 memakai rumus yang sama). Keputusan pemilik produk 13 November 2026 (opsi 8.3 A): grading tinggal di module ini, harga dihitung saat Siapkan dan disalin ke `bill_farmasi_detail`, dan kasir tidak menghitung ulang.

- **Harga dasar** milik barang Core (`gd_m_barang.harga_dasar`, Harga_Jual `mBarang`), per satuan dasar. Posting penerimaan menaikkannya ke harga beli ditambah PPN baris, per satuan dasar dan sebelum diskon (`(harga + harga x PPN % / 100) / konversi`, Goods_receipt.php), bila lebih tinggi; batal posting tidak menurunkannya, dan pengguna boleh mengubahnya di kartu barang (FastTab Harga).
- **Kelompok grading** (Setup → Harga obat → Kelompok grading) dipasang di data obat farmasi. Obat tanpa kelompok sama dengan `'ALL'` sistem lama. Kelompok XX sistem lama adalah kelompok biasa.
- **Grading harga obat** (Setup → Harga obat → Grading harga obat): per kelompok harga (master Core), kelompok grading atau semua barang, Patient KTP (`pasien_ktp`, bawaan nyala), rentang harga dasar (kedua batas termasuk), % naik, % diskon, dan tanggal berlaku mulai. Rentang yang bertumpuk dengan baris lain berkunci sama (kelompok harga, kelompok grading, Patient KTP, tanggal berlaku) ditolak. Kelompok harga yang dipakai baris grading tidak bisa dihapus di Core.
- **Desimal harga satuan obat** adalah **Presisi harga satuan** setelan keuangan Core (Sys Admin → Keuangan → Setelan keuangan, `setelan_keuangan.desimal_harga_satuan`, per legal entity), sejak 0008 yang menyalin nilai `far_m_parameter` ke sana. Ketiga salinan sistem lama berbeda di sini: Kuta 1 dan Penta menyimpan `round(@HargaObat, 0)` (0, rupiah utuh), Seroja menyimpan `@HargaObat` money tanpa round (4). Legal entity tanpa baris memakai 0. Padanannya di BC adalah Unit-Amount Rounding Precision. Pembulatannya memakai `divideRounded` Core.
- **Aturan** (`drug-price.calculation.ts`, fungsi murni): baris kelompok grading obat yang cocok dulu, lalu baris semua barang, lalu 0 %; di antara yang cocok, tanggal berlaku terakhir yang sudah lewat pada tanggal penyerahan. Baris hanya cocok dengan resep yang Patient KTP-nya sama persis (`KTP=@KTP` sistem lama): resep tanpa baris untuk KTP-nya jatuh ke baris semua barang untuk KTP-nya, lalu 0 %, tidak pernah ke baris KTP lain. Resep tanpa kelompok harga dihargai harga dasar. Harga satuan baris = harga dasar x (1 + % naik / 100) x isi satuan baris, dibulatkan ke presisi harga satuan setelan keuangan, setengah menjauhi nol, sesudah dikali isi satuan (urutan `ConvertAmountByUnitOfMeasure` BC; sistem lama tidak pernah menjual dalam satuan lain). % diskon disimpan terpisah, dan nilai baris = jumlah x harga satuan x (100 - % diskon) / 100, dibulatkan ke sen.
- **Disalin saat Siapkan**: harga dasar, baris grading yang dipakai, % naik, harga satuan (`numeric(18,4)`), dan % diskon. Perubahan grading, harga dasar, atau setelan keuangan sesudahnya tidak mengubah baris itu; Batal siapkan lalu Siapkan lagi menghitung ulang. Kartu penyerahan menampilkan harga satuan, diskon, nilai per baris, dan totalnya.
- **Golden test** terhadap fungsi SQL sistem lama: `test/drug/drug-price/legacy-drug-prices.test.ts` memakai keluaran oracle `legacy-drug-prices.sql` (dijalankan read-only di Kuta 1, Seroja, dan Penta dengan KTP 1, dan di Seroja dan Penta sekali lagi dengan KTP 0) yang disimpan di `legacy-drug-prices.json`. Setiap kasus dihitung dengan KTP-nya dan presisi harga satuan sumbernya (`unit_price_decimals`: Kuta 1 dan Penta 0, Seroja 4) dan wajib sama dengan harga sistem lama kecuali yang tercatat di `expected_differences` beserta alasannya: satu barang Seroja berkelas ALKES di kelompok XX, yang salinan Seroja hargai 0 % untuk kedua nilai KTP karena juga mencocokkan kelas barang.
- **Tidak dibawa sebagai kode**: KTP 1 yang dipaksakan untuk BPJS (JenisKerjasamaID 9; kelompok harga yang tidak membedakan KTP cukup diberi baris untuk kedua nilai), TipePelayanan (mati di setiap salinan sistem lama: lookup-nya dikomentari dan yang hidup memakai `'STANDARD'`), kontrak penjamin dan HargaObatDigunakan, BPJS + Fornas tanpa kenaikan (cukup baris grading 0 %), dan diskon karyawan; semuanya bergantung pada id yang ditulis mati di sistem lama.

## Penjualan obat bebas

Pembeli datang ke loket farmasi tanpa resep. Petugas memilih obat, melihat total, menerima bayar, lalu menyerahkan obatnya, semuanya dalam satu langkah. Sistem lama punya satu "pembayaran obat bebas" yang mencampur penjualan dan pembayaran; di sini polanya transaksi Commerce F&O (baris penjualan dan baris tender dalam satu transaksi) dan dokumen penjualan BC yang dibayar saat diposting. Resep tetap dua langkah: Siapkan di farmasi, lalu kasir. Module ini tidak membaca module layanan kesehatan, jadi apotek yang hanya memasang farmasi bisa menjual obat bebas (`0015_otc_sale.sql`).

- **Lokasi.** Setelan Lokasi penjualan obat bebas (`far_m_lokasi_penjualan`, API `/otc-sale-locations`, layar `/pharmacy/dispensing/otc-sale-locations` di Setup › Pelayanan resep): satu baris hidup per lokasi stok berarti lokasi itu boleh menjual, dengan kelompok harga bawaannya; kosong berarti harga dasar. Lokasi adalah identitas baris, jadi Ubah hanya mengganti kelompok harga. Menghapus barisnya (lunak) mencabut izin menjual; penjualan yang sudah terjadi tetap tercatat. Lokasi transit ditolak.
- **Pilihan loket** (`GET .../otc-sales/options`): lokasi yang boleh menjual beserta kelompok harga bawaannya, lalu isian tender kasir Core dari `paymentOptions` (jenis bayar dengan presisi mata uang dan kurs hari ini atau pesannya, merchan, presisi jumlah, mata uang lokal, tanggal, dan izin kasir), sama dengan yang dibaca Form Pembayaran tanpa penolakan tipe pasien. `can_search_buyers` memberi tahu layar apakah pengguna boleh membaca buku alamat Core untuk mencari pembeli.
- **Cari obat** (`GET .../otc-sales/items?q=&location_id=`): barang legal entity ini yang tidak diblokir, sama dengan yang diterima quote, dimuat bertahap, dengan pilihan satuannya (satuan dasar lebih dulu), satuan jual bawaannya, dan stok dalam satuan dasar di lokasi itu. Stok hanya diisi untuk lokasi yang boleh menjual obat bebas. Pilihan batch memakai `/lookups/batches` milik penyiapan resep, yang juga terbuka untuk izin loket.
- **Harga tanpa menyimpan** (`POST .../otc-sales/quote`): lokasi, kelompok harga, Patient KTP, dan baris obat (barang, satuan, jumlah). Harga satuan dan % diskon dihitung `priceDrugLines`, sama dengan Siapkan resep, pada tanggal hari ini di legal entity itu. Nilai baris dan total dihitung `invoiceTotals` kasir Core atas baris tagihan yang sama (Qty jumlah jual, Nilai dan HargaOrig harga satuan, Disc % diskon, HExt 0, tanpa kelompok jasa), jadi total yang terlihat sama dengan yang ditagih kasir. `price_group_id` yang tidak dikirim berarti kelompok harga bawaan lokasi, dan `null` berarti harga dasar.
- **Simpan dan bayar** (`POST .../otc-sales`): isian quote ditambah pembeli, batch per baris, `expected_total`, dan `payment` (isian Form Pembayaran kasir: `received`, `lines`, `take_remainder`). Satu transaksi: periksa isian, hitung ulang total, tolak dengan 409 `stale_total` bila berbeda dengan `expected_total`, ambil nomor `pharmacy.dispensing-number` untuk operating unit lokasi, tulis `bill_farmasi` tanpa resep berstatus `diserahkan` (siap dan serah dengan waktu dan pengguna yang sama) beserta barisnya, posting stok keluar `penyerahan` lewat `postItemLines` (batch kosong diambil menurut cara pengambilan lokasi, FEFO bawaan), tulis tagihan penjualan kasir lewat `replaceSaleBill` (group OBAT), lalu simpan pembayarannya lewat `payBill` dengan clerk pengguna loket. Yang ditolak tidak menulis apa pun. Jawabannya 201 berisi id dan nomor penjualan serta id dan nomor pembayaran.
- **Penolakan kasir** memakai nama field Form Pembayaran, yang bertabrakan dengan baris obat (`lines.0`). Di loket nama field-nya dipindah ke bawah `payment.` (`payment.received`, `payment.lines.0.amount`); `_form` tetap, misalnya "Masih terdapat Sisa pembayaran!!" dan pesan Clerk Start.
- **Pembeli.** Pihak buku alamat Core, nama yang diketik, keduanya, atau tidak ada (pembeli umum). Nama yang disalin ke penjualan dan tagihannya adalah nama yang diketik, atau nama pihaknya. Pembayaran yang menjadi piutang wajib punya pihak, aturan kasir Core.
- **Izin.** Duty `pharmacy.otc-sale.operate` membuka loket; uangnya diterima kasir Core, jadi petugas loket juga butuh izin terima pembayaran kasir (`core.payment.update`) dan Clerk Start. Tanpa izin itu Simpan dan bayar dijawab 403.
- **Tidak ada event ke layanan kesehatan.** Penjualan obat bebas tidak punya kunjungan, jadi `pharmacy.dispensing.charges-replaced.v1` tidak terbit; tagihannya ditulis langsung lewat `replaceSaleBill`.
- **Patient KTP per penjualan.** Buku alamat Core tidak menyimpan KTP; KTP pasien ada di master pasien layanan kesehatan, yang tidak dibaca module ini. Karena itu KTP diisi per penjualan, bawaannya `true`, juga untuk pembeli dari buku alamat. Ini gap sampai pihak Core punya atribut KTP.
- **Layar loket** (`/pharmacy/dispensing/otc-sale`, menu Pelayanan resep › Penjualan obat bebas). Kepala: lokasi (yang terakhir dipilih diingat per pengguna di peramban), kelompok harga (bawaan lokasi, bisa diganti), pembeli dari buku alamat atau nama yang diketik (kosong berarti pembeli umum), dan saklar KTP (bawaannya hidup). Baris: obat, jumlah, satuan (bawaannya satuan jual), dan batch opsional. Harga, diskon, nilai, dan total hanya datang dari quote, yang diminta ulang 300 ms sesudah isian berhenti berubah; angka quote lama tampil redup sampai quote terbaru kembali, dan Simpan dan bayar baru bisa ditekan sesudah itu. Tender digambar dari jenis bayar kasir seperti tab Pembayaran Form Pembayaran, tanpa tab Diskon: uang tunai diterima dengan kembalian, jenis bayar lain beserta merchan, referensi, biaya kartu, pihak, dan kurs bila jenis bayarnya memintanya, dan saklar piutang bila ada jenis bayar penampung sisa. Rumus kembalian dan sisa disalin dari `payment.amounts.ts` ke `otc-sale-tender.tsx`, karena module tidak meng-import layar Core; server kasir tetap yang memutuskan. Penolakan 409 `stale_total` meminta quote ulang dan menampilkan pesan server; 422 dipetakan ke baris obat (`lines.N.*`), isian tender (`payment.*`), dan ringkasan kesalahan (`_form`). Berhasil menampilkan nomor penjualan, nomor pembayaran, dan kembalian, lalu mengosongkan layar untuk pembeli berikutnya dengan lokasi dan kelompok harga yang sama.
- **Menu** (`0017_otc_sale_navigation.sql`): Penjualan obat bebas di Pelayanan resep (izin `pharmacy.otc-sale.read`), Lokasi penjualan obat bebas di Setup › Pelayanan resep (izin `pharmacy.otc-sale-location.read`).
- **Belum termasuk.** Retur penjualan obat bebas, poin member, cetak struk (menunggu mesin cetak), dan resep luar.

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

| Duty                          | Isi                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `pharmacy.dispensing.inquire` | Lihat antrean resep                                                                            |
| `pharmacy.dispensing.prepare` | Siapkan dan panggil resep (asisten apoteker)                                                   |
| `pharmacy.dispensing.manage`  | Siapkan, panggil, serahkan, batal siapkan, retur, dan batalkan resep (apoteker)                |
| `pharmacy.otc-sale.operate`   | Jual obat bebas di loket (bersama izin kasir Core untuk menerima uangnya)                      |
| `pharmacy.setup.inquire`      | Lihat lokasi layanan resep dan penjualan obat bebas, golongan obat, data obat, dan harga obat  |
| `pharmacy.setup.manage`       | Kelola lokasi layanan resep dan penjualan obat bebas, golongan obat, data obat, dan harga obat |

Role pemilik tenant mendapat semua duty saat module dipasang (`installModule`). Tahap ini tidak menyatakan kebijakan data per unit kerja: resep dan setelan dibatasi legal entity tempat kerja dan duty, sama dengan dokumen persediaan Core.

## Belum dikerjakan

- Pembatasan akses per lokasi atau unit kerja (petugas pusling hanya melihat resep pusling).
- Layar antrean di TV (display board).
- Resep luar. Di Kuta 1 hampir tidak dipakai (0 dari 12.177 penyerahan, Desember 2025 sampai Juni 2026).
- Tagihan; menyusul lewat billing/kasir di Foundation, yang membaca harga yang sudah disalin ke baris penyerahan.
- Mengganti obat resep dengan obat lain (Item Substitution BC).
- Cetak etiket dan kuitansi; menunggu mesin cetak.
