# Hari pertama

Target hari ini: server lokal jalan, kamu bisa login ke lingkungan contoh, kamu tahu di mana barang disimpan, dan kamu paham istilah yang dipakai tim.

## Checklist

- [ ] Dapat akses ke repo `operations-metta`
- [ ] Bun dan Docker terpasang (rinciannya di [Menyiapkan lingkungan lokal](setup.md))
- [ ] Server lokal jalan dan `http://klinik-contoh.localhost:8000` bisa dibuka
- [ ] Baca [Glosarium](glosarium.md): tenant, lingkungan, organization, legal entity, operating unit
- [ ] Baca [Grand design](../dev/01-grand-design.md) satu kali, tidak perlu hafal
- [ ] Baca [`AGENTS.md`](../../AGENTS.md) di akar repo sampai habis. Itu aturan main yang berlaku untuk semua orang, termasuk agen AI

## Apa yang kamu jalankan sebenarnya

| Yang jalan | Alamat | Isinya |
| --- | --- | --- |
| Server operations (`bun run dev`) | `http://<tenant>.localhost:8000` | API oRPC di `/api/...` dan dokumen layar SPA untuk URL lain. Satu proses untuk Core dan semua module. |
| PostgreSQL (container sekali pakai) | `127.0.0.1:55432` | Database runtime (`operations_dev`) ditambah satu database per lingkungan contoh |
| Valkey (container sekali pakai) | `127.0.0.1:56379` | Sesi, bila `SESSION_BACKEND=valkey`; bawaannya sesi di database. Test sesi Valkey memakainya |

Tidak ada control plane di laptop. Tenant dan lingkungan contoh dibuat `bun run dev:setup` dari `dev/tenants.json` lewat fungsi yang sama dengan yang dijalankan worker di server (`provisionEnvironment`). Di server sungguhan, tenant hanya lahir dari admin.erp di control-plane-metta.

Module tidak punya port atau alamat sendiri. Halamannya ada di `/<module>/<folder fitur>/...` di alamat lingkungan yang sama, dan menunya muncul setelah module itu terpasang untuk tenant tersebut.

## Peta repo

```text
src/main.ts, src/worker.ts, src/migrate.ts   Proses yang di-deploy: HTTP, worker lingkungan, migration
src/client.tsx                              Entry peramban dan route tree, ditulis skrip; jangan disunting
src/platform/<kemampuan>/                   Bagian yang dipakai setiap request: identity, access, environment, organization, shell, ...
src/foundation/<layanan>/                   Layanan bisnis bersama: number-sequence, inventory, billing, calendar, ...
modules/<module>/                           Module bisnis, satu package Bun workspace per module
packages/<package>/                         Pustaka bersama, misalnya packages/ui = @operations-metta/ui
database/migrations/                        Migration SQL milik Core
test/                                       Test Core, susunannya mengikuti src/
parity/                                     Harness kesetaraan dengan CoreERP
docs/                                       design-system/, dev/, onboarding/
.agents/skills/                             Skill per bidang, dibaca agen AI maupun developer
```

Rinciannya di [Peta kode ke dokumen](peta-kode.md).

## Yang jangan dilakukan minggu ini

**Jangan bikin module atau master baru dulu.** Ada gate keputusan yang harus dilewati, dan proposalnya butuh persetujuan. Lihat [Gate penemuan dan keputusan](../dev/18-module-discovery-and-decision-gate.md).

**Jangan menyentuh tabel milik module lain.** Tidak ada pengecualian, walaupun tabelnya ada di database yang sama dan query-nya akan berhasil. Butuh data module lain? Jawabannya ada di [API dan integrasi](../dev/04-api-and-integration.md), bukan query.

**Jangan menulis mati nama.** Nama perusahaan, nama orang, nama module besar: semuanya datang dari database. Kalau ragu, tanya dulu.

**Jangan mengubah repo CoreERP.** Repo itu beku. Baca untuk acuan perilaku, tulis perubahannya di sini.

**Jangan menaruh rahasia, IP, nama server, atau data pasien di repo.** Repo ini publik, dan riwayat git menyimpan berkas yang sudah dihapus. Pakai contoh seperti `server.example.com` dan `203.0.113.10`.

## Besok

[Tiga kebenaran lifecycle](tiga-kebenaran.md), lalu [Alur end-to-end](alur-end-to-end.md). Dua halaman itu yang paling cepat membuat arsitekturnya masuk akal.
