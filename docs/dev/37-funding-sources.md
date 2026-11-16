# Sumber dana

Sumber dana menyatakan asal pembiayaan barang yang masuk, misalnya APBD atau BLUD. Di repo ini ia master persediaan Core, mengikuti master `mSumberDana` sistem lama, bukan master `funding_sources` bersama milik Foundation CoreERP.

## Bentuk yang dipakai

| Tabel | Isi |
| --- | --- |
| `gd_m_sumber_dana` | Kode dan nama sumber dana, per legal entity |
| `gd_m_program_pengadaan` | Kode dan nama program pengadaan, per legal entity, dengan bentuk yang sama |
| `bl_tr_penerimaan_detail.sumber_dana_id`, `program_pengadaan_id`, `tahun_anggaran` | Asal pembiayaan per baris penerimaan barang |
| `gd_tr_kartu_gudang.sumber_dana_id`, `program_pengadaan_id`, `tahun_anggaran` | Asal pembiayaan yang melekat pada baris stok masuk |

Tabelnya lahir di migration `database/migrations/0025_purchase_receipt.sql`. Kodenya di `src/foundation/inventory/code-list/`, satu layanan untuk daftar kode persediaan yang berbentuk sama, misalnya satuan, alasan penyesuaian, sumber dana, dan program pengadaan. Layarnya **Sumber dana** di `/sysadmin/inventory/funding-sources` dan **Program pengadaan** di `/sysadmin/inventory/procurement-programs`.

## Aturan yang dijaga

- **Milik legal entity.** Kode unik per `(tenant_id, legal_entity_id)` di antara baris yang belum dihapus, seperti master persediaan lain.
- **Melekat pada baris masuk, bukan pada batch.** Di data sistem lama, batch yang sama bisa datang lebih dari sekali dengan sumber dana berbeda. Karena itu sumber dana, program, dan tahun anggaran dicatat per baris penerimaan dan per baris stok masuk. Baris keluar dan mutasi mewarisinya dari baris masuk yang diambil, sama seperti batch dan harga.
- **Yang sudah dipakai tidak dapat dihapus.** Sumber dana atau program yang dirujuk kartu gudang atau baris penerimaan ditolak dengan pesan yang menyebut sebabnya. Menghapus yang belum dipakai mengisi `deleted_at`.
- **Hak layar** memakai permission `core.inventory-funding-source.read` dan `core.inventory-funding-source.update`. Layar penerimaan menawarkan pembuatan sumber dana baru hanya kepada pemegang izin ubahnya.

Sumber dana tidak menyimpan pagu, saldo, atau persetujuan anggaran. Memilihnya pada dokumen hanya mencatat asal pembiayaan.

## Beda dengan CoreERP

CoreERP punya `funding_sources` sebagai master Foundation per tenant, tanpa kode, dipakai lintas module lewat kontrak `FundingSourceDirectory`. Tabel itu masih ada di `database/migrations/0001_coreerp_baseline.sql`, dan baseline module aset masih merujuknya dari baris perencanaan aset. Tidak ada kode di repo ini yang membacanya atau menulisnya. Acuan desain lamanya ada di [`docs/dev/37-funding-sources.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/37-funding-sources.md).

## Lihat juga

- [Satuan dan konversi](16-units-of-measure.md): daftar kode persediaan lain yang memakai layanan yang sama
