import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    activePanels,
    examinationPanels,
    isExaminationPanel,
    panelSettingSchema,
} from '../../examination/medical-record/medical-record.panels.ts';
import { activeOperatingUnit, operatingUnits } from '../room/room.service.ts';
import { isSectionKind } from './section.kinds.ts';
import { defaultQueueMode, isQueueMode } from './section.queue-modes.ts';
import { sectionInputSchema, sectionRowSchema } from './section.schema.ts';

const rowSql = `select * from (
                    select s.id, s.operating_unit_id, o.name as operating_unit_name, s.nama as name, s.jenis as kind,
                           s.kode_no_bukti as document_code, s.kode_poli_bpjs as bpjs_clinic_code,
                           s.mode_antrean as queue_mode, s.awalan_antrean as queue_prefix,
                           coalesce((select json_agg(json_build_object('id', r.id, 'code', r.kode, 'name', r.nama,
                                                                       'is_active', r.aktif) order by r.urutan, r.kode)
                                     from sim_m_section_ruangan l
                                     join sim_m_ruangan r on r.tenant_id = l.tenant_id and r.id = l.ruangan_id
                                                         and r.deleted_at is null
                                     where l.tenant_id = s.tenant_id and l.section_id = s.id and l.deleted_at is null),
                                    '[]'::json) as rooms,
                           coalesce((select json_agg(json_build_object('id', k.id, 'code', k.kode, 'name', k.nama)
                                                     order by k.urutan, k.kode)
                                     from sim_m_section_klaster c
                                     join sim_m_klaster k on k.tenant_id = c.tenant_id and k.id = c.klaster_id
                                     where c.tenant_id = s.tenant_id and c.section_id = s.id and c.deleted_at is null),
                                    '[]'::json) as clusters,
                           coalesce((select json_agg(json_build_object('code', b.panel_kode, 'active', b.aktif))
                                     from sim_m_section_panel_pemeriksaan b
                                     where b.tenant_id = s.tenant_id and b.section_id = s.id and b.deleted_at is null),
                                    '[]'::json) as panel_settings,
                           s.aktif as is_active, s.version
                    from sim_m_section s
                    join organizations o on o.tenant_id = s.tenant_id and o.id = s.operating_unit_id
                    where s.tenant_id = $1 and s.deleted_at is null) sections
                where true`;

const optional = (value: string | null | undefined) => value?.trim() || null;

const storedRowSchema = sectionRowSchema
    .omit({ examination_panels: true })
    .extend({ panel_settings: z.array(panelSettingSchema) });

function sectionRow(raw: unknown) {
    const { panel_settings: settings, ...row } = storedRowSchema.parse(raw);
    return sectionRowSchema.parse({
        ...row,
        examination_panels: activePanels(settings),
    });
}

function checked(body: unknown) {
    const parsed = sectionInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const name = data?.name.trim() ?? '';
    const kind = data?.kind ?? '';
    const documentCode = optional(data?.document_code);
    const bpjsClinicCode = optional(data?.bpjs_clinic_code);
    const queuePrefix = optional(data?.queue_prefix);
    if (!name) errors.name = 'Isi nama section.';
    else if (name.length > 100) errors.name = 'Paling panjang 100 karakter.';
    if (!isSectionKind(kind)) errors.kind = 'Pilih jenis section dari daftar.';
    if (documentCode && documentCode.length > 10)
        errors.document_code = 'Paling panjang 10 karakter.';
    if (bpjsClinicCode && bpjsClinicCode.length > 20)
        errors.bpjs_clinic_code = 'Paling panjang 20 karakter.';
    if (data?.queue_mode !== undefined && !isQueueMode(data.queue_mode))
        errors.queue_mode = 'Pilih cara antrean dari daftar.';
    if (queuePrefix && queuePrefix.length > 5)
        errors.queue_prefix = 'Paling panjang 5 karakter.';
    if (data?.examination_panels?.some((code) => !isExaminationPanel(code)))
        errors.examination_panels = 'Pilih bagian pemeriksaan dari daftar.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        operatingUnitId: data.operating_unit_id,
        name,
        kind,
        documentCode,
        bpjsClinicCode,
        queueMode: data.queue_mode,
        queuePrefix,
        roomIds: data.room_ids ? [...new Set(data.room_ids)] : undefined,
        clusterIds: data.cluster_ids
            ? [...new Set(data.cluster_ids)]
            : undefined,
        examinationPanels: data.examination_panels
            ? new Set(data.examination_panels)
            : undefined,
        isActive: data.is_active ?? true,
    };
}

function nameTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_section_nama_unique')
    )
        validation({
            name: 'Nama ini sudah dipakai section lain di unit yang sama.',
        });
}

