# Harness kesetaraan

Harness ini membuktikan operations-metta berperilaku sama dengan CoreERP untuk input yang sama. Ia dipindah dari `experiments/stack-comparison/scripts` di branch `codex/native-stack-comparison` CoreERP. CoreERP tidak disentuh lagi, jadi bukti CoreERP yang sudah terekam menjadi acuan tetap.

- `golden.py` menjalankan satu golden run. Ia meng-clone seed uuid, merekam baseline oracle, menjalankan alur HTTP bertrace, lalu empat gate: `compare_http.py`, `sql_oracle.py check`, `compare_posting.py`, dan `compare_queries.py`.
- `conformance.py` menjalankan probe negatif, race, pencabutan akses, rollback, dan throttle pada clone baru, lalu membandingkannya dengan hasil CoreERP.
- `ids.py` memetakan ULID ke uuid dan menerjemahkan bukti CoreERP.
- `check_seed.py` membuktikan terjemahan itu sama dengan konversi skema pada seluruh seed.
- `candidate.py` menjalankan image di jaringan lab. `lab.py` mengakses PostgreSQL lab.

## Id ULID dan uuid

Pemilik produk memutuskan pada 9 November 2026 bahwa setiap id ULID menjadi `uuid` native dengan nilai 128 bit yang sama. Bukti CoreERP tetap ber-ULID, sedangkan kandidat membaca seed yang dikonversi `ulid_to_uuid`.

- `ids.ulid_to_uuid` dan `ids.uuid_to_ulid` sama bit demi bit dengan fungsi SQL di migration 0002 dan tidak peka huruf besar.
- Sebelum dibandingkan, bukti CoreERP diterjemahkan dengan aturan kunci yang sama dengan konversi skema. Nilai di bawah kunci `id`, `*_id`, dan `*_ids` diganti bila seluruhnya ULID. Teks yang disusun dari id diganti per bagian. `posting_id` dan `posting_ids` berpemisah `-`, `scope_key` berpemisah `|` dan `:`, `period_key` dan `reference` berpemisah `:`, `record_id` berpemisah `,`, sedangkan header `Location` dan `url` berpemisah `/`.
- Nama, kode, email, dan teks bebas tidak disentuh, walau memuat penanda fixture yang bentuknya seperti ULID. Identitas run (`fixture_id`, `fixture_hash`, `run_id`) juga tidak.
- `input_hash` posting adalah hash atas id. Resepnya lebih dulu dicocokkan dengan hash tersimpan CoreERP, lalu hash diturunkan ulang dari input yang sudah diterjemahkan.
- Baseline oracle berisi hash isi baris, jadi tidak bisa diterjemahkan. Baseline direkam ulang dari clone seed uuid sebelum kandidat berjalan, dan himpunan id-nya wajib sama dengan baseline CoreERP lewat `ulid_to_uuid`.
- Id yang dibangkitkan selama alur dipetakan bijektif ke placeholder seperti `$receipt`, `$asset-<kode>`, dan `$posting`, sama dengan di eksperimen.

## Waiver

Selisih yang disengaja dicatat di `query-obligations.json` beserta alasannya. FAIL hanya boleh dikecualikan dengan evidence perilaku. Gate HTTP, oracle, posting, dan conformance tidak punya waiver, jadi selisih apa pun di sana merah. Bila skema berubah lagi, jalankan `check_seed.py`, perbarui aturan kunci di `ids.py` atau register waiver, lalu ulangi golden dan conformance.

## Lab

Input privat tetap di lab dan tidak pernah masuk repo ini: fixture, `runtime.env`, flow, trace, dan hasil conformance CoreERP, serta baseline seed CoreERP. Infrastruktur lab dijelaskan berkas JSON di luar repo, misalnya:

```json
{
    "postgres_container": "lab-database-1",
    "postgres_user": "lab_admin",
    "network": "lab_default",
    "database_host": "database",
    "database_prefix": "lab_compare_",
    "candidate_port": 18647
}
```

Harness hanya membuat database berawalan `database_prefix`, tidak pernah menimpa atau menghapusnya, dan selalu meng-clone seed per run.

```bash
python3 -B parity/golden.py --lab lab.json --image operations-metta:uuid \
    --template lab_compare_uuid_seed --database lab_compare_g1 \
    --fixture private/fixture.json --env private/runtime.env \
    --expected-flow private/coreerp-flow.json --expected-traces private/coreerp-traces \
    --expected-database lab_compare_coreerp --coreerp-baseline private/seed-baseline.json \
    --run-id golden-20261103 --output runs/g1

python3 -B parity/conformance.py --lab lab.json --image operations-metta:uuid \
    --template lab_compare_uuid_seed --database lab_compare_c1 \
    --fixture private/fixture.json --env private/runtime.env \
    --expected private/coreerp-conformance.json --output runs/c1
```

## Test

```bash
python3 -B -m unittest discover -s parity
```

`test_evidence.py` hanya berjalan bila `PARITY_COREERP_FLOW`, `PARITY_FIXTURE`, dan `PARITY_CANDIDATE_FLOW` menunjuk ke bukti lab. Tanpa itu, test-nya dilaporkan dilewati.
