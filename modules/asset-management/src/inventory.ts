import { ulid } from 'ulid';
import { z } from 'zod';
import { Database } from '@core/platform/db.ts';
import type { Bind } from '@core/platform/db.ts';
import { abort, validation } from '@core/platform/errors.ts';
import { incrementalList } from '@core/platform/listing.ts';
import { dateSchema, nowSql } from '@core/platform/model.ts';
import { Decimal } from '@core/platform/money.ts';
import type { Workspace } from '@core/platform/security.ts';
import { assetSchema } from './model.ts';
import type { DetailInput, ReceiptDetail, ReceiptHeader } from './model.ts';

const groupSchema = z.object({
    id: z.string(),
    kode: z.string(),
    nama: z.string(),
    kelompok_harta_fiskal_id: z.string().nullable(),
    lokasi_aset_id: z.string().nullable(),
    capitalization_threshold: z.string().nullable(),
});
const bookMatrixSchema = z.object({
    buku_id: z.string(),
    useful_life_periods: z.number().nullable(),
    convention: z.string().nullable(),
    depreciate: z.boolean(),
    round_off_depreciation: z.string().nullable(),
    depreciation_profile_id: z.string().nullable(),
    alternative_profile_id: z.string().nullable(),
    buku_code: z.string(),
});
const profileSchema = z.object({
    id: z.string(),
    method: z.string(),
    frequency: z.string(),
    convention: z.string().nullable(),
    useful_life_periods: z.number().nullable(),
    rate_percent: z.string().nullable(),
    manual_schedule: z.json(),
    effective_from: z.string().nullable(),
    effective_to: z.string().nullable(),
});
const definitionSchema = z.object({
    tipe_atribut_id: z.string(),
    kode: z.string(),
    nama: z.string(),
    data_type: z.string(),
    satuan: z.string().nullable(),
    min_value: z.string().nullable(),
    max_value: z.string().nullable(),
    wajib: z.boolean(),
    urutan: z.number(),
});
const conventions = [
    'none',
    'full_month',
    'mid_month_1st',
    'mid_month_15th',
    'mid_quarter',
    'half_year',
    'half_year_start_of_year',
    'half_year_next_year',
];

export function depreciationStart(
    date: string,
    convention: string | null,
    fiscalYear: { starts_on: string; ends_on: string } | null = null,
): string {
    const current = new Date(date.slice(0, 10) + 'T00:00:00Z');
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    switch (convention) {
        case 'full_month':
            return new Date(Date.UTC(year, month, 1))
                .toISOString()
                .slice(0, 10);
        case 'mid_month_1st':
            return new Date(
                Date.UTC(year, month + (current.getUTCDate() > 15 ? 1 : 0), 1),
            )
                .toISOString()
                .slice(0, 10);
        case 'mid_month_15th':
            return new Date(Date.UTC(year, month, 15))
                .toISOString()
                .slice(0, 10);
        case 'mid_quarter': {
            const firstMonth = Math.floor(month / 3) * 3;
            const days = new Date(
                Date.UTC(year, firstMonth + 1, 0),
            ).getUTCDate();
            return new Date(
                Date.UTC(year, firstMonth, Math.round((days * 3) / 2)),
            )
                .toISOString()
                .slice(0, 10);
        }
        case 'half_year':
        case 'half_year_start_of_year':
        case 'half_year_next_year': {
            const start = fiscalYear
                ? new Date(fiscalYear.starts_on + 'T00:00:00Z')
                : new Date(Date.UTC(year, 0, 1));
            const end = fiscalYear
                ? new Date(fiscalYear.ends_on + 'T00:00:00Z')
                : new Date(Date.UTC(year, 11, 31));
            const midpoint = new Date(
                start.valueOf() +
                    Math.floor(
                        (end.valueOf() - start.valueOf()) / 86400000 / 2,
                    ) *
                        86400000,
            );
            const firstHalf = current <= midpoint;
            if (convention === 'half_year_start_of_year')
                return (firstHalf ? start : midpoint)
                    .toISOString()
                    .slice(0, 10);
            if (convention === 'half_year_next_year')
                return (firstHalf ? start : new Date(end.valueOf() + 86400000))
                    .toISOString()
                    .slice(0, 10);
            return midpoint.toISOString().slice(0, 10);
        }
        default:
            return current.toISOString().slice(0, 10);
    }
}

