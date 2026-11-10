import { z } from 'zod';
import { Currency } from '@core/foundation/currency/index.ts';
import { FinancePostings } from '@core/foundation/finance-posting/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    jsonObject,
    nowSql,
    sqlErrorCode,
} from '@core/platform/database/index.ts';
import type { Bind, Database } from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    idSchema,
    incrementalList,
    lookupId,
    validation,
} from '@core/platform/http/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import { assetCodes } from '../asset/asset.code.ts';
import { Inventory } from '../asset/asset.service.ts';
import { AcquisitionPosting } from './asset-receipt.posting.ts';
import {
    detailSchema,
    headerSchema,
    parseReceipt,
} from './asset-receipt.schema.ts';
import type {
    ReceiptDetail,
    ReceiptHeader,
    ReceiptInput,
} from './asset-receipt.schema.ts';

const headerTable = 'aset_tr_penerimaan_aset';
const detailTable = 'aset_tr_penerimaan_aset_details';
const editedMessage =
    'Penerimaan yang sudah selesai tidak dapat diubah; asetnya sudah terdaftar dan bernomor.';
const postingFailure =
    'Penerimaan gagal diselesaikan karena kesalahan sistem pada jurnal perolehannya. Tidak ada aset yang terdaftar; tim kami sudah diberi tahu.';
const requestLineSchema = z.object({
    id: z.string(),
    request_id: z.string(),
    jenis_aset_id: z.string(),
    quantity: z.string(),
});
const requestHeaderSchema = z.object({
    id: z.string(),
    status: z.string(),
    legal_entity_id: z.string(),
    requesting_org_unit_id: z.string().nullable(),
});

export class Receipts {
    readonly inventory: Inventory;
    private readonly currency: Currency;
    private readonly finance: FinancePostings;
    private readonly posting: AcquisitionPosting;
    private readonly numbers: NumberIssuer;

    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {
        this.inventory = new Inventory(db, workspace);
        this.currency = new Currency(db, workspace.tenantId);
        this.finance = new FinancePostings(
            db,
            workspace.tenantId,
            this.currency,
            postingFailure,
        );
        this.posting = new AcquisitionPosting(
            db,
            workspace,
            this.currency,
            this.inventory,
            this.finance,
        );
        this.numbers = new NumberIssuer(db, workspace);
    }

    private lookupQuery(where: string, extraColumns: string[] = []) {
        return `
            select (select count(*)::int from ${detailTable} d
                     where d.tenant_id = h.tenant_id and d.penerimaan_aset_id = h.id) as jumlah_baris,
                   (select coalesce(sum(jumlah), 0)::int from ${detailTable} d
                     where d.tenant_id = h.tenant_id and d.penerimaan_aset_id = h.id) as jumlah_aset,
                   h.*,
                   ${extraColumns.map((column) => `${column},`).join('\n')}
                   l.kode as lokasi_aset_kode,
                   l.nama as lokasi_aset_nama
            from ${headerTable} h
            left join aset_m_lokasi_aset l on l.id = h.lokasi_aset_id and l.tenant_id = h.tenant_id
            where ${where}`;
    }

    async document(id: string): Promise<ReceiptHeader> {
        const filter = this.workspace.filter('h', 2);
        const row = await this.db.one(
            headerSchema,
            this.lookupQuery(
                `h.id=$1 and h.deleted_at is null and ${filter.clause}`,
            ) + ' limit 1',
            [lookupId(id), ...filter.bindings],
        );
        if (!row)
            abort(
                404,
                'No query results for model [Modules\\Apperp\\ManagementAset\\Models\\transaksi\\PenerimaanAset\\PenerimaanAset].',
            );
        const units = await this.db.rows(
            z.object({ id: z.string(), name: z.string() }),
            "select o.id,o.name,o.classification,u.type,u.number from organizations o left join operating_units u on u.organization_id=o.id where o.tenant_id=$1 and o.classification='operating_unit' order by o.name",
            [this.workspace.tenantId],
        );
        const people =
            row.diterima_oleh_user_id !== null ||
            row.penanggung_jawab_user_id !== null
                ? await this.db.rows(
                      z.object({
                          user_id: idSchema,
                          name: z.string(),
                      }),
                      "select m.id,m.user_id,u.name,u.email from tenant_memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.status='active' order by u.name",
                      [this.workspace.tenantId],
                  )
                : [];
        return {
            ...row,
            responsible_org_unit_nama:
                units.find((unit) => unit.id === row.responsible_org_unit_id)
                    ?.name ?? null,
            receiving_org_unit_nama:
                units.find((unit) => unit.id === row.receiving_org_unit_id)
                    ?.name ?? null,
            diterima_oleh_nama:
                people.find(
                    (person) => person.user_id === row.diterima_oleh_user_id,
                )?.name ?? null,
            penanggung_jawab_nama:
                people.find(
                    (person) => person.user_id === row.penanggung_jawab_user_id,
                )?.name ?? null,
        };
    }

