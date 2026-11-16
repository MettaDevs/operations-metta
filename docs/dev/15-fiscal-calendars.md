# Kalender fiskal

> **Status di repo ini:** sebagian. Tabelnya ada, dan [number sequence](14-number-sequences.md) membacanya. Layanan yang menulisnya, layar pengelolanya, dan isian kalender pada legal entity belum dipindah. Acuan perilaku: [`docs/dev/15-fiscal-calendars.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/15-fiscal-calendars.md) dan `FiscalCalendarService` di repo CoreERP.

Kalender fiskal menentukan bagaimana sebuah legal entity membagi waktunya untuk akuntansi. Ia bukan tahun kalender, dan bukan properti tenant.

Jangan tertukar dengan hal lain yang juga bernama kalender atau periode di repo ini, misalnya:

- **Kalender kerja** di `src/foundation/calendar/` menyimpan jam buka dan hari libur, misalnya untuk jadwal praktik. Tabelnya `working_time_*`, dari migration `0021_calendars.sql`.
- **Periode persediaan** di `src/foundation/inventory/inventory-period/` menutup kartu gudang sampai tanggal tertentu, padanan Inventory Period di Business Central. Tabelnya `gd_m_periode_persediaan`, dari migration `0031_inventory_period.sql`.

## Pemilik kebenaran

Legal entity memegang konsekuensi legal, ledger, pajak, dan kalender fiskal. Karena itu kolom `legal_entities.fiscal_calendar_id` yang menunjuk kalender, bukan tenant dan bukan operating unit.

Kalender sendiri dipakai bersama di dalam satu tenant. Beberapa legal entity dengan tahun buku yang sama boleh menunjuk kalender yang sama. Bentuk ini mengikuti Dynamics 365 F&O, tempat fiscal calendar adalah data bersama dan legal entity memilih salah satunya.

## Bentuk data

Tabel-tabelnya berasal dari skema CoreERP di `database/migrations/0001_coreerp_baseline.sql`, dengan id `uuid` sesudah `0002_ids_to_uuid.sql`.

| Tabel | Isi | Keunikan |
| --- | --- | --- |
| `fiscal_calendars` | Kalender milik tenant | `(tenant_id, code)` |
| `fiscal_years` | Tahun fiskal dengan `starts_on` dan `ends_on` | `(fiscal_calendar_id, name)` |
| `fiscal_periods` | Periode berurutan di dalam satu tahun fiskal | `(fiscal_year_id, ordinal)` |

Tahun fiskal tidak harus dimulai Januari. Nama tahun bebas, jadi tahun buku Juli 2026 sampai Juni 2027 boleh bernama `FY2027`. Nama tahun hanya unik per kalender, bukan per tenant. Karena itu `period_key` number sequence memakai id tahun fiskal, bukan namanya.

## Invarian yang wajib dijaga penulisnya

Invarian ini butuh perbandingan rentang tanggal, dan skema tidak menjaganya. Di CoreERP `FiscalCalendarService` yang menegakkannya. Penulis kalender fiskal di repo ini kelak wajib menegakkan hal yang sama, dan setiap penulisan wajib lewat penulis itu:

1. Tahun fiskal dalam satu kalender tidak saling tumpang tindih.
2. Periode berurutan, tanpa celah dan tanpa tumpang tindih.
3. Periode menutup seluruh rentang tahun fiskalnya.
4. Periode berada di dalam rentang tahun fiskalnya.

Tempatnya kelak `src/foundation/<layanan>/` sesuai tabel *Susunan repo* di `AGENTS.md`. Nama foldernya belum diputuskan.

## Resolusi tanggal ke periode

Pembacanya saat ini number sequence, antara lain `NumberIssuer` di `src/foundation/number-sequence/number-sequence.issuer.ts`. Ia mencari tahun dan periode fiskal untuk tanggal dokumen lewat `legal_entities.fiscal_calendar_id`. Bila legal entity belum punya kalender, atau tanggal berada di luar semua periode yang terdefinisi, penerbitan ditolak dengan pesan "Kalender fiskal belum tersedia untuk tanggal dokumen ...". Diam-diam jatuh ke tahun kalender akan menghasilkan angka akuntansi yang salah, jadi kegagalan itu disengaja.

Number sequence memakai resolusi ini untuk `reset_period` `fiscal_year` dan `fiscal_period`, untuk segmen format `fiscal_year` dan `fiscal_period`, dan untuk scope `legal_entity_fiscal_period`. Rinciannya, termasuk kenapa scope operating unit wajib menyebut legal entity, ada di [number sequence](14-number-sequences.md).

## Akibat yang perlu diketahui sekarang

Belum ada jalur di aplikasi yang membuat kalender fiskal atau mengisi `legal_entities.fiscal_calendar_id`. Pada lingkungan baru, reset fiskal dan scope per periode fiskal karena itu belum dapat dipakai sampai penulisnya dipindah. Test mengisi tabelnya langsung lewat `test/support/number-sequence-fixtures.ts`.

## Yang belum ada, juga di CoreERP

- Status buka dan tutup periode. Menutup periode akuntansi adalah urusan ledger, bukan kalender. Di F&O status itu disimpan per ledger di atas kalender bersama.
- Mengubah atau menghapus tahun fiskal setelah dibuat. Ini disengaja selama belum ada aturan untuk nomor yang sudah terbit di periode itu.

## Lihat juga

- [Number sequence](14-number-sequences.md): konsumen periode fiskal
- [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md): legal entity sebagai pemilik kalender
