import { z } from 'zod';
import { coreWorkspace } from '../access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../http/index.ts';
import type { ReportCatalog } from './catalog.ts';
import { Letterheads, type LetterheadInput } from './letterheads.service.ts';
import { outputFormats, Printing } from './printing.service.ts';

const printQuerySchema = z.object({
    format: z.enum(outputFormats).optional(),
    layout: z.string().min(1).max(200).optional(),
});

const route = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string) =>
    base.route({
        method,
        path: `/api/v1${path}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

const codeParams = z.object({ code: z.string().min(1).max(160) });
const refParams = codeParams.extend({ ref: z.string().min(1).max(200) });

function query(context: Context) {
    return printQuerySchema.safeParse(
        Object.fromEntries(new URL(context.request.url).searchParams),
    );
}

function reportParameters(context: Context) {
    const parameters = new URL(context.request.url).searchParams;
    parameters.delete('format');
    parameters.delete('layout');
    return parameters;
}

function file(body: File) {
    return {
        status: 200 as const,
        headers: {
            'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(body.name)}`,
        },
        body,
    };
}

const unknownFormat = {
    status: 422 as const,
    headers: {},
    body: { message: 'Format cetak tidak dikenal.' },
};

// Upload layout: multipart/form-data berisi `file`, `name`, dan `language`. Body diperiksa service, bukan oRPC.
type UploadBody = { file: Blob; name: string; language: 'id' | 'en' };

export function reportingRoutes(catalog: ReportCatalog) {
    const printing = (context: Context) => new Printing(catalog, context);
    return {
        reportLayouts: route('GET', '/reports/{code}/layouts')
            .input(z.object({ params: codeParams }))
            .handler(async ({ context, input }) =>
                ok(await printing(context).layouts(input.params.code)),
            ),
        // Berkas satu laporan: PDF atau Word dari layout Word, Excel dari layout Excel. Tanpa `format`, format layout
        // yang dipakai. GET supaya peramban bisa membukanya langsung di tab baru.
        reportPrint: route('GET', '/reports/{code}/records/{id}')
            .input(
                typedQuery<z.input<typeof printQuerySchema>>().extend({
                    params: codeParams.extend({
                        id: z.string().min(1).max(64),
                    }),
                }),
            )
            .handler(async ({ context, input }) => {
                const parsed = query(context);
                if (!parsed.success) return unknownFormat;
                return file(
                    await printing(context).print(
                        input.params.code,
                        input.params.id,
                        parsed.data.format ?? null,
                        parsed.data.layout ?? null,
                        reportParameters(context),
                    ),
                );
            }),
        reportLayoutCatalogue: route('GET', '/report-layouts').handler(
            async ({ context }) => ok(await printing(context).catalogue()),
        ),
        reportLayoutUpload: route('POST', '/reports/{code}/layouts')
            .input(typedBody<UploadBody>().extend({ params: codeParams }))
            .handler(async ({ context, input }) => ({
                status: 201 as const,
                headers: {},
                body: await printing(context).upload(
                    input.params.code,
                    input.body,
                ),
            })),
        reportLayoutChoose: route('PUT', '/reports/{code}/layout-default')
            .input(
                typedBody<{ layout: string }>().extend({ params: codeParams }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await printing(context).choose(
                        input.params.code,
                        input.body,
                    ),
                ),
            ),
        reportLayoutRemove: route('DELETE', '/reports/{code}/layouts/{ref}')
            .input(
                z.object({ params: refParams, body: z.unknown().optional() }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await printing(context).remove(
                        input.params.code,
                        input.params.ref,
                        input.body,
                    ),
                ),
            ),
        reportLayoutFile: route('GET', '/reports/{code}/layouts/{ref}/file')
            .input(z.object({ params: refParams }))
            .handler(async ({ context, input }) =>
                file(
                    await printing(context).download(
                        input.params.code,
                        input.params.ref,
                    ),
                ),
            ),
        reportLayoutPreview: route(
            'GET',
            '/reports/{code}/layouts/{ref}/preview',
        )
            .input(
                typedQuery<z.input<typeof printQuerySchema>>().extend({
                    params: refParams,
                }),
            )
            .handler(async ({ context, input }) => {
                const parsed = query(context);
                if (!parsed.success) return unknownFormat;
                return file(
                    await printing(context).preview(
                        input.params.code,
                        input.params.ref,
                        parsed.data.format ?? null,
                    ),
                );
            }),
        letterheadList: route('GET', '/letterheads').handler(
            async ({ context }) =>
                ok(
                    await new Letterheads(
                        context.db,
                        await coreWorkspace(context),
                        catalog,
                    ).list(),
                ),
        ),
        letterheadSave: route('PUT', '/letterheads/{id}')
            .input(
                typedBody<LetterheadInput>().extend({
                    params: z.object({ id: z.string() }),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await new Letterheads(
                        context.db,
                        await coreWorkspace(context, input.body),
                        catalog,
                    ).save(input.params.id, input.body),
                ),
            ),
    };
}
