import { api } from '../../../platform/shell/index.ts';
import type { CodeListSource } from './code-list-screen.tsx';

// Satuan dan alasan penyesuaian sebagai daftar kode, dipakai halaman daftarnya dan tombol Baru pada pilihan satuan di
// kartu barang serta pilihan alasan di dokumen penyesuaian.

export const unitsOfMeasure: CodeListSource = {
    title: 'Satuan',
    label: 'satuan',
    list: async (query, signal) =>
        (await api.inventoryUnitOfMeasureList({ query }, { signal })).body,
    create: async (body) =>
        (await api.inventoryUnitOfMeasureCreate({ body })).body.data,
    update: async (id, body) =>
        (await api.inventoryUnitOfMeasureUpdate({ params: { id }, body })).body
            .data,
    remove: (id, version) =>
        api.inventoryUnitOfMeasureDelete({ params: { id }, body: { version } }),
};

export const reasonCodes: CodeListSource = {
    title: 'Alasan penyesuaian',
    label: 'alasan',
    consumption: {
        label: 'Dicatat sebagai pemakaian',
        hint: 'Stok yang keluar dengan alasan ini tercatat sebagai pemakaian di kartu stok. Matikan untuk alasan seperti pemusnahan atau kedaluwarsa, yang tercatat sebagai penyesuaian.',
    },
    list: async (query, signal) =>
        (await api.inventoryReasonCodeList({ query }, { signal })).body,
    create: async (body) =>
        (await api.inventoryReasonCodeCreate({ body })).body.data,
    update: async (id, body) =>
        (await api.inventoryReasonCodeUpdate({ params: { id }, body })).body
            .data,
    remove: (id, version) =>
        api.inventoryReasonCodeDelete({ params: { id }, body: { version } }),
};
