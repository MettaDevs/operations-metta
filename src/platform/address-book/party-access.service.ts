import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import type { Bind, Database } from '../database/index.ts';

// Siapa melihat party mana. Keputusan pemilik produk, 9 November 2026: party berperan hanya terlihat bagi pemegang
// izin lihat salah satu perannya (party_roles.view_permission_code), dan party tanpa peran terlihat bagi pemegang
// izin buku alamat. Izin peran boleh milik module, misalnya pasien, jadi dicari di semua app.
export class PartyAccess {
    private constructor(
        readonly visibleRoles: string[],
        readonly seesUnassigned: boolean,
        readonly seesFullIdentification: boolean,
        readonly seesPrivateLocations: boolean,
    ) {}

    static async open(db: Database, workspace: Workspace) {
        const roles = await db.rows(
            z.object({ code: z.string(), view_permission_code: z.string() }),
            'select code, view_permission_code from party_roles order by code',
        );
        const held = await workspace.holds(
            db,
            roles.map((role) => role.view_permission_code),
        );
        return new PartyAccess(
            roles
                .filter((role) => held.has(role.view_permission_code))
                .map((role) => role.code),
            workspace.permissions.has('core.organization.read'),
            workspace.permissions.has('core.party-identification.read'),
            workspace.permissions.has('core.private-location.read'),
        );
    }

    // Syarat SQL bahwa party `alias` terlihat. `bind` menambah parameter dan memberi nomornya.
    clause(alias: string, bind: (value: Bind) => string): string {
        const registered = `select 1 from party_role_registrations visible_role where visible_role.tenant_id = ${alias}.tenant_id and visible_role.party_id = ${alias}.id`;
        const parts: string[] = [];
        if (this.seesUnassigned) parts.push(`not exists (${registered})`);
        if (this.visibleRoles.length)
            parts.push(
                `exists (${registered} and visible_role.role_code in (${this.visibleRoles.map((role) => bind(role)).join(',')}))`,
            );
        return parts.length ? `(${parts.join(' or ')})` : 'false';
    }
}
