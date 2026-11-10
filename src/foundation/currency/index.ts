import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { validation } from '../../platform/http/index.ts';

const precisionSchema = z.object({
    amount_decimals: z.number(),
    unit_amount_decimals: z.number(),
});

export class Currency {
    private readonly cache = new Map<string, z.infer<typeof precisionSchema>>();

    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
    ) {
        db.onTransactionBoundary(() => this.cache.clear());
    }

    async precision(code: string) {
        const key = code.toUpperCase();
        const cached = this.cache.get(key);
        if (cached) return cached;
        const row = await this.db.one(
            precisionSchema,
            'select amount_decimals,unit_amount_decimals from currency_precisions where tenant_id=$1 and currency_code=$2 limit 1',
            [this.tenantId, key],
        );
        if (!row && key !== 'IDR')
            validation({
                currency_code: `Presisi mata uang ${key} belum disetel. Atur di Data referensi › Mata uang.`,
            });
        const precision = row ?? {
            amount_decimals: 2,
            unit_amount_decimals: 3,
        };
        this.cache.set(key, precision);
        return precision;
    }
}
