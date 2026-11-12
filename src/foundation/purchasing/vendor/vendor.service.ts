import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    Parties,
    registerPartyRole,
} from '../../../platform/address-book/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity, parseInput } from '../../inventory/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import {
    vendorInputSchema,
    vendorRowSchema,
    vendorStatuses,
} from './vendor.schema.ts';

const numberReference = 'core.vendor-number';

const rowSql = `select * from (
                    select v.id, v.number, p.name, v.tax_number, v.status, v.version, v.party_id
                    from vendors v
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    where v.tenant_id = $1 and v.legal_entity_id = $2) vendors
                where true`;

const messages = {
    name: 'Isi nama vendor.',
    tax_number: 'Isi NPWP paling banyak 32 karakter.',
    status: 'Pilih status aktif atau nonaktif.',
};

// Vendor (Vendor di BC) per legal entity. Identitasnya party organisasi di buku alamat, dengan peran vendor; nomornya
// terbit dari number sequence legal entity. Vendor tidak dihapus: vendor yang tidak dipakai lagi dibuat nonaktif,
// seperti Blocked di BC, dan tidak bisa dipilih di dokumen baru.
export class Vendors {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('vendor', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(vendorStatuses)
            .safeParse(parameters.get('status'));
        const filter = status.success
            ? ` and status = $${bindings.push(status.data)}`
            : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: { number: 'number', name: 'name', status: 'status' },
            searchColumns: ['number', 'name', 'tax_number'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => vendorRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('core.vendor.update'),
        };
    }

    private async stored(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  vendorRowSchema.extend({ party_id: z.string() }),
                  `${rowSql} and vendors.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async row(id: string) {
        return vendorRowSchema.parse(await this.stored(id));
    }

    private checked(body: unknown) {
        const data = parseInput(vendorInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const name = data.name.trim();
        if (!name) errors.name = messages.name;
        else if (name.length > 200)
            errors.name = 'Nama vendor paling banyak 200 karakter.';
        const taxNumber = data.tax_number?.trim() || null;
        if (taxNumber && taxNumber.length > 32)
            errors.tax_number = messages.tax_number;
        if (Object.keys(errors).length) validation(errors);
        return { name, taxNumber, status: data.status ?? 'active' };
    }

    async create(body: unknown) {
        this.workspace.guard('vendor', 'update');
        const data = this.checked(body);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const partyId = await new Parties(
                this.db,
                this.workspace,
            ).createForRole(
                { type: 'organization', status: 'active', name: data.name },
                `vendor:${id}`,
            );
            await registerPartyRole(this.db, {
                tenantId: this.scope.tenantId,
                partyId,
                roleCode: 'vendor',
                legalEntityId: this.scope.legalEntityId,
                owningAppId: 'core',
            });
            const number = await new NumberIssuer(this.db, {
                tenantId: this.scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: numberReference,
                key: `vendor:${id}`,
                documentDate: nowSql().slice(0, 10),
                legalEntityId: this.scope.legalEntityId,
            });
            const stamp = nowSql();
            await this.db.insert('vendors', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                party_id: partyId,
                number,
                tax_number: data.taxNumber,
                status: data.status,
                created_at: stamp,
                updated_at: stamp,
            });
        });
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Nama diubah di party-nya, di transaksi yang sama dengan baris vendor, seperti Name di kartu vendor BC.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('vendor', 'update');
        const current = await this.stored(id);
        const data = this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        await this.db.transaction(async () => {
            updated = await this.db.execute(
                `update vendors set tax_number = $1, status = $2, updated_at = $3
                 where tenant_id = $4 and legal_entity_id = $5 and id = $6 and version = $7`,
                [
                    data.taxNumber,
                    data.status,
                    nowSql(),
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.id,
                    version,
                ],
            );
            if (!updated) return;
            if (data.name !== current.name)
                await new Parties(this.db, this.workspace).updateForRole(
                    current.party_id,
                    { name: data.name },
                );
        });
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }
}
