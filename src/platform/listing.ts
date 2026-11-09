import { z } from 'zod';
import { Database, jsonObject } from './db.ts';
import type { Bind, JsonObject } from './db.ts';
import { validation } from './errors.ts';
import { idSchema, lookupId } from './model.ts';

export function searchTerms(
    keyword: string,
): { phrase: boolean; text: string }[] {
    const normalized = keyword
        .normalize('NFC')
        .replace(/[\s\p{Z}\uFEFF]+/gu, ' ')
        .toLowerCase();
    return [...normalized.matchAll(/"([^"]*)"|([^\s"]+)/gu)].flatMap(
        (match) => {
            const text = (match[1] ?? match[2] ?? '').trim();
            return /[\p{L}\p{N}]/u.test(text)
                ? [{ phrase: match[1] !== undefined, text }]
                : [];
        },
    );
}

const searchableText = (column: string) =>
    `to_tsvector('simple'::regconfig, regexp_replace(normalize(coalesce(cast(${column} as text), ''), NFC), '[^[:alnum:]]+', ' ', 'g'))`;

const cursorSchema = z
    .object({
        list_sort_null: z.union([z.literal(0), z.literal(1)]),
        list_sort_value: z.union([z.string(), z.number(), z.boolean()]),
        id: idSchema.optional(),
        _pointsToNextItems: z
            .union([z.boolean(), z.string(), z.number()])
            .transform((value) =>
                value === '0' || value === '' ? false : Boolean(value),
            ),
    })
    .catchall(z.union([z.string(), z.number(), z.boolean()]));

export async function incrementalList(
    db: Database,
    options: {
        query: string;
        bindings: Bind[];
        parameters: URLSearchParams;
        columns: Record<string, string>;
        searchColumns: string[];
        numericColumns: string[];
        defaultSort: string;
        defaultDirection: 'asc' | 'desc';
    },
): Promise<{ data: JsonObject[]; next_cursor: string | null }> {
    const input = Object.fromEntries(options.parameters);
    const parsed = z
        .object({
            q: z.string().max(200).optional(),
            sort: z.string().optional(),
            direction: z.enum(['asc', 'desc']).optional(),
            cursor: z.string().max(2000).optional(),
            per_page: z.coerce.number().int().min(1).max(100).optional(),
            record_id: z.string().max(100).optional(),
        })
        .safeParse(input);
    if (!parsed.success)
        validation(
            Object.fromEntries(
                parsed.error.issues.map((issue) => [
                    issue.path.join('.'),
                    issue.message,
                ]),
            ),
        );
    const value = parsed.data;
    const sort = options.columns[value.sort ?? options.defaultSort];
    if (!sort) validation({ sort: 'The selected sort is invalid.' });
    const direction =
        value.direction ?? (value.sort ? 'asc' : options.defaultDirection);
    const numeric = options.numericColumns.includes(sort);
    const bindings = [...options.bindings];
    const bind = (binding: Bind) => {
        bindings.push(binding);
        return '$' + bindings.length;
    };
    const filters: string[] = [];
    if (value.record_id) filters.push('id=' + bind(lookupId(value.record_id)));
    const ids = options.parameters.getAll('record_ids[]');
    if (ids.length > 100 || ids.some((id) => id.length > 100 || id.length < 1))
        validation({
            record_ids:
                'The record ids field must not have more than 100 items.',
        });
    if (options.parameters.has('record_ids[]'))
        filters.push(
            ids.length
                ? `id in (${ids.map((id) => bind(lookupId(id))).join(',')})`
                : 'false',
        );
    const keyword = (value.q ?? '').trim();
    if (keyword) {
        const terms = searchTerms(keyword);
        if (!terms.length) filters.push('false');
        for (const term of terms) {
            const words = term.text.match(/[\p{L}\p{N}]+/gu) ?? [];
            const expression = term.phrase
                ? words.join(' ')
                : words.map((word) => `'${word}':*`).join(' & ');
            const position = bind(expression);
            const tsquery = term.phrase ? 'phraseto_tsquery' : 'to_tsquery';
            const matches = options.searchColumns.map(
                (column) =>
                    `${searchableText(column)} @@ ${tsquery}('simple'::regconfig, ${position})`,
            );
            filters.push(`(${matches.join(' or ')})`);
        }
    }
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (value.cursor) {
        try {
            const candidate = cursorSchema.safeParse(
                JSON.parse(
                    Buffer.from(value.cursor, 'base64url').toString('utf8'),
                ),
            );
            if (candidate.success) cursor = candidate.data;
        } catch {
            /* Invalid cursors share the same public validation error. */
        }
        if (
            !cursor ||
            (sort !== 'id' && cursor.id === undefined) ||
            (numeric && !Number.isFinite(Number(cursor.list_sort_value)))
        )
            validation({
                cursor: 'Posisi daftar tidak valid. Muat ulang daftar.',
            });
    }
    const forward = cursor?._pointsToNextItems ?? true;
    const nullDirection = forward ? 'asc' : 'desc';
    const order = forward ? direction : direction === 'asc' ? 'desc' : 'asc';
    const sortNull = `case when ${sort} is null then 1 else 0 end`;
    const sortValue = numeric
        ? `coalesce(${sort}, 0)`
        : `coalesce(cast(${sort} as text), '')`;
    const where = filters.length ? `where ${filters.join(' and ')}` : '';
    let keyset = '';
    if (cursor) {
        const nullAt = bind(cursor.list_sort_null);
        const valueAt = bind(cursor.list_sort_value);
        const comparison = order === 'asc' ? '>' : '<';
        const tie =
            sort === 'id'
                ? ''
                : `or (list_sort_value = ${valueAt} and id ${comparison} ${bind(cursor.id ?? '')})`;
        keyset = `
            where list_sort_null ${forward ? '>' : '<'} ${nullAt}
               or (list_sort_null = ${nullAt} and (list_sort_value ${comparison} ${valueAt} ${tie}))`;
    }
    const size = value.per_page ?? 40;
    const query = `
        select *
        from (
            select list_records.*,
                   ${sortNull} as list_sort_null,
                   ${sortValue} as list_sort_value
            from (${options.query}) list_records
            ${where}
        ) sorted_records
        ${keyset}
        order by list_sort_null ${nullDirection},
                 list_sort_value ${order}${sort === 'id' ? '' : `, id ${order}`}
        limit ${size + 1}`;
    const rows = await db.rows(jsonObject, query, bindings);
    const more = rows.length > size;
    const items = rows.slice(0, size);
    if (!forward) items.reverse();
    const last = items.at(-1);
    let next: string | null = null;
    if (last && (more || !forward)) {
        next = Buffer.from(
            JSON.stringify({
                list_sort_null: last.list_sort_null,
                list_sort_value: last.list_sort_value,
                ...(sort !== 'id' ? { id: last.id } : {}),
                _pointsToNextItems: true,
            }),
        ).toString('base64url');
    }
    return {
        data: items.map(({ list_sort_null, list_sort_value, ...row }) => row),
        next_cursor: next,
    };
}
