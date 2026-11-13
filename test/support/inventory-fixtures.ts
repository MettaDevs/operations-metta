import type postgres from 'postgres';
import type { Browser } from './operations-app.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from './tenant-fixtures.ts';

// Satu bisnis sintetis untuk test persediaan: legal entity dan operating unit dibuat lewat API organisasi, sehingga
// parameter persediaan, alasan bawaan, dan nomor penyesuaian lahir lewat jalur yang sama dengan aplikasi.

export const inventoryApi = '/api/v1/inventory';

export const inventoryDuties = [
    'core.organization.manage',
    'core.inventory-setup.manage',
    'core.inventory-item.manage',
    'core.inventory-adjustment.manage',
    'core.inventory-period.manage',
];

export async function json<T>(response: Response, status: number): Promise<T> {
    const text = await response.text();
    if (response.status !== status)
        throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
    return JSON.parse(text) as T;
}

export async function refused(response: Response) {
    return (await json<{ errors: Record<string, string[]> }>(response, 422))
        .errors;
}

type Reference = { id: string; code: string; name: string };
export type Adjustment = {
    id: string;
    number: string;
    status: string;
    version: number;
    lines: { id: string }[];
};
export type AdjustmentLine = {
    item_id: string;
    quantity: number | string;
    batch_number?: string | null;
    expiry_date?: string | null;
    unit_cost?: number | string | null;
    batch_id?: string | null;
};

export async function createBusiness(
    pool: postgres.Sql,
    browser: () => Browser,
    name: string,
    duties: string[] = inventoryDuties,
) {
    const tenantId = await createTenant(pool, name);
    const member = await createMember(pool, tenantId, duties);
    await grantAllOrganizations(pool, tenantId, member.membershipId);
    const admin = browser();
    await admin.login(member.email, member.password);
    const created = async <T = Reference>(
        path: string,
        body: Record<string, unknown>,
    ) => (await json<{ data: T }>(await admin.post(path, body), 201)).data;
    const suffix = String(Math.floor(Math.random() * 1e6));
    const legalEntityId = (
        await created('/api/v1/organizations', {
            classification: 'legal_entity',
            name: `PT ${name}`,
            company_code: `K${suffix}`,
            country_code: 'ID',
        })
    ).id;
    const operatingUnit = async (unitName: string) =>
        (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: unitName,
                operating_unit_type: 'department',
                operating_unit_number: `U${Math.floor(Math.random() * 1e6)}`,
            })
        ).id;
    const unitId = await operatingUnit(`Puskesmas ${name}`);
    const uom = await created(`${inventoryApi}/units-of-measure`, {
        code: 'TAB',
        name: 'Tablet',
    });
    const reasons = (
        await json<{ data: Reference[] }>(
            await admin.get(`${inventoryApi}/reason-codes`),
            200,
        )
    ).data;
    const reason = (code: string) => {
        const found = reasons.find((entry) => entry.code === code);
        if (!found) throw new Error(`Reason ${code} was not seeded.`);
        return found.id;
    };

    const trackingCode = (code: string, flags: Record<string, boolean>) =>
        created(`${inventoryApi}/item-tracking-codes`, {
            code,
            name: `Profil ${code}`,
            ...flags,
        });
    const location = (code: string, body: Record<string, unknown> = {}) =>
        created(`${inventoryApi}/locations`, {
            code,
            name: `Lokasi ${code}`,
            operating_unit_id: unitId,
            ...body,
        });
    const item = <T = Reference>(
        code: string,
        body: Record<string, unknown> = {},
    ) =>
        created<T>(`${inventoryApi}/items`, {
            code,
            name: `Barang ${code}`,
            base_unit_id: uom.id,
            ...body,
        });

    async function draft(
        direction: 'masuk' | 'keluar',
        locationId: string,
        lines: AdjustmentLine[],
        postingDate = '2026-11-01',
    ) {
        return created<Adjustment>(`${inventoryApi}/adjustments`, {
            direction,
            location_id: locationId,
            posting_date: postingDate,
            reason_id: reason(
                direction === 'masuk' ? 'SALDO-AWAL' : 'PEMAKAIAN',
            ),
            lines,
        });
    }
    const post = (document: { id: string; version: number }) =>
        admin.post(`${inventoryApi}/adjustments/${document.id}/post`, {
            version: document.version,
        });
    const reverse = (document: { id: string; version: number }) =>
        admin.post(`${inventoryApi}/adjustments/${document.id}/reverse`, {
            version: document.version,
        });
    // Membuat lalu memposting satu dokumen; jawaban posting dikembalikan apa adanya.
    async function adjust(
        direction: 'masuk' | 'keluar',
        locationId: string,
        lines: AdjustmentLine[],
        postingDate = '2026-11-01',
    ) {
        return post(await draft(direction, locationId, lines, postingDate));
    }
    async function posted(
        direction: 'masuk' | 'keluar',
        locationId: string,
        lines: AdjustmentLine[],
        postingDate = '2026-11-01',
    ) {
        return (
            await json<{ data: Adjustment }>(
                await adjust(direction, locationId, lines, postingDate),
                200,
            )
        ).data;
    }

    // Periode persediaan yang berakhir pada tanggal itu, dibuat lalu ditutup.
    async function closedPeriod(endingDate: string) {
        const period = await created<{ id: string; version: number }>(
            `${inventoryApi}/periods`,
            { ending_date: endingDate },
        );
        return (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(`${inventoryApi}/periods/${period.id}/close`, {
                    version: period.version,
                }),
                200,
            )
        ).data;
    }
    const reopenPeriod = (period: { id: string; version: number }) =>
        admin.post(`${inventoryApi}/periods/${period.id}/reopen`, {
            version: period.version,
        });

    // Stok per nomor batch dari SQL langsung, bukan dari API yang sedang diuji.
    async function stock(itemId: string, locationId: string) {
        const rows = await pool.unsafe<
            { batch: string | null; stock: string }[]
        >(
            `select t.no_batch as batch, trim_scale(sum(k.sisa))::text as stock
             from gd_tr_kartu_gudang k
             left join gd_m_batch t on t.id = k.batch_id
             where k.tenant_id = $1 and k.barang_id = $2 and k.lokasi_id = $3
             group by t.no_batch
             having sum(k.sisa) <> 0
             order by t.no_batch nulls first`,
            [tenantId, itemId, locationId],
        );
        return Object.fromEntries(
            rows.map((row) => [row.batch ?? '-', Number(row.stock)]),
        );
    }

    return {
        tenantId,
        legalEntityId,
        unitId,
        admin,
        member,
        uom,
        reason,
        operatingUnit,
        trackingCode,
        location,
        item,
        draft,
        post,
        reverse,
        adjust,
        posted,
        closedPeriod,
        reopenPeriod,
        stock,
    };
}

export type Business = Awaited<ReturnType<typeof createBusiness>>;
