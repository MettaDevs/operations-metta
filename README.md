# operations-metta

Runtime ERP yang dijalankan untuk klinik, di SaaS maupun on-prem, dan ditulis dengan Bun + Elysia. Praktik Dokter direncanakan berjalan di runtime yang sama. Onboarding, tenant, lingkungan, dan rilis dikelola repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta).

## Status

Core dan module pertama, `asset-management`, sedang dipindah dari [CoreERP](https://github.com/MettaDevs/coreERP). Sampai setiap alur selesai dipindah, CoreERP tetap acuan perilaku. Skema database CoreERP menjadi titik awal, dan aturan mengubahnya ada di [AGENTS.md](AGENTS.md).

## Menjalankan pemeriksaan

Dari akar repo:

```bash
bun install
bun run typecheck
bun test
bun run format:check
bun run check:boundaries
```

`bun run build` hanya bila perubahan menyentuh hasil build; rinciannya di [AGENTS.md](AGENTS.md).

Aturan kerja di repo ini ada di [AGENTS.md](AGENTS.md).
