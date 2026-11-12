import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    json,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type ServiceLocation = {
    id: string;
    operating_unit: { id: string; name: string };
    section: { id: string; name: string } | null;
    location: { id: string; code: string; name: string };
    version: number;
};

// Lokasi layanan resep: satu baris bawaan per operating unit dan satu per section asal, lokasi harus milik legal entity
// tempat kerja dan bukan transit, section hanya yang dikenal dari resep, dan hapus bersifat lunak. Butuh PostgreSQL yang
// sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('service locations', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let farmasi: { id: string };
    const section = {
        id: '00000000-0000-7000-8000-0000000000b1',
        name: 'Poli Gigi',
    };
    const path = `${api}/service-locations`;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Setelan');
        farmasi = await pharmacy.location('FARMASI');
        const item = await pharmacy.item('AMX');
        await pharmacy.issue([{ item, quantity: '1' }], { section });
    });

    test('the unit default and a section override are separate rows, each unique', async () => {
        const unitDefault = (
            await json<{ data: ServiceLocation }>(
                await pharmacy.admin.post(path, {
                    operating_unit_id: pharmacy.unitId,
                    section_id: null,
                    location_id: farmasi.id,
                }),
                201,
            )
        ).data;
        expect(unitDefault.section).toBeNull();
        expect(unitDefault.location.code).toBe('FARMASI');
        const override = (
            await json<{ data: ServiceLocation }>(
                await pharmacy.admin.post(path, {
                    operating_unit_id: pharmacy.unitId,
                    section_id: section.id,
                    location_id: farmasi.id,
                }),
                201,
            )
        ).data;
        expect(override.section).toEqual(section);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path, {
                        operating_unit_id: pharmacy.unitId,
                        section_id: null,
                        location_id: farmasi.id,
                    }),
                ),
            ),
        ).toEqual(['operating_unit_id']);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path, {
                        operating_unit_id: pharmacy.unitId,
                        section_id: section.id,
                        location_id: farmasi.id,
                    }),
                ),
            ),
        ).toEqual(['section_id']);
        const other = await pharmacy.location('FAR-2');
        const moved = (
            await json<{ data: ServiceLocation }>(
                await pharmacy.admin.patch(`${path}/${override.id}`, {
                    location_id: other.id,
                    version: override.version,
                }),
                200,
            )
        ).data;
        expect(moved.location.id).toBe(other.id);
        expect(moved.section).toEqual(section);
        expect(
            (
                await pharmacy.admin.patch(`${path}/${override.id}`, {
                    location_id: farmasi.id,
                    version: override.version,
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await pharmacy.admin.delete(`${path}/${override.id}`, {
                    version: moved.version,
                })
            ).status,
        ).toBe(204);
        const [archived] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from far_m_lokasi_layanan where id = $1',
            [override.id],
        );
        expect(archived?.deleted).toBe(true);
        await json(
            await pharmacy.admin.post(path, {
                operating_unit_id: pharmacy.unitId,
                section_id: section.id,
                location_id: farmasi.id,
            }),
            201,
        );
    });

    test('malformed, foreign, transit, and unknown references are refused field by field, and unknown rows are 404', async () => {
        const transit = await pharmacy.location('TRANSIT', {
            is_transit: true,
        });
        const other = await createPharmacy(
            pool,
            browser,
            'Farmasi Uji Setelan Lain',
        );
        const foreign = await other.location('FARMASI');
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path, {
                        operating_unit_id: 'bukan-uuid',
                        section_id: 'x',
                        location_id: 'y',
                    }),
                ),
            ).sort(),
        ).toEqual(['location_id', 'operating_unit_id', 'section_id']);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path, {
                        operating_unit_id: other.unitId,
                        section_id: Bun.randomUUIDv7(),
                        location_id: foreign.id,
                    }),
                ),
            ).sort(),
        ).toEqual(['location_id', 'operating_unit_id', 'section_id']);
        expect(
            await refused(
                await pharmacy.admin.post(path, {
                    operating_unit_id: pharmacy.unitId,
                    section_id: null,
                    location_id: transit.id,
                }),
            ),
        ).toEqual({
            location_id: [
                'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai mutasi.',
            ],
        });
        expect(
            (
                await pharmacy.admin.patch(`${path}/bukan-uuid`, {
                    location_id: farmasi.id,
                    version: 1,
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await pharmacy.admin.delete(`${path}/${Bun.randomUUIDv7()}`, {
                    version: 1,
                })
            ).status,
        ).toBe(404);
    });

    test('viewing and changing the mapping are separate rights', async () => {
        const viewer = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.setup.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            viewer.membershipId,
        );
        const session = browser();
        await session.login(viewer.email, viewer.password);
        const listed = await json<{ can_manage: boolean }>(
            await session.get(path),
            200,
        );
        expect(listed.can_manage).toBe(false);
        expect(
            (
                await session.post(path, {
                    operating_unit_id: pharmacy.unitId,
                    section_id: null,
                    location_id: farmasi.id,
                })
            ).status,
        ).toBe(403);
    });
});
