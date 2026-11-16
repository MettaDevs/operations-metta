import type { Viewer } from '../../src/platform/access/index.ts';

// Pengguna yang memegang setiap izin, untuk test yang memanggil kunci perubahan biaya langsung tanpa sesi.
export function fullAccessViewer(tenantId: string): Viewer {
    return {
        tenantId,
        holds: (_db, codes) => Promise.resolve(new Set(codes)),
    };
}
