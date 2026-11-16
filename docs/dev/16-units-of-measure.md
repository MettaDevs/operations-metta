# Satuan dan konversi

Satuan di repo ini milik persediaan Core, `src/foundation/inventory/`, dan bentuknya mengikuti Business Central: daftar satuan per legal entity, lalu satuan kemasan per barang beserta isinya dalam satuan dasar. Bentuk CoreERP, yaitu katalog satuan bersama per tenant dengan kelas, sistem satuan, dan konversi umum, tidak dipindah.

## Bentuk yang dipakai

| Tabel | Padanan BC | Isi | Kode |
| --- | --- | --- | --- |
| `gd_m_satuan` | Unit of Measure | Kode dan nama satuan, misalnya TAB atau BOX, per legal entity | `src/foundation/inventory/code-list/` |
| `gd_m_barang.satuan_dasar_id` | Base Unit of Measure | Satuan dasar barang. Stok selalu dicatat dalam satuan ini | `src/foundation/inventory/item/` |
| `gd_m_barang_satuan` | Item Unit of Measure | Satuan kemasan sebuah barang dan `konversi`-nya, yaitu isinya dalam satuan dasar | `src/foundation/inventory/item-unit/` |
| `gd_m_barang.satuan_beli_id`, `gd_m_barang.satuan_jual_id` | Purch. Unit of Measure, Sales Unit of Measure | Satuan bawaan saat membeli dan menjual. Kosong berarti satuan dasar | `src/foundation/inventory/item/` |

Tabelnya lahir di migration `0024_inventory.sql`, `0025_purchase_receipt.sql`, dan `0034_item_default_units.sql`. Layarnya **Satuan** di `/sysadmin/inventory/units-of-measure` dan **Satuan barang** di `/sysadmin/inventory/item-units`. Menu keduanya ditulis di `src/platform/access/navigation.ts`.

## Aturan yang dijaga

- **Satuan milik legal entity.** Kode satuan unik per `(tenant_id, legal_entity_id)` di antara baris yang belum dihapus, sama seperti master persediaan lain yang mengikuti company di BC.
- **Satuan dasar selalu berisi 1** dan tidak dicatat di `gd_m_barang_satuan`. Isinya dibaca dari `gd_m_barang.satuan_dasar_id`.
- **Satu satuan hanya punya satu isi per barang.** Indeks unik `gd_m_barang_satuan_unique` menolak satuan yang sama dua kali pada satu barang, dan `konversi` wajib lebih besar dari nol.
- **Satuan beli dan satuan jual harus satuan barang itu sendiri**, yaitu satuan dasar atau salah satu satuan kemasannya. Layanan barang yang menjaganya. Foreign key hanya memastikan satuannya ada di legal entity yang sama. Satuan kemasan yang sedang menjadi satuan bawaan tidak dapat dihapus, padanan `TestItemSetup` di BC.
- **Satuan yang dipakai tidak dapat dihapus.** Satuan yang masih menjadi satuan dasar atau satuan kemasan barang ditolak dengan pesan yang menyebut sebabnya.
- **Baris dokumen menyalin isi satuannya saat disimpan.** Mengubah isi kemasan di kartu barang sesudahnya tidak mengubah dokumen yang sudah ada. Pola ini juga dipakai baris resep di module layanan kesehatan, lihat `modules/healthcare/database/migrations/0032_prescription_units.sql`.

## Dipakai module

Module tidak membaca tabel `gd_m_*`. Mereka memakai fungsi dari `src/foundation/inventory/index.ts`, antara lain `itemUnits` untuk pilihan satuan baris dokumen, `defaultUnit` untuk satuan bawaan barang, dan `unitConversion` untuk isi satuan yang dipilih. Contoh pemakainya ada di `modules/pharmacy/src/dispensing/dispensing/dispensing.service.ts`.

Jumlah barang disimpan dalam satuan dasar dengan skala tetap `quantityScale` dari `src/foundation/inventory/quantity.ts`. Angka di belakang koma tidak diatur per satuan.

## Yang tidak dipindah dari CoreERP

CoreERP punya katalog satuan bersama per tenant: tabel `units_of_measure`, `uom_classes`, `uom_systems`, `uom_conversions`, `uom_external_codes`, dan `uom_translations`, beserta data awal SI dan kode UN/ECE Rec 20. Tabel-tabel itu masih ada di `database/migrations/0001_coreerp_baseline.sql`, tetapi tidak ada kode di repo ini yang membacanya atau menulisnya.

Yang karena itu belum ada:

- kelas satuan dan larangan konversi antarkelas, misalnya kg ke pcs;
- sistem satuan seperti Metrik dan Imperial;
- konversi umum yang berlaku untuk semua barang, misalnya kg ke gram;
- jumlah angka desimal per satuan;
- kode satuan internasional untuk pertukaran dokumen.

Di persediaan klinik, konversi yang dipakai adalah isi kemasan per barang, misalnya 1 BOX berisi 10 STRIP. Konversi itu memang data barang, bukan konversi umum. Acuan desain lama ada di [`docs/dev/16-units-of-measure.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/16-units-of-measure.md).

## Lihat juga

- [Number sequence](14-number-sequences.md)