    private lines(id: string, lookups = false): Promise<ReceiptDetail[]> {
        if (!lookups)
            return this.db.rows(
                detailSchema,
                `select * from ${detailTable} where tenant_id=$1 and penerimaan_aset_id=$2 order by line_number`,
                [this.workspace.tenantId, id],
            );
        return this.db.rows(
            detailSchema,
            `select d.*,g.nama as group_aset_nama,t.nama as jenis_aset_nama,c.nama as kondisi_aset_nama,p.nama as pabrikan_aset_nama,m.nama as model_aset_nama,r.id as purchase_request_id,r.kode as purchase_request_code from ${detailTable} d left join aset_tr_permintaan_pengadaan_aset_details rl on rl.id=d.permintaan_pembelian_detail_id and rl.tenant_id=d.tenant_id left join aset_tr_permintaan_pengadaan_aset r on r.id=rl.request_id and r.tenant_id=d.tenant_id left join aset_m_group_aset g on g.id=d.group_aset_id and g.tenant_id=d.tenant_id left join aset_m_jenis_aset t on t.id=d.jenis_aset_id and t.tenant_id=d.tenant_id left join aset_m_kondisi_aset c on c.id=d.kondisi_aset_id and c.tenant_id=d.tenant_id left join aset_m_pabrikan_aset p on p.id=d.pabrikan_aset_id and p.tenant_id=d.tenant_id left join aset_m_model_aset m on m.id=d.model_aset_id and m.tenant_id=d.tenant_id where d.tenant_id=$1 and d.penerimaan_aset_id=$2 order by d.line_number`,
            [this.workspace.tenantId, id],
        );
    }

