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

## Golongan obat dan data obat farmasi

Golongan obat diisi trigger migration untuk setiap legal entity saat module dipasang (`core_module_installations`) dan untuk legal entity yang lahir sesudahnya, hanya bila legal entity belum punya golongan sama sekali. Legal entity bebas menambah, mengubah, dan menghapusnya; golongan yang masih dipakai data obat tidak bisa dihapus.

Data obat farmasi (`far_m_obat`) adalah table extension BC atas Item: barisnya lahir saat data farmasi sebuah barang pertama kali disimpan. Kode, nama, satuan, dan blokir tetap milik kartu barang Core.

## Hak akses

| Duty                          | Isi                                                      |
| ----------------------------- | -------------------------------------------------------- |
| `pharmacy.dispensing.inquire` | Lihat antrean resep                                      |
| `pharmacy.dispensing.prepare` | Siapkan dan panggil resep (asisten apoteker)             |
| `pharmacy.dispensing.manage`  | Siapkan, panggil, serahkan, dan batal siapkan (apoteker) |
| `pharmacy.setup.inquire`      | Lihat lokasi layanan resep, golongan obat, data obat     |
| `pharmacy.setup.manage`       | Kelola lokasi layanan resep, golongan obat, data obat    |

Role pemilik tenant mendapat semua duty saat module dipasang (`installModule`). Tahap ini tidak menyatakan kebijakan data per unit kerja: resep dan setelan dibatasi legal entity tempat kerja dan duty, sama dengan dokumen persediaan Core.

## Belum dikerjakan

- Pembatasan akses per lokasi atau unit kerja (petugas pusling hanya melihat resep pusling).
- Layar antrean di TV (display board).
- Obat bebas tanpa resep (OTC) dan resep luar. Di Kuta 1 keduanya hampir tidak dipakai (2 dan 0 dari 12.177 penyerahan, Desember 2025 sampai Juni 2026).
- Harga dan tagihan; menyusul lewat billing/kasir di Foundation.
- Mengganti obat resep dengan obat lain (Item Substitution BC) dan menutup resep yang tidak pernah diambil pasien.
- Cetak etiket dan kuitansi; menunggu mesin cetak.
