import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import {
    billingSetupInputSchema,
    billingSetupRowSchema,
} from './billing-setup.schema.ts';

// Baris setelan lahir bersama legal entity (trigger kasir_isi_acuan di migration 0063), jadi di sini hanya dibaca dan
// diubah.
export class BillingSetup {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private async row() {
        const found = await this.db.one(
            billingSetupRowSchema,
            `select wajib_clerk as clerk_required, version
             from parameter_kasir where tenant_id = $1 and legal_entity_id = $2`,
            [this.workspace.tenantId, activeLegalEntity(this.workspace)],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async show() {
        this.workspace.guard('billing-setup', 'read');
        return {
            data: await this.row(),
            can_manage: this.workspace.permissions.has(
                'core.billing-setup.update',
            ),
        };
    }

    async update(body: unknown) {
        this.workspace.guard('billing-setup', 'update');
        const parsed = billingSetupInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ clerk_required: 'Pilih apakah clerk wajib.' });
        const updated = await this.db.execute(
            `update parameter_kasir set wajib_clerk = $1, updated_at = $2
             where tenant_id = $3 and legal_entity_id = $4 and version = $5`,
            [
                parsed.data.clerk_required,
                nowSql(),
                this.workspace.tenantId,
                activeLegalEntity(this.workspace),
                parsed.data.version,
            ],
        );
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { data: await this.row() };
    }
}
