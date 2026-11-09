# Alur data

Alur sisi tulis: simpan agregat, nomor dokumen, penghapusan lunak, event, posting finance, workflow, siklus module, lampiran, dan jejak perubahan. Tabel, kolom, index, constraint, dan trigger tetap 1:1; contoh memakai penerimaan aset karena itu jalur tulis paling lengkap hari ini.

## 1. Simpan agregat (header + rincian)

### Buat (`POST`)

1. Izin create resource wajib (403). `tenant_id` hanya dari konteks.
2. Bentuk permintaan: multipart dengan field `payload` (JSON) dan `attachments[]`. Header `Idempotency-Key` wajib: maksimal 143 karakter, pola `[A-Za-z0-9._:-]`.
3. Kunci itu dicari di `creation_key` (termasuk record terarsip). Sudah ada → jawab 200, header `Idempotent-Replayed: true`, record lama.
4. Validasi header dan setiap baris: minimal satu baris; jumlah 1–500 per baris; master milik tenant dan belum terarsip; presisi desimal mengikuti mata uang; aturan per jenis. Kunci error baris berbentuk `details.<i>.<kolom>`.
5. `legal_entity_id` harus perusahaan aktif (422); unit harus dalam hibah kebijakan (403); vendor harus milik perusahaan itu.
6. Validasi lampiran (§8); bila ada berkas, izin ubah juga wajib.
7. Terbitkan nomor (§2).
8. Satu transaksi: kunci dokumen sumber yang ditautkan (`FOR UPDATE`, urut `id`) dan periksa tautannya → `INSERT` header (status `draft`, `version` 1) → `INSERT` baris (`line_number` = urutan) → simpan lampiran.
9. Bentrok unik pada `creation_key` → jawab sebagai replay (langkah 3).
10. Berhasil → baca ulang header (dengan nama lookup) dan baris → 201 + `Location`; body memuat `version`.

### Ubah (`PATCH`)

1. Hanya untuk status `draft`. Versi wajib lewat `If-Match: W/"n"` atau field `version` → tanpa versi 428 `version_required`.
2. Satu transaksi: klaim versi `UPDATE … SET version = n WHERE id = ? AND version = n` → 0 baris berarti 409 `stale_version` → `UPDATE` header `WHERE status = 'draft'` → ganti baris rincian → tambah lampiran.
3. Jawab detail lengkap + `ETag`.

### Selesaikan

Satu transaksi: kunci dokumen sumber dan klaim versi → `UPDATE` status `draft` → `selesai` secara bersyarat → terbitkan kode aset → buat aset per unit dengan `creation_key` = `penerimaan:<id>:<baris>:<urut>` → teruskan lampiran → terbitkan posting finance (§5). Gagal di langkah mana pun membatalkan semuanya.

**Tabel contoh**: `aset_tr_penerimaan_aset` (unik `(tenant_id, id)`, `(tenant_id, creation_key)`; `aset_tr_penerimaan_kode_unique` `(tenant_id, legal_entity_id, kode) WHERE deleted_at IS NULL`), `aset_tr_penerimaan_aset_details` (unik `aset_tr_penerimaan_line_uq`; FK gabungan `(tenant_id, x) → (tenant_id, id)` RESTRICT). Selesaikan juga menulis `aset_tr_aset`, `aset_tr_penempatan_aset`, `aset_tr_buku_aset`, `aset_tr_aset_atribut`.

**Gagal**: 403; 422 `{message, errors: {path: [pesan]}}`; 422 `{error: {code: "number_sequence_failed"}}`; 428 `version_required`; 409 `stale_version`; 404; 500 `posting_failed`.

## 2. Nomor dokumen

