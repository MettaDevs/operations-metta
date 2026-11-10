import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import type { Database } from '@core/platform/database/index.ts';
import { validation } from '@core/platform/http/index.ts';

// Tujuan hierarchy yang dipasang migration module ini. Sysadmin menyusun kelompok di layar Hierarki organisasi.
export const sharingPurpose = 'healthcare.patient-sharing';

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

// Kelompok berbagi pasien. Rancangan kita sendiri, karena F&O tidak punya scope data menurut hierarchy:
//
// - Kelompok dibaca dari hierarchy Organization bertujuan "kelompok berbagi pasien", memakai versi terbit yang
//   sedang berlaku (tanggal berlaku paling akhir yang sudah lewat) di setiap hierarchy aktif.
// - Kepala kelompok sebuah unit adalah operating unit teratas di jalurnya ke akar. Kelompok adalah kepala itu beserta
//   semua operating unit di bawahnya. Bila akar hierarchy perusahaan, setiap unit langsung di bawahnya memimpin
//   kelompoknya sendiri; bila akarnya operating unit, seluruh pohon satu kelompok.
// - Unit yang tidak ditempatkan di hierarchy itu menjadi kelompok sendiri.
// - Memisah atau menggabung kelompok berarti versi hierarchy baru. Catatan pasien tidak ditulis ulang: kelompok
//   dihitung setiap kali data dibaca.
export class PatientSharing {
    private versionCache: string[] | null = null;

    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
    ) {}

    private async versions(): Promise<string[]> {
        this.versionCache ??= (
            await this.db.rows(
                z.object({ id: z.string() }),
                `select distinct on (h.id) v.id
                 from organization_hierarchies h
                 join organization_hierarchy_purposes hp on hp.hierarchy_id = h.id
                 join hierarchy_purposes p on p.id = hp.purpose_id and p.code = $2
                 join organization_hierarchy_versions v on v.hierarchy_id = h.id
                 where h.tenant_id = $1 and h.status = 'active' and v.status = 'published'
                   and v.effective_from <= current_timestamp
                 order by h.id, v.effective_from desc, v.version_number desc`,
                [this.tenantId, sharingPurpose],
            )
        ).map((row) => row.id);
        return this.versionCache;
    }

    // Kepala kelompok setiap unit, per versi hierarchy yang memuatnya. Unit di luar hierarchy tidak muncul.
    private async heads(unitIds: string[]) {
        const versions = await this.versions();
        if (!versions.length || !unitIds.length) return [];
        return this.db.rows(
            z.object({
                unit_id: z.string(),
                version_id: z.string(),
                head_id: z.string(),
            }),
            `select c.descendant_organization_id as unit_id, c.version_id,
                    (select a.ancestor_organization_id from organization_hierarchy_closures a
                     join organizations o on o.id = a.ancestor_organization_id and o.classification = 'operating_unit'
                     where a.version_id = c.version_id and a.descendant_organization_id = c.descendant_organization_id
                       and a.deleted_at is null
                     order by a.distance desc limit 1) as head_id
             from organization_hierarchy_closures c
             where c.distance = 0 and c.deleted_at is null
               and c.version_id in (${ids(1, versions.length)})
               and c.descendant_organization_id in (${ids(versions.length + 1, unitIds.length)})`,
            [...versions, ...unitIds],
        );
    }

    // Unit pemilik nomor rekam medis untuk pasien yang didaftarkan di unit ini: kepala kelompoknya.
    async numberingUnit(unitId: string): Promise<string> {
        const heads = [
            ...new Set((await this.heads([unitId])).map((row) => row.head_id)),
        ];
        if (heads.length > 1)
            validation({
                org_unit_id:
                    'Unit kerja ini masuk lebih dari satu kelompok berbagi pasien. Minta admin merapikan susunan kelompoknya di Hierarki organisasi.',
            });
        return heads[0] ?? unitId;
    }

    // Semua operating unit yang sekelompok dengan salah satu unit yang disebut, termasuk unit itu sendiri.
    async members(unitIds: string[]): Promise<string[]> {
        const unique = [...new Set(unitIds)];
        const heads = await this.heads(unique);
        const placed = new Set(heads.map((row) => row.unit_id));
        const members = new Set(unique.filter((id) => !placed.has(id)));
        if (heads.length) {
            const pairs = heads.map(
                (_, index) =>
                    `(c.version_id = $${index * 2 + 1} and c.ancestor_organization_id = $${index * 2 + 2})`,
            );
            const rows = await this.db.rows(
                z.object({ id: z.string() }),
                `select distinct c.descendant_organization_id as id
                 from organization_hierarchy_closures c
                 join organizations o on o.id = c.descendant_organization_id and o.classification = 'operating_unit'
                 where c.deleted_at is null and (${pairs.join(' or ')})`,
                heads.flatMap((row) => [row.version_id, row.head_id]),
            );
            for (const row of rows) members.add(row.id);
        }
        return [...members];
    }

    // Unit pendaftar pasien yang terlihat bagi pengguna: anggota kelompok setiap unit yang diberikan kepadanya lewat
    // kebijakan data pasien. null berarti seluruh tenant (batas data "seluruh organisasi").
    async visibleUnits(workspace: Workspace): Promise<string[] | null> {
        if (workspace.policy.kind === 'all') return null;
        return this.members(
            workspace.policy.grants.flatMap((grant) => grant.operatingUnitIds),
        );
    }
}

// Unit yang boleh menjadi unit pendaftar: unit aktif di tempat kerja, dan unit itu sendiri termasuk batas data pengguna.
export function grantsUnit(workspace: Workspace, unitId: string): boolean {
    return (
        workspace.policy.kind === 'all' ||
        workspace.policy.grants.some((grant) =>
            grant.operatingUnitIds.includes(unitId),
        )
    );
}
