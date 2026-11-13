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

| Tabel                  | Isi                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `far_processed_events` | Event yang sudah diproses, supaya event yang diantar dua kali dicatat sekali                                  |
| `far_m_golongan_obat`  | Golongan obat per legal entity (narkotika, psikotropika, obat keras, bebas terbatas, bebas): data, bukan kode |
| `far_m_obat`           | Perluasan barang Core berkunci id barang: golongan, generik, formularium                                      |
| `far_m_lokasi_layanan` | Lokasi stok yang melayani resep dari satu operating unit, dan dari satu section asal                          |
| `far_tr_resep`         | Antrean resep: potret resep dari event, ditambah lokasi pilihan petugas                                       |
| `far_tr_resep_detail`  | Baris resep apa adanya: obat tunggal, kepala racikan, dan komponen racikan                                    |
| `bill_farmasi`         | Penyerahan obat satu resep: nomor, status, lokasi stok keluar, apoteker, asisten, dan waktu setiap langkah    |
| `bill_farmasi_detail`  | Satu baris per obat resep: jumlah diserahkan, batch pilihan, alasan bila kurang dari resep                    |
| `retur_farmasi`        | Retur obat dari pasien atas satu penyerahan: nomor, tanggal, lokasi, alasan, status                           |
| `retur_farmasi_detail` | Satu baris per obat dan batch yang kembali                                                                    |

## Resep masuk lewat event

`registerPharmacyEventHandlers()` di `src/index.ts` dipanggil `src/main.ts` dan `src/worker.ts`. Ia mendaftarkan penerima `healthcare.prescription.issued.v1` (kontrak `contracts/events/healthcare.prescription.issued.v1.yaml`).

- Penerima berjalan di transaksi Kirim ke farmasi milik dokter, jadi ia kecil: memeriksa isi, mencatat id event, lalu menyalin potret resep. Tidak ada pekerjaan stok.
- Isi diperiksa schema zod milik module ini (`prescription.schema.ts`) yang mengikuti kontrak. Field yang tidak dikenal dilewati, supaya field opsional baru di versi yang sama tidak membuat resep terlewat.
- Isi yang tidak cocok (bentuk salah, teks lebih panjang dari kolom, barang yang bukan milik legal entity itu) dicatat ke log `pharmacy-event-skipped` lalu dilewati, tidak dilempar: lemparan membatalkan resep dokter. Event yang dilewati tidak dicatat sebagai sudah diproses.
- Event yang sama diantar dua kali, atau resep yang sama dalam event lain, dicatat sekali (`far_processed_events` dan indeks unik `resep_sumber_id`).
- Handler hanya berjalan untuk tenant yang memasang module ini.

## Penyerahan obat

Satu penyerahan aktif (`bill_farmasi`) per resep, dibuka dari antrean. Polanya pengiriman pesanan penjualan BC: Post Ship mencatat stok keluar, dan Undo Shipment membaliknya sebelum faktur.

| Langkah       | Yang terjadi                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simpan (draf) | Jumlah diserahkan (0 sampai jumlah resep; kurang dari resep wajib beralasan), batch pilihan, lokasi, apoteker, asisten, catatan. Nomor dari `pharmacy.dispensing-number` per operating unit resep.                                                                                                                                                                                          |
| Siapkan       | Isian disimpan lalu stok keluar diposting lewat `postItemLines` (jenis `penyerahan`) di lokasi yang melayani resep, di transaksi yang sama. Batch kosong diambil menurut cara pengambilan lokasi (FEFO bawaan); lokasi pilih manual mewajibkan batch. Stok kurang ditolak bila lokasi menolak stok minus, dan tidak ada yang tersimpan. Asisten diisi pengguna yang menyiapkan bila kosong. |
| Panggil       | Waktu dan pemanggil dicatat; Panggil ulang memperbarui waktunya.                                                                                                                                                                                                                                                                                                                            |
| Serahkan      | Waktu dan penyerah dicatat; apoteker diisi penyerah bila kosong.                                                                                                                                                                                                                                                                                                                            |
| Batal siapkan | Hanya sebelum diserahkan. Stok kembali lewat `reverseItemEntries`, penyerahan ditutup sebagai dibatalkan, dan resep kembali menunggu. Siapkan berikutnya membuat penyerahan baru dengan isian yang sama, karena kunci posting kartu gudang penyerahan lama sudah terpakai (sama dengan batal posting dokumen persediaan Core).                                                              |

Setiap perubahan mengunci baris resep (`for update`), jadi Siapkan yang ditekan beberapa orang bersamaan memposting sekali; indeks unik kunci posting kartu gudang menjadi penjaga terakhir. Batch yang diambil dibaca dari kartu gudang lewat `issuedSlices` Core, bukan disalin ke tabel farmasi.

Apoteker dan asisten adalah pengguna tenant (`users`), dipilih dengan namanya. Di Kuta 1 keduanya dipilih di setiap penyerahan (`Pharmacy_id`, `Pharmacy_assistant_id`; 6 apoteker dan 7 asisten dalam 12.177 penyerahan, 425 di antaranya orang yang sama), jadi di sini keduanya boleh dipilih, dan terisi otomatis dari pengguna yang menyiapkan dan menyerahkan bila dibiarkan kosong.

## Obat diserahkan: event ke layanan kesehatan

