import type postgres from 'postgres';
import type { Browser } from '../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../test/support/tenant-fixtures.ts';

// Klinik sintetis untuk test halaman pemeriksaan: satu unit dengan Poli Umum (tanpa jadwal) dan Poli Gigi (jadwal
// dokter hari ini), satu ruangan untuk keduanya, satu pasien, dokter, dan perawat.

export const api = '/api/modules/healthcare/v1';

export const vitals = {
    pulse_rate: 88,
    respiratory_rate: 20,
    consciousness: 'COMPOS MENTIS',
    systolic: 120,
    diastolic: 80,
    height: 158,
    weight: 52,
    waist_circumference: 71,
};

export async function json<T>(response: Response, status: number): Promise<T> {
    const text = await response.text();
    if (response.status !== status)
        throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
    return JSON.parse(text) as T;
}

export async function refused(response: Response) {
    return (await json<{ errors: Record<string, string[]> }>(response, 422))
        .errors;
}

export const fullDuties = [
    'core.organization.manage',
    'core.inventory-setup.manage',
    'healthcare.patient.manage',
    'healthcare.payment-setup.manage',
    'healthcare.service-setup.manage',
    'healthcare.practitioner.manage',
    'healthcare.practice-schedule.manage',
    'healthcare.visit.manage',
    'healthcare.examination.manage',
    'healthcare.clinical-setup.manage',
];

export async function login(
    pool: postgres.Sql,
    browser: () => Browser,
    tenant: string,
    duties: string[],
    scope: { legalEntityId: string; unitId: string } | null = null,
) {
    const account = await createMember(pool, tenant, duties);
    await grantAllOrganizations(pool, tenant, account.membershipId);
    await pool.unsafe(
        `insert into role_assignment_data_policy_scopes
         (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id,
          include_descendants, valid_from, created_at, updated_at)
         select $1, $2, id, 'healthcare.patient-unit', $3, $4, false, now() - interval '1 day', now(), now()
         from role_assignments where membership_id = $5`,
        [
            Bun.randomUUIDv7(),
            tenant,
            scope?.legalEntityId ?? null,
            scope?.unitId ?? null,
            account.membershipId,
        ],
    );
    const session = browser();
    await session.login(account.email, account.password);
    return session;
}

export type Clinic = Awaited<ReturnType<typeof createClinic>>;