export class Inventory {
    constructor(
        private readonly db: Database,
        readonly workspace: Workspace,
    ) {}

    async group(id: string) {
        const row = await this.db.one(
            groupSchema,
            'select id,kode,nama,kelompok_harta_fiskal_id,lokasi_aset_id,capitalization_threshold from aset_m_group_aset where tenant_id=$1 and id=$2 limit 1',
            [this.workspace.tenantId, id],
        );
        if (!row) abort(404, 'Not Found');
        return row;
    }

    async inheritedLocation(
        locationId: string | null,
        column: 'org_unit_id' | 'departemen_bawaan_id',
    ): Promise<string | null> {
        let current = locationId;
        const visited = new Set<string>();
        for (
            let depth = 0;
            current !== null && depth < 32 && !visited.has(current);
            depth++
        ) {
            visited.add(current);
            const row = await this.db.one(
                z.object({
                    parent_id: z.string().nullable(),
                    value: z.string().nullable(),
                }),
                `select parent_id,${column} as value from aset_m_lokasi_aset where tenant_id=$1 and id=$2 limit 1`,
                [this.workspace.tenantId, current],
            );
            if (!row) return null;
            if (row.value !== null) return row.value;
            current = row.parent_id;
        }
        return null;
    }

    async dimension(
        groupId: string,
        locationId: string | null,
        usageId: string,
    ): Promise<string> {
        const effective =
            locationId ?? (await this.group(groupId)).lokasi_aset_id;
        return (
            (await this.inheritedLocation(effective, 'org_unit_id')) ?? usageId
        );
    }

    postedBook(groupId: string) {
        return this.db.one(
            z.object({ id: z.string(), kode: z.string() }),
            "select b.id,b.kode from aset_m_group_buku_penyusutan m join aset_m_buku_penyusutan b on b.id=m.buku_id and b.tenant_id=m.tenant_id where m.tenant_id=$1 and m.group_aset_id=$2 and m.deleted_at is null and b.deleted_at is null and b.aktif=true and b.posting_layer!='none' order by case b.posting_layer when 'current' then 0 else 1 end,b.kode limit 1",
            [this.workspace.tenantId, groupId],
        );
    }

    async condition(
        typeId: string,
        conditionId: string | null,
        field = 'kondisi_aset_id',
    ): Promise<void> {
        if (!conditionId) return;
        const links = await this.db.one(
            z.object({ found: z.boolean() }),
            'select true as found from aset_m_jenis_aset_kondisi where tenant_id=$1 and jenis_aset_id=$2 and deleted_at is null limit 1',
            [this.workspace.tenantId, typeId],
        );
        const valid = await this.db.one(
            z.object({ found: z.boolean() }),
            `select true as found from aset_m_kondisi_aset c where c.tenant_id=$1 and c.id=$2 and c.deleted_at is null and c.aktif=true ${links ? 'and exists(select 1 from aset_m_jenis_aset_kondisi l where l.tenant_id=$1 and l.jenis_aset_id=$3 and l.kondisi_aset_id=c.id and l.deleted_at is null)' : ''} limit 1`,
            links
                ? [this.workspace.tenantId, conditionId, typeId]
                : [this.workspace.tenantId, conditionId],
        );
        if (!valid)
            validation({
                [field]:
                    'Kondisi tidak aktif atau tidak dapat dipakai untuk jenis aset ini.',
            });
    }

