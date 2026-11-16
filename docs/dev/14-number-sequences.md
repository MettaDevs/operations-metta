# Number sequences

Number sequence adalah layanan Core yang menerbitkan nomor dokumen dan kode master untuk Core maupun module. Kodenya di `src/foundation/number-sequence/`, dan `index.ts` di folder itu satu-satunya pintu yang boleh di-import. Pemanggil tidak pernah membaca atau menulis tabel sequence sendiri.

Sejak 10 November 2026 bentuknya mengikuti [number sequence F&O](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/number-sequence-overview): satu reference boleh punya banyak sequence dalam satu tenant, satu per nilai scope. Kapan sebuah record memang perlu nomor diatur `AGENTS.md`, bagian *Kode dan nomor dokumen*. Desain reference baru, yaitu scope, format, continuous, dan reset, mengikuti skill `number-sequence-design` di `.agents/skills/number-sequence-design/SKILL.md`.

## Pemilik kebenaran

| Data | Pemilik | Tempat |
| --- | --- | --- |
| Reference: kode, judul, scope yang diizinkan, setelan bawaan | Core atau module pemilik nomor | Baris `app_number_sequence_references`, ditulis migration pemiliknya |
| Sequence tenant: scope dan nilainya, format, rentang, status, mode | Admin tenant | `tenant_number_sequences`, diatur di layar **Nomor dokumen** |
| Penghitung, blok, pool, pesanan, catatan terbit, audit | Core | `number_sequence_counters`, `number_sequence_allocations`, `number_sequence_continuous_pool`, `number_sequence_reservations`, `number_sequence_reusable_numbers`, `number_sequence_issues`, `number_sequence_audit_events` |
| Kalender fiskal | Legal entity | `legal_entities.fiscal_calendar_id`, lihat [kalender fiskal](15-fiscal-calendars.md) |
| Dokumen yang memakai nomor | Pemanggil | Tabel dokumen pemanggil |

Semua tabel di atas ada di database tenant. Tidak ada penghitung atau rentang nomor yang disimpan di memori proses, karena beberapa proses Bun dan beberapa instance melayani tenant yang sama.

## Reference didaftarkan lewat migration

Core dan module menulis reference-nya sebagai baris `app_number_sequence_references` di migration miliknya sendiri, misalnya `database/migrations/0025_purchase_receipt.sql` untuk nomor penerimaan barang dan `modules/healthcare/database/migrations/0001_patient.sql` untuk nomor rekam medis. Tidak ada manifest `app.yaml`. Kode reference diawali id pemiliknya, misalnya `core.`, `healthcare.`, atau `pharmacy.`.

Kolom yang menentukan perilaku:

| Kolom | Arti |
| --- | --- |
| `allowed_scopes` | Jenis scope yang boleh dipilih admin untuk reference ini |
| `default_settings` | Setelan awal sequence: rentang, segmen format, dan segmen `context` yang boleh dipakai |
| `default_per_legal_entity` | Setiap legal entity mendapat satu sequence berscope legal entity saat dibuat. Kolomnya lahir di migration `0014_legal_entity_number_sequences.sql` |
| `default_per_operating_unit` | Setiap operating unit mendapat satu sequence berscope operating unit saat dibuat. Kolomnya lahir di migration `0012_unit_number_sequences.sql` |
| `numbers_unique_per_scope` | Indeks unik dokumen reference ini memuat nilai scope-nya, jadi format yang sama di organisasi lain tidak membuat nomor kembar |

Sequence bawaan per organisasi dibuat `registerOrganizationDefaults` di `organization-defaults.ts`. Fungsi itu mendengarkan `onOrganizationCreated` dari `src/platform/organization/`. Proses yang membuat organisasi atau memasang module memanggilnya sekali saat mulai. `installModule` menjalankannya ulang untuk organisasi yang sudah ada sebelum module dipasang. Sequence bawaan hanya dibuat untuk reference milik Core atau milik module yang entitlement-nya aktif untuk tenant itu, dan reference yang sudah punya sequence untuk organisasi itu dilewati.