export async function createClinic(
    pool: postgres.Sql,
    browser: () => Browser,
    name: string,
) {
    const tenantId = await createTenant(pool, name);
    await entitle(pool, tenantId, 'healthcare');
    await recordInstallation(pool, tenantId, 'healthcare');
    const admin = await login(pool, browser, tenantId, fullDuties);
    const created = async <T = { id: string }>(
        path: string,
        body: Record<string, unknown>,
    ) => (await json<{ data: T }>(await admin.post(path, body), 201)).data;
    const suffix = String(Date.now() % 100000);
    const legalEntityId = (
        await created('/api/v1/organizations', {
            classification: 'legal_entity',
            name: `PT ${name}`,
            company_code: `K${suffix}`,
            country_code: 'ID',
        })
    ).id;
    const operatingUnit = async (unitName: string, number: string) =>
        (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: unitName,
                operating_unit_type: 'department',
                operating_unit_number: number,
            })
        ).id;
    // Satuan obat milik persediaan Core per legal entity; module tidak lagi mengisi satuan bawaan.
    const unitTab = (
        await created('/api/v1/inventory/units-of-measure', {
            code: 'TAB',
            name: 'Tablet',
        })
    ).id;
    const unit = (
        await created('/api/v1/organizations', {
            classification: 'operating_unit',
            name: `Puskesmas ${name}`,
            operating_unit_type: 'department',
            operating_unit_number: `U${suffix}`,
        })
    ).id;
    const roomIn = async (unitId: string, code: string) =>
        (
            await created(`${api}/rooms`, {
                operating_unit_id: unitId,
                code,
                name: `Ruang ${code}`,
            })
        ).id;
    const room = await roomIn(unit, 'R1');
    const otherUnit = await operatingUnit(`Pustu ${name}`, `B${suffix}`);
    const otherRoom = await roomIn(otherUnit, 'B1');
    const section = async (
        sectionName: string,
        prefix: string,
        unitId = unit,
        roomId = room,
    ) =>
        (
            await created(`${api}/sections`, {
                operating_unit_id: unitId,
                name: sectionName,
                kind: 'rawat_jalan',
                queue_prefix: prefix,
                room_ids: [roomId],
            })
        ).id;
    const general = await section('Poli Umum', 'A');
    const dental = await section('Poli Gigi', 'G');
    const lab = await section('Poli KIA', 'K');
    const otherSection = await section('Poli Pustu', 'B', otherUnit, otherRoom);
    const patientType = (
        await created(`${api}/patient-types`, { code: 'UMUM', name: 'Umum' })
    ).id;
    const patientId = (
        await created(`${api}/patients`, {
            name: 'Pasien Uji',
            nationality_country_code: 'AU',
            passport_number: `P${Math.floor(Math.random() * 1e8)}`,
            gender: 'female',
            birth_date: '1985-02-03',
            phone: '081200000041',
            domicile_address: { street: 'Jl. Uji No. 1' },
            payment_methods: [{ patient_type_id: patientType }],
        })
    ).id;
    const professions = Object.fromEntries(
        (
            await pool.unsafe<{ kode: string; id: string }[]>(
                'select kode, id from sim_m_profesi where tenant_id = $1 and deleted_at is null',
                [tenantId],
            )
        ).map((row) => [row.kode, row.id]),
    );
    const practitioner = async (practitionerName: string, profession: string) =>
        (
            await created(`${api}/practitioners`, {
                name: practitionerName,
                nik: String(Date.now() + Math.floor(Math.random() * 1e6))
                    .slice(-12)
                    .padStart(16, '6'),
                gender: 'male',
                phone: '081200000042',
                profession_id: professions[profession],
            })
        ).id;
    const doctor = await practitioner('Dokter Umum', 'dokter');
    const dentist = await practitioner('Dokter Gigi', 'dokter');
    const nurse = await practitioner('Perawat Jaga', 'perawat');
    const session = (
        await created(`${api}/practice-sessions`, {
            name: 'Pagi',
            start_time: '00:00',
            end_time: '23:59',
        })
    ).id;
    const today = (
        await json<{ date: string }>(
            await admin.get(`${api}/visits/metadata`),
            200,
        )
    ).date;
    const dentalSchedule = (
        await created(`${api}/practice-schedules`, {
            section_id: dental,
            date: today,
            practitioner_id: dentist,
            session_id: session,
            capacity: null,
        })
    ).id;

    async function visit(sectionId = general) {
        const registered = await json<{
            data: { id: string; destinations: { id: string }[] };
        }>(
            await admin.post(`${api}/visits`, {
                patient_id: patientId,
                patient_type_id: patientType,
                visit_condition: 'sakit',
                section_id: sectionId,
            }),
            201,
        );
        return {
            visitId: registered.data.id,
            destinationId: registered.data.destinations[0]!.id,
        };
    }

    const start = (id: string, as = admin, roomId = room) =>
        as.post(`${api}/examination/destinations/${id}/start`, {
            room_id: roomId,
        });
    const finish = (id: string, as = admin) =>
        as.post(`${api}/examination/destinations/${id}/finish`, {});
    const recordPath = (id: string) =>
        `${api}/examination/destinations/${id}/medical-record`;

    async function show(id: string, as = admin) {
        return json<{
            data: Record<string, unknown> & { version: number | null };
        }>(await as.get(recordPath(id)), 200);
    }

    async function save(id: string, data: Record<string, unknown>, as = admin) {
        const current = await show(id, as);
        return as.put(recordPath(id), {
            ...current.data,
            physical: { ...(current.data.physical as object), ...vitals },
            ...data,
        });
    }

    // Dokter / tenaga medis yang memeriksa, wajib sebelum Selesai periksa.
    async function examineBy(id: string, doctorId = doctor, as = admin) {
        const current = await show(id, as);
        return save(
            id,
            {
                anamnesis: {
                    ...(current.data.anamnesis as object),
                    doctor_id: doctorId,
                },
            },
            as,
        );
    }

    return {
        tenantId,
        admin,
        legalEntityId,
        unitTab,
        unit,
        otherUnit,
        otherRoom,
        otherSection,
        room,
        general,
        dental,
        lab,
        patientId,
        doctor,
        dentist,
        nurse,
        dentalSchedule,
        today,
        visit,
        start,
        finish,
        show,
        save,
        examineBy,
        recordPath,
    };
}