    async attributeRows(
        typeId: string,
        submitted: DetailInput['atribut'],
        prefix = '',
    ): Promise<Record<string, Bind>[]> {
        const typeIds = await this.db.rows(
            z.object({ tipe_atribut_id: z.string() }),
            'select tipe_atribut_id from aset_m_jenis_aset_atribut where tenant_id=$1 and jenis_aset_id=$2 and deleted_at is null order by tipe_atribut_id',
            [this.workspace.tenantId, typeId],
        );
        if (typeIds.length)
            await this.db.rows(
                z.object({ id: z.string() }),
                `select id from aset_m_tipe_atribut where tenant_id=$1 and id in (${typeIds.map((_, index) => `$${index + 2}`).join(',')}) order by id for update`,
                [
                    this.workspace.tenantId,
                    ...typeIds.map((row) => row.tipe_atribut_id),
                ],
            );
        const definitions = await this.db.rows(
            definitionSchema,
            'select t.id as tipe_atribut_id,t.kode,t.nama,t.data_type,t.satuan,t.min_value,t.max_value,l.wajib,l.urutan from aset_m_jenis_aset_atribut l join aset_m_tipe_atribut t on t.id=l.tipe_atribut_id and t.tenant_id=$1 where l.tenant_id=$1 and l.jenis_aset_id=$2 and l.deleted_at is null and t.deleted_at is null and t.aktif=true order by l.urutan,t.nama',
            [this.workspace.tenantId, typeId],
        );
        const choices = definitions.length
            ? await this.db.rows(
                  z.object({
                      id: z.string(),
                      tipe_atribut_id: z.string(),
                      nilai: z.string(),
                  }),
                  `select id,tipe_atribut_id,nilai from aset_m_tipe_atribut_nilai where tenant_id=$1 and deleted_at is null and tipe_atribut_id in (${definitions.map((_, index) => `$${index + 2}`).join(',')}) order by urutan,nilai`,
                  [
                      this.workspace.tenantId,
                      ...definitions.map(
                          (definition) => definition.tipe_atribut_id,
                      ),
                  ],
              )
            : [];
        const values = new Map(
            submitted.map((item) => [item.tipe_atribut_id, item.nilai]),
        );
        const errors: Record<string, string> = {};
        for (const [index, id] of [...values.keys()].entries())
            if (
                !definitions.some(
                    (definition) => definition.tipe_atribut_id === id,
                )
            )
                errors[`${prefix}atribut.${index}.tipe_atribut_id`] =
                    'Atribut ini tidak terdaftar pada jenis aset yang dipilih.';
        const rows: Record<string, Bind>[] = [];
        for (const definition of definitions) {
            const raw = values.get(definition.tipe_atribut_id) ?? null;
            const field = prefix + 'atribut.' + definition.tipe_atribut_id;
            if (raw === null || raw === '') {
                if (definition.wajib)
                    errors[field] = definition.nama + ' wajib diisi.';
                continue;
            }
            const value: Record<string, Bind> = {
                nilai_text: null,
                nilai_number: null,
                nilai_boolean: null,
                nilai_date: null,
                tipe_atribut_nilai_id: null,
            };
            switch (definition.data_type) {
                case 'decimal':
                case 'integer': {
                    if (
                        (typeof raw !== 'string' && typeof raw !== 'number') ||
                        String(raw).trim() === '' ||
                        !Number.isFinite(Number(raw))
                    ) {
                        errors[field] =
                            definition.nama + ' harus berupa angka.';
                        break;
                    }
                    const number = Number(raw);
                    if (
                        definition.data_type === 'integer' &&
                        !Number.isInteger(number)
                    ) {
                        errors[field] =
                            definition.nama + ' harus berupa bilangan bulat.';
                        break;
                    }
                    if (
                        (definition.min_value !== null &&
                            number < Number(definition.min_value)) ||
                        (definition.max_value !== null &&
                            number > Number(definition.max_value))
                    ) {
                        errors[field] =
                            definition.nama +
                            ' harus antara ' +
                            (definition.min_value ?? '') +
                            ' dan ' +
                            (definition.max_value ?? '') +
                            '.';
                        break;
                    }
                    value.nilai_number = number;
                    break;
                }
                case 'boolean':
                    value.nilai_boolean =
                        raw === true ||
                        raw === 1 ||
                        ['1', 'true', 'on', 'yes'].includes(
                            String(raw).toLowerCase(),
                        );
                    break;
                case 'date': {
                    const parsed = dateSchema.safeParse(raw);
                    if (!parsed.success)
                        errors[field] =
                            definition.nama +
                            ' harus berupa tanggal (YYYY-MM-DD).';
                    else value.nilai_date = parsed.data;
                    break;
                }
                case 'string': {
                    const eligible = choices.filter(
                        (choice) =>
                            choice.tipe_atribut_id ===
                            definition.tipe_atribut_id,
                    );
                    const choice = eligible.find(
                        (candidate) => candidate.nilai === String(raw),
                    );
                    if (eligible.length && !choice)
                        errors[field] =
                            definition.nama +
                            ' harus dipilih dari daftar yang tersedia.';
                    else {
                        value.nilai_text = choice?.nilai ?? String(raw);
                        value.tipe_atribut_nilai_id = choice?.id ?? null;
                    }
                    break;
                }
                default:
                    errors[field] =
                        definition.nama +
                        ' memakai tipe data yang tidak dikenal.';
            }
            if (!errors[field]) {
                const stamp = nowSql();
                rows.push({
                    id: ulid(),
                    tenant_id: this.workspace.tenantId,
                    tipe_atribut_id: definition.tipe_atribut_id,
                    ...value,
                    created_at: stamp,
                    updated_at: stamp,
                });
            }
        }
        if (Object.keys(errors).length) validation(errors);
        return rows;
    }

