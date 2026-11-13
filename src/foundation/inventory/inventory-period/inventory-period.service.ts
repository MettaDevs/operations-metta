import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    isoSql,
    nowSql,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
    violates,
} from '../inventory.service.ts';
import { display, fromNumeric, quantityScale } from '../quantity.ts';
import {
    inventoryPeriodInputSchema,
    inventoryPeriodRowSchema,
} from './inventory-period.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

const lockKey = (scope: Scope) =>
    `gd_m_periode_persediaan:${scope.tenantId}:${scope.legalEntityId}`;

// Setiap transaksi yang menulis kartu gudang memegang kunci bersama ini sampai commit; menutup, membuka lagi, dan
// mengubah periode memegang kunci eksklusifnya. Menutup periode karena itu menunggu posting yang sedang berjalan, dan
// posting yang datang sesudahnya membaca periode yang sudah ditutup. Diambil lockItemLocations sebelum kunci barang dan
// lokasi, sehingga urutan kuncinya sama di setiap transaksi.
export async function lockInventoryPeriods(db: Database, scope: Scope) {
    await db.execute(
        'select pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
        [lockKey(scope)],
    );
}

const longDate = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});
const monthName = new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});
const dateText = (date: string) =>
    longDate.format(new Date(`${date}T00:00:00Z`));

// Penjaga mesin posting (IsValidDate dan ShowError di BC): posting atau pembatalan bertanggal sampai tanggal akhir
// periode yang ditutup ditolak. Periode yang ditutup selalu berurutan dari yang paling awal, jadi periode tertutup
// pertama yang berakhir pada atau sesudah tanggal itu adalah periode yang memuatnya. Dipanggil sesudah
// lockInventoryPeriods.
export async function refuseClosedPeriod(
    db: Database,
    scope: Scope,
    date: string,
    action: 'post' | 'reverse',
): Promise<void> {
    const closed = await db.one(
        z.object({ name: z.string(), closed_through: z.string() }),
        `select p.nama as name,
                (select max(t.tanggal_akhir)::text from gd_m_periode_persediaan t
                 where t.tenant_id = $1 and t.legal_entity_id = $2 and t.ditutup and t.deleted_at is null)
                as closed_through
         from gd_m_periode_persediaan p
         where p.tenant_id = $1 and p.legal_entity_id = $2 and p.ditutup and p.deleted_at is null
           and p.tanggal_akhir >= $3
         order by p.tanggal_akhir
         limit 1`,
        [scope.tenantId, scope.legalEntityId, date],
    );
    if (!closed) return;
    validation({
        _form:
            action === 'post'
                ? `Periode persediaan ${closed.name} sudah ditutup, jadi stok bertanggal ${dateText(date)} tidak bisa diposting. Pakai tanggal sesudah ${dateText(closed.closed_through)}, atau minta periode itu dibuka lagi.`
                : `Periode persediaan ${closed.name} sudah ditutup, jadi posting bertanggal ${dateText(date)} tidak bisa dibatalkan. Minta periode itu dibuka lagi bila pembatalannya memang perlu.`,
    });
}

const stampSql = (at: string, user: string) =>
    `case when ${at} is null then null else json_build_object(
         'at', ${isoSql(at)},
         'user_name', (select u.name from users u where u.id = ${user})) end`;

const rowSql = `select * from (
                    select p.id, p.tanggal_akhir::text as ending_date, p.nama as name, p.ditutup as closed,
                           ${stampSql('p.ditutup_pada', 'p.ditutup_oleh_user_id')} as closed_stamp,
                           ${stampSql('p.dibuka_lagi_pada', 'p.dibuka_lagi_oleh_user_id')} as reopened_stamp,
                           p.version, p.ditutup_pada is not null as ever_closed
                    from gd_m_periode_persediaan p
                    where p.tenant_id = $1 and p.legal_entity_id = $2 and p.deleted_at is null) periods
                where true`;

const storedSchema = inventoryPeriodRowSchema.extend({
    ever_closed: z.boolean(),
});