1. Ambil `tenant_number_sequences` yang aktif (`FOR SHARE`). Tidak ada → 422.
2. Sudah ada issue dengan `(sequence_id, app_id, idempotency_key)` yang sama → kembalikan nomor itu.
3. Manual hanya bila `allow_manual` dan urutan non-continuous; otomatis ditolak bila `allow_automatic = false`.
4. Kunci cakupan: `scope_key` = `tenant:<t>` | `legal_entity:<org>` | `operating_unit:<org>[|legal_entity:<le>]`, plus `|values:<sha256>` bila ada segmen konteks; `period_key` = `all` | `YYYY` | `FY:<year_id>` | `FP:<year_id>:<ordinal>`.
5. Kunci counter (`FOR UPDATE`), lalu blok alokasi yang masih hidup. Tidak ada blok → hapus blok yang habis, buat blok baru sebesar `preallocation_quantity`, majukan counter. Nilai yang hasil formatnya sudah terpakai dilewati.
6. Format dari segmen (constant, number, year, scope = kode perusahaan, tahun fiskal, periode fiskal, konteks). Melebihi panjang segmen atau `maximum_number` → 422.
7. `INSERT` issue + `number_sequence_audit_events`. Bentrok unik → replay; dicoba paling banyak 3 kali.

**Kapan nomor diambil**: penerbit nomor memakai transaksinya sendiri, yang menjadi savepoint bila dipanggil di dalam transaksi pemanggil.

- Simpan penerimaan: nomor diterbitkan setelah seluruh validasi dan **sebelum** transaksi dokumen, dengan commit terpisah. Alasannya: permintaan yang ditolak tidak membakar counter, dan kegagalan penomoran tidak menahan koneksi. Akibatnya nomor bisa bolong bila transaksi dokumen gagal.
- Selesaikan, dokumen siklus aset beserta pengajuan workflow, dan master: nomor diterbitkan **di dalam** transaksi dokumen; kunci counter dipegang sampai dokumen commit, sehingga penerbitan per cakupan mengantre.

**Bawaan**: profil `non-continuous-default`, prealokasi 20, minimum 1, maksimum 19999, prefix + 5 digit, lalu ditimpa setelan bawaan manifest. Reset: never, calendar_year, fiscal_year, fiscal_period (format wajib punya segmen pembeda periode). Setelan struktural terkunci setelah nomor pertama terbit; counter hanya boleh dimajukan. Mode continuous (reservasi 15 menit lalu confirm/cancel, pool dengan `SKIP LOCKED`) tersedia tetapi belum dipakai module aset.

**Tabel**: `tenant_number_sequences`, `app_number_sequence_references`, `number_sequence_counters`, `number_sequence_allocations` (index parsial `number_sequence_allocations_live`), `number_sequence_issues` (unik `(sequence_id, app_id, idempotency_key)` dan `(sequence_id, scope_key, period_key, numeric_value)`; `number_sequence_issues_formatted_unique`, `number_sequence_issues_value_unique`), `number_sequence_audit_events`.

## 3. Penghapusan lunak

1. Dokumen: izin arsip, status harus `draft`, versi wajib → satu transaksi: klaim versi → `UPDATE … SET deleted_at = now() WHERE status = 'draft'` → 204. Baris anak, lampiran, dan nomor tidak disentuh.
2. Master: masih punya anak yang belum diarsip → 409 `referenced_by_children`, klaim versi ikut batal.
3. Semua bacaan menyaring `deleted_at IS NULL` di lapisan model; record terarsip menjawab 404. Pencarian replay idempoten tetap menembus arsip.
4. Index unik kode bisnis bersifat parsial `WHERE deleted_at IS NULL`; identitas teknis (`id`, `creation_key`) unik penuh. Contoh: `aset_tr_penerimaan_kode_unique`, `aset_tr_aset_kode_unique`, `m_lokasi_aset_tenant_id_kode_unique`, `m_mnt_tpl_line_number_uq_active`.
5. Mencabut module tidak menyentuh data.

## 4. Event dan pengiriman keluar