    private async profile(
        id: string | null,
        life: number | null,
        convention: string | null,
    ) {
        if (!id)
            validation({
                group_aset_id:
                    'Buku penyusutan belum memiliki profil utama yang efektif. Pilih profil pada matriks group x book atau pada Buku penyusutan.',
            });
        const profile = await this.db.one(
            profileSchema,
            'select id,method,frequency,convention,useful_life_periods,rate_percent,manual_schedule,effective_from,effective_to from aset_m_profil_penyusutan where tenant_id=$1 and id=$2 and deleted_at is null and aktif=true limit 1',
            [this.workspace.tenantId, id],
        );
        if (!profile)
            validation({
                group_aset_id:
                    'Profil penyusutan pada Buku atau matriks sudah tidak aktif. Pilih profil yang masih berlaku.',
            });
        const errors: Record<string, string> = {};
        if (
            ![
                'straight_line',
                'straight_line_life_remaining',
                'reducing_balance',
                'manual',
                'consumption',
            ].includes(profile.method)
        )
            errors.group_aset_id =
                'Metode profil penyusutan belum dapat dihitung oleh aplikasi.';
        if (
            !['monthly', 'quarterly', 'half_yearly', 'yearly'].includes(
                profile.frequency,
            )
        )
            errors.group_aset_id =
                'Frekuensi profil penyusutan belum dapat dihitung oleh aplikasi.';
        const effectiveConvention = convention ?? profile.convention;
        if (
            effectiveConvention !== null &&
            !conventions.includes(effectiveConvention)
        )
            errors.group_aset_id =
                'Konvensi penyusutan pada Buku atau profil tidak dikenal.';
        if (
            [
                'straight_line',
                'straight_line_life_remaining',
                'reducing_balance',
            ].includes(profile.method) &&
            !(life ?? profile.useful_life_periods)
        )
            errors.group_aset_id =
                'Masa manfaat belum diisi pada matriks atau profil penyusutan.';
        if (
            profile.method === 'reducing_balance' &&
            Number(profile.rate_percent ?? 0) <= 0
        )
            errors.group_aset_id =
                'Profil saldo menurun harus memiliki persentase per tahun yang lebih besar dari 0.';
        if (
            profile.method === 'manual' &&
            (!Array.isArray(profile.manual_schedule) ||
                !profile.manual_schedule.length ||
                profile.manual_schedule.some(
                    (row) =>
                        !z
                            .object({ amount: z.coerce.number().min(0) })
                            .safeParse(row).success,
                ))
        )
            errors.group_aset_id =
                'Profil dengan jadwal manual belum memiliki nilai penyusutan per periode.';
        if (Object.keys(errors).length) validation(errors);
        return profile;
    }

