# Schema dan query scope: tenant, legal entity, dan organisasi

Halaman ini menerapkan model di [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md) ke tabel dan query. Yang dijelaskan: di database mana data tinggal, kolom konteks apa yang dibawa setiap baris, dan bagaimana query menyaring baris yang boleh dilihat.

## Identitas pada setiap lapisan

```text
Client        = pihak komersial, dicatat control plane dan disalin ke database lingkungan saat penyiapan
Tenant        = batas isolasi
Organisasi    = legal entity atau operating unit di dalam tenant
Hierarchy     = susunan organisasi untuk satu tujuan dan satu versi
```

`client_id` tidak disalin ke transaksi. Setiap baris milik tenant membawa `tenant_id`; transaksi dengan konsekuensi hukum atau akuntansi membawa `legal_entity_id`; proses operasional membawa `org_unit_id` bila relevan.

## Di database mana data tinggal

| Database | Isi |
| --- | --- |
| Database pusat control plane | Registri tenant dan lingkungan, rilis, lisensi, identitas pusat. Operations tidak pernah membacanya |
| Database runtime host ini | Antara lain `environment_routes`, upacara SSO, logout token yang sudah dipakai, dan data tenant yang memakai database bersama |
| Database lingkungan | Semua data satu lingkungan, misalnya tenant, organisasi, pengguna dan keanggotaan, role dan duty, sesi bila disimpan di database, master, transaksi, dan tabel setiap module yang terpasang |

Karena organisasi, akses, dan module tinggal di satu database lingkungan, module boleh memasang foreign key ke tabel Core dan menyaring turunan organisasi lewat `organization_hierarchy_closures` langsung. Proyeksi hierarchy per module tidak dibutuhkan. Yang tetap dilarang: foreign key atau query dari satu module ke tabel module lain.

Tenant di database bersama dipisah `tenant_id` saja. Karena itu setiap query wajib menyaring `tenant_id`, juga di database lingkungan yang saat ini hanya berisi satu tenant: kode yang sama berjalan di kedua bentuk.

## Tabel organisasi

Bentuk tabelnya ada di `database/migrations/0001_coreerp_baseline.sql` dan perubahan sesudahnya. Invarian yang dijaga:

- `organizations` menyimpan identitas dan tepat satu klasifikasi, `legal_entity` atau `operating_unit`. Penulis organisasi membuat tepat satu baris subtype yang sesuai, di `legal_entities` atau `operating_units`.
- `company_code` milik legal entity, unik per tenant, dan tidak dipakai sebagai foreign key atau id transaksi. Operating unit tidak punya kode generik; nomor unit adalah identifier domain.
- Organisasi, hierarchy, versi, dan node berada di tenant yang sama, dan satu organisasi hanya muncul sekali dalam satu versi. Service menolak pelanggaran itu sebelum menulis.
- Closure selalu terikat ke satu versi, dan versi yang sudah dipublikasikan tidak ditulis ulang.

## Query scope di kode

`Workspace` di `src/platform/access/workspace.ts` adalah satu-satunya sumber konteks tepercaya. Module memanggilnya lewat helper-nya sendiri, misalnya `moduleWorkspace` di `modules/asset-management/src/module.ts`, lalu meneruskan hasilnya ke service.

`Workspace.resolve` membaca, untuk satu request:

1. pengguna dari sesi;
2. keanggotaan aktif, dibatasi ke tenant pemilik alamat lingkungan;
3. permission module itu lewat rantai role, termasuk role turunan;
4. batas data penugasan role untuk satu kode kebijakan data, termasuk turunan organisasi menurut versi hierarchy yang tercatat pada batas itu;
5. legal entity dan operating unit aktif dari sesi, bila masih terjangkau.

Hasilnya dipakai lewat method berikut:

| Method | Gunanya |
| --- | --- |
| `guard(resource, action)` | Menolak dengan 403 bila permission `<module>.<resource>.<action>` tidak dipegang |
| `filter(alias, start)` | Klausa SQL dan parameter untuk daftar dan pencarian |
| `require(legalEntityId, orgUnitId)` | Menolak satu record di luar legal entity aktif atau di luar batas data |
| `allows(legalEntityId, orgUnitId)` | Pertanyaan yang sama tanpa melempar |

`filter` hari ini menghasilkan satu bentuk:

```sql
x.tenant_id = $1
and x.legal_entity_id = $2              -- legal entity aktif
and (                                   -- dihilangkan bila kebijakan memberi seluruh organisasi
    (x.legal_entity_id = $3 and x.responsible_org_unit_id in ($4, $5))
    or (x.legal_entity_id = $6 and x.responsible_org_unit_id in ($7))
)
```

Batas data disimpan sebagai **pasangan** legal entity dan daftar unit. Pasangan `(A, unit A)` dan `(B, unit B)` tidak pernah berubah menjadi izin palsu `(A, unit B)`: query memakai OR antarpasangan dan AND di dalam satu pasangan. Kebijakan yang berbeda tidak saling memperluas.

Resource yang kolom kebijakannya bukan `responsible_org_unit_id`, atau yang tidak dimiliki legal entity, membutuhkan bentuk yang dirancang tersendiri. Jangan memaksakannya ke `filter`. Gate keputusannya di skill `operations-metta-architecture`, bagian Data policy decision gate.

Legal entity yang saling melihat jenis data tertentu dibaca lewat `sharedLegalEntities` di `src/platform/data-sharing/`, oleh module pemilik datanya. Lihat [Buku alamat](24-global-address-book.md#data-sharing-antar-legal-entity).

## Urutan authorization

1. Bangun konteks dari sesi tepercaya dan alamat lingkungan.
2. Periksa permission lewat role, duty, privilege, lalu permission.
3. Baca batas data kebijakan yang relevan, termasuk versi hierarchy yang berlaku.
4. Terapkan `tenant_id`, legal entity aktif untuk resource milik legal entity, lalu predikat kebijakan pada setiap query dan perintah. Ketiganya digabung dengan AND.

Legal entity aktif adalah konteks kerja, bukan izin. Unit aktif tetap nilai awal dan saringan opsional. Resource bersama dan jalur lintas legal entity yang disengaja mengikuti keputusan per resource, dan detail mewarisi batas induknya.

## Konteks dihitung per request

`Workspace` dibuat untuk satu request dan tidak pernah disimpan di memori proses. Beberapa proses Bun dan beberapa instance melayani tenant yang sama, dan konteks yang tertinggal dari request sebelumnya adalah konteks pengguna lain.

`Workspace.resolve` menjalankan query-nya setiap kali dipanggil. CoreERP memoisasi konteks per request dan menahan jumlah query-nya dengan test yang menghitung query, bukan milidetik. Repo ini belum punya keduanya. Bila memoisasi ditambahkan, test-nya wajib meniru batas request: tanpa itu request kedua memakai konteks yang sudah dihangatkan request pertama, dan angkanya tampak lebih baik daripada kenyataan.

## Indeks unik pada kode bisnis wajib parsial

Tidak ada baris yang dihapus fisik. Keunikan yang meliputi seluruh tabel akan menghitung baris yang sudah dihapus lunak, sehingga kode yang sudah "dihapus" pengguna tetap menempati namanya. Karena itu keunikan kode bisnis ditulis sebagai indeks parsial yang hanya mencakup baris hidup:

```sql
create unique index roles_tenant_id_name_unique
    on public.roles using btree (tenant_id, name) where (deleted_at is null);
```

PostgreSQL tidak mengizinkan klausa `WHERE` pada constraint `UNIQUE`. Keunikan dari baseline yang berbentuk constraint harus dibuang dengan `ALTER TABLE ... DROP CONSTRAINT` lalu diganti indeks, seperti di `0009_access.sql`.

CoreERP memeriksa aturan ini dengan membaca katalog indeks database, bukan teks migration. Pemeriksaan itu belum dipindah, jadi aturan ini dijaga di review.

## Aturan tetap

1. Module tidak membuat query atau foreign key ke tabel module lain. Core boleh membaca tabel module dengan syarat di bagian Aturan module `AGENTS.md`.
2. Identitas organisasi tidak menyimpan parent atau kedalaman permanen.
3. Setiap organisasi punya tepat satu klasifikasi.
4. Closure selalu terikat ke satu versi hierarchy.
5. Versi yang sudah dipublikasikan tidak ditulis ulang saat restrukturisasi.
6. `org_unit_id` tidak menggantikan `legal_entity_id` untuk kebutuhan hukum atau akuntansi.
7. `tenant_id` tidak pernah dihapus dari predikat, juga untuk penugasan yang memberi seluruh organisasi.

## Lihat juga

- [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md)
- [Identity dan access](09-identity-and-access.md)
- [Rantai keamanan modul transaksi](19-transaction-security-chain.md)