Nama event `module.aggregate.action.vN`; versi yang sudah terbit tidak diubah di tempat (tambah/hapus field wajib = `vN+1`). Saat ini Core menerbitkan `core.workflow.decision.v2` dan `core.tenant.provisioned.v1`; module belum menerbitkan event.

1. Di dalam transaksi yang mencatat fakta: `INSERT outbox_events`.
2. Event yang sama (eventId = id outbox) diantar sinkron ke penerima module di proses yang sama, dengan tenant terikat. Penerima yang gagal membatalkan transaksi faktanya. Pengecualian: `tenant.provisioned` diantar setelah commit pendaftaran, per module yang terpasang.
3. Pengirim keluar berjalan tiap menit di satu server: ambil paling banyak 100 baris `published_at IS NULL`. Tujuan berasal dari konfigurasi (`type`, `url`, `module`); tujuan yang module-nya sudah ada di proses dilewati.
4. Body: `{id, type, occurred_at, tenant_id, correlation_id, legal_entity_id (dibuang bila null), data}`. Header `X-CoreERP-Event-Timestamp` dan `X-CoreERP-Event-Signature` = HMAC-SHA256 hex atas `<timestamp>.<raw body>`. Timeout 2 detik koneksi, 5 detik total.
5. Semua tujuan menjawab 2xx → `published_at` diisi. Gagal → diambil lagi menit berikutnya ke semua tujuan tipe itu.
6. Baris tanpa `correlation_id` ditahan. Lingkungan tanpa izin keluar menandai baris terbit tanpa mengirim.
7. Penerima idempoten: kunci dokumen terkait → `INSERT … ON CONFLICT DO NOTHING` ke tabel event yang sudah diproses (contoh `aset_processed_core_events`, unik `(tenant_id, event_id)`) → 0 baris tersisip berarti sudah diproses, berhenti.

Pengiriman di proses yang sama mengubah **waktu** event (sebelum commit), bukan hanya jalurnya; stack baru yang memindahkannya ke luar proses harus menjaga urutan dan atomisitas yang sama.

**Tabel**: `outbox_events` (`id`, `tenant_id`, `correlation_id`, `legal_entity_id`, `type`, `payload`, `occurred_at`, `published_at`; index `outbox_event_correlation_index`).

## 5. Feed posting finance

1. Module menerbitkan posting **di dalam** transaksi dokumen; dipanggil tanpa transaksi → galat. `posting_id` contoh: `AST-ACQ-<id>`, `AST-OPB-<id>`.
2. `posting_id` sudah ada: `input_hash` sama → kembalikan posting lama; berbeda → ditolak.
3. Bentuk tidak sah (kurang dari dua baris, tidak seimbang, presisi salah) → 500 dan dokumen ikut batal.
4. Status awal, berurutan: asal rejected/manual/held diwarisi → feed mati → `manual(feed_disabled)` → sebelum cutover → `manual(before_cutover)` → ada masalah akun → `held` → selain itu `pending`.
5. Pull: `GET internal/v1/finance-postings` hanya menyajikan `pending` (jurnal balik setelah asalnya `posted`), urut `posting_date`, `published_at`, `id`, limit maksimal 500 dengan `has_more`. Posting disajikan ulang sampai menerima ack; `served_count` naik setiap pull.
6. Ack: `POST …/{posting_id}/ack`. `posted` wajib `external_reference`; `rejected` wajib `reason_code` + `reason`. Ack sama diulang → tanpa perubahan; ack bertentangan → 409. `rejected` mengubah jurnal balik turunannya menjadi `manual`.
7. Push (bila klien memilih push): tiap menit, ditandatangani signing secret per klien. 2xx → delivered; 408/429/5xx → dicoba lagi dengan jeda 1, 2, 4, … sampai 60 menit, selama 24 jam, lalu failed; 4xx lain → langsung failed.

