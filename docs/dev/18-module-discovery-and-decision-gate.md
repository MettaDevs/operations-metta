# Gate penemuan dan keputusan module

Sebelum membuat module, master, transaksi, workflow, atau integrasi, termasuk saat memindahkannya dari CoreERP, buat proposal yang merujuk Microsoft Learn Dynamics 365. Bila tidak ada padanan resmi, nyatakan itu; jangan menciptakan klaim kesetaraan.

Prosedur lengkap, templat proposal, dan urutan skill sesudah proposal disetujui ada di skill [`module-discovery`](../../.agents/skills/module-discovery/SKILL.md). Halaman ini menjelaskan mengapa gate itu ada dan keputusan apa yang ditetapkannya.

## Yang ditetapkan proposal

Proposal menetapkan, untuk setiap resource: pemilik data dan lifecycle-nya, scope tenant, legal entity, dan operating unit, rantai keamanan beserta kebijakan data, nomor, workflow dan pemisahan tugas, serta kontrak REST dan event. Pilihan material menunggu persetujuan pemilik produk sebelum kode atau migration ditulis.

Sesuatu yang baru dan tidak punya tempat di tabel Susunan repo `AGENTS.md` adalah pertanyaan untuk pemilik produk sebelum dibuat.

## Pemilik kode: Core atau module

Untuk setiap **master**, proposal menjawab lebih dulu: milik Core atau milik module. Master lahir di `src/foundation/` bila ia dipakai, atau pasti akan dipakai, lebih dari satu module; bila ia identitas party atau legal entity; atau bila padanannya di Business Central atau Dynamics 365 hidup di lapis bersama. Pelanggan yang membeli satu module tidak boleh dipaksa membeli module lain demi master itu. Aturannya di skill `operations-metta-architecture`, bagian Shared master and layer decision gate.

Pemilik kode tidak menentukan scope data. Master di Foundation tetap boleh menyimpan pemakaian per legal entity.

## Scope diputuskan per resource

Satu module dapat punya identitas bersama, konfigurasi per legal entity, transaksi milik legal entity, dan detail yang mengikuti dokumen induk. Karena itu pertanyaan scope diajukan untuk setiap resource, bukan sekali untuk seluruh module.

| Pertanyaan sebelum implementasi | Keputusan yang dicatat |
| --- | --- |
| Apakah identitas atau definisi ini dipakai bersama, dimiliki legal entity, dimiliki unit, atau mengikuti dokumen induk? | Pemilik data dan tabel atau relasi induknya |
| Apakah ada konsekuensi akuntansi, pajak, kontrak, ledger, atau pelaporan resmi? | Legal entity yang bertanggung jawab; unit dapat menjadi pembatas tambahan |
| Saat pengguna berhak atas A dan B tetapi bekerja di A, apakah daftar dan tindakan terbatas pada A? | Konteks baca dan tulis biasa, terpisah dari hak akses |
| Apakah unit penanggung jawab dan turunannya perlu membatasi akses? | Kebijakan data, field bisnis, hierarchy, dan aturan penggabungan batas |
| Apakah laporan, analitik, integrasi, atau proses latar perlu lintas legal entity? | Jalur yang diizinkan dan sumber konteks legal entity tepercaya |
| Memakai rekomendasi F&O atau desain lain? | Pilihan, alasan, dampak pada relasi dan nomor, dan keputusan yang masih terbuka |

Rekomendasi awal mengikuti F&O: resource milik legal entity bekerja pada legal entity aktif, resource bersama tetap bersama, dan proses lintas legal entity dinyatakan eksplisit. Ini rekomendasi desain, **bukan klaim bahwa runtime sudah menerapkannya untuk setiap resource**. Periksa `Workspace` di `src/platform/access/` sebelum menyatakan proposal ditegakkan.

Legal entity dan operating unit tidak selalu saling menggantikan. Transaksi dapat dimiliki legal entity sekaligus dibatasi unit penanggung jawab. Detail dan baris dokumen mengikuti batas induknya; ketiadaan kolom legal entity pada detail tidak menjadikannya data bersama. Unit aktif juga tidak otomatis menyaring semua resource operasional.

Hak akses, konteks kerja, dan kepemilikan dicatat terpisah. Memilih legal entity tidak menambah izin, dan batas seluruh organisasi tidak otomatis berarti layar bekerja lintas legal entity. Baris `app_data_policies` menyatakan dimensi akses, bukan deklarasi bahwa query otomatis dibatasi legal entity aktif.

Uji keputusan dengan pengguna yang berhak atas A dan B saat bekerja di A lalu di B. Jalur yang relevan mengikuti keputusan yang sama, misalnya daftar, pencarian, detail, simpan, hapus, posting, relasi detail, pengulangan dengan idempotency key, laporan, ekspor, dan proses latar. Data bersama tetap tersedia, tenant lain tetap tertutup, pasangan legal entity dan unit yang tidak diizinkan ditolak, dan scope nomor sesuai indeks unik dokumen. Proses latar membawa legal entity dokumen atau permintaan yang tersimpan; ia tidak mengambil pilihan peramban yang mungkin sudah berubah.

Dasar Microsoft: [perilaku company dan cross-company](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/cross-company-behavior), [pemodelan organisasi](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/plan-organizational-hierarchy), dan [kebijakan keamanan data XDS](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/extensible-data-security-policies).

## Keputusan lain pada proposal

**Keamanan** berarti rantai lengkapnya: entry point yang dilindungi, permission beserta access level-nya, privilege sebagai satuan tugas, duty sebagai bagian proses bisnis, ditambah bentuk role yang masuk akal disusun tenant. Rantainya ditulis di migration module sebagai baris terpisah per lapis. Aturan dan checklist-nya di [Rantai keamanan modul transaksi](19-transaction-security-chain.md), dan dilewati **sebelum** module dibangun.

**Nomor** hanya untuk dokumen transaksi dan master utama yang dicari orang lewat kodenya. Master setup kecil tidak memakai number sequence. Aturannya di bagian Kode dan nomor dokumen `AGENTS.md` dan skill `number-sequence-design`.

**Workflow** hanya untuk persetujuan, pengecualian, keputusan berisiko atau tidak dapat dibatalkan, atau serah terima terkendali. **Pemisahan tugas** hanya bila pengaju tidak boleh sekaligus memverifikasi atau menyetujui. **Event** hanya untuk fakta setelah commit yang dipakai module lain atau sistem di luar runtime.

## Sesudah disetujui

Keputusan yang disetujui dicatat di `modules/<module>/README.md` module pemiliknya dan di kontraknya. Hanya keputusan yang disetujui yang diimplementasikan. Gate dijalankan ulang ketika muncul lifecycle dokumen baru atau pemakai baru di luar runtime.

## Lihat juga

- [Rantai keamanan modul transaksi](19-transaction-security-chain.md)
- [Identity dan access](09-identity-and-access.md)
- [Kebutuhan khusus pelanggan](05-customization-and-addons.md)
