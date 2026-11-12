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

## Resep masuk lewat event

`registerPharmacyEventHandlers()` di `src/index.ts` dipanggil `src/main.ts` dan `src/worker.ts`. Ia mendaftarkan penerima `healthcare.prescription.issued.v1` (kontrak `contracts/events/healthcare.prescription.issued.v1.yaml`).

- Penerima berjalan di transaksi Kirim ke farmasi milik dokter, jadi ia kecil: memeriksa isi, mencatat id event, lalu menyalin potret resep. Tidak ada pekerjaan stok.
- Isi diperiksa schema zod milik module ini (`prescription.schema.ts`) yang mengikuti kontrak. Field yang tidak dikenal dilewati, supaya field opsional baru di versi yang sama tidak membuat resep terlewat.
- Isi yang tidak cocok (bentuk salah, teks lebih panjang dari kolom, barang yang bukan milik legal entity itu) dicatat ke log `pharmacy-event-skipped` lalu dilewati, tidak dilempar: lemparan membatalkan resep dokter. Event yang dilewati tidak dicatat sebagai sudah diproses.
- Event yang sama diantar dua kali, atau resep yang sama dalam event lain, dicatat sekali (`far_processed_events` dan indeks unik `resep_sumber_id`).
- Handler hanya berjalan untuk tenant yang memasang module ini.

## Golongan obat dan data obat farmasi

Golongan obat diisi trigger migration untuk setiap legal entity saat module dipasang (`core_module_installations`) dan untuk legal entity yang lahir sesudahnya, hanya bila legal entity belum punya golongan sama sekali. Legal entity bebas menambah, mengubah, dan menghapusnya; golongan yang masih dipakai data obat tidak bisa dihapus.

Data obat farmasi (`far_m_obat`) adalah table extension BC atas Item: barisnya lahir saat data farmasi sebuah barang pertama kali disimpan. Kode, nama, satuan, dan blokir tetap milik kartu barang Core.

## Hak akses

| Duty                          | Isi                                                   |
| ----------------------------- | ----------------------------------------------------- |
| `pharmacy.dispensing.inquire` | Lihat antrean resep                                   |
| `pharmacy.setup.inquire`      | Lihat lokasi layanan resep, golongan obat, data obat  |
| `pharmacy.setup.manage`       | Kelola lokasi layanan resep, golongan obat, data obat |

Role pemilik tenant mendapat semua duty saat module dipasang (`installModule`). Tahap ini tidak menyatakan kebijakan data per unit kerja: resep dan setelan dibatasi legal entity tempat kerja dan duty, sama dengan dokumen persediaan Core.

## Belum dikerjakan

- Pembatasan akses per lokasi atau unit kerja (petugas pusling hanya melihat resep pusling).
- Layar antrean di TV (display board).
- Obat bebas tanpa resep (OTC) dan resep luar. Di Kuta 1 keduanya hampir tidak dipakai (2 dan 0 dari 12.177 penyerahan, Desember 2025 sampai Juni 2026).
- Harga dan tagihan; menyusul lewat billing/kasir di Foundation.