    async create(
        receipt: ReceiptHeader,
        line: ReceiptDetail,
        key: string,
        code: string,
        value: string,
    ): Promise<{
        id: string;
        asset_code: string;
        group_aset_id: string;
        acquisition_value: string;
    }> {
        await this.condition(line.jenis_aset_id, line.kondisi_aset_id);
        const group = await this.group(line.group_aset_id);
        const locationId = receipt.lokasi_aset_id ?? group.lokasi_aset_id;
        const dimensionId =
            (await this.inheritedLocation(locationId, 'org_unit_id')) ??
            receipt.responsible_org_unit_id;
        const id = ulid().toLowerCase();
        const stamp = nowSql();
        await this.db.insert('aset_tr_aset', {
            id,
            tenant_id: this.workspace.tenantId,
            creation_key: key,
            kode: code,
            nama: line.nama,
            legal_entity_id: receipt.legal_entity_id,
            responsible_org_unit_id: receipt.responsible_org_unit_id,
            group_aset_id: line.group_aset_id,
            kelompok_harta_fiskal_id: group.kelompok_harta_fiskal_id,
            jenis_aset_id: line.jenis_aset_id,
            kondisi_aset_id: line.kondisi_aset_id,
            pabrikan_aset_id: line.pabrikan_aset_id,
            model_aset_id: line.model_aset_id,
            induk_aset_id: null,
            lokasi_aset_id: locationId,
            financial_dimension_org_unit_id: dimensionId,
            serial_number: null,
            model_number: line.model_number,
            acquired_on: receipt.tanggal.slice(0, 10),
            placed_in_service_on:
                receipt.tanggal_siap_pakai?.slice(0, 10) ?? null,
            acquisition_value: value,
            currency_code: receipt.currency_code.toUpperCase(),
            lifecycle_state: 'received',
            keterangan: line.keterangan,
            penerimaan_aset_id: receipt.id,
            penerimaan_aset_detail_id: line.id,
            created_at: stamp,
            updated_at: stamp,
        });
        await this.db.insert('aset_tr_penempatan_aset', {
            id: ulid(),
            tenant_id: this.workspace.tenantId,
            aset_id: id,
            receiving_org_unit_id: receipt.receiving_org_unit_id,
            usage_org_unit_id: receipt.responsible_org_unit_id,
            received_by_user_id: receipt.diterima_oleh_user_id,
            custodian_user_id: receipt.penanggung_jawab_user_id,
            lokasi_aset_id: locationId,
            effective_on: receipt.tanggal.slice(0, 10),
            reason: 'Penerimaan aset',
            created_at: stamp,
            updated_at: stamp,
        });
        const receiptCode = await this.db.one(
            z.object({ kode: z.string() }),
            'select kode from aset_tr_penerimaan_aset where tenant_id=$1 and id=$2 and deleted_at is null limit 1',
            [this.workspace.tenantId, receipt.id],
        );
        await this.db.execute(
            "select set_config('coreerp.fa_ledger_context',$1,true)",
            [
                JSON.stringify({
                    type: 'acquisition',
                    date: receipt.tanggal.slice(0, 10),
                    source_type: 'penerimaan-aset',
                    source_id: receipt.id,
                    document_number: receiptCode?.kode ?? code,
                    description: 'Perolehan aset',
                }),
            ],
        );
        const matrices = await this.db.rows(
            bookMatrixSchema,
            'select m.buku_id,m.useful_life_periods,m.convention,m.depreciate,coalesce(m.round_off_depreciation,b.round_off_depreciation) as round_off_depreciation,coalesce(m.depreciation_profile_id,b.depreciation_profile_id) as depreciation_profile_id,coalesce(m.alternative_profile_id,b.alternative_profile_id) as alternative_profile_id,b.kode as buku_code from aset_m_group_buku_penyusutan m join aset_m_buku_penyusutan b on b.id=m.buku_id and b.tenant_id=m.tenant_id where m.tenant_id=$1 and m.group_aset_id=$2 and m.deleted_at is null and b.deleted_at is null and b.aktif=true',
            [this.workspace.tenantId, line.group_aset_id],
        );
        const capitalized =
            group.capitalization_threshold === null ||
            Decimal.of(value).compare(
                Decimal.of(group.capitalization_threshold),
            ) >= 0;
        for (const matrix of matrices) {
            const depreciates = capitalized && matrix.depreciate;
            const profile = depreciates
                ? await this.profile(
                      matrix.depreciation_profile_id,
                      matrix.useful_life_periods,
                      matrix.convention,
                  )
                : null;
            if (depreciates && matrix.alternative_profile_id)
                await this.profile(matrix.alternative_profile_id, null, null);
            const life =
                matrix.useful_life_periods ??
                profile?.useful_life_periods ??
                null;
            const convention = matrix.convention ?? profile?.convention ?? null;
            const placed = receipt.tanggal_siap_pakai ?? receipt.tanggal;
            await this.db.insert('aset_tr_buku_aset', {
                id: ulid().toLowerCase(),
                tenant_id: this.workspace.tenantId,
                aset_id: id,
                buku_id: matrix.buku_id,
                depreciation_profile_id: matrix.depreciation_profile_id,
                alternative_profile_id: matrix.alternative_profile_id,
                book_code: matrix.buku_code,
                useful_life_periods: life,
                convention,
                depreciation_start_on: depreciationStart(placed, convention),
                depreciate: depreciates,
                round_off_depreciation: matrix.round_off_depreciation ?? '0',
                acquisition_value: value,
                residual_value: line.residu_per_unit,
                accumulated_depreciation: '0',
                opening_accumulated_depreciation: '0',
                elapsed_periods_offset: 0,
                net_book_value: value,
                status: 'active',
                created_at: stamp,
                updated_at: stamp,
            });
        }
        const attributes = await this.attributeRows(
            line.jenis_aset_id,
            line.atribut,
        );
        for (const row of attributes)
            await this.db.insert('aset_tr_aset_atribut', {
                ...row,
                aset_id: id,
            });
        const typeIds = [
            ...new Set(attributes.map((row) => String(row.tipe_atribut_id))),
        ];
        if (typeIds.length)
            await this.db.execute(
                `update aset_m_tipe_atribut set data_type_locked=true,updated_at=$1 where tenant_id=$2 and id in (${typeIds.map((_, index) => `$${index + 3}`).join(',')})`,
                [nowSql(), this.workspace.tenantId, ...typeIds],
            );
        return {
            id,
            asset_code: code,
            group_aset_id: line.group_aset_id,
            acquisition_value: value,
        };
    }