    async show(id: string) {
        this.workspace.guard('penerimaan-aset', 'read');
        const receipt = await this.document(id);
        const details = await this.lines(id, true);
        const vendor =
            receipt.vendor_id === null
                ? null
                : await this.finance.vendor(receipt.vendor_id);
        const posting = ['selesai', 'cancelled'].includes(receipt.status)
            ? await this.finance.status(
                  (receipt.cara_perolehan === 'saldo_awal'
                      ? 'AST-OPB-'
                      : 'AST-ACQ-') + receipt.id,
              )
            : null;
        const cancellation = await this.db.one(
            z.object({
                status: z.string(),
                reason: z.string(),
                failure_message: z.string().nullable(),
                posting_date: z.string(),
                posting_ids: z.array(z.string()).nullable(),
            }),
            "select status,reason,failure_message,posting_date,posting_ids from aset_tr_pembatalan where tenant_id=$1 and resource='penerimaan-aset' and document_id=$2 and deleted_at is null order by created_at desc,id desc limit 1",
            [this.workspace.tenantId, id],
        );
        let cancellationView = null;
        if (cancellation) {
            const statuses = [];
            for (const postingId of cancellation.posting_ids ?? []) {
                const status = await this.finance.status(postingId);
                if (status) statuses.push(status);
            }
            const { posting_ids, ...summary } = cancellation;
            cancellationView = { ...summary, postings: statuses };
        }
        return {
            status: 200,
            headers: { ETag: `W/"${receipt.version}"` },
            body: {
                data: {
                    ...receipt,
                    details,
                    vendor: vendor
                        ? {
                              id: vendor.id,
                              number: vendor.number,
                              name: vendor.name,
                              status: vendor.status,
                          }
                        : null,
                    posting,
                    cancellation: cancellationView,
                },
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('penerimaan-aset', 'read');
        const filter = this.workspace.filter('h', 1);
        const bindings: Bind[] = [...filter.bindings];
        let where = filter.clause + ' and h.deleted_at is null';
        const status = parameters.get('status');
        if (status) {
            if (!['draft', 'selesai', 'cancelled'].includes(status))
                validation({ status: 'The selected status is invalid.' });
            bindings.push(status);
            where += ` and h.status=$${bindings.length}`;
        }
        const from = parameters.get('dari');
        const to = parameters.get('sampai');
        for (const [field, value, operator] of [
            ['dari', from, '>='],
            ['sampai', to, '<='],
        ]) {
            if (value) {
                bindings.push(value);
                where += ` and h.tanggal${operator}$${bindings.length}`;
            }
            if (field === 'sampai' && from && to && to < from)
                validation({
                    sampai: 'The sampai field must be a date after or equal to dari.',
                });
        }
        const organizationName = (column: string) =>
            `(select name from organizations o where o.tenant_id = h.tenant_id and o.id = h.${column} limit 1)`;
        const userName = (column: string) =>
            `(select u.name from tenant_memberships m join users u on u.id = m.user_id where m.tenant_id = h.tenant_id and cast(m.user_id as text) = h.${column} limit 1)`;
        const query = this.lookupQuery(where, [
            `${organizationName('legal_entity_id')} as legal_entity_nama`,
            `${organizationName('responsible_org_unit_id')} as responsible_org_unit_nama`,
            `${organizationName('receiving_org_unit_id')} as receiving_org_unit_nama`,
            `${userName('diterima_oleh_user_id')} as diterima_oleh_nama`,
            `${userName('penanggung_jawab_user_id')} as penanggung_jawab_nama`,
        ]);
        const batch = await incrementalList(this.db, {
            query,
            bindings,
            parameters,
            columns: {
                id: 'id',
                legal_entity: 'legal_entity_nama',
                kode: 'kode',
                tanggal: 'tanggal',
                siap: 'tanggal_siap_pakai',
                unit: 'responsible_org_unit_nama',
                lokasi: 'lokasi_aset_nama',
                baris: 'jumlah_baris',
                jumlah: 'jumlah_aset',
                status: 'status',
            },
            searchColumns: [
                'kode',
                'legal_entity_nama',
                'keterangan',
                'lokasi_aset_nama',
                'responsible_org_unit_nama',
                'status',
            ],
            numericColumns: ['jumlah_baris', 'jumlah_aset'],
            defaultSort: 'tanggal',
            defaultDirection: 'desc',
        });
        return {
            ...batch,
            data: batch.data.map((row) => headerSchema.parse(row)),
        };
    }

    private async replay(key: string) {
        const receipt = await this.db.one(
            headerSchema,
            `select * from ${headerTable} where tenant_id=$1 and creation_key=$2 limit 1`,
            [this.workspace.tenantId, key],
        );
        if (receipt)
            this.workspace.require(
                receipt.legal_entity_id,
                receipt.responsible_org_unit_id,
            );
        return receipt;
    }

    private async validate(
        input: unknown,
    ): Promise<ReceiptInput & { responsible_org_unit_id: string }> {
        const data = parseReceipt(input);
        if (data.cara_perolehan === 'saldo_awal')
            abort(
                501,
                'Opening-balance operations are outside the declared comparison profile.',
            );
        const checks: { table: string; id: string | null; field: string }[] = [
            {
                table: 'aset_m_lokasi_aset',
                id: data.lokasi_aset_id,
                field: 'lokasi_aset_id',
            },
        ];
        for (const [index, detail] of data.details.entries()) {
            checks.push(
                {
                    table: 'aset_m_group_aset',
                    id: detail.group_aset_id,
                    field: `details.${index}.group_aset_id`,
                },
                {
                    table: 'aset_m_jenis_aset',
                    id: detail.jenis_aset_id,
                    field: `details.${index}.jenis_aset_id`,
                },
                {
                    table: 'aset_m_kondisi_aset',
                    id: detail.kondisi_aset_id,
                    field: `details.${index}.kondisi_aset_id`,
                },
                {
                    table: 'aset_m_pabrikan_aset',
                    id: detail.pabrikan_aset_id,
                    field: `details.${index}.pabrikan_aset_id`,
                },
                {
                    table: 'aset_m_model_aset',
                    id: detail.model_aset_id,
                    field: `details.${index}.model_aset_id`,
                },
            );
        }
        const errors: Record<string, string> = {};
        for (const check of checks)
            if (
                check.id &&
                !(await this.db.one(
                    z.object({ found: z.boolean() }),
                    `select true as found from ${check.table} where id=$1 and tenant_id=$2 and deleted_at is null limit 1`,
                    [check.id, this.workspace.tenantId],
                ))
            )
                errors[check.field] =
                    `The selected ${check.field.replaceAll('_', ' ')} is invalid.`;
        if (Object.keys(errors).length) validation(errors);
        const responsible =
            data.responsible_org_unit_id ??
            (await this.inventory.inheritedLocation(
                data.lokasi_aset_id,
                'departemen_bawaan_id',
            ));
        if (!responsible)
            validation({
                responsible_org_unit_id:
                    'Pilih unit penanggung jawab, atau pilih lokasi yang punya unit kerja bawaan.',
            });
        const precision = await this.currency.precision(data.currency_code);
        for (const [index, detail] of data.details.entries()) {
            for (const column of [
                'nilai_per_unit',
                'ppn_per_unit',
            ] satisfies (keyof typeof detail)[]) {
                if (
                    Decimal.of(detail[column]).scale >
                    precision.unit_amount_decimals
                )
                    errors[`details.${index}.${column}`] =
                        `Paling banyak ${precision.unit_amount_decimals} angka di belakang koma untuk ${data.currency_code.toUpperCase()}.`;
            }
        }
        if (Object.keys(errors).length) validation(errors);
        for (const [index, detail] of data.details.entries()) {
            await this.inventory.condition(
                detail.jenis_aset_id,
                detail.kondisi_aset_id,
                `details.${index}.kondisi_aset_id`,
            );
            if (
                Decimal.of(detail.akumulasi_per_unit).compare(Decimal.of('0')) >
                    0 ||
                detail.periode_berjalan > 0 ||
                (detail.saldo_awal_buku?.length ?? 0) > 0
            )
                errors[`details.${index}.akumulasi_per_unit`] =
                    'Akumulasi dan periode berjalan hanya diisi untuk saldo awal.';
        }
        if (Object.keys(errors).length) validation(errors);
        const validated = { ...data, responsible_org_unit_id: responsible };
        this.workspace.require(data.legal_entity_id, responsible);
        for (const [index, detail] of data.details.entries()) {
            await this.inventory.attributeRows(
                detail.jenis_aset_id,
                detail.atribut,
                `details.${index}.`,
            );
            if (detail.model_aset_id) {
                const model = await this.db.one(
                    z.object({
                        pabrikan_aset_id: z.string().nullable(),
                        jenis_aset_id: z.string().nullable(),
                        aktif: z.boolean(),
                    }),
                    'select pabrikan_aset_id,jenis_aset_id,aktif from aset_m_model_aset where tenant_id=$1 and id=$2 and deleted_at is null limit 1',
                    [this.workspace.tenantId, detail.model_aset_id],
                );
                const field = `details.${index}.model_aset_id`;
                if (model) {
                    if (!model.aktif)
                        validation({
                            [field]: 'Model yang dipilih sudah tidak aktif.',
                        });
                    if (model.pabrikan_aset_id !== detail.pabrikan_aset_id)
                        validation({
                            [field]:
                                'Model harus berasal dari pabrikan yang dipilih.',
                        });
                    const related = await this.db.one(
                        z.object({ found: z.boolean() }),
                        'select true as found from aset_m_model_aset where tenant_id=$1 and jenis_aset_id=$2 and aktif=true and deleted_at is null limit 1',
                        [this.workspace.tenantId, detail.jenis_aset_id],
                    );
                    if (related && model.jenis_aset_id !== detail.jenis_aset_id)
                        validation({
                            [field]:
                                'Model ini belum dikaitkan dengan jenis aset yang dipilih.',
                        });
                    if (!related && model.jenis_aset_id !== null)
                        validation({
                            [field]:
                                'Model ini hanya dapat dipakai pada jenis aset yang sudah dikaitkan dengannya.',
                        });
                }
            }
        }
        if (data.vendor_id) {
            const vendor = await this.finance.vendor(data.vendor_id);
            if (!vendor || vendor.legal_entity_id !== data.legal_entity_id)
                validation({
                    vendor_id:
                        'Pilih vendor milik entitas legal penerimaan ini.',
                });
        }
        return validated;
    }

    private header(data: ReceiptInput): Record<string, Bind> {
        return {
            legal_entity_id: data.legal_entity_id,
            responsible_org_unit_id: data.responsible_org_unit_id,
            tanggal: data.tanggal,
            currency_code: data.currency_code.toUpperCase(),
            cara_perolehan: data.cara_perolehan,
            receiving_org_unit_id: data.receiving_org_unit_id,
            tanggal_siap_pakai: data.tanggal_siap_pakai,
            diterima_oleh_user_id: data.diterima_oleh_user_id,
            penanggung_jawab_user_id: data.penanggung_jawab_user_id,
            lokasi_aset_id: data.lokasi_aset_id,
            keterangan: data.keterangan,
            vendor_id: data.vendor_id,
            vendor_invoice_reference: data.vendor_invoice_reference,
            purchase_order_reference:
                data.purchase_order_reference?.trim() || null,
            vendor_invoice_date: data.vendor_invoice_date,
            updated_at: nowSql(),
        };
    }

    private async replaceLines(id: string, data: ReceiptInput): Promise<void> {
        for (const [index, detail] of data.details.entries()) {
            const stamp = nowSql();
            await this.db.insert(detailTable, {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                penerimaan_aset_id: id,
                line_number: index + 1,
                nama: detail.nama,
                group_aset_id: detail.group_aset_id,
                jenis_aset_id: detail.jenis_aset_id,
                kondisi_aset_id: detail.kondisi_aset_id,
                pabrikan_aset_id: detail.pabrikan_aset_id,
                model_aset_id: detail.model_aset_id,
                model_number: detail.model_number,
                jumlah: detail.jumlah,
                nilai_per_unit: detail.nilai_per_unit,
                ppn_per_unit: detail.ppn_per_unit,
                residu_per_unit: detail.residu_per_unit,
                akumulasi_per_unit: detail.akumulasi_per_unit,
                periode_berjalan: detail.periode_berjalan,
                saldo_awal_buku: null,
                permintaan_pembelian_detail_id:
                    detail.permintaan_pembelian_detail_id,
                atribut: JSON.stringify(detail.atribut),
                keterangan: detail.keterangan,
                created_at: stamp,
                updated_at: stamp,
            });
        }
    }

    private async requestLinks(
        details: {
            permintaan_pembelian_detail_id: string | null;
            jenis_aset_id: string;
            jumlah: number;
            nama: string;
        }[],
        receiptId: string | null,
        companyId: string,
        method: string,
        lock: boolean,
    ): Promise<void> {
        const ids = [
            ...new Set(
                details.flatMap((detail) =>
                    detail.permintaan_pembelian_detail_id
                        ? [detail.permintaan_pembelian_detail_id]
                        : [],
                ),
            ),
        ];
        if (!ids.length) return;
        const fetch = () =>
            this.db.rows(
                requestLineSchema,
                `select id,request_id,jenis_aset_id,quantity from aset_tr_permintaan_pengadaan_aset_details where tenant_id=$1 and id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
                [this.workspace.tenantId, ...ids],
            );
        let lines = await fetch();
        const requestIds = [...new Set(lines.map((line) => line.request_id))];
        const headers = requestIds.length
            ? await this.db.rows(
                  requestHeaderSchema,
                  `select id,status,legal_entity_id,requesting_org_unit_id from aset_tr_permintaan_pengadaan_aset where tenant_id=$1 and deleted_at is null and id in (${requestIds.map((_, index) => `$${index + 2}`).join(',')}) order by id ${lock ? 'for update' : ''}`,
                  [this.workspace.tenantId, ...requestIds],
              )
            : [];
        if (receiptId === null) lines = await fetch();
        for (const [index, detail] of details.entries()) {
            if (!detail.permintaan_pembelian_detail_id) continue;
            const line = lines.find(
                (item) => item.id === detail.permintaan_pembelian_detail_id,
            );
            const header = headers.find((item) => item.id === line?.request_id);
            if (receiptId === null) {
                if (
                    !line ||
                    !header ||
                    header.status === 'cancelled' ||
                    header.legal_entity_id !== companyId
                )
                    validation({
                        [`details.${index}.permintaan_pembelian_detail_id`]:
                            'Pilih permintaan yang belum dibatalkan dari perusahaan yang sama.',
                    });
                this.workspace.require(
                    header.legal_entity_id,
                    header.requesting_org_unit_id,
                );
                if (
                    method !== 'pembelian' ||
                    line.jenis_aset_id !== detail.jenis_aset_id
                )
                    validation({
                        [`details.${index}.permintaan_pembelian_detail_id`]:
                            'Penerimaan pembelian harus memakai jenis aset yang sama dengan permintaan.',
                    });
            } else {
                if (!line || !header || header.status === 'cancelled')
                    abort(
                        422,
                        'Permintaan pembelian sudah dibatalkan atau tidak tersedia.',
                    );
                const previous = await this.db.one(
                    z.object({ quantity: z.number() }),
                    `select coalesce(sum(d.jumlah),0)::int as quantity from ${detailTable} d where d.tenant_id=$1 and d.permintaan_pembelian_detail_id=$2 and d.penerimaan_aset_id!=$3 and exists(select 1 from ${headerTable} h where h.id=d.penerimaan_aset_id and h.tenant_id=$1 and h.status='selesai' and h.deleted_at is null)`,
                    [this.workspace.tenantId, line.id, receiptId],
                );
                const quantity = details
                    .filter(
                        (item) =>
                            item.permintaan_pembelian_detail_id === line.id,
                    )
                    .reduce((sum, item) => sum + item.jumlah, 0);
                if (
                    (previous?.quantity ?? 0) + quantity >
                    Number(line.quantity)
                )
                    validation({
                        details: `Baris "${detail.nama}" melebihi permintaan pembelian. Sisa yang belum diterima tinggal ${Math.max(0, Math.trunc(Number(line.quantity)) - (previous?.quantity ?? 0))}.`,
                    });
            }
        }
    }

    async create(request: Request, input: unknown) {
        this.workspace.guard('penerimaan-aset', 'create');
        const key = request.headers.get('idempotency-key');
        if (!key || !/^[A-Za-z0-9._:-]{1,143}$/.test(key))
            validation({
                key: !key
                    ? 'The key field is required.'
                    : 'The key field format is invalid.',
            });
        const replay = await this.replay(key);
        if (replay)
            return {
                status: 200,
                headers: { 'Idempotent-Replayed': 'true' },
                body: { data: replay },
            };
        const data = await this.validate(input);
        const code = await this.numbers.issue(
            this.workspace.moduleId + '.penerimaan-aset',
            'penerimaan-aset:' + key,
        );
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                await this.requestLinks(
                    data.details,
                    null,
                    data.legal_entity_id,
                    data.cara_perolehan,
                    true,
                );
                await this.db.insert(headerTable, {
                    ...this.header(data),
                    id,
                    tenant_id: this.workspace.tenantId,
                    creation_key: key,
                    kode: code,
                    status: 'draft',
                    created_at: nowSql(),
                });
                await this.replaceLines(id, data);
            });
        } catch (error) {
            if (sqlErrorCode(error)) {
                const replay = await this.replay(key);
                if (replay)
                    return {
                        status: 200,
                        headers: { 'Idempotent-Replayed': 'true' },
                        body: { data: replay },
                    };
            }
            throw error;
        }
        return {
            status: 201,
            headers: { Location: request.url.replace(/\?.*$/, '') + '/' + id },
            body: {
                data: {
                    ...(await this.document(id)),
                    details: await this.lines(id, true),
                },
            },
        };
    }

    private async claim(id: string, version: number): Promise<void> {
        const claimed = await this.db.one(
            z.object({ id: z.string() }),
            `update ${headerTable} set version=$1 where tenant_id=$2 and id=$3 and version=$1 and deleted_at is null returning id`,
            [version, this.workspace.tenantId, id],
        );
        if (!claimed) {
            const exists = await this.db.one(
                z.object({ id: z.string() }),
                `select id from ${headerTable} where tenant_id=$1 and id=$2 and deleted_at is null limit 1`,
                [this.workspace.tenantId, id],
            );
            if (!exists) abort(404, 'Not Found');
            coded(
                409,
                'stale_version',
                'Perubahanmu belum disimpan karena data ini sudah diubah sejak kamu membukanya. Muat ulang untuk melihat data terbaru, lalu ulangi perubahanmu.',
            );
        }
    }

    async update(request: Request, id: string, input: unknown) {
        this.workspace.guard('penerimaan-aset', 'update');
        const receipt = await this.document(id);
        if (receipt.status !== 'draft') abort(422, editedMessage);
        const data = await this.validate(input);
        const version = expectedVersion(request, input);
        this.workspace.require(
            receipt.legal_entity_id,
            receipt.responsible_org_unit_id,
        );
        await this.db.transaction(async () => {
            await this.requestLinks(
                data.details,
                null,
                data.legal_entity_id,
                data.cara_perolehan,
                true,
            );
            await this.claim(id, version);
            const header = this.header(data);
            const updated = await this.db.one(
                z.object({ id: z.string() }),
                `update ${headerTable} set ${Object.keys(header)
                    .map((field, index) => `${field}=$${index + 1}`)
                    .join(
                        ',',
                    )} where tenant_id=$${Object.keys(header).length + 1} and id=$${Object.keys(header).length + 2} and status='draft' and deleted_at is null returning id`,
                [...Object.values(header), this.workspace.tenantId, id],
            );
            if (!updated) abort(422, editedMessage);
            await this.db.execute(
                `delete from ${detailTable} where tenant_id=$1 and penerimaan_aset_id=$2`,
                [this.workspace.tenantId, id],
            );
            await this.replaceLines(id, data);
        });
        return this.show(id);
    }

    private async flowAttachments(id: string): Promise<void> {
        const filter = this.workspace.filter('h', 2);
        const exists = await this.db.one(
            z.object({ id: z.string() }),
            `select h.id from ${headerTable} h where h.id=$1 and h.deleted_at is null and ${filter.clause} limit 1`,
            [id, ...filter.bindings],
        );
        if (
            !exists ||
            !this.workspace.permissions.has(
                this.workspace.moduleId + '.penerimaan-aset.read',
            )
        )
            abort(404, 'Data ini tidak ditemukan.');
        await this.db.transaction(async () => {
            const attachments = await this.db.rows(
                z.object({
                    id: z.string(),
                    line_number: z.number().nullable(),
                    file_name: z.string(),
                    mime_type: z.string(),
                    size_bytes: z.coerce.number(),
                    storage_path: z.string(),
                    content_hash: z.string(),
                    data_class: z.string(),
                    created_by_user_id: idSchema.nullable(),
                }),
                "select * from document_attachments where tenant_id=$1 and record_type='aset_tr_penerimaan_aset' and record_id=$2 and kind='document' and deleted_at is null order by id for update",
                [this.workspace.tenantId, id],
            );
            if (!attachments.length) return;
            const records = await this.db.rows(
                z.object({
                    record_id: z.string(),
                    source_line_number: z.number().nullable(),
                }),
                `select a.id as record_id,d.line_number as source_line_number from aset_tr_aset a left join ${detailTable} d on d.id=a.penerimaan_aset_detail_id and d.tenant_id=$1 where a.tenant_id=$1 and a.penerimaan_aset_id=$2 and a.deleted_at is null and a.is_budgeted=false order by a.id`,
                [this.workspace.tenantId, id],
            );
            const existing = await this.db.rows(
                z.object({ record_id: z.string(), storage_path: z.string() }),
                `select record_id,storage_path from document_attachments where tenant_id=$1 and record_type='aset_tr_aset' and record_id in (${records.map((_, index) => `$${index + 2}`).join(',') || 'null'})`,
                [
                    this.workspace.tenantId,
                    ...records.map((row) => row.record_id),
                ],
            );
            const known = new Set(
                existing.map((row) => row.record_id + '|' + row.storage_path),
            );
            for (const record of records)
                for (const attachment of attachments) {
                    const key =
                        record.record_id + '|' + attachment.storage_path;
                    if (
                        (attachment.line_number !== null &&
                            attachment.line_number !==
                                record.source_line_number) ||
                        known.has(key)
                    )
                        continue;
                    known.add(key);
                    const stamp = nowSql();
                    await this.db.insert('document_attachments', {
                        id: Bun.randomUUIDv7(),
                        tenant_id: this.workspace.tenantId,
                        record_type: 'aset_tr_aset',
                        record_id: record.record_id,
                        line_number: null,
                        kind: 'document',
                        file_name: attachment.file_name,
                        mime_type: attachment.mime_type,
                        size_bytes: attachment.size_bytes,
                        storage_path: attachment.storage_path,
                        content_hash: attachment.content_hash,
                        data_class: attachment.data_class,
                        created_by_user_id: attachment.created_by_user_id,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                }
        });
    }

    async complete(request: Request, id: string, input: unknown) {
        this.workspace.guard('aset', 'create');
        const receipt = await this.document(id);
        if (receipt.status !== 'draft')
            abort(422, 'Penerimaan ini sudah diselesaikan.');
        const version = expectedVersion(request, input);
        this.workspace.require(
            receipt.legal_entity_id,
            receipt.responsible_org_unit_id,
        );
        const lines = await this.lines(id);
        if (!lines.length)
            validation({
                details:
                    'Penerimaan tanpa baris barang tidak dapat diselesaikan.',
            });
        await this.requestLinks(
            lines,
            id,
            receipt.legal_entity_id,
            receipt.cara_perolehan,
            false,
        );
        const blockers = await this.posting.blockers(receipt, lines);
        if (Object.keys(blockers).length) validation(blockers);
        const units: {
            line: ReceiptDetail;
            key: string;
            value: string;
            tax: string;
        }[] = [];
        for (const line of lines) {
            const amounts = await this.posting.amounts(receipt, line);
            for (let index = 0; index < line.jumlah; index++) {
                const value = amounts.unitValues[index];
                const tax = amounts.unitTaxes[index];
                if (value === undefined || tax === undefined)
                    throw new Error('Incomplete allocation.');
                units.push({
                    line,
                    key: `penerimaan:${id}:${line.line_number}:${index + 1}`,
                    value,
                    tax,
                });
            }
        }
        await this.db.transaction(async () => {
            await this.requestLinks(
                lines,
                id,
                receipt.legal_entity_id,
                receipt.cara_perolehan,
                true,
            );
            await this.claim(id, version);
            const updated = await this.db.one(
                z.object({ id: z.string() }),
                `update ${headerTable} set status='selesai',updated_at=$1 where tenant_id=$2 and id=$3 and status='draft' and deleted_at is null returning id`,
                [nowSql(), this.workspace.tenantId, id],
            );
            if (!updated) abort(422, 'Penerimaan ini sudah diselesaikan.');
            const codes = await assetCodes(
                this.db,
                this.numbers,
                this.workspace,
                units.map((unit) => ({
                    key: 'aset:' + unit.key,
                    groupId: unit.line.group_aset_id,
                    locationId: receipt.lokasi_aset_id,
                    acquiredOn: receipt.tanggal.slice(0, 10),
                })),
            );
            const assets = [];
            for (const unit of units) {
                const code = codes.get('aset:' + unit.key);
                if (!code) throw new Error('Asset number was not issued.');
                const asset = await this.inventory.create(
                    receipt,
                    unit.line,
                    unit.key,
                    code,
                    unit.value,
                );
                assets.push({ ...asset, tax_amount: unit.tax });
            }
            await this.flowAttachments(id);
            await this.posting.publish(receipt, lines, assets);
        });
        return this.show(id);
    }

    async preview(id: string) {
        this.workspace.guard('penerimaan-aset', 'read');
        const receipt = await this.document(id);
        if (receipt.status !== 'draft')
            abort(
                422,
                'Penerimaan ini sudah diselesaikan; jurnalnya sudah terbit dan keadaannya ada di rincian dokumen.',
            );
        const lines = await this.lines(id);
        const blockers = lines.length
            ? await this.posting.blockers(receipt, lines)
            : { details: 'Tambahkan baris barang lebih dulu.' };
        const value =
            lines.length && !blockers.currency_code
                ? await this.posting.evaluate(
                      receipt,
                      lines,
                      null,
                      Boolean(blockers.vendor_id),
                  )
                : null;
        return {
            data: {
                blockers: Object.entries(blockers).map(([field, message]) => ({
                    field,
                    message,
                })),
                status: value?.status ?? null,
                posting_date: value?.input.posting_date ?? null,
                settlement_mode: value?.input.settlement_mode ?? null,
                currency: value
                    ? {
                          code: value.input.currency_code,
                          decimals: value.decimals,
                      }
                    : null,
                lines:
                    value?.payloadLines.map((line) => ({
                        line_no: line.line_no,
                        account_code: line.account?.code ?? null,
                        account_name: line.account?.name ?? null,
                        description: line.description,
                        debit: line.debit,
                        credit: line.credit,
                        dimensions: line.financial_dimensions.map(
                            ({ value_id, ...dimension }) => dimension,
                        ),
                    })) ?? [],
                problems: value?.problems ?? [],
            },
        };
    }

    async assets(id: string) {
        this.workspace.guard('penerimaan-aset', 'read');
        const receipt = await this.document(id);
        const assets = await this.db.rows(
            jsonObject,
            'select id,kode,nama,serial_number,penerimaan_aset_detail_id from aset_tr_aset where tenant_id=$1 and penerimaan_aset_id=$2 and deleted_at is null and is_budgeted=false order by kode',
            [this.workspace.tenantId, id],
        );
        return { data: assets, version: receipt.version };
    }
}