Serahkan menerbitkan `pharmacy.prescription.dispensed.v1` (kontrak `contracts/events/pharmacy.prescription.dispensed.v1.yaml`) di transaksi yang sama. Isinya: id dan nomor resep asal, nomor penyerahan, waktu, lokasi, apoteker, asisten, dan satu baris per obat resep dengan jumlah resep, jumlah diserahkan, alasan, dan batch yang diambil (nomor, kedaluwarsa, jumlah). Serahkan yang diulang tidak menerbitkan event kedua, dan penyiapan yang dibatalkan tidak menerbitkan apa pun.

Penerimanya module layanan kesehatan (`registerHealthcareEventHandlers()`, `modules/healthcare/src/examination/medical-record/dispensing.events.ts`): E-Resep menampilkan status "Diserahkan farmasi", waktu dan nomor penyerahan, serta jumlah yang diserahkan per baris. Ia idempoten lewat `sim_processed_events`, dan resep yang tidak dikenal dilewati dengan log.

## Retur obat

Retur langsung diposting saat disimpan (8 retur dari 12.177 penyerahan di Kuta 1 tidak membutuhkan draf). Stok masuk lagi ke lokasi penyerahan lewat `postItemLines` (jenis `penyerahan` dengan jumlah positif, seperti retur penjualan di BC yang tercatat sebagai Sale) dengan batch, kedaluwarsa, harga satuan, dan sumber dana yang sama dengan bagian stok yang keluar (`issuedSlices`; Appl.-from Item Entry di BC). Jumlah retur per obat dan batch tidak pernah melebihi yang diserahkan dikurangi yang sudah diretur; bagian yang sudah kembali dicocokkan dengan batch, harga, dan sumber dana baris kartu gudang retur sebelumnya, jadi retur berikutnya mengambil bagian yang memang belum kembali. Batal retur membalik posting itu lewat `reverseItemEntries` dan ditolak bila stoknya sudah terpakai.

## Retur: event ke layanan kesehatan

Retur yang diposting menerbitkan `pharmacy.return.posted.v1`, dan Batal retur menerbitkan `pharmacy.return.reversed.v1` (kontrak `contracts/events/pharmacy.return.posted.v1.yaml` dan `pharmacy.return.reversed.v1.yaml`), masing-masing di transaksi yang sama. Isinya: id dan nomor resep asal, penyerahan yang diretur, nomor, tanggal, dan alasan retur, lokasi, lalu satu baris per obat resep yang diretur dengan satuan dan jumlahnya (bentuknya sama dengan baris penyerahan), jumlah yang sama dalam satuan dasar, batch yang kembali, dan total retur yang masih berlaku atas baris itu sesudah perubahan ini dalam satuan dasar (`returned_base_quantity`). Retur hari ini hanya dalam satuan dasar; total dalam satuan dasar membuat layanan kesehatan tetap menghitung selisih dengan benar saat retur atau penyerahan kelak memakai satuan lain dengan konversi. Batal retur yang diulang tidak menerbitkan event kedua.

Maknanya dari sistem lama (Kuta 1): retur menambah `BILLFarmasiDetail.JmlRetur` dan tidak mengubah resep dokter (`SIMtrResepDetail` hanya punya `Qty`), dan CPPT menampilkan "Obat Direalisasi" sebagai `JmlObat - JmlRetur`. Padanannya di BC adalah Return Receipt atas Sales Shipment yang sudah diposting. Penerimanya module layanan kesehatan: kolom Diserahkan di E-Resep menampilkan yang diserahkan dikurangi yang dikembalikan.

## Golongan obat dan data obat farmasi

Golongan obat diisi trigger migration untuk setiap legal entity saat module dipasang (`core_module_installations`) dan untuk legal entity yang lahir sesudahnya, hanya bila legal entity belum punya golongan sama sekali. Legal entity bebas menambah, mengubah, dan menghapusnya; golongan yang masih dipakai data obat tidak bisa dihapus.

Data obat farmasi (`far_m_obat`) adalah table extension BC atas Item: barisnya lahir saat data farmasi sebuah barang pertama kali disimpan. Kode, nama, satuan, dan blokir tetap milik kartu barang Core.

## Hak akses

| Duty                          | Isi                                                             |
| ----------------------------- | --------------------------------------------------------------- |
| `pharmacy.dispensing.inquire` | Lihat antrean resep                                             |
| `pharmacy.dispensing.prepare` | Siapkan dan panggil resep (asisten apoteker)                    |
| `pharmacy.dispensing.manage`  | Siapkan, panggil, serahkan, batal siapkan, dan retur (apoteker) |
| `pharmacy.setup.inquire`      | Lihat lokasi layanan resep, golongan obat, data obat            |
| `pharmacy.setup.manage`       | Kelola lokasi layanan resep, golongan obat, data obat           |

Role pemilik tenant mendapat semua duty saat module dipasang (`installModule`). Tahap ini tidak menyatakan kebijakan data per unit kerja: resep dan setelan dibatasi legal entity tempat kerja dan duty, sama dengan dokumen persediaan Core.

## Belum dikerjakan

- Pembatasan akses per lokasi atau unit kerja (petugas pusling hanya melihat resep pusling).
- Layar antrean di TV (display board).
- Obat bebas tanpa resep (OTC) dan resep luar. Di Kuta 1 keduanya hampir tidak dipakai (2 dan 0 dari 12.177 penyerahan, Desember 2025 sampai Juni 2026).
- Harga dan tagihan; menyusul lewat billing/kasir di Foundation.
- Mengganti obat resep dengan obat lain (Item Substitution BC) dan menutup resep yang tidak pernah diambil pasien.
- Cetak etiket dan kuitansi; menunggu mesin cetak.
