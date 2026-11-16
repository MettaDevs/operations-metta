# Tiga kebenaran lifecycle

Ini aturan yang paling sering dilanggar orang baru, dan paling mahal ongkos perbaikannya. Baca sekali dengan serius.

Sebuah module melewati tiga fakta yang **terpisah**. Masing-masing punya sumber kebenaran sendiri, dan satu fakta tidak boleh disimpulkan dari fakta lain.

```
catalogued  →  entitled  →  installed
```

| Fakta | Artinya | Sumber kebenaran |
| --- | --- | --- |
| **Catalogued** | Module dikenal dan boleh dijual dari image ini | `modules/<module>/module.json` beserta migration-nya; dilaporkan worker ke control plane (`readModuleCatalog` di `src/platform/environment/sync-entitlements.service.ts`). Di database lingkungan, migration module menulis barisnya ke `apps`. |
| **Entitled** | Tenant ini berhak memakainya | `tenant_app_entitlements` aktif dan belum berakhir. Ditulis dari control plane lewat operasi `sync_entitlements`. |
| **Installed** | Migration module berhasil di database lingkungan tenant ini | `core_module_installations` berstatus `installed`, ditulis hanya sesudah migration berhasil. |

CoreERP dulu punya fakta keempat, *ready*, untuk app yang berjalan di container sendiri. Bentuk itu dibuang sebelum repo ini lahir: module berjalan di proses yang sama dengan Core, jadi tidak ada kesehatan kedua yang perlu ditanyakan.

## Kenapa ini penting

Godaannya besar: kalau tenant punya entitlement, kelihatannya wajar menampilkan module itu sebagai "terpasang". **Jangan.** Entitlement hanya berarti tenant berhak. Module-nya bisa saja tidak dibawa rilis host itu, atau migration-nya gagal.

Layar yang menulis "terpasang" wajib membaca `core_module_installations`. Shell sudah melakukannya: peluncur aplikasi (`GET /api/v1/shell`, `src/platform/access/shell.routes.ts`) hanya membuka module yang dihak **dan** terpasang, menampilkan module yang dihak tetapi belum terpasang sebagai nonaktif dengan keterangan "Belum dipasang", dan tidak menampilkan module yang tidak dihak.

Kalau catatan yang kamu butuhkan belum ada, nyatakan itu sebagai gap. Jangan membuat tabel placeholder, compatibility layer, atau status palsu untuk menutupinya.

## Seperti apa di kode

`installModule` (`src/platform/environment/install-module.service.ts`) memasang satu module untuk satu tenant:

1. menolak module yang tidak dibawa rilis ini;
2. menjalankan migration module di database lingkungan, dicatat per pemilik di `schema_migrations`. Migration itu juga menulis katalog module ke `apps`;
3. lalu, dalam satu transaksi: mencatat entitlement bila belum ada yang berlaku, mencatat `core_module_installations` berstatus `installed`, memberi role pemilik (`is_owner`) semua duty module itu, dan menjalankan ulang pembuat data bawaan per organisasi untuk setiap legal entity dan operating unit yang sudah ada (misalnya number sequence milik module).

Semuanya aman diulang. Pemanggilnya antara lain `bun run dev:setup` di laptop dan operasi `sync_entitlements` dari control plane (`syncEntitlements`), yang memasang module baru dan mencabut hak yang tidak lagi diberikan.

## Kewajiban yang tidak boleh dilonggarkan

- `installed` hanya ditulis setelah migration berhasil.
- Mencabut hak (`revoked`) tidak menyentuh tabel dan isinya. Hak yang diberikan lagi menampilkan data lamanya. Ini sejalan dengan [hapus lunak](../dev/02-module-standard.md#penghapusan-lunak): tidak ada yang dihapus fisik.
- Module yang haknya sudah berakhir tidak dipasang ulang diam-diam.
- Pemasangan yang gagal tidak boleh diam-diam memberi akses.

## Lihat juga

- [Alur end-to-end](alur-end-to-end.md), dari control plane sampai module terpasang
- [Standar module](../dev/02-module-standard.md)
- [Release dan on-prem dari sisi runtime](../dev/03-release-and-on-prem.md)
