import type postgres from 'postgres';

// Data number sequence untuk test yang memakai database, ditulis lewat SQL langsung. Kode reference dan app unik per
// pemanggilan, jadi test boleh berjalan berulang dan bersamaan di database yang sama.

export async function createModule(sql: postgres.Sql): Promise<string> {
    const appId = `uji-nomor-${Bun.randomUUIDv7().slice(-12)}`;
    await sql.unsafe(
        "insert into apps (id, name, version, status, created_at, updated_at) values ($1, 'Modul uji nomor', '1.0.0', 'internal', now(), now())",
        [appId],
    );
    return appId;
}

export async function createReference(
    sql: postgres.Sql,
    appId: string,
    name: string,
    allowedScopes: string[] = ['tenant', 'legal_entity', 'operating_unit'],
): Promise<{ id: string; code: string }> {
    const id = Bun.randomUUIDv7();
    const code = `${appId}.dokumen-${id.slice(-8)}`;
    await sql.unsafe(
        'insert into app_number_sequence_references (id, app_id, code, name, allowed_scopes, created_at, updated_at) values ($1, $2, $3, $4, $5::text::json, now(), now())',
        [id, appId, code, name, JSON.stringify(allowedScopes)],
    );
    return { id, code };
}

export async function createProfile(sql: postgres.Sql): Promise<string> {
    await sql.unsafe(
        `insert into number_sequence_profiles (code, name, segments, created_at, updated_at)
         values ('uji', 'Profil uji', '[{"type":"number","length":5}]', now(), now())
         on conflict (code) do nothing`,
    );
    return 'uji';
}

type Segment = Record<string, string | number>;

export async function createSequence(
    sql: postgres.Sql,
    tenantId: string,
    referenceId: string,
    settings: Record<string, string | number | boolean | null | Segment[]>,
): Promise<string> {
    const id = Bun.randomUUIDv7();
    const row: Record<string, string | number | boolean | null> = {
        id,
        tenant_id: tenantId,
        reference_id: referenceId,
        profile_code: await createProfile(sql),
        scope_type: 'tenant',
        status: 'active',
        preallocation_enabled: true,
        preallocation_quantity: 20,
        minimum_number: 1,
        maximum_number: 19999,
        reset_period: 'never',
        segments: JSON.stringify([
            { type: 'constant', value: 'DOKU' },
            { type: 'number', length: 5 },
        ]),
    };
    for (const [key, value] of Object.entries(settings))
        row[key] = Array.isArray(value) ? JSON.stringify(value) : value;
    const fields = Object.keys(row);
    await sql.unsafe(
        `insert into tenant_number_sequences (${fields.join(',')}, created_at, updated_at) values (${fields
            .map(
                (field, index) =>
                    `$${index + 1}${field === 'segments' ? '::text::json' : ''}`,
            )
            .join(',')}, now(), now())`,
        Object.values(row),
    );
    return id;
}

export async function createLegalEntity(
    sql: postgres.Sql,
    tenantId: string,
    companyCode: string,
    fiscalCalendarId: string | null = null,
): Promise<string> {
    const id = Bun.randomUUIDv7();
    await sql.unsafe(
        "insert into organizations (id, tenant_id, name, classification, status, created_at, updated_at) values ($1, $2, $3, 'legal_entity', 'active', now(), now())",
        [id, tenantId, `Perusahaan ${companyCode}`],
    );
    await sql.unsafe(
        "insert into legal_entities (organization_id, tenant_id, company_code, country_code, fiscal_calendar_id, created_at, updated_at) values ($1, $2, $3, 'ID', $4, now(), now())",
        [id, tenantId, companyCode, fiscalCalendarId],
    );
    return id;
}

export async function createOperatingUnit(
    sql: postgres.Sql,
    tenantId: string,
    name: string,
    number: string | null = null,
): Promise<string> {
    const id = Bun.randomUUIDv7();
    await sql.unsafe(
        "insert into organizations (id, tenant_id, name, classification, status, created_at, updated_at) values ($1, $2, $3, 'operating_unit', 'active', now(), now())",
        [id, tenantId, name],
    );
    await sql.unsafe(
        "insert into operating_units (organization_id, tenant_id, type, number, created_at, updated_at) values ($1, $2, 'department', $3, now(), now())",
        [id, tenantId, number],
    );
    return id;
}

// Kalender fiskal yang tahunnya mengikuti tahun kalender, dengan dua belas periode bulanan per tahun.
export async function createFiscalCalendar(
    sql: postgres.Sql,
    tenantId: string,
    years: number[],
): Promise<{
    id: string;
    periods: Map<string, { id: string; yearId: string }>;
}> {
    const id = Bun.randomUUIDv7();
    await sql.unsafe(
        'insert into fiscal_calendars (id, tenant_id, code, name, created_at, updated_at) values ($1, $2, $3, $4, now(), now())',
        [id, tenantId, `FC${id.slice(-6)}`, 'Kalender uji'],
    );
    const periods = new Map<string, { id: string; yearId: string }>();
    for (const year of years) {
        const yearId = Bun.randomUUIDv7();
        await sql.unsafe(
            'insert into fiscal_years (id, fiscal_calendar_id, name, starts_on, ends_on, created_at, updated_at) values ($1, $2, $3, $4, $5, now(), now())',
            [yearId, id, `FY${year}`, `${year}-01-01`, `${year}-12-31`],
        );
        for (let month = 1; month <= 12; month++) {
            const periodId = Bun.randomUUIDv7();
            const starts = `${year}-${String(month).padStart(2, '0')}-01`;
            await sql.unsafe(
                "insert into fiscal_periods (id, fiscal_year_id, ordinal, name, starts_on, ends_on, created_at, updated_at) values ($1, $2, $3, $4, $5::date, ($5::date + interval '1 month' - interval '1 day')::date, now(), now())",
                [periodId, yearId, month, `P${month}`, starts],
            );
            periods.set(starts.slice(0, 7), { id: periodId, yearId });
        }
    }
    return { id, periods };
}
