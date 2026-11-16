import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../support/operations-app.ts';
import { createTenant } from '../../support/tenant-fixtures.ts';

// Tabel yang ditambah migration sesudah 0066_change_log_always_logged tidak dicatat log perubahan, walau migration itu
// masih mendaftarkannya dengan all lewat baris tanpa tenant seperti pola lama. Hanya baris milik tenant yang menyalakan.
describe.skipIf(!process.env.DB_HOST)(
    'change log of tables added later',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, close } = operationsTestApp();
        const table = `uji_log_${Bun.randomUUIDv7().replaceAll('-', '')}`;
        let tenantId: string;

        beforeAll(async () => {
            tenantId = await createTenant(pool, 'Klinik Uji Tabel Baru');
            await pool.unsafe(`
            CREATE TABLE public.${table} (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, nama text NOT NULL);
            CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.${table}
                FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
            INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion,
                                                        log_modification, log_deletion, created_at, updated_at)
            VALUES (gen_random_uuid(), NULL, '${table}', 'Tabel uji', 'all', 'all', 'all', now(), now());
        `);
        });
        afterAll(async () => {
            await pool.unsafe(`
            DELETE FROM public.change_log_setup_tables WHERE table_name = '${table}';
            DROP TABLE public.${table};
        `);
            await close();
        });

        const write = (nama: string) =>
            pool.unsafe(
                `insert into public.${table} (id, tenant_id, nama) values ($1, $2, $3)`,
                [Bun.randomUUIDv7(), tenantId, nama],
            );
        const entries = async () => [
            ...(await pool.unsafe<{ new_value: string; protected: boolean }[]>(
                'select new_value, protected from change_log_entries where table_name = $1 order by id',
                [table],
            )),
        ];

        test('a table registered with all for every tenant writes no entry, until the tenant turns it on', async () => {
            await write('tanpa setelan tenant');
            expect(await entries()).toEqual([]);

            await pool.unsafe(
                `insert into change_log_setup_tables (id, tenant_id, table_name, log_insertion, log_modification, log_deletion,
                 created_at, updated_at)
             values ($1, $2, $3, 'all', 'none', 'none', now(), now())`,
                [Bun.randomUUIDv7(), tenantId, table],
            );
            await write('dengan setelan tenant');
            expect(await entries()).toEqual([
                { new_value: 'dengan setelan tenant', protected: false },
            ]);
        });
    },
);