Reference yang tidak meminta sequence bawaan baru bisa dipakai setelah admin membuat sequence-nya di layar.

## Satu sequence per nilai scope

`tenant_number_sequences.scope_type` bernilai salah satu jenis scope di `scopeTypes`, yang ditulis di `number-sequence.schema.ts`. Padanannya di F&O:

| `scope_type` | Padanan F&O | Kolom nilai yang terisi |
| --- | --- | --- |
| `tenant` | Shared | tidak ada |
| `legal_entity` | Company / Legal entity | `legal_entity_id` |
| `operating_unit` | Operating unit | `operating_unit_id` |
| `legal_entity_fiscal_period` | Legal entity + Fiscal calendar period | `legal_entity_id`, `fiscal_period_id` |

Scope *Operating unit type* dari F&O sengaja belum ada di `number-sequence.schema.ts`.

Aturan yang dijaga database dan service:

- **Satu sequence aktif per reference per nilai scope.** Indeks unik parsial `tenant_number_sequences_aktif_per_scope` menjaganya, dan CHECK `tenant_number_sequences_nilai_scope` memastikan kolom nilai yang terisi cocok dengan `scope_type`.
- **Scope dan nilainya tetap sejak sequence dibuat.** Trigger `scope_is_fixed` menolak perubahannya. Mengubah kebijakan berarti membuat sequence baru lalu menghentikan yang lama.
- **Semua sequence aktif satu reference memakai jenis scope yang sama**, supaya satu dokumen tidak cocok dengan dua sequence. Reference ber-`numbers_unique_per_scope` dikecualikan, karena pemanggilnya selalu menyebut tepat satu nilai scope.
- **Format kembar yang dapat bertabrakan di dalam satu legal entity ditolak** saat sequence disimpan: format sama, tanpa segmen pembeda, dengan rentang yang beririsan.

Pemanggil mengirim legal entity, operating unit, dan tanggal milik dokumen. `NumberIssuer` memilih sequence aktif untuk nilai itu. Bila tidak ada, ia menolak dengan pesan yang menyebut organisasinya, dan tidak pernah pindah ke scope lain. Organisasi workspace pengguna yang sedang aktif tidak pernah dibaca, karena organisasi milik dokumen, bukan milik layar.

## Menerbitkan nomor

```ts
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';

const number = await new NumberIssuer(db, { tenantId, moduleId: 'pharmacy' }).issue({
    reference: 'pharmacy.dispensing-number',
    key: `dispensing:${billId}`,
    documentDate: '2026-11-16',
    legalEntityId,
    operatingUnitId,
});
```

Contoh pemanggil sungguhan ada di `modules/pharmacy/src/dispensing/dispensing/dispensing.service.ts` dan `src/foundation/purchasing/receipt/receipt.service.ts`.

- **Selalu di dalam transaksi dokumen.** `issue`, `reserve`, `confirm`, dan `cancel` melempar bila `db` tidak sedang di dalam transaksi. Dokumen gagal disimpan, nomornya ikut batal: penghitung, blok, pool, dan catatan terbit kembali seperti semula.
- **`key` wajib stabil.** Kunci idempoten yang sama selalu mendapat nomor yang sama. Kunci yang dibuat ulang setiap percobaan membakar satu nomor per retry.
- **`documentDate` menentukan periode fiskal**, bukan tanggal hari ini. Segmen `year` tetap tahun penerbitan, sama dengan CoreERP; tahun dokumen dikirim lewat segmen `context` bila perlu dicetak.
- **`values`** mengisi segmen `context`, misalnya kode yang diambil pemanggil dari record miliknya. Nilainya hanya huruf, angka, strip, atau underscore, dan setiap kombinasi nilai memisahkan penghitung.
- **`number`** membawa nomor yang diketik pengguna: nomor manual, atau nomor otomatis yang diubah ke lebih kecil atau lebih besar bila sequence mengizinkan. Izinnya `allow_lower_number` dan `allow_higher_number`, padanan *Allow user changes* F&O.

