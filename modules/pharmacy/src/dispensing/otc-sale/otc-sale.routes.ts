import type { z } from 'zod';
import { coreWorkspace } from '@core/platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    otcSaleInputSchema,
    otcSaleQuoteInputSchema,
} from './otc-sale.schema.ts';
import { OtcSales } from './otc-sale.service.ts';

async function otcSales(context: Context, body?: unknown) {
    return new OtcSales(context.db, await moduleWorkspace(context, body));
}

// Loket penjualan obat bebas: pilihan lokasi, harga tanpa menyimpan, lalu Simpan dan bayar.
export function otcSaleRoutes() {
    const root: `/${string}` = `/api/modules/${moduleId}/v1/otc-sales`;
    const route = (method: 'GET' | 'POST', path: string) =>
        base.route({
            method,
            path: `${root}${path}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyOtcSaleOptions: route('GET', '/options').handler(
            async ({ context }) =>
                ok(await (await otcSales(context)).options()),
        ),
        pharmacyOtcSaleQuote: route('POST', '/quote')
            .input(typedBody<z.input<typeof otcSaleQuoteInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await otcSales(context, input.body)
                    ).quote(input.body),
                ),
            ),
        pharmacyOtcSaleCreate: route('POST', '')
            .input(typedBody<z.input<typeof otcSaleInputSchema>>())
            .handler(async ({ context, input }) =>
                (await otcSales(context, input.body)).create(
                    input.body,
                    await coreWorkspace(context, input.body),
                ),
            ),
    };
}