export class InventoryPeriods {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-period', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: { ending_date: 'ending_date', name: 'name' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'ending_date',
            defaultDirection: 'desc',
        });
        const can = (action: string) =>
            this.workspace.permissions.has(`core.inventory-period.${action}`);
        return {
            data: batch.data.map((row) => inventoryPeriodRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: can('update'),
            can_close: can('close'),
            can_reopen: can('reopen'),
        };
    }

    private async stored(id: string) {
        const found = lookupId(id)
            ? await this.db.one(storedSchema, `${rowSql} and periods.id = $3`, [
                  this.scope.tenantId,
                  this.scope.legalEntityId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async row(id: string) {
        return inventoryPeriodRowSchema.parse(await this.stored(id));
    }

    // Semua perubahan periode berjalan di bawah kunci eksklusif, sehingga urutan periode yang ditutup tidak bisa rusak
    // oleh dua perubahan bersamaan dan tidak ada posting yang sedang berjalan saat periode ditutup.
    private async exclusively<T>(work: () => Promise<T>): Promise<T> {
        return this.db.transaction(async () => {
            await this.db.execute(
                'select pg_advisory_xact_lock(hashtextextended($1, 0))',
                [lockKey(this.scope)],
            );
            return work();
        });
    }

    private async closedThrough(): Promise<string | null> {
        const found = await this.db.one(
            z.object({ date: z.string().nullable() }),
            `select max(tanggal_akhir)::text as date from gd_m_periode_persediaan
             where tenant_id = $1 and legal_entity_id = $2 and ditutup and deleted_at is null`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        return found?.date ?? null;
    }

    private checked(body: unknown) {
        const data = parseInput(inventoryPeriodInputSchema, body, {
            ending_date: 'Isi tanggal akhir periode.',
            name: 'Isi nama periode.',
        });
        const name =
            data.name?.trim() ||
            monthName.format(new Date(`${data.ending_date}T00:00:00Z`));
        if (name.length > 50)
            validation({ name: 'Nama periode paling banyak 50 karakter.' });
        return { endingDate: data.ending_date, name };
    }

    // Periode baru tidak boleh berakhir sebelum periode yang sudah ditutup (Text002 di BC), supaya periode yang ditutup
    // tetap berurutan dari yang paling awal.
    private async refuseBeforeClosed(endingDate: string) {
        const closedThrough = await this.closedThrough();
        if (closedThrough !== null && endingDate <= closedThrough)
            validation({
                ending_date: `Persediaan sudah ditutup sampai ${dateText(closedThrough)}. Pilih tanggal akhir sesudahnya.`,
            });
    }

    private dateTaken(error: unknown): void {
        if (violates(error, 'gd_m_periode_persediaan_tanggal_unique'))
            validation({
                ending_date: 'Sudah ada periode dengan tanggal akhir ini.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-period', 'update');
        const data = this.checked(body);
        const id = Bun.randomUUIDv7();
        try {
            await this.exclusively(async () => {
                await this.refuseBeforeClosed(data.endingDate);
                const stamp = nowSql();
                await this.db.insert('gd_m_periode_persediaan', {
                    id,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    tanggal_akhir: data.endingDate,
                    nama: data.name,
                    created_at: stamp,
                    updated_at: stamp,
                });
            });
        } catch (error) {
            this.dateTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Nama selalu boleh diubah. Tanggal akhir tidak boleh berubah setelah periodenya pernah ditutup (OnRename di BC).
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-period', 'update');
        const data = this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.exclusively(async () => {
                const current = await this.stored(id);
                if (current.ending_date !== data.endingDate) {
                    if (current.ever_closed)
                        validation({
                            ending_date:
                                'Tanggal akhir periode yang pernah ditutup tidak bisa diubah.',
                        });
                    await this.refuseBeforeClosed(data.endingDate);
                }
                updated = await this.db.execute(
                    `update gd_m_periode_persediaan set tanggal_akhir = $1, nama = $2, updated_at = $3
                     where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                    [
                        data.endingDate,
                        data.name,
                        nowSql(),
                        this.scope.tenantId,
                        current.id,
                        version,
                    ],
                );
            });
        } catch (error) {
            this.dateTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-period', 'update');
        const version = expectedVersion(request, body);
        const deleted = await this.exclusively(async () => {
            const current = await this.stored(id);
            if (current.closed)
                validation({
                    _form: 'Periode yang sudah ditutup tidak bisa dihapus. Buka lagi periode itu lebih dulu.',
                });
            return this.db.execute(
                `update gd_m_periode_persediaan set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
                [nowSql(), this.scope.tenantId, current.id, version],
            );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }

    // Stok minus yang masih terbuka sampai tanggal akhir menahan penutupan (CheckOpenOutboundEntryExist di BC): barang
    // masuk sesudahnya akan menutup baris keluar itu, padahal periodenya sudah terkunci.
    private async refuseNegativeStock(endingDate: string) {
        const negatives = await this.db.rows(
            z.object({
                item: z.string(),
                location: z.string(),
                open: z.string(),
            }),
            `select b.kode || ' ' || b.nama as item, l.nama as location, sum(k.sisa)::text as open
             from gd_tr_kartu_gudang k
             join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id
             join gd_m_lokasi l on l.tenant_id = k.tenant_id and l.id = k.lokasi_id
             where k.tenant_id = $1 and k.legal_entity_id = $2 and k.sisa < 0 and k.tanggal_posting <= $3
             group by b.kode, b.nama, l.nama
             order by b.kode, l.nama
             limit 4`,
            [this.scope.tenantId, this.scope.legalEntityId, endingDate],
        );
        if (!negatives.length) return;
        const listed = negatives
            .slice(0, 3)
            .map(
                (row) =>
                    `${row.item} di ${row.location} (kurang ${display(-fromNumeric(row.open, quantityScale), quantityScale)})`,
            )
            .join(', ');
        validation({
            _form: `Periode ini belum bisa ditutup karena masih ada stok minus sampai ${dateText(endingDate)}: ${listed}${negatives.length > 3 ? ', dan barang lain' : ''}. Terima atau sesuaikan stok barang itu lebih dulu.`,
        });
    }

    // Menutup periode ikut menutup periode lebih awal yang masih terbuka (UpdateInvtPeriod di BC).
    async close(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-period', 'close');
        const version = expectedVersion(request, body);
        const closed = await this.exclusively(async () => {
            const current = await this.stored(id);
            if (current.version !== version) return false;
            if (current.closed)
                validation({ _form: 'Periode ini sudah ditutup.' });
            await this.refuseNegativeStock(current.ending_date);
            await this.db.execute(
                `update gd_m_periode_persediaan
                 set ditutup = true, ditutup_pada = $1, ditutup_oleh_user_id = $2, updated_at = $1
                 where tenant_id = $3 and legal_entity_id = $4 and deleted_at is null and not ditutup
                   and tanggal_akhir <= $5`,
                [
                    nowSql(),
                    this.workspace.userId,
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.ending_date,
                ],
            );
            return true;
        });
        if (!closed) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Membuka lagi ikut membuka periode sesudahnya yang sudah ditutup, karena posting di periode ini bisa mengubah stok
    // yang dibawa ke periode itu.
    async reopen(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-period', 'reopen');
        const version = expectedVersion(request, body);
        const reopened = await this.exclusively(async () => {
            const current = await this.stored(id);
            if (current.version !== version) return false;
            if (!current.closed)
                validation({ _form: 'Periode ini belum ditutup.' });
            await this.db.execute(
                `update gd_m_periode_persediaan
                 set ditutup = false, dibuka_lagi_pada = $1, dibuka_lagi_oleh_user_id = $2, updated_at = $1
                 where tenant_id = $3 and legal_entity_id = $4 and deleted_at is null and ditutup
                   and tanggal_akhir >= $5`,
                [
                    nowSql(),
                    this.workspace.userId,
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.ending_date,
                ],
            );
            return true;
        });
        if (!reopened) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }
}