Kegagalan yang diketahui dijawab 422 dengan kode `number_sequence_failed` lewat `failSequence`. Kesalahan lain, misalnya koneksi database putus, tidak ditangkap dan tetap menjadi 5xx. Penerbitan berjalan di proses dan koneksi yang sama dengan dokumen, jadi tidak ada keadaan "layanan nomor tidak terjangkau" yang perlu dijawab 503.

## Jalur mengambil angka

| Jalur | Dipakai saat | Tabel | Sifat |
| --- | --- | --- | --- |
| Penghitung langsung | preallocation mati | `number_sequence_counters` | Satu kunci baris per penerbitan. Nomor yang dilepas pesanan dipakai lagi lebih dulu dari `number_sequence_reusable_numbers` |
| Blok preallocation | non-continuous, preallocation hidup | `number_sequence_allocations` | Satu blok diambil dari penghitung, nomor dibagikan dari blok |
| Pool continuous | continuous, preallocation hidup | `number_sequence_continuous_pool` | Satu baris per nomor, diklaim `FOR UPDATE SKIP LOCKED` |

**Urutan kunci: penghitung, lalu blok.** Setiap penerbit di jalur blok mengunci baris penghitung scope-nya lebih dulu, baru blok yang masih hidup. Urutan sebaliknya pernah menghasilkan deadlock `40P01` di CoreERP saat load test: penerbit yang mengantre di blok lalu mendapati blok habis tetap memegang blok itu sambil meminta penghitung, sementara pemegang penghitung menunggu blok yang sama. Kode baru yang mengunci lebih dari satu tabel penomoran mengikuti urutan yang sama.

Continuous boleh memakai preallocation karena pool-nya bukan cache. Setiap nomor adalah satu baris yang statusnya tercatat, jadi nomor yang tidak jadi dipakai kembali tersedia dan tidak ada yang hilang. Nomor yang sudah tercatat terbit dilewati dan ditandai terpakai.

## Continuous: pesan, tetapkan, batalkan

Sequence continuous yang perlu menampilkan nomor sebelum dokumen disimpan memakai `reserve`, lalu `confirm` di dalam transaksi dokumen, atau `cancel` bila dokumen tidak jadi disimpan.

- Pesanan bertenggat `reservationMinutes`, yaitu 15 menit. CHECK `number_sequence_reservations_dipesan_bertenggat` menolak pesanan `reserved` tanpa `expires_at`, karena kunci tanpa tenggat membuat macet.
- Pesanan yang lewat tenggat dilepas, misalnya sedikit demi sedikit setiap kali ada pesanan baru pada sequence itu, dan lewat **Manual cleanup** di layar, padanan tombol yang sama di F&O. Baris pesanan yang sedang dikunci transaksi dokumen dilewati, jadi nomor yang sedang di-confirm tidak pernah dilepas.
- Melepas pesanan yang lewat tenggat aman di sini karena confirm dan dokumen berada dalam satu transaksi. Pesanan yang lewat tenggat tanpa confirm berarti dokumennya tidak tersimpan.
- Pesanan yang sudah dibatalkan tidak pernah diputar ulang untuk kunci idempoten yang sama. Nomornya sudah kembali ke pool dan mungkin sudah milik dokumen lain, jadi pemanggil memakai kunci baru.
- Satu sequence menolak pesanan baru setelah 500 pesanan terbuka, dengan pesan yang menyebut sebabnya.
- Continuous tidak dapat digabung dengan nomor manual atau dengan *Allow user changes*. CHECK `tenant_number_sequences_izin_ubah_nomor` menjaganya.

## Periode reset dan kalender fiskal

