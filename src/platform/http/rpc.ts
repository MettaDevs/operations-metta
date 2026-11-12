import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { type Database, sqlErrorCode } from '../database/index.ts';
import { reportError } from '../error-reporting/index.ts';
import { HttpFailure } from './errors.ts';
import type { Session, Sso } from '../identity/index.ts';

export type Context = {
    db: Database;
    session: Session;
    // Masuk lewat SSO; null bila SSO tidak disetel.
    sso: Sso | null;
    request: Request;
    errorHeaders: Record<string, string>;
};
export const bodyInput = z.object({ body: z.unknown() });
export const recordInput = z.object({ params: z.object({ id: z.string() }) });
export const mutationInput = recordInput.extend({ body: z.unknown() });
// Body yang diperiksa service, bukan oRPC: pesan 422-nya tetap milik service, dan tipenya sampai ke layar lewat
// klien oRPC.
export const typedBody = <T>() => z.object({ body: z.custom<T>() });
// Query string yang dibaca handler dari URL-nya sendiri; skema ini hanya memberi tipe untuk pemanggil di layar.
export const typedQuery = <T>() => z.object({ query: z.custom<T>() });
export const ok = <T extends object>(body: T) => ({
    status: 200 as const,
    headers: {},
    body,
});

export const base = os.$context<Context>().use(async ({ context, next }) => {
    try {
        return await next();
    } catch (error) {
        if (error instanceof HttpFailure) {
            context.errorHeaders = error.headers;
            throw new ORPCError('PHP_HTTP', {
                status: error.status,
                data: error.body,
                message: error.message,
            });
        }
        if (error instanceof z.ZodError) {
            process.stderr.write(
                JSON.stringify({
                    event: 'native-row-validation-failed',
                    fields: error.issues.map((issue) => issue.path.join('.')),
                    messages: error.issues.map((issue) => issue.message),
                }) + '\n',
            );
        } else {
            process.stderr.write(
                JSON.stringify({
                    event: 'native-request-failed',
                    error: error instanceof Error ? error.name : typeof error,
                    code: sqlErrorCode(error),
                    message: error instanceof Error ? error.message : undefined,
                }) + '\n',
            );
        }
        reportError(error, {
            method: context.request.method,
            path: new URL(context.request.url).pathname,
        });
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
            status: 500,
            data: { message: 'Server Error' },
        });
    }
});
