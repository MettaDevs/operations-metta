import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    coded,
    expectedVersion,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import { scheduleParameterInputSchema } from './practice-schedule.schema.ts';

// Tanpa baris setelan, generate otomatis aktif untuk tujuh hari mulai hari ini.
export const defaultAutoGenerate = true;
export const defaultHorizonDays = 7;
const maxHorizonDays = 92;

// Parameter jadwal praktik per tenant, pola halaman "parameters" F&O. Dibaca dengan izin lihat jadwal praktik dan
// diubah dengan izin ubahnya.
export class ScheduleParameters {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async show() {
        this.workspace.guard('practice-schedule', 'read');
        const row = await this.db.one(
            z.object({
                generate_otomatis: z.boolean(),
                horizon_hari: z.number(),
                version: z.number(),
            }),
            'select generate_otomatis, horizon_hari, version from sim_m_parameter_jadwal where tenant_id = $1',
            [this.workspace.tenantId],
        );
        return {
            data: {
                auto_generate: row?.generate_otomatis ?? defaultAutoGenerate,
                horizon_days: row?.horizon_hari ?? defaultHorizonDays,
                version: row?.version ?? null,
                can_update: this.workspace.permissions.has(
                    'healthcare.practice-schedule.update',
                ),
            },
        };
    }

    // Setelan pertama dibuat tanpa versi; sesudahnya perubahan wajib membawa versi yang dibuka pengguna.
    async update(request: Request, body: unknown) {
        this.workspace.guard('practice-schedule', 'update');
        const parsed = scheduleParameterInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ horizon_days: 'Isian parameter jadwal tidak sah.' });
        const horizon = Number(parsed.data.horizon_days);
        if (
            parsed.data.horizon_days === '' ||
            !Number.isInteger(horizon) ||
            horizon < 1 ||
            horizon > maxHorizonDays
        )
            validation({
                horizon_days: `Isi bilangan bulat 1 sampai ${maxHorizonDays}.`,
            });
        const tenantId = this.workspace.tenantId;
        const stamp = nowSql();
        const current = await this.show();
        if (current.data.version === null) {
            await this.db.execute(
                `insert into sim_m_parameter_jadwal (tenant_id, generate_otomatis, horizon_hari, created_at, updated_at)
                 values ($1, $2, $3, $4, $4) on conflict (tenant_id) do nothing`,
                [tenantId, parsed.data.auto_generate, horizon, stamp],
            );
        } else {
            const changed = await this.db.execute(
                `update sim_m_parameter_jadwal set generate_otomatis = $1, horizon_hari = $2, updated_at = $3
                 where tenant_id = $4 and version = $5`,
                [
                    parsed.data.auto_generate,
                    horizon,
                    stamp,
                    tenantId,
                    expectedVersion(request, body),
                ],
            );
            if (!changed) coded(409, 'stale_version', staleMessage);
        }
        return this.show();
    }
}
