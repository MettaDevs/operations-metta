# Bentuk catatan review dan pemeriksaan cakupan

Simpan `review.json`, `pr/review.md`, `pr/human.md`, dan `pr/inline.md` dalam folder review
lokal di luar working tree aplikasi. JSON adalah bukti cakupan untuk validator, bukan
pengganti pembacaan source. Markdown berisi hasil yang akan dibaca pengguna.

Contoh struktur, dengan metadata diganti nilai PR sebenarnya:

```json
{
  "metadata": {
    "repository": "owner/repository",
    "number": 123,
    "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "base_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "scope": {
    "database_reads": true,
    "ui_lists": true,
    "ui_forms": false,
    "api_endpoints": true,
    "security_changes": false,
    "lifecycle": false,
    "contracts": false
  },
  "checks": {
    "scope": {
      "status": "verified",
      "evidence": ["metadata dan diff pada head/base yang dicatat"]
    },
    "shared_capability_ownership": {
      "status": "verified",
      "evidence": ["owning canonical rules and actual independent-module needs inspected"],
      "ownership": {
        "resource": "Module-specific process resource",
        "needed_without_module": false,
        "current_owner": "module",
        "target_owner": "module"
      }
    },
    "n_plus_one": {
      "status": "verified",
      "evidence": ["query-results.json dan harness yang sudah dijalankan"],
      "measurement": {
        "environment": "environment sebenarnya beserta batasnya",
        "parent_counts": [1, 10, 25],
        "query_counts": [4, 4, 4],
        "includes_serialization": true
      }
    },
    "datatable_incremental": {
      "status": "finding",
      "evidence": ["source loader dan DataTable pada revisi yang dinilai"],
      "finding_ids": ["F1"]
    }
  },
  "findings": [
    {
      "id": "F1",
      "priority": "P2",
      "path": "relative/path/to/changed-file.tsx",
      "line": 42,
      "title": "Perilaku yang perlu diperbaiki",
      "impact": "Skenario dan akibat yang didukung bukti",
      "fix": "Perbaikan terkecil yang lengkap",
      "evidence": ["source/reproduksi yang benar-benar diperiksa"],
      "pattern_url": "https://github.com/owner/repository/blob/commit/path#L1",
      "documentation_urls": ["https://example.com/aturan-yang-berlaku"]
    }
  ],
  "limitations": ["Pemeriksaan yang belum dijalankan atau batas environment"]
}
```

Contoh di atas sengaja hanya menampilkan sebagian `checks`. Isi seluruh ID yang diwajibkan
oleh scope menurut `review_criteria.md`. Scope yang tidak memiliki database/list/form tidak
dipaksa menjalankan pengujian kategori tersebut. Semua scope flag harus eksplisit.

- `verified`: pemeriksaan dilakukan dengan evidence. Untuk `n_plus_one`, sertakan
  pengukuran ukuran induk berbeda, jumlah query, environment, dan serialisasi.
- `finding`: sertakan evidence dan ID temuan yang ada di `findings`.
- `source_only`: sertakan evidence, `reason`, dan limitation yang cocok. Jangan menyebut
  hasil itu sebagai pengujian runtime yang lulus.
- `not_applicable`: hanya untuk pemeriksaan tambahan yang tidak diwajibkan scope;
  sertakan `reason`. Pemeriksaan yang diwajibkan tidak boleh dilewati dengan label ini.

`shared_capability_ownership` diwajibkan ketika scope mencakup API, form, atau lifecycle.
Untuk status verified/finding, isi objek ownership. `needed_without_module=true` tidak
boleh menargetkan module; master bersama ke foundation, engine netral ke platform.
Jika source saat ini masih module-owned, catat finding pemindahan, bukan verified.
Evidence menyebut kebutuhan bisnis/consumer atau aturan kanonik; jangan memakai dugaan
bahwa fitur mungkin berguna kelak sebagai alasan memindahkan seluruh fakta proses.

Jalankan dari root repository:

```powershell
python .agents/skills/pr-review/scripts/validate_review.py C:/path/review.json --diff C:/path/diff.patch
python .agents/skills/pr-review/scripts/validate_review.py C:/path/review.json --diff C:/path/diff.patch --publication C:/path/post-review.json
python .agents/skills/pr-review/scripts/validate_review.py --self-test
```

`--diff` memeriksa bahwa file/baris inline memang baris baru pada patch yang dibaca.
`--publication` menerima payload terstruktur tool posting yang berisi `repo_full_name`,
`pr_number`, `commit_id` dan `file_comments` dengan `path`, `line`, serta `body`. Ia
memeriksa target revisi dan memastikan contoh pola serta bacaan tiap finding benar-benar
ada pada body inline di anchor tersebut, bukan hanya pada catatan internal reviewer.
Untuk temuan inherited, balas thread asal atau laporkan pada review umum; jangan menaruh
inline pada baris yang tidak berubah di PR sekarang. Validator tidak mengakses jaringan,
tidak mengirim review, tidak membuktikan kebenaran evidence, dan tidak mengesahkan merge.

Jika temuan sudah memiliki thread pada PR ini atau pada parent dalam stack, catat terpisah:

```json
{
  "existing_findings": [
    {
      "id": "OLD1",
      "thread_url": "https://github.com/owner/repository/pull/123#discussion_r123",
      "evidence": ["thread dan source pemilik masalah yang sudah diperiksa"]
    }
  ]
}
```

`checks.finding_ids` boleh menunjuk ID baru di `findings` maupun ID yang sudah ada di
`existing_findings`. Hanya `findings` baru yang harus memiliki anchor dalam diff dan
body inline pada payload publikasi. Cara ini mencatat cakupan tanpa memaksa reviewer
memposting ulang temuan inherited. Bukti baru dapat dibalas ke thread asal melalui tool
yang sesuai; izin posting tetap mengikuti sesi pengguna.
