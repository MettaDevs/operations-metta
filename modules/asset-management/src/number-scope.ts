import { z } from 'zod';
import {
    failSequence,
    type NumberIssuer,
} from '@core/foundation/number-sequence.ts';
import type { Database } from '@core/platform/db.ts';
import type { Workspace } from '@core/platform/security.ts';

type AssetCodeRequest = {
    key: string;
    groupId: string;
    locationId: string | null;
    acquiredOn: string;
};

export function assetCodes(
    db: Database,
    numbers: NumberIssuer,
    workspace: Workspace,
    requests: AssetCodeRequest[],
): Promise<Map<string, string>> {
    return db.transaction(async () => {
        const reference = workspace.moduleId + '.asset-code';
        const fields = await numbers.contextFields(reference);
        const contexts = new Map<string, Record<string, string>>();
        const prepared: {
            key: string;
            values: Record<string, string>;
            rank: string;
            position: number;
        }[] = [];
        for (const [position, request] of requests.entries()) {
            const contextKey = JSON.stringify([
                request.groupId,
                request.locationId,
                request.acquiredOn,
            ]);
            let values = contexts.get(contextKey);
            if (!values) {
                values = {};
                if (fields.length) {
                    const group = await db.one(
                        z.object({
                            kode: z.string(),
                            kelompok_harta_fiskal_id: z.string().nullable(),
                            lokasi_aset_id: z.string().nullable(),
                        }),
                        'select kode,kelompok_harta_fiskal_id,lokasi_aset_id from aset_m_group_aset where tenant_id=$1 and id=$2 and deleted_at is null limit 1 for share',
                        [workspace.tenantId, request.groupId],
                    );
                    if (!group) failSequence('Group aset tidak ditemukan.');
                    const classification = await db.one(
                        z.object({ kode: z.string() }),
                        'select kode from aset_m_kelompok_harta_fiskal where tenant_id=$1 and id=$2 and deleted_at is null limit 1 for share',
                        [workspace.tenantId, group.kelompok_harta_fiskal_id],
                    );
                    const location = await db.one(
                        z.object({ kode: z.string() }),
                        'select kode from aset_m_lokasi_aset where tenant_id=$1 and id=$2 and deleted_at is null limit 1 for share',
                        [
                            workspace.tenantId,
                            request.locationId ?? group.lokasi_aset_id,
                        ],
                    );
                    const available: Record<string, string> = {
                        asset_classification: classification?.kode ?? '',
                        asset_group: group.kode,
                        asset_location: location?.kode ?? '',
                        acquisition_year: request.acquiredOn.slice(0, 4),
                    };
                    const selectedValues: Record<string, string> = {};
                    for (const field of [...fields].sort())
                        selectedValues[field] = available[field] ?? '';
                    values = selectedValues;
                }
                contexts.set(contextKey, values);
            }
            prepared.push({
                key: request.key,
                values,
                rank: JSON.stringify(values),
                position,
            });
        }
        prepared.sort(
            (first, second) =>
                first.rank.localeCompare(second.rank) ||
                first.position - second.position,
        );
        const codes = new Map<string, string>();
        for (const request of prepared) {
            const code = await numbers.issue(
                reference,
                request.key,
                request.values,
            );
            if (code.length > 50)
                failSequence(
                    'Format kode aset melebihi 50 karakter. Pendekkan bagian kode pada pengaturan nomor.',
                );
            codes.set(request.key, code);
        }
        return codes;
    });
}
