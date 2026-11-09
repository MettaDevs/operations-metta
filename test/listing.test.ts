import { expect, test } from 'bun:test';
import type postgres from 'postgres';
import { Database, type Bind } from '../src/platform/db.ts';
import { HttpFailure } from '../src/platform/errors.ts';
import { incrementalList, searchTerms } from '../src/platform/listing.ts';

const id = '019313d0-6c4b-1b08-d2b8-cf3c1114ca74';

function list(parameters: string) {
    const statements: { query: string; parameters: Bind[] }[] = [];
    const unsafe = async (query: string, parameters: Bind[]) => {
        statements.push({ query, parameters });
        return Object.assign([], { count: 0 });
    };
    const db = new Database(
        { unsafe } as unknown as postgres.ReservedSql,
        undefined,
        'test',
    );
    const result = incrementalList(db, {
        query: 'select id,tanggal from records',
        bindings: [],
        parameters: new URLSearchParams(parameters),
        columns: { id: 'id', tanggal: 'tanggal' },
        searchColumns: [],
        numericColumns: [],
        defaultSort: 'tanggal',
        defaultDirection: 'desc',
    });
    return { result, statements };
}

function cursor(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('record search retains phrases, Unicode words and punctuation behavior', () => {
    expect(searchTerms('  "Aset baru" CAFE\u0301.12  ')).toEqual([
        { phrase: true, text: 'aset baru' },
        { phrase: false, text: 'café.12' },
    ]);
    expect(searchTerms('--- ... !!!')).toEqual([]);
    expect(searchTerms('"" pompa-air')).toEqual([
        { phrase: false, text: 'pompa-air' },
    ]);
});

test('record filters that are not ids match nothing instead of reaching the uuid column', async () => {
    const { result, statements } = list(
        `record_id=01JC9X0V2B3C4D5E6F7G8H9JKM&record_ids[]=not-an-id&record_ids[]=${id}`,
    );
    expect(await result).toEqual({ data: [], next_cursor: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.query).toContain('id=$1 and id in ($2,$3)');
    expect(statements[0]?.parameters).toEqual([null, null, id]);
});

test('a cursor whose tie-break id is not an id is a stale list position', async () => {
    const stale = list(
        'cursor=' +
            cursor({
                list_sort_null: 0,
                list_sort_value: '2026-11-01',
                id: '01JC9X0V2B3C4D5E6F7G8H9JKM',
                _pointsToNextItems: true,
            }),
    );
    const failure = await stale.result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpFailure);
    expect((failure as HttpFailure).status).toBe(422);
    expect((failure as HttpFailure).body).toEqual({
        message: 'Posisi daftar tidak valid. Muat ulang daftar.',
        errors: { cursor: ['Posisi daftar tidak valid. Muat ulang daftar.'] },
    });
    expect(stale.statements).toHaveLength(0);

    const current = list(
        'cursor=' +
            cursor({
                list_sort_null: 0,
                list_sort_value: '2026-11-01',
                id,
                _pointsToNextItems: true,
            }),
    );
    await current.result;
    expect(current.statements[0]?.parameters).toEqual([0, '2026-11-01', id]);
});
