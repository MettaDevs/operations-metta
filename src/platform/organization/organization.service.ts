import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { Database, nowSql } from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    validation,
} from '../http/index.ts';
import {
    createOrganizationSchema,
    organizationRowSchema,
    timezones,
    updateOrganizationSchema,
    type OrganizationRow,
} from './organization.schema.ts';

// Bentuk tanggal Eloquent saat diubah ke JSON: UTC dengan enam angka mikrodetik.
export const isoSql = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS".000000Z"')`;

export const staleMessage =
    'Perubahanmu belum disimpan karena data ini sudah diubah sejak kamu membukanya. Muat ulang untuk melihat data terbaru, lalu ulangi perubahanmu.';

// Organisasi beserta relasi legalEntity dan operatingUnit, dengan kolom dan urutan yang sama dengan Eloquent.
const organizationSql = `
    select o.id, o.tenant_id, o.name, o.classification, o.status,
           ${isoSql('o.created_at')} as created_at, ${isoSql('o.updated_at')} as updated_at,
           o.created_by_user_id, o.updated_by_user_id, o.version,
           case when le.organization_id is null then null else json_build_object(
               'organization_id', le.organization_id, 'company_code', le.company_code,
               'country_code', le.country_code, 'created_at', ${isoSql('le.created_at')},
               'updated_at', ${isoSql('le.updated_at')}, 'tenant_id', le.tenant_id,
               'fiscal_calendar_id', le.fiscal_calendar_id, 'created_by_user_id', le.created_by_user_id,
               'updated_by_user_id', le.updated_by_user_id, 'timezone', le.timezone, 'version', le.version)
           end as legal_entity,
           case when ou.organization_id is null then null else json_build_object(
               'organization_id', ou.organization_id, 'type', ou.type,
               'created_at', ${isoSql('ou.created_at')}, 'updated_at', ${isoSql('ou.updated_at')},
               'tenant_id', ou.tenant_id, 'number', ou.number, 'created_by_user_id', ou.created_by_user_id,
               'updated_by_user_id', ou.updated_by_user_id, 'version', ou.version)
           end as operating_unit
    from organizations o
    left join legal_entities le on le.organization_id = o.id
    left join operating_units ou on ou.organization_id = o.id`;

// UserClock::options CoreERP: nama zona IANA beserta selisihnya dari UTC saat ini, urut dari selisih terkecil.
export function timezoneOptions(): { value: string; label: string }[] {
    const now = new Date();
    return timezones
        .map((zone) => {
            const offset =
                new Intl.DateTimeFormat('en-US', {
                    timeZone: zone,
                    timeZoneName: 'longOffset',
                })
                    .formatToParts(now)
                    .find((part) => part.type === 'timeZoneName')
                    ?.value.replace('GMT', '') || '+00:00';
            const [, sign = '+', hours = '0', minutes = '0'] =
                /^([+-])(\d{2}):(\d{2})$/.exec(offset) ?? [];
            const seconds =
                (sign === '-' ? -1 : 1) *
                (Number(hours) * 3600 + Number(minutes) * 60);
            return { seconds, value: zone, label: `${zone} · UTC${offset}` };
        })
        .sort(
            (left, right) =>
                left.seconds - right.seconds ||
                (left.value < right.value
                    ? -1
                    : left.value > right.value
                      ? 1
                      : 0),
        )
        .map(({ value, label }) => ({ value, label }));
}

function unitNumberInUse(): never {
    return validation({
        operating_unit_number:
            'Kode unit sudah dipakai unit lain dalam bisnis ini.',
    });
}

function violates(error: unknown, constraint: string): boolean {
    return error instanceof Error && error.message.includes(`"${constraint}"`);
}

export class Organizations {
    constructor(
        private readonly db: Database,
        readonly workspace: Workspace,
    ) {}

    get canManage(): boolean {
        return this.workspace.permissions.has('core.organization.update');
    }

    // Pengecekan izin action CoreERP (`hasCorePermission(ORGANIZATION_UPDATE)`), yang menolak dengan 403.
    requireManage(): void {
        this.workspace.guard('organization', 'update');
    }

