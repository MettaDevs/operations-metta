import { z } from 'zod';
import { coreWorkspace } from '@core/platform/access/index.ts';
import {
    base,
    type listParametersSchema,
    ok,
    typedBody,
    typedQuery,
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

// Loket penjualan obat bebas: pilihan lokasi, harga tanpa menyimpan, lalu Simpan dan bayar. Daftar dan kartu
// penjualan untuk melihat penjualan yang sudah terjadi dan meretur obatnya.
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
                ok(
                    await (
                        await otcSales(context)
                    ).options(await coreWorkspace(context)),
                ),
        ),
        pharmacyOtcSaleItems: route('GET', '/items')
            .input(
                typedQuery<
                    z.input<typeof listParametersSchema> & {
                        location_id?: string;
                        substitutes_of?: string;
                    }
                >(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await otcSales(context)
                    ).items(new URL(context.request.url).searchParams),
                ),
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
        pharmacyOtcSaleList: route('GET', '')
            .input(
                typedQuery<
                    z.input<typeof listParametersSchema> & {
                        from?: string;
                        to?: string;
                    }
                >(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await otcSales(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyOtcSaleShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await otcSales(context)).show(input.params.id)),
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
