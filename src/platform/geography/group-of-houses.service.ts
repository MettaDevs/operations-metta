import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import {
    Database,
    isoSql,
    nowSql,
    sqlErrorCode,
    type Bind,
} from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import {
    groupOfHousesRowSchema,
    saveGroupOfHousesSchema,
    type GroupOfHousesRow,
    type SaveGroupOfHouses,
} from './group-of-houses.schema.ts';

const found = z.object({ found: z.boolean() });

const rowSql = `
    select g.id, g.tenant_id, g.village_id, g.code, g.name, g.active, g.postal_code, g.override_postal_code,
           v.name as village_name, d.name as district_name, r.name as regency_name, p.name as province_name,
           ${isoSql('g.created_at')} as created_at, ${isoSql('g.updated_at')} as updated_at, g.version
    from ref_group_of_houses g
    join ref_villages v on v.id = g.village_id
    join ref_districts d on d.id = v.district_id
    join ref_regencies r on r.id = d.regency_id
    join ref_provinces p on p.id = r.province_id`;

function nameTaken(): never {
    return validation({
        name: 'Nama ini sudah dipakai di desa/kelurahan yang sama.',
    });
}

// Dusun, banjar, atau sebutan setempat lain di bawah desa. Berbeda dengan master wilayah, ia milik satu tenant:
// klinik mencatat dusun pasiennya sendiri, dan tenant lain tidak melihatnya. Menghapus mengisi deleted_at, jadi alamat
// yang kelak menunjuknya tetap utuh dan namanya boleh dipakai lagi.
export class GroupsOfHouses {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dipakai pemilih di form alamat oleh setiap anggota tenant, jadi cukup tenant aktif.
    async list(parameters: URLSearchParams) {
        const bindings: (string | null)[] = [this.workspace.tenantId];
        const filters = ['g.tenant_id = $1', 'g.deleted_at is null'];
        const village = parameters.get('village_id');
        if (village) {
            bindings.push(lookupId(village));
            filters.push(`g.village_id = $${bindings.length}`);
        }
        return incrementalList(this.db, {
            query: `${rowSql} where ${filters.join(' and ')}`,
            bindings,
            parameters,
            columns: { name: 'name', code: 'code' },
            searchColumns: ['name', 'code', 'village_name', 'district_name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
    }

    async create(body: unknown) {
        this.workspace.guard('reference-data', 'update');
        const data = saveGroupOfHousesSchema.parse(body);
        const postalCode = await this.postalCode(data);
        await this.ensureNameFree(data, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        await this.write(() =>
            this.db.insert('ref_group_of_houses', {
                id,
                tenant_id: this.workspace.tenantId,
                village_id: data.village_id,
                code: data.code,
                name: data.name,
                active: data.active,
                postal_code: postalCode,
                override_postal_code: data.override_postal_code,
                created_at: stamp,
                updated_at: stamp,
            }),
        );
        return {
            status: 201,
            headers: {
                Location: `/api/v1/settings/address-setup/group-of-houses/${id}`,
            },
            body: { data: await this.row(id) },
        };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('reference-data', 'update');
        await this.row(id);
        const data = saveGroupOfHousesSchema.parse(body);
        const version = expectedVersion(request, body);
        const postalCode = await this.postalCode(data);
        await this.ensureNameFree(data, id);
        await this.write(() =>
            this.claim(
                id,
                version,
                `village_id = $4, code = $5, name = $6, active = $7, postal_code = $8, override_postal_code = $9,
                 updated_at = $10`,
                [
                    data.village_id,
                    data.code,
                    data.name,
                    data.active,
                    postalCode,
                    data.override_postal_code,
                    nowSql(),
                ],
            ),
        );
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async delete(request: Request, id: string, body: unknown) {
        this.workspace.guard('reference-data', 'update');
        await this.row(id);
        const version = expectedVersion(request, body);
        const stamp = nowSql();
        await this.claim(id, version, 'deleted_at = $4, updated_at = $4', [
            stamp,
        ]);
        return { status: 204, headers: {}, body: undefined };
    }

    // Baris tenant ini yang belum dihapus. Dusun tenant lain dijawab 404, supaya keberadaannya tidak bocor.
    private async row(id: string): Promise<GroupOfHousesRow> {
        const row = lookupId(id)
            ? await this.db.one(
                  groupOfHousesRowSchema,
                  `${rowSql} where g.tenant_id = $1 and g.id = $2 and g.deleted_at is null`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!row) abort(404, 'Not Found');
        return row;
    }

    // Desa harus ada di master wilayah bersama. Tanpa kode pos sendiri, dusun memakai kode pos desanya.
    private async postalCode(data: SaveGroupOfHouses): Promise<string | null> {
        const village = await this.db.one(
            z.object({ postal_code: z.string().nullable() }),
            'select postal_code from ref_villages where id = $1 and tenant_id is null',
            [data.village_id],
        );
        if (!village)
            validation({ village_id: 'Pilih desa/kelurahan dari daftar.' });
        return data.override_postal_code
            ? data.postal_code
            : village.postal_code;
    }

    private async ensureNameFree(
        data: SaveGroupOfHouses,
        except: string | null,
    ): Promise<void> {
        const taken = await this.db.one(
            found,
            `select true as found from ref_group_of_houses
             where tenant_id = $1 and village_id = $2 and lower(name) = lower($3) and deleted_at is null
               ${except ? 'and id <> $4' : ''}
             limit 1`,
            except
                ? [this.workspace.tenantId, data.village_id, data.name, except]
                : [this.workspace.tenantId, data.village_id, data.name],
        );
        if (taken) nameTaken();
    }

    // Dua permintaan yang lolos pemeriksaan nama bersamaan: indeks unik yang memutuskan.
    private async write(action: () => Promise<unknown>): Promise<void> {
        try {
            await action();
        } catch (error) {
            if (
                sqlErrorCode(error) === '23505' &&
                error instanceof Error &&
                error.message.includes('ref_group_of_houses_name_unique')
            )
                nameTaken();
            throw error;
        }
    }

    // Perubahan bersyarat pada versi yang dibuka pengguna (RowVersion::claim CoreERP), dalam satu UPDATE: trigger
    // menaikkan versinya sekali. Bila tidak ada baris yang berubah, barisnya hilang (404) atau sudah diubah orang lain
    // (409).
    private async claim(
        id: string,
        version: number,
        assignments: string,
        values: Bind[],
    ): Promise<void> {
        const claimed = await this.db.execute(
            `update ref_group_of_houses set ${assignments}
             where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null`,
            [this.workspace.tenantId, id, version, ...values],
        );
        if (claimed) return;
        const exists = await this.db.one(
            found,
            'select true as found from ref_group_of_houses where tenant_id = $1 and id = $2 and deleted_at is null',
            [this.workspace.tenantId, id],
        );
        if (!exists) abort(404, 'Not Found');
        coded(409, 'stale_version', staleMessage);
    }
}