    async rows(ids: string[]): Promise<OrganizationRow[]> {
        if (!ids.length) return [];
        const found = await this.db.rows(
            organizationRowSchema,
            `${organizationSql} where o.tenant_id = $1 and o.id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
            [this.workspace.tenantId, ...ids],
        );
        const byId = new Map(found.map((row) => [row.id, row]));
        return ids.flatMap((id) => byId.get(id) ?? []);
    }

    async index() {
        return {
            data: await this.db.rows(
                organizationRowSchema,
                `${organizationSql} where o.tenant_id = $1 order by o.name, o.id`,
                [this.workspace.tenantId],
            ),
        };
    }

    // Daftar bertahap layar organisasi (OrganizationPageRecords::batch): scope dan urutan diterapkan sebelum batas
    // batch, lalu setiap baris diganti organisasi lengkap.
    async batch(
        parameters: URLSearchParams,
        scope:
            | { classification: 'legal_entity' | 'operating_unit' }
            | { activeOnly: true; excludeVersionId: string | null },
    ) {
        const bindings: (string | null)[] = [this.workspace.tenantId];
        const filters = ['o.tenant_id = $1'];
        if ('classification' in scope) {
            bindings.push(scope.classification);
            filters.push(`o.classification = $${bindings.length}`);
        } else {
            filters.push("o.status = 'active'");
            if (scope.excludeVersionId) {
                bindings.push(scope.excludeVersionId);
                filters.push(
                    `o.id not in (select organization_id from organization_hierarchy_nodes where version_id = $${bindings.length} and deleted_at is null)`,
                );
            }
        }
        const batch = await incrementalList(this.db, {
            query: `select o.id, o.name, o.classification, o.status, coalesce(company.company_code, unit.number) as code
                    from organizations o
                    left join legal_entities company on company.organization_id = o.id
                    left join operating_units unit on unit.organization_id = o.id
                    where ${filters.join(' and ')}`,
            bindings,
            parameters,
            columns: { name: 'name', code: 'code' },
            searchColumns: ['name', 'code'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: await this.rows(batch.data.map((row) => String(row.id))),
            next_cursor: batch.next_cursor,
        };
    }

    async create(body: unknown) {
        this.requireManage();
        const data = createOrganizationSchema.parse(body);
        const tenantId = this.workspace.tenantId;
        if (
            data.classification === 'legal_entity' &&
            (await this.db.one(
                z.object({ found: z.boolean() }),
                'select true as found from legal_entities where tenant_id = $1 and company_code = $2 limit 1',
                [tenantId, data.company_code],
            ))
        )
            validation({
                company_code:
                    'Kode perusahaan sudah digunakan pada tenant ini.',
            });
        const number = data.operating_unit_number;
        if (number !== null && (await this.numberTaken(number, null)))
            unitNumberInUse();
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await this.db.insert('organizations', {
                    id,
                    tenant_id: tenantId,
                    classification: data.classification,
                    name: data.name,
                    status: 'active',
                    created_at: stamp,
                    updated_at: stamp,
                });
                if (data.classification === 'legal_entity')
                    await this.db.insert('legal_entities', {
                        organization_id: id,
                        tenant_id: tenantId,
                        company_code: data.company_code,
                        country_code: String(data.country_code).toUpperCase(),
                        // Tanpa pilihan, bawaan kolomnya yang berlaku.
                        ...(data.timezone !== null
                            ? { timezone: data.timezone }
                            : {}),
                        created_at: stamp,
                        updated_at: stamp,
                    });
                else
                    await this.db.insert('operating_units', {
                        organization_id: id,
                        tenant_id: tenantId,
                        type: data.operating_unit_type,
                        number,
                        created_at: stamp,
                        updated_at: stamp,
                    });
            });
        } catch (error) {
            // Dua permintaan yang lolos pemeriksaan di atas bersamaan: indeks unik yang memutuskan, dan transaksinya
            // sudah dibatalkan seluruhnya.
            if (violates(error, 'operating_units_tenant_number_unique'))
                unitNumberInUse();
            throw error;
        }
        const [saved] = await this.rows([id]);
        if (!saved) throw new Error('Created organization is missing.');
        // Model yang baru dibuat Eloquent hanya membawa kolom yang diisinya, tanpa versi dan kolom actor.
        return {
            status: 201,
            headers: { Location: `/api/v1/organizations/${id}` },
            body: {
                data: {
                    tenant_id: saved.tenant_id,
                    classification: saved.classification,
                    name: saved.name,
                    status: saved.status,
                    id: saved.id,
                    updated_at: saved.updated_at,
                    created_at: saved.created_at,
                    legal_entity: saved.legal_entity,
                    operating_unit: saved.operating_unit,
                },
            },
        };
    }

    async update(request: Request, id: string, body: unknown) {
        // Route model binding CoreERP mencari organisasi tanpa melihat tenant; tenant diperiksa action.
        const found = lookupId(id)
            ? await this.db.one(
                  organizationRowSchema,
                  `${organizationSql} where o.id = $1`,
                  [id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        this.requireManage();
        const data = updateOrganizationSchema(found).parse(body);
        if (
            data.submitted_company_code !== null &&
            (await this.db.one(
                z.object({ found: z.boolean() }),
                'select true as found from legal_entities where company_code = $1 and tenant_id = $2 and organization_id <> $3 limit 1',
                [data.submitted_company_code, found.tenant_id, found.id],
            ))
        )
            validation({
                company_code: 'The company code has already been taken.',
            });
        const version = expectedVersion(request, body);
        if (found.tenant_id !== this.workspace.tenantId)
            abort(403, 'Tidak diizinkan.');
        const renumber =
            found.classification === 'operating_unit' &&
            'operating_unit_number' in data;
        const number = renumber ? (data.operating_unit_number ?? null) : null;
        if (number !== null && (await this.numberTaken(number, found.id)))
            unitNumberInUse();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await this.claim(found.id, version);
                await this.db.execute(
                    'update organizations set name = $1, updated_at = $2 where id = $3 and name is distinct from $1',
                    [data.name, stamp, found.id],
                );
                if (found.classification === 'legal_entity')
                    await this.db.execute(
                        `update legal_entities set company_code = $1, country_code = $2, ${data.timezone !== null ? 'timezone = $5, ' : ''}updated_at = $3 where organization_id = $4`,
                        [
                            data.company_code,
                            data.country_code,
                            stamp,
                            found.id,
                            ...(data.timezone !== null ? [data.timezone] : []),
                        ],
                    );
                // tenant_id ikut ditulis setiap kali: operating unit dari rilis CoreERP lama belum punya salinannya,
                // dan indeks unik nomor berdiri di atasnya.
                else
                    await this.db.execute(
                        `update operating_units set tenant_id = $1, type = $2, ${renumber ? 'number = $5, ' : ''}updated_at = $3 where organization_id = $4`,
                        [
                            found.tenant_id,
                            data.operating_unit_type,
                            stamp,
                            found.id,
                            ...(renumber ? [number] : []),
                        ],
                    );
            });
        } catch (error) {
            if (violates(error, 'operating_units_tenant_number_unique'))
                unitNumberInUse();
            throw error;
        }
        const [saved] = await this.rows([found.id]);
        if (!saved) throw new Error('Updated organization is missing.');
        return { status: 200, headers: {}, body: { data: saved } };
    }

    private async numberTaken(
        number: string,
        except: string | null,
    ): Promise<boolean> {
        return !!(await this.db.one(
            z.object({ found: z.boolean() }),
            `select true as found from operating_units where tenant_id = $1 and number = $2 ${except ? 'and organization_id <> $3' : ''} limit 1`,
            except
                ? [this.workspace.tenantId, number, except]
                : [this.workspace.tenantId, number],
        ));
    }

    // RowVersion::claim CoreERP: update bersyarat pada versi yang dibuka pengguna. Trigger menaikkan versinya dan
    // baris itu terkunci sampai transaksi selesai.
    private async claim(id: string, version: number): Promise<void> {
        const claimed = await this.db.execute(
            'update organizations set version = $1 where tenant_id = $2 and id = $3 and version = $1',
            [version, this.workspace.tenantId, id],
        );
        if (claimed) return;
        const exists = await this.db.one(
            z.object({ found: z.boolean() }),
            'select true as found from organizations where tenant_id = $1 and id = $2',
            [this.workspace.tenantId, id],
        );
        if (!exists) abort(404, 'Not Found');
        coded(409, 'stale_version', staleMessage);
    }
}
