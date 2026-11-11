import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import type { Bind, Database } from '@core/platform/database/index.ts';
import { sharedLegalEntities } from '@core/platform/data-sharing/index.ts';
import { validation } from '@core/platform/http/index.ts';
import { patientDataSharing } from '../../module.ts';

// Tujuan hierarchy yang dipasang migration module ini. Sysadmin menyusun kelompok di layar Hierarki organisasi.
export const sharingPurpose = 'healthcare.patient-sharing';

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

// Siapa melihat pasien siapa. Pola F&O (keputusan pemilik produk, 10 November 2026):
//
// - Bawaan: pasien terlihat di semua operating unit yang bekerja untuk legal entity pendaftarnya. Operating unit tidak
//   memisahkan data dalam satu legal entity, sama dengan F&O.
// - Antar legal entity pasien tidak terlihat, kecuali kedua legal entity ikut satu kebijakan aktif dan sudah berlaku
//   untuk Master pasien di Sys Admin → Data sharing (cross-company data sharing F&O, milik Core). Satu legal entity
//   hanya ikut satu kebijakan aktif per jenis data.
// - Mempersempit dalam legal entity: unit yang ditempatkan sysadmin di hierarchy bertujuan "Tidak sharing master pasien" hanya
//   berbagi dengan kelompoknya. Kepala kelompok sebuah unit adalah operating unit teratas di jalurnya ke akar, pada
//   versi terbit yang sedang berlaku; kelompok adalah kepala itu beserta semua operating unit di bawahnya. Unit yang
//   tidak ditempatkan memakai bawaan legal entity: ia berbagi dengan semua unit lain yang juga tidak ditempatkan.
//
// Jadi pasien p terlihat dari legal entity L dan unit g bila legal entity p sama dengan L atau sekebijakan dengannya,
// dan unit pendaftar p sekelompok dengan g (keduanya di kelompok yang sama, atau keduanya tidak ditempatkan).
// Kelompok dan kebijakan dihitung setiap kali data dibaca; catatan pasien tidak pernah ditulis ulang.
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

    // Unit pemilik nomor rekam medis untuk pasien yang didaftarkan di unit ini: kepala kelompoknya, atau null bila unit
    // tidak ditempatkan di kelompok, yang berarti NRM diambil dari sequence legal entity.
    async numberingUnit(unitId: string): Promise<string | null> {
        const heads = [
            ...new Set((await this.heads([unitId])).map((row) => row.head_id)),
        ];
        if (heads.length > 1)
            validation({
                org_unit_id:
                    'Unit kerja ini masuk lebih dari satu kelompok di hierarki Tidak sharing master pasien. Minta admin merapikan susunannya di Hierarki organisasi.',
            });
        return heads[0] ?? null;
    }

    // Legal entity yang pasiennya terlihat dari legal entity ini: dirinya sendiri, ditambah anggota kebijakan aktif dan
    // sudah berlaku untuk Master pasien di Sys Admin → Data sharing, dibaca lewat layanan Core.
    sharedLegalEntities(legalEntityId: string): Promise<string[]> {
        return sharedLegalEntities(
            this.db,
            this.tenantId,
            patientDataSharing,
            legalEntityId,
        );
    }

    // Syarat SQL bahwa pasien `k` terlihat dari legal entity ini dan dari salah satu unit yang disebut. units null
    // berarti semua unit (batas data "seluruh organisasi"): hanya aturan legal entity yang berlaku.
    async clause(
        legalEntityId: string | null,
        units: string[] | null,
        bind: (value: Bind) => string,
    ): Promise<string> {
        if (!legalEntityId) return 'false';
        const companies = await this.sharedLegalEntities(legalEntityId);
        const company = `k.legal_entity_id in (${companies.map((id) => bind(id)).join(',')})`;
        if (units === null) return company;
        const unique = [...new Set(units)];
        if (!unique.length) return 'false';
        const heads = await this.heads(unique);
        const placed = new Set(heads.map((row) => row.unit_id));
        const parts: string[] = [];
        if (heads.length) {
            const pairs = heads.map(
                (_, index) =>
                    `(c.version_id = $${index * 2 + 1} and c.ancestor_organization_id = $${index * 2 + 2})`,
            );
            const members = await this.db.rows(
                z.object({ id: z.string() }),
                `select distinct c.descendant_organization_id as id
                 from organization_hierarchy_closures c
                 join organizations o on o.id = c.descendant_organization_id and o.classification = 'operating_unit'
                 where c.deleted_at is null and (${pairs.join(' or ')})`,
                heads.flatMap((row) => [row.version_id, row.head_id]),
            );
            parts.push(
                `k.org_unit_id in (${members.map((row) => bind(row.id)).join(',') || 'null'})`,
            );
        }
        if (unique.some((id) => !placed.has(id))) {
            const versions = await this.versions();
            parts.push(
                versions.length
                    ? `not exists (select 1 from organization_hierarchy_closures placed
                                   where placed.distance = 0 and placed.deleted_at is null
                                     and placed.descendant_organization_id = k.org_unit_id
                                     and placed.version_id in (${versions.map((id) => bind(id)).join(',')}))`
                    : 'true',
            );
        }
        return `${company} and (${parts.join(' or ') || 'false'})`;
    }

    // Syarat SQL pasien yang terlihat bagi pengguna. Urutannya: tenant (pemanggil), izin (guard pemanggil), legal
    // entity aktif beserta kebijakan berbaginya, lalu kelompok dari unit yang diberikan kepadanya lewat kebijakan data
    // `healthcare.patient-unit` di legal entity aktif. Batas "seluruh organisasi" tidak membatasi unit.
    async visible(
        workspace: Workspace,
        bind: (value: Bind) => string,
    ): Promise<string> {
        return this.clause(
            workspace.legalEntityId,
            grantedUnits(workspace),
            bind,
        );
    }
}

// Unit yang diberikan kepada pengguna lewat kebijakan data pasien untuk legal entity aktif (atau tanpa legal entity).
// null berarti seluruh organisasi.
export function grantedUnits(workspace: Workspace): string[] | null {
    if (workspace.policy.kind === 'all') return null;
    return workspace.policy.grants
        .filter(
            (grant) =>
                grant.legalEntityId === null ||
                grant.legalEntityId === workspace.legalEntityId,
        )
        .flatMap((grant) => grant.operatingUnitIds);
}

// Unit yang boleh menjadi unit pendaftar: unit aktif di tempat kerja, dan unit itu sendiri termasuk batas data pengguna.
export function grantsUnit(workspace: Workspace, unitId: string): boolean {
    const units = grantedUnits(workspace);
    return units === null || units.includes(unitId);
}