    async show(id: string) {
        this.workspace.guard('aset', 'read');
        const filter = this.workspace.filter('a', 2);
        const asset = await this.db.one(
            assetSchema,
            `select a.* from aset_tr_aset a where a.id=$1 and a.deleted_at is null and ${filter.clause} limit 1`,
            [id, ...filter.bindings],
        );
        if (!asset)
            abort(
                404,
                'No query results for model [Modules\\Apperp\\ManagementAset\\Models\\transaksi\\InventarisasiAset\\Aset] ' +
                    id,
            );
        const attributes = await this.db.rows(
            z.object({
                tipe_atribut_id: z.string(),
                kode: z.string(),
                nama: z.string(),
                data_type: z.string(),
                satuan: z.string().nullable(),
                nilai_text: z.string().nullable(),
                nilai_number: z.string().nullable(),
                nilai_boolean: z.boolean().nullable(),
                nilai_date: z.string().nullable(),
                tipe_atribut_nilai_id: z.string().nullable(),
            }),
            'select t.id as tipe_atribut_id,t.kode,t.nama,t.data_type,t.satuan,a.nilai_text,a.nilai_number,a.nilai_boolean,a.nilai_date,a.tipe_atribut_nilai_id from aset_tr_aset_atribut a join aset_m_tipe_atribut t on t.id=a.tipe_atribut_id and t.tenant_id=a.tenant_id where a.tenant_id=$1 and a.aset_id=$2 order by t.nama',
            [this.workspace.tenantId, id],
        );
        return {
            status: 200,
            headers: { ETag: `W/"${asset.version}"` },
            body: {
                data: {
                    ...this.present(asset),
                    atribut: attributes.map(
                        ({
                            nilai_text,
                            nilai_number,
                            nilai_boolean,
                            nilai_date,
                            ...definition
                        }) => ({
                            ...definition,
                            nilai: ['decimal', 'integer'].includes(
                                definition.data_type,
                            )
                                ? nilai_number === null
                                    ? null
                                    : Number(nilai_number)
                                : definition.data_type === 'boolean'
                                  ? nilai_boolean
                                  : definition.data_type === 'date'
                                    ? (nilai_date?.slice(0, 10) ?? null)
                                    : nilai_text,
                        }),
                    ),
                },
            },
        };
    }

