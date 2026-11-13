import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Obat adalah barang persediaan Core dengan perluasan klinis milik module ini (sim_m_obat, id sama dengan barang).
// Kode, nama, satuan dasar, kode KFA, dan blokir dibaca dari barang; bentuk sediaan dan boleh diresepkan dari
// perluasannya.
// Kategori, profil pelacakan, satuan kemasan, dan blokir diatur di kartu barang persediaan. version adalah versi
// barang, karena setiap simpan kartu obat mengubah barang itu. sales_unit_id adalah satuan jual barang (satuan dasar
// bila kosong).
export const drugRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    base_unit_id: z.string(),
    base_unit_name: z.string(),
    sales_unit_id: z.string(),
    kfa_code: z.string().nullable(),
    dosage_form_id: z.string().nullable(),
    dosage_form_name: z.string().nullable(),
    is_prescribable: z.boolean(),
    is_blocked: z.boolean(),
    version: z.number(),
});

// prescribable=true: obat yang bisa dipilih di E-Resep, yaitu boleh diresepkan dan barangnya tidak diblokir.
export const drugListQuerySchema = listParametersSchema.extend({
    prescribable: z.enum(['true', 'false']).optional(),
});

export const drugInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    base_unit_id: z.string().nullable(),
    // Ditulis ke barang dan diperiksa persediaan Core; tidak dikirim berarti tetap.
    kfa_code: z.string().nullable().optional(),
    dosage_form_id: z.string().nullable(),
    is_prescribable: z.boolean(),
    version: z.number().optional(),
});
