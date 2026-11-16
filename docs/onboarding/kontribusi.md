# Cara berkontribusi

Alur kerja yang mengikat ada di [`AGENTS.md`](../../AGENTS.md), bagian *Alur kerja* dan *Worktree*. Halaman ini meringkasnya untuk orang baru dan menambahkan alasannya. Kalau keduanya berbeda, `AGENTS.md` yang benar.

## Alur kerja

1. Pastikan pekerjaannya sudah disetujui. Untuk hal baru, lewati [gate penemuan](../dev/18-module-discovery-and-decision-gate.md) dulu.
2. Periksa `git worktree list`, lalu buat worktree sendiri di dalam clone: `git worktree add .worktrees/<nama> -b <branch> origin/main`. Worktree tidak dibuat di luar repo.
3. Kerjakan dengan perubahan sekecil mungkin.
4. Jalankan pemeriksaan di [Definition of done](definition-of-done.md).
5. Push branch-nya dan buka PR biasa ke `main` (`gh pr create --base main`), bukan draft.
6. Setelah di-merge, hapus worktree dengan `git worktree remove .worktrees/<nama>` dan branch lokalnya. Jangan `rm -rf`.

`main` dijaga ruleset: setiap perubahan lewat PR dan check `check` wajib lulus. Push langsung ke `main` ditolak, juga untuk admin. CI yang merah diperbaiki di branch yang sama. Jalur hotfix hanya dipakai bila pemilik produk menyatakannya.

## Aturan yang mengikat semua perubahan

**Jaga perubahan dan dependency tetap minimal.** Jangan membuat abstraksi atau compatibility layer spekulatif. Kalau ada yang belum jelas, **berhenti dan tanya** pemilik produk, jangan menebak lalu terus jalan.

**Jangan menulis mati nama.** Nama perusahaan, nama orang, nama module besar: semuanya datang dari database.

**Jangan query lintas module.** Module tidak membaca tabel module lain. Butuh datanya? Lihat [API dan integrasi](../dev/04-api-and-integration.md).

**Jangan fork untuk kebutuhan satu pelanggan.** Pakai setelan, fitur produk, integrasi, atau module khusus, sesuai urutannya di [Kebutuhan khusus pelanggan](../dev/05-customization-and-addons.md).

**Nama kode bahasa Inggris, prosa bahasa Indonesia.** Berkas, fungsi, variabel, route, dan komponen berbahasa Inggris. Nama tabel dan kolom, teks layar, komentar, docs, dan pesan commit berbahasa Indonesia. Istilah tanpa padanan jelas memakai istilah Dynamics 365.

**Repo ini publik.** Tidak ada secret, data pasien, alamat server, IP, atau user SSH sungguhan. Pakai contoh.

## Bahasa layar

Teks untuk pengguna bisnis (hint, label, dialog, empty state, error, status) memakai bahasa sehari-hari yang menjelaskan tindakan atau dampaknya.

| Jangan | Pakai |
| --- | --- |
| "Entitlement tidak aktif" | "Langganan aplikasi ini sedang tidak aktif" |
| "Module belum installed" | "Aplikasi ini belum dipasang" |
| "Tenant context tidak valid" | "Sesi kamu sudah berakhir, silakan masuk lagi" |

Istilah teknis yang sudah baku tetap apa adanya: push, pull, scope, token, webhook, endpoint, GET, POST. Bantuan per field mengikuti [bantuan kontekstual](../dev/02-module-standard.md#bantuan-kontekstual-pada-halaman-dan-field): hanya field yang rumit yang diberi help text.

## Sebelum menambah sesuatu yang baru

Module, master, transaksi, workflow, nomor, atau integrasi baru **wajib** melewati gate penemuan: cari rujukan resmi Dynamics 365 (F&O atau Business Central), buat proposal keputusan, tunggu persetujuan. Kalau tidak ada padanan di Dynamics, nyatakan terus terang.

Prosedur dan templatenya di [`.agents/skills/module-discovery/SKILL.md`](../../.agents/skills/module-discovery/SKILL.md). Batas arsitektur dan *data policy decision gate* ada di [`.agents/skills/operations-metta-architecture/SKILL.md`](../../.agents/skills/operations-metta-architecture/SKILL.md).

## Menulis dokumentasi

Dokumentasi ikut dalam PR yang sama dengan kodenya. Itu satu-satunya cara ia tetap benar.

| Isi | Tempat |
| --- | --- |
| Aturan kerja di repo | `AGENTS.md` |
| Desain kanonik lintas Core dan module | `docs/dev/` |
| Orientasi, setup, glosarium | `docs/onboarding/` |
| Perilaku dan aturan satu module | `modules/<module>/README.md` |
| Token tampilan, kontrak komponen, alur layar sampai database | `docs/design-system/` |
| Janji kepada pemanggil di luar runtime | `contracts/`, termasuk gap di `info.description` |
| Harness kesetaraan | `parity/README.md` |

Aturan menulis ada di skill [`operations-metta-docs`](../../.agents/skills/operations-metta-docs/SKILL.md). Yang paling sering terlewat:

- Tulis tautan antar dokumen sebagai path relatif `.md`. Repo ini belum punya build dokumentasi, jadi tidak ada yang gagal karena tautan mati: periksa sendiri.
- Tautan ke dokumen CoreERP ditulis sebagai URL GitHub repo coreERP, bukan path relatif.
- Jangan menghitung hal yang tumbuh ("delapan master"); tunjuk sumbernya.
- Kalau sebuah fondasi belum ada, tulis bahwa ia belum ada.
- Jangan mengganti nama berkas di `docs/dev/` tanpa memperbarui semua tautan ke berkas itu.

## Lihat juga

- [Definition of done](definition-of-done.md)
- [Menyiapkan lingkungan lokal](setup.md)
- [Gate penemuan dan keputusan](../dev/18-module-discovery-and-decision-gate.md)