    present(asset: z.infer<typeof assetSchema>) {
        return {
            ...asset,
            acquired_on: asset.acquired_on.slice(0, 10) + 'T00:00:00.000000Z',
            placed_in_service_on: asset.placed_in_service_on
                ? asset.placed_in_service_on.slice(0, 10) + 'T00:00:00.000000Z'
                : null,
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('aset', 'read');
        if (parameters.has('planning_company_id'))
            abort(
                501,
                'Planning lookup is outside the declared comparison profile.',
            );
        const filter = this.workspace.filter('a', 1);
        const bindings: Bind[] = [...filter.bindings];
        let where = filter.clause + ' and a.deleted_at is null';
        for (const [field, comparison] of [
            ['lifecycle_state', '='],
            ['exclude_state', '<>'],
        ]) {
            const value = parameters.get(field ?? '');
            if (value) {
                if (
                    ![
                        'budgeted',
                        'received',
                        'in_use',
                        'decommissioned',
                        'disposed',
                    ].includes(value)
                )
                    validation({
                        [field ?? 'lifecycle_state']:
                            'The selected lifecycle state is invalid.',
                    });
                bindings.push(value);
                where += ` and a.lifecycle_state${comparison}$${bindings.length}`;
            }
        }
        const result = await incrementalList(this.db, {
            query: `
                select a.*,
                       g.nama as group_nama,
                       t.nama as type_nama,
                       l.nama as location_nama,
                       (select name from organizations o
                         where o.tenant_id = a.tenant_id and o.id = a.legal_entity_id
                         limit 1) as legal_entity_nama
                from aset_tr_aset a
                left join aset_m_group_aset g on g.id = a.group_aset_id and g.tenant_id = a.tenant_id
                left join aset_m_jenis_aset t on t.id = a.jenis_aset_id and t.tenant_id = a.tenant_id
                left join aset_m_lokasi_aset l on l.id = a.lokasi_aset_id and l.tenant_id = a.tenant_id
                where ${where}`,
            bindings,
            parameters,
            columns: {
                id: 'id',
                created_at: 'created_at',
                kode: 'kode',
                nama: 'nama',
                serial: 'serial_number',
                legal_entity: 'legal_entity_nama',
                group: 'group_nama',
                jenis: 'type_nama',
                lokasi: 'location_nama',
                nilai: 'acquisition_value',
                status: 'lifecycle_state',
            },
            searchColumns: ['kode', 'nama', 'serial_number'],
            numericColumns: ['acquisition_value'],
            defaultSort: 'created_at',
            defaultDirection: 'desc',
        });
        return {
            data: result.data.map((row) => ({
                ...this.present(assetSchema.parse(row)),
                legal_entity_nama: row.legal_entity_nama,
                group_nama: row.group_nama,
                type_nama: row.type_nama,
                location_nama: row.location_nama,
            })),
            next_cursor: result.next_cursor,
        };
    }
}
