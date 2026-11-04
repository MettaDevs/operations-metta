import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { type Database, sqlErrorCode } from './db.ts';
import { HttpFailure } from './errors.ts';
import type { Session } from './security.ts';

export type Context = {
    db: Database;
    session: Session;
    request: Request;
    errorHeaders: Record<string, string>;
};
export const bodyInput = z.object({ body: z.unknown() });
export const recordInput = z.object({ params: z.object({ id: z.string() }) });
export const mutationInput = recordInput.extend({ body: z.unknown() });
export const ok = (body: object) => ({ status: 200, headers: {}, body });

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
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
            status: 500,
            data: { message: 'Server Error' },
        });
    }
});
