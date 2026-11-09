# operations-metta

Runtime ERP yang dijalankan untuk klinik, di SaaS maupun on-prem, dan ditulis dengan Bun + Elysia. Praktik Dokter direncanakan berjalan di runtime yang sama. Onboarding, tenant, lingkungan, dan rilis dikelola repo [control-plane-metta](https://github.com/MettaDevs/control-plane-metta).

## Status

Core dan module pertama, `asset-management`, sedang dipindah dari [CoreERP](https://github.com/MettaDevs/coreERP). Sampai setiap alur selesai dipindah, CoreERP tetap acuan perilaku. Skema database CoreERP menjadi titik awal, dan aturan mengubahnya ada di [AGENTS.md](AGENTS.md).

## Menjalankan pemeriksaan

Dari akar repo:

```bash
bun install
bun run check:generated
bun run typecheck
bun test
bun run format:check
bun run check:boundaries
```

`bun run build` hanya bila perubahan menyentuh hasil build; rinciannya di [AGENTS.md](AGENTS.md).

Layar dijalankan di laptop dengan `bun run dev`, di atas database yang sudah dimigrasi. Caranya ada di bagian [Layar](AGENTS.md#layar) AGENTS.md.

Aturan kerja di repo ini ada di [AGENTS.md](AGENTS.md).