// Section milik tenant, diisi admin di Setup, beserta ruangan yang melayaninya. Bukan data yang dibatasi per unit:
// unit hanya isian section, dan semua pemegang izin section melihat section semua unit tenant.
export class Sections {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Pilihan unit dan ruangan, serta izin layar section. Ruangan nonaktif ikut, supaya ruangan yang sudah terpasang
    // tetap terbaca namanya.
    async metadata() {
        this.workspace.guard('section', 'read');
        return {
            operating_units: await operatingUnits(
                this.db,
                this.workspace.tenantId,
            ),
            rooms: await this.db.rows(
                z.object({
                    id: z.string(),
                    operating_unit_id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    is_active: z.boolean(),
                }),
                `select id, operating_unit_id, kode as code, nama as name, aktif as is_active from sim_m_ruangan
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [this.workspace.tenantId],
            ),
            // Klaster yang dapat dipilih untuk section. Klaster nonaktif ikut supaya pilihan tersimpan tetap terbaca.
            clusters: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    is_active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as is_active from sim_m_klaster
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [this.workspace.tenantId],
            ),
            // Katalog panel pemeriksaan untuk pilihan Bagian pemeriksaan di kartu section.
            examination_panels: examinationPanels.map((panel) => ({
                code: panel.code,
                label: panel.label,
                by_default: activePanels([]).includes(panel.code),
            })),
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.section.create',
                ),
                update: this.workspace.permissions.has(
                    'healthcare.section.update',
                ),
                delete: this.workspace.permissions.has(
                    'healthcare.section.delete',
                ),
            },
        };
    }

    // Daftar bertahap. Saring per unit (`operating_unit_id`), jenis (`kind`), dan status (`active`/`inactive`).
    async list(parameters: URLSearchParams) {
        this.workspace.guard('section', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const bind = (value: string | boolean) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const filters: string[] = [];
        const unit = lookupId(parameters.get('operating_unit_id') ?? '');
        if (unit) filters.push(`operating_unit_id = ${bind(unit)}`);
        const kind = parameters.get('kind') ?? '';
        if (isSectionKind(kind)) filters.push(`kind = ${bind(kind)}`);
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive')
            filters.push(`is_active = ${bind(status === 'active')}`);
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}`,
            bindings,
            parameters,
            columns: {
                name: 'name',
                operating_unit_name: 'operating_unit_name',
                kind: 'kind',
            },
            searchColumns: ['name', 'operating_unit_name', 'document_code'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map(sectionRow),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  storedRowSchema,
                  `${rowSql} and sections.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return sectionRow(found);
    }

    // Satu baris per panel katalog: panel yang dikirim aktif, sisanya nonaktif. Baris yang nilainya sudah sama tidak
    // disentuh.
    private async savePanels(sectionId: string, chosen: ReadonlySet<string>) {
        const stamp = nowSql();
        const current = await this.db.rows(
            z.object({ id: z.string(), code: z.string(), active: z.boolean() }),
            `select id, panel_kode as code, aktif as active from sim_m_section_panel_pemeriksaan
             where tenant_id = $1 and section_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, sectionId],
        );
        for (const panel of examinationPanels) {
            const active = chosen.has(panel.code);
            const row = current.find((item) => item.code === panel.code);
            if (!row)
                await this.db.insert('sim_m_section_panel_pemeriksaan', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.workspace.tenantId,
                    section_id: sectionId,
                    panel_kode: panel.code,
                    aktif: active,
                    created_at: stamp,
                    updated_at: stamp,
                });
            else if (row.active !== active)
                await this.db.execute(
                    `update sim_m_section_panel_pemeriksaan set aktif = $1, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [active, stamp, this.workspace.tenantId, row.id],
                );
        }
    }

    // Ruangan section harus ruangan unit section itu sendiri.
    private async checkRooms(operatingUnitId: string, roomIds: string[]) {
        if (!roomIds.length) return;
        const ids = roomIds.filter((id) => lookupId(id));
        const found = ids.length
            ? await this.db.rows(
                  z.object({ id: z.string() }),
                  `select id from sim_m_ruangan
                   where tenant_id = $1 and operating_unit_id = $2 and deleted_at is null
                     and id in (${ids.map((_, index) => `$${index + 3}`).join(',')})`,
                  [this.workspace.tenantId, operatingUnitId, ...ids],
              )
            : [];
        if (found.length !== roomIds.length)
            validation({
                room_ids: 'Pilih ruangan dari unit section ini.',
            });
    }

    private async checkClusters(clusterIds: string[]) {
        if (!clusterIds.length) return;
        const ids = clusterIds.filter((id) => lookupId(id));
        const found = ids.length
            ? await this.db.rows(
                  z.object({ id: z.string() }),
                  `select id from sim_m_klaster
                   where tenant_id = $1 and deleted_at is null
                     and id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
                  [this.workspace.tenantId, ...ids],
              )
            : [];
        if (found.length !== clusterIds.length)
            validation({ cluster_ids: 'Pilih klaster dari daftar.' });
    }

    private async saveClusters(
        sectionId: string,
        clusterIds: string[],
        current: string[],
    ) {
        const stamp = nowSql();
        const removed = current.filter((id) => !clusterIds.includes(id));
        if (removed.length)
            await this.db.execute(
                `update sim_m_section_klaster set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and section_id = $3 and deleted_at is null
                   and klaster_id in (${removed.map((_, index) => `$${index + 4}`).join(',')})`,
                [stamp, this.workspace.tenantId, sectionId, ...removed],
            );
        for (const clusterId of clusterIds.filter(
            (id) => !current.includes(id),
        ))
            await this.db.insert('sim_m_section_klaster', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                section_id: sectionId,
                klaster_id: clusterId,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    private async saveRooms(
        sectionId: string,
        roomIds: string[],
        current: string[],
    ) {
        const stamp = nowSql();
        const removed = current.filter((id) => !roomIds.includes(id));
        if (removed.length)
            await this.db.execute(
                `update sim_m_section_ruangan set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and section_id = $3 and deleted_at is null
                   and ruangan_id in (${removed.map((_, index) => `$${index + 4}`).join(',')})`,
                [stamp, this.workspace.tenantId, sectionId, ...removed],
            );
        for (const roomId of roomIds.filter((id) => !current.includes(id)))
            await this.db.insert('sim_m_section_ruangan', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                section_id: sectionId,
                ruangan_id: roomId,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    async create(body: unknown) {
        this.workspace.guard('section', 'create');
        const data = checked(body);
        const operatingUnitId = await activeOperatingUnit(
            this.db,
            this.workspace.tenantId,
            data.operatingUnitId,
        );
        const roomIds = data.roomIds ?? [];
        await this.checkRooms(operatingUnitId, roomIds);
        const clusterIds = data.clusterIds ?? [];
        await this.checkClusters(clusterIds);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await this.db.insert('sim_m_section', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    operating_unit_id: operatingUnitId,
                    nama: data.name,
                    jenis: data.kind,
                    kode_no_bukti: data.documentCode,
                    kode_poli_bpjs: data.bpjsClinicCode,
                    mode_antrean: data.queueMode ?? defaultQueueMode,
                    awalan_antrean: data.queuePrefix,
                    aktif: data.isActive,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.saveRooms(id, roomIds, []);
                await this.saveClusters(id, clusterIds, []);
                if (data.examinationPanels)
                    await this.savePanels(id, data.examinationPanels);
            });
        } catch (error) {
            nameTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Section dan ruangannya disimpan bersama di bawah satu version section. Pindah unit memeriksa ruangan yang tetap
    // terpasang, juga bila room_ids tidak dikirim.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('section', 'update');
        const current = await this.row(id);
        const data = checked(body);
        const operatingUnitId =
            data.operatingUnitId === current.operating_unit_id
                ? current.operating_unit_id
                : await activeOperatingUnit(
                      this.db,
                      this.workspace.tenantId,
                      data.operatingUnitId,
                  );
        const currentRooms = current.rooms.map((room) => room.id);
        const roomIds = data.roomIds ?? currentRooms;
        if (data.roomIds || operatingUnitId !== current.operating_unit_id)
            await this.checkRooms(operatingUnitId, roomIds);
        const currentClusters = current.clusters.map((cluster) => cluster.id);
        if (data.clusterIds) await this.checkClusters(data.clusterIds);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                updated = await this.db.execute(
                    `update sim_m_section set operating_unit_id = $1, nama = $2, jenis = $3, kode_no_bukti = $4,
                            kode_poli_bpjs = $5, mode_antrean = $6, awalan_antrean = $7, aktif = $8, updated_at = $9
                     where tenant_id = $10 and id = $11 and version = $12 and deleted_at is null`,
                    [
                        operatingUnitId,
                        data.name,
                        data.kind,
                        data.documentCode,
                        data.bpjsClinicCode,
                        data.queueMode ?? current.queue_mode,
                        data.queuePrefix,
                        data.isActive,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                    ],
                );
                if (updated) {
                    await this.saveRooms(current.id, roomIds, currentRooms);
                    if (data.clusterIds)
                        await this.saveClusters(
                            current.id,
                            data.clusterIds,
                            currentClusters,
                        );
                    if (data.examinationPanels)
                        await this.savePanels(
                            current.id,
                            data.examinationPanels,
                        );
                }
            });
        } catch (error) {
            nameTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Section yang dihapus ikut melepas ruangan, klaster, dan pengaturan panel pemeriksaannya; ruangan dan klasternya
    // sendiri tetap ada.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('section', 'delete');
        const current = await this.row(id);
        const stamp = nowSql();
        let deleted = 0;
        await this.db.transaction(async () => {
            deleted = await this.db.execute(
                'update sim_m_section set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                [
                    stamp,
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
            if (deleted) {
                await this.db.execute(
                    'update sim_m_section_ruangan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and section_id = $3 and deleted_at is null',
                    [stamp, this.workspace.tenantId, current.id],
                );
                await this.db.execute(
                    'update sim_m_section_klaster set deleted_at = $1, updated_at = $1 where tenant_id = $2 and section_id = $3 and deleted_at is null',
                    [stamp, this.workspace.tenantId, current.id],
                );
                await this.db.execute(
                    'update sim_m_section_panel_pemeriksaan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and section_id = $3 and deleted_at is null',
                    [stamp, this.workspace.tenantId, current.id],
                );
            }
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
