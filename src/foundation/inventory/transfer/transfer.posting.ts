import type { Database } from '../../../platform/database/index.ts';
import { nowSql } from '../../../platform/database/index.ts';

// Jenis sumber baris kartu gudang yang ditulis posting kirim dan posting terima amprah.
export const shipmentSource = 'mutasi';
export const receiptSource = 'mutasi_terima';

// Jumlah akan dikirim kembali ke sisa yang belum dikirim, dan jumlah akan diterima ke barang dalam perjalanan, seperti
// Qty. to Ship dan Qty. to Receive BC sesudah posting.
export async function resetQuantitiesToHandle(
    db: Database,
    tenantId: string,
    orderId: string,
) {
    await db.execute(
        `update gd_tr_amprahan_detail
         set jumlah_akan_dikirim = jumlah_diminta - jumlah_dikirim,
             jumlah_akan_diterima = jumlah_dikirim - jumlah_diterima, updated_at = $1
         where tenant_id = $2 and amprahan_id = $3 and deleted_at is null`,
        [nowSql(), tenantId, orderId],
    );
}
