import { z } from 'zod';
import { base, ok, typedQuery, type Context } from '../http/index.ts';
import type { ReportCatalog } from './catalog.ts';
import { outputFormats, Printing } from './printing.service.ts';

const printQuerySchema = z.object({
    format: z.enum(outputFormats).default('pdf'),
    layout: z.string().min(1).max(200).optional(),
});

const route = (suffix: string) =>
    base.route({
        method: 'GET',
        path: `/api/v1/reports/{code}${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

const codeParams = z.object({ code: z.string().min(1).max(160) });

export function reportingRoutes(catalog: ReportCatalog) {
    const printing = (context: Context) => new Printing(catalog, context);
    return {
        reportLayouts: route('/layouts')
            .input(z.object({ params: codeParams }))
            .handler(async ({ context, input }) =>
                ok(await printing(context).layouts(input.params.code)),
            ),
        // Berkas satu dokumen: PDF (bawaan) atau Word. GET supaya peramban bisa membukanya langsung di tab baru.
        reportPrint: route('/records/{id}')
            .input(
                typedQuery<z.input<typeof printQuerySchema>>().extend({
                    params: codeParams.extend({
                        id: z.string().min(1).max(64),
                    }),
                }),
            )
            .handler(async ({ context, input }) => {
                const query = printQuerySchema.safeParse(
                    Object.fromEntries(
                        new URL(context.request.url).searchParams,
                    ),
                );
                if (!query.success)
                    return {
                        status: 422,
                        headers: {},
                        body: { message: 'Format cetak tidak dikenal.' },
                    };
                const file = await printing(context).print(
                    input.params.code,
                    input.params.id,
                    query.data.format,
                    query.data.layout ?? null,
                );
                return {
                    status: 200,
                    headers: {
                        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
                    },
                    body: file,
                };
            }),
    };
}