**Tabel**: `finance_postings` (status `held|pending|posted|rejected|manual`, `manual_reason`, `hold_reasons`, `payload`, `input`, `input_hash`, `external_reference`, `reason_code`, `acknowledged_at`, `served_count`, `last_served_at`; unik `(tenant_id, posting_id)`; constraint `finance_postings_status_check`, `finance_postings_balanced_check`, `finance_postings_manual_reason_check`, `finance_postings_posted_reference_check`, `finance_postings_rejected_reason_check`), `finance_posting_lines`, `finance_posting_deliveries` (`attempts`, `next_attempt_at`), `finance_posting_events`, `integration_clients` (`delivery_mode`, `push_url`, `signing_secret`, `posting_type_prefixes`).

## 6. Workflow persetujuan

1. Module mengajukan di dalam transaksi dokumen: tipe terdaftar untuk app; `legal_entity_id` wajib bila tipe per perusahaan; pengaju anggota aktif; field wajib `decision_context` lengkap; kunci idempoten sama → instance lama.
2. `INSERT` instance `pending`, lalu telusuri graf: kondisi memilih cabang; langkah persetujuan membuat work item bagi penerima (anggota atau peran) yang berizin dan dalam lingkup unit, tanpa pengaju bila tenant melarangnya; tanpa penerima → instance langsung `rejected`.
3. Keputusan: kunci instance lalu work item. Kebijakan `single`, `all`, `majority`, `percentage`; selain `all`, work item tersisa dibatalkan.
4. Status final dicatat sekali (`decision_event_emitted`), lalu outbox dan event di proses (§4). Module dapat menarik pengajuan → `cancelled`.

**Tabel**: `workflow_types` (scope, `decision_context_schema`), `workflow_configurations`, `workflow_configuration_versions` (status, `effective_from`), `workflow_elements`, `workflow_transitions`, `workflow_instances` (status, `correlation_id`, `idempotency_key`), `workflow_work_items` (`assigned_membership_id`), `workflow_history`.

## 7. Siklus module

1. **Katalog**: registrasi manifest dalam satu transaksi (Alur permintaan §3), plus referensi nomor, `workflow_types`, dan `app_data_policies`. Sesudah commit: urutan nomor dibuat dan duty role Owner disinkronkan.
2. **Entitlement**: `tenant_app_entitlements` (status, `starts_at`, `ends_at`). Berhak belum berarti terpasang.
3. **Pasang** per lingkungan: module yang menjadi dependensi harus sudah terpasang → migration yang belum jalan dijalankan dengan advisory lock, riwayat di `core_module_migrations` (unik `(module_id, migration)`), log perubahan dimatikan selama migration → `UPSERT core_module_installations` = `installed` → urutan nomor dibuat → data awal hanya bila `seeded_at` kosong.
4. **Nonaktifkan** → `disabled`. **Cabut** → `uninstalled`, ditolak bila module lain bergantung. Data tidak disentuh.
5. Layar yang berlabel "terpasang" membaca `core_module_installations`, tidak menyimpulkannya dari entitlement.
6. **Data acuan** untuk tenant yang sudah memasang dikirim lewat migration data, bukan data awal. Data awal hanya sekali seumur pemasangan (`seeded_at`), supaya mengaktifkan ulang tidak menggandakan master bawaan.

**Tabel**: `core_module_installations` (PK `(tenant_id, module_id)`; `core_module_installations_status_check`; `seeded_at`, `installed_at`, `disabled_at`, `uninstalled_at`), `core_module_migrations`.

## 8. Lampiran

1. Batas dibaca dari server: 10240 KB per berkas, 10 berkas, total 10240 KB; jenis pdf, jpg, jpeg, png, docx, xlsx, diperiksa dari ekstensi dan isinya.
2. Berkas ikut permintaan Simpan dan divalidasi sebelum nomor terbit.
3. Di dalam transaksi: hitung SHA-256 → tulis objek `attachments/<tenant>/<ulid>` ke penyimpanan objek → daftarkan penghapusan objek bila transaksi rollback → `INSERT` baris.
4. Saat dokumen diselesaikan, baris lampiran disalin ke setiap record hasil dengan `storage_path` yang sama (isi berkas tidak digandakan); lampiran per baris rincian hanya ikut ke record dari baris itu.
5. Unduh memeriksa ulang hash. Delete lampiran mengisi `deleted_at`; objeknya tetap.