`reset_period` menentukan bagaimana penghitung dipecah lewat `period_key`.

| `reset_period` | `period_key` | Segmen format yang wajib ada |
| --- | --- | --- |
| `never` | `all` | tidak ada |
| `calendar_year` | tahun penerbitan, misalnya `2026` | `year` |
| `fiscal_year` | `FY:<fiscal_year_id>` | `fiscal_year` |
| `fiscal_period` | `FP:<fiscal_year_id>:<ordinal>` | `fiscal_year` dan `fiscal_period` |

Reset tanpa segmen pembeda ditolak saat sequence disimpan. Indeks unik catatan terbit dibatasi per `period_key`, jadi bila format tidak berubah saat periode berganti, database tidak akan menangkap nomor dokumen yang berulang.

Kalender fiskal milik legal entity, jadi reset fiskal selalu butuh legal entity:

| Scope | Asal legal entity |
| --- | --- |
| `legal_entity` | dari sequence itu sendiri |
| `operating_unit` | wajib dikirim pemanggil sebagai `legalEntityId` |
| `tenant` | tidak ada, reset fiskal ditolak |
| `legal_entity_fiscal_period` | dari sequence; sequence ini sudah satu per periode, jadi `reset_period` harus `never` |

Di F&O kalender fiskal menggantung pada ledger, dan ledger hanya dimiliki legal entity. Operating unit sengaja dipakai lintas legal entity, jadi ia tidak bisa menyiratkan satu kalender. Karena itu, untuk scope operating unit dengan reset fiskal, legal entity ikut menjadi bagian `scope_key`, misalnya `operating_unit:<id>|legal_entity:<id>`. Satu unit yang dipakai dua legal entity punya dua aliran nomor. Aturan umumnya: apa pun yang memecah penghitung harus ada di `scope_key`, bukan hanya di `period_key`.

Tanggal dokumen di luar periode fiskal yang terdefinisi ditolak, bukan diam-diam memakai kalender lain.

## Format

Segmen format didefinisikan `segmentSchema` di `number-sequence.schema.ts`:

| Segmen | Isi |
| --- | --- |
| `constant` | Teks tetap. Awalan nomor ditulis sebagai segmen ini, misalnya `PNR-` |
| `number` | Angka berpadded selebar `length`. `mask` opsional mencetak digit lewat pola `#`, misalnya `##.##.##`, seperti segmen Alphanumeric F&O |
| `context` | Nilai dari pemanggil lewat `values`. Hanya segmen `context` yang dinyatakan `default_settings` reference yang boleh dipakai |
| `year` | Tahun penerbitan |
| `scope` | `legal_entities.company_code`, atau `operating_units.number` untuk sequence per unit. Id internal tidak pernah dicetak; unit tanpa nomor ditolak bila formatnya memuat segmen ini |
| `fiscal_year`, `fiscal_period` | Nama tahun fiskal dan nomor urut periode |

Segmen alfabet yang bertambah, yaitu `&` di F&O, tidak didukung. Nomor yang melampaui lebar segmennya ditolak, bukan melebar diam-diam.

## Layar Nomor dokumen

**Sys Admin › Nomor dokumen** adalah padanan halaman *Number sequences* F&O. URL layarnya `/sysadmin/number-sequences`, ditulis di `number-sequences.page.tsx`. Endpoint datanya di bawah `/api/v1/number-sequences`, ditulis di `number-sequence.routes.ts`. Hak layar memakai rantai keamanan Core dari migration `0011_number_sequence_access.sql`: permission `core.number-sequence.read` dan `core.number-sequence.update`, duty *Lihat nomor dokumen* dan *Kelola nomor dokumen*. Role pemilik tenant mendapat duty kelola.