**Tabel**: `document_attachments` (`record_type`, `record_id`, `line_number`, `kind`, `storage_path`, `content_hash`, `size_bytes`, `deleted_at`; `document_attachments_kind_check`).

## 9. Jejak perubahan dan trigger database

Bagian ini hidup di database, jadi berlaku sama di stack apa pun, **asal** stack menyiapkan variabel sesi yang dibacanya.

1. **Pelaku**: trigger `stamp_audit_actor` mengisi `created_by_user_id` dan `updated_by_user_id` dari `current_setting('coreerp.user_id', true)`.
2. **Versi baris**: trigger `bump_row_version` menaikkan `version`.
3. **Log perubahan**: trigger `log_change` membaca `current_setting('coreerp.change_log', true)` (`off` mematikan, misalnya saat migration). Mode none/some/all per operasi dari setelan tenant atau bawaan (`tenant_id` NULL); tabel keamanan selalu `all`. Satu entri per field yang berubah; entri tidak bisa diubah dan hanya dihapus retensi.
4. Jejak lain: `number_sequence_audit_events`, `finance_posting_events`, `workflow_history`, `aset_tr_ledger_aset` (diisi trigger, tidak bisa diubah).
5. **Tugas stack**: pasang `coreerp.user_id` (id pengguna, angka; nilai lain menggagalkan setiap penulisan) saat pengguna atau klien integrasi terautentikasi, dan reset `coreerp.user_id` serta `coreerp.change_log` ke kosong sebelum koneksi dipakai permintaan atau job lain. Saat ini variabel dipasang di tingkat sesi koneksi (bukan per transaksi) karena banyak penulisan tidak dibungkus transaksi; pekerja yang hidup lama menjalankan setiap job dengan pelakunya sendiri.
6. **Kunci operasi bertenggat** (operasi lingkungan/situs): `INSERT` operasi `running` dengan `lease_until`; index parsial `environment_operations_satu_berjalan WHERE status = 'running'` menolak operasi kedua; operasi lama yang lewat tenggat ditandai failed lalu diambil alih sekali; constraint `environment_operations_berjalan_bertenggat`. Pola yang sama di `site_operations_*`. Kunci berbasis index unik parsial wajib bertenggat.

**Tabel**: `change_log_setup_tables`, `change_log_setup_fields`, `change_log_entries` (`table_name`, `record_id`, `field_name`, `change_type`, `old_value`, `new_value`).

## 10. Celah yang ditemukan (keadaan kode saat ini)

- Nomor penerimaan terbit di transaksi terpisah sebelum dokumen; nomor bisa bolong.
- Masih ada penghapusan fisik: baris rincian draft diganti dengan hapus-tulis saat diubah, prune katalog manifest, blok alokasi nomor yang habis, retensi log.
- Envelope event belum membawa `org_unit_id`.
- Pengiriman ulang event hanya pengambilan ulang tiap menit, tanpa jeda bertingkat dan tanpa batas percobaan.
- Event `core.units-of-measure.<aksi>.v1` ditulis ke outbox tetapi tidak pernah dikirim.
- Replay penerimaan tidak membandingkan isi permintaan; master membandingkannya lewat hash dan menolak 409 `idempotency_conflict`.
- Objek lampiran bisa tertinggal tanpa baris bila proses mati di antara penulisan objek dan commit (dugaan, belum dibuktikan).
- Data awal module aset diisi lewat penerima event `tenant.provisioned`; lingkungan yang disiapkan belakangan mungkin tidak mendapatkannya (dugaan, belum dibuktikan).