- Daftar menampilkan Smallest, Largest, Next, dan Format, dengan saringan area, reference, scope, dan status.
- Kartu mengikuti urutan F&O: Identification, Scope, Segments beserta Format hasilnya, sequence lain untuk reference yang sama, General, dan Performance. Scope hanya diisi saat membuat.
- Continuous, Manual, In use/Stopped, Smallest/Largest, Reset every, Allow user changes, dan Preallocation boleh diubah kapan saja. Format terkunci begitu nomor pertama terbit.
- **Next** hanya boleh naik. Menurunkannya dapat menerbitkan ulang nomor yang sudah terpakai.
- **Status list** menampilkan nomor yang sedang dipesan dan belum dipakai dokumen. **Manual cleanup** melepas yang sudah lewat tenggat.

Setiap perubahan pengaturan dan setiap penerbitan tercatat di `number_sequence_audit_events`.

## Nomor sama dengan indeks dokumen

Keberhasilan `issue` belum membuktikan dokumen bisa disimpan. Telusuri setiap reference dari scope sequence, nilai yang dikirim pemanggil, kolom dokumen, sampai indeks unik dokumennya.

- Penghitung per legal entity berjalan sendiri untuk setiap legal entity, walaupun kodenya tidak dicetak. Indeks dokumennya karena itu menjaga `(tenant_id, legal_entity_id, kode)`, bukan hanya `(tenant_id, kode)`.
- Bila beberapa reference berbagi satu tabel, kolom jenis dokumen ikut masuk indeks.
- Dokumen yang dapat dihapus lunak memakai indeks parsial `WHERE deleted_at IS NULL`. Indeks parsial bukan izin menerbitkan ulang nomor yang pernah terbit; idempotensi penerbit tetap menjaga riwayatnya.
- Bentrokan tidak diatasi dengan menaikkan penghitung organisasi lain, mencari `MAX(kode)`, atau mengubah format yang sudah dipakai.

Kegagalan ini pernah terjadi di CoreERP pada 6 Oktober 2026: sequence aset per legal entity sementara beberapa indeks lama masih se-tenant, dan helper test memaksa semua reference ke scope `tenant`, sehingga keadaan runtime tidak pernah direproduksi.

## Test

Test penerbit ada di `test/foundation/number-sequence/number-sequence.test.ts` dan berjalan di PostgreSQL sungguhan. Test itu dilewati bila `DB_HOST` kosong. PostgreSQL wajib di sini: tanpa database sungguhan, `FOR UPDATE` dan `SKIP LOCKED` tidak membuktikan apa pun. Bantuan fixture organisasi, kalender fiskal, dan sequence ada di `test/support/number-sequence-fixtures.ts`.

Yang dibuktikan antara lain: nomor tidak terbit bila dokumen gagal disimpan, dua dokumen paralel di koneksi berbeda tidak pernah berbagi nomor, sequence dipilih dari scope dan tanggal dokumen, scope tidak dapat diubah, format kembar ditolak, dan pesanan continuous yang ditinggalkan dilepas.

Fixture membuat organisasi sungguhan dan memakai scope yang dinyatakan reference. Jangan memaksa semua reference ke `tenant` demi test yang lebih sederhana; itulah titik buta yang menyembunyikan kegagalan 6 Oktober. Test cakupan reference-ke-indeks dokumen, seperti `NumberSequenceScopeTest` di module aset CoreERP, belum ada di repo ini.

Penomoran dokumen termasuk alur yang wajib dibuktikan harness kesetaraan sebelum dianggap pindah. Aturannya di `AGENTS.md`, bagian *Kapan sebuah alur dianggap pindah*.

## Lihat juga

- [Kalender fiskal](15-fiscal-calendars.md): periode yang dipakai reset fiskal dan scope per periode fiskal
- [Gate penemuan dan keputusan](18-module-discovery-and-decision-gate.md): kapan sebuah record memang perlu nomor
- Desain lama CoreERP, termasuk API internal dan rekonsiliasi untuk app di luar runtime yang tidak dipindah: [`docs/dev/14-number-sequences.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/14-number-sequences.md)
