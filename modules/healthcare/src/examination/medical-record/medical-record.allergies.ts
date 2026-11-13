import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { isoSql, type Database } from '@core/platform/database/index.ts';
import { isRecord, lookupId } from '@core/platform/http/index.ts';
import { duplicateAllergyMessage } from './medical-record.messages.ts';
import { practitionerOfUser, text } from './medical-record.orders.ts';
import {
    allergyCategories,
    allergyItemSchema,
    allergyStatuses,
} from './medical-record.schema.ts';

// Daftar alergi pasien (sim_m_pasien_alergi) di panel Riwayat penyakit dan alergi, ditulis di dalam Simpan rekam medis.
// Alergi milik pasien, jadi terbawa ke pemeriksaan berikutnya. Baris yang sudah dicatat tidak pernah ditimpa: jenis,
// alergen, pemeriksaan, waktu, dan pencatatnya tetap; yang bisa diubah hanya reaksi dan status.

type Errors = Record<string, string[]>;
type AllergyCategory = (typeof allergyCategories)[number];
type AllergyStatus = (typeof allergyStatuses)[number];

const savedAllergySchema = allergyItemSchema.extend({
    id: z.string(),
    category: z.enum(allergyCategories),
});
type SavedAllergy = z.infer<typeof savedAllergySchema>;

// Alergen baris baru: tepat satu dari alergi_id, obat_id, atau nama, sesuai jenisnya.
type NewAllergy = {
    category: AllergyCategory;
    allergen_id: string | null;
    drug_id: string | null;
    name: string | null;
    reaction: string | null;
    status: AllergyStatus;
};

// Baris baru yang sudah dikenali alergennya, dengan isian dan nama alergen untuk pesan alergen ganda.
type NewEntry = {
    allergy: Omit<NewAllergy, 'reaction' | 'status'>;
    field: string;
    label: string;
};

// Daftar yang dikirim layar: baris tersimpan yang tetap ada beserta reaksi dan statusnya, dan baris baru. Baris
// tersimpan yang tidak dikirim lagi dibuang pengguna.
export type AllergyList = {
    saved: SavedAllergy[];
    kept: Map<string, { reaction: string | null; status: AllergyStatus }>;
    added: NewAllergy[];
};

const allergyNoneMessage =
    'Tidak ada alergi tidak bisa dipilih selama pasien punya alergi aktif.';

// Kode 00 "Tidak Ada" di setiap jenis sim_m_alergi (kode PCare) berarti pasien tidak punya alergi jenis itu, jadi ia
// bukan alergen. Tidak ada alergi dicatat per pemeriksaan.
const allergenChoice = `kode <> '00' and deleted_at is null`;

function add(errors: Errors, field: string, message: string): void {
    (errors[field] ??= []).push(message);
}

const missing = (value: unknown) =>
    value === null || value === undefined || value === '';

const isCategory = (value: unknown): value is AllergyCategory =>
    allergyCategories.some((category) => category === value);
const isStatus = (value: unknown): value is AllergyStatus =>
    allergyStatuses.some((status) => status === value);

// Kunci keunikan baris hidup, sama dengan indeks unik tabelnya. Alergi lainnya tidak punya kunci.
const keyOf = (row: {
    category: AllergyCategory | null;
    allergen_id: string | null;
    drug_id: string | null;
}) =>
    row.drug_id
        ? `obat:${row.drug_id}`
        : row.allergen_id
          ? `${row.category ?? ''}:${row.allergen_id}`
          : null;

// Obat dari baris obat_id yang aktif, yang ditolak E-Resep. Golongan obat tidak ikut, karena tidak ada pemetaan golongan
// ke obat.
export function activeDrugIdsOf(list: AllergyList): Set<string> {
    const ids = new Set<string>();
    for (const row of list.saved) {
        const kept = list.kept.get(row.id);
        if (row.drug_id && kept?.status === 'aktif') ids.add(row.drug_id);
    }
    for (const row of list.added)
        if (row.drug_id && row.status === 'aktif') ids.add(row.drug_id);
    return ids;
}

export class PatientAllergies {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get tenantId() {
        return this.workspace.tenantId;
    }

    // Pilihan alergen layar per jenis: makanan, udara, dan golongan obat.
    async allergens() {
        const rows = await this.db.rows(
            z.object({
                id: z.string(),
                kind: z.string(),
                code: z.string(),
                name: z.string(),
            }),
            `select id, jenis as kind, kode as code, nama as name from sim_m_alergi
             where tenant_id = $1 and ${allergenChoice} order by jenis, urutan, kode`,
            [this.tenantId],
        );
        const of = (kind: AllergyCategory) =>
            rows
                .filter((row) => row.kind === kind)
                .map(({ id, code, name }) => ({ id, code, name }));
        return {
            food: of('makanan'),
            airborne: of('udara'),
            drug_classes: of('obat'),
        };
    }

    async list(patientId: string): Promise<SavedAllergy[]> {
        return this.db.rows(
            savedAllergySchema,
            `select a.id, a.kategori as category, a.alergi_id as allergen_id, m.nama as allergen_name,
                    a.obat_id as drug_id, b.kode as drug_code, b.nama as drug_name, a.nama as name,
                    a.reaksi as reaction, a.status, ${isoSql('a.dicatat_pada')} as recorded_at, u.name as recorded_by
             from sim_m_pasien_alergi a
             left join sim_m_alergi m on m.tenant_id = a.tenant_id and m.id = a.alergi_id
             left join gd_m_barang b on b.tenant_id = a.tenant_id and b.id = a.obat_id
             left join users u on u.id = a.dicatat_oleh
             where a.tenant_id = $1 and a.pasien_id = $2 and a.deleted_at is null
             order by a.dicatat_pada, a.id`,
            [this.tenantId, patientId],
        );
    }

    async activeDrugIds(patientId: string): Promise<Set<string>> {
        return new Set(
            (await this.list(patientId)).flatMap((row) =>
                row.drug_id && row.status === 'aktif' ? [row.drug_id] : [],
            ),
        );
    }

    // Daftar alergi yang dikirim layar. Baris tersimpan dikenali dari id-nya; jenis dan alergen kirimannya diabaikan,
    // karena keduanya tidak berubah sesudah dicatat. Tanpa items, daftar tersimpan dibiarkan seperti adanya.
    async read(
        raw: Record<string, unknown> | undefined,
        patientId: string,
        none: boolean,
        errors: Errors,
    ): Promise<AllergyList> {
        const saved = await this.list(patientId);
        const list: AllergyList = { saved, kept: new Map(), added: [] };
        if (!Array.isArray(raw?.items)) {
            if (raw?.items !== undefined)
                add(errors, 'allergy.items', 'Isian ini tidak sah.');
            for (const row of saved)
                list.kept.set(row.id, {
                    reaction: row.reaction,
                    status: row.status,
                });
        } else {
            const added: (NewEntry & {
                reaction: string | null;
                status: AllergyStatus;
            })[] = [];
            for (const [index, item] of raw.items.entries()) {
                const row = isRecord(item) ? item : {};
                const field = (name: string) =>
                    `allergy.items.${index}.${name}`;
                const reaction = text(
                    row.reaction,
                    500,
                    field('reaction'),
                    errors,
                );
                const status = isStatus(row.status) ? row.status : null;
                if (!status)
                    add(errors, field('status'), 'Pilih status alergi.');
                if (missing(row.id)) {
                    const entry = await this.readNew(row, field, errors);
                    if (entry && status)
                        added.push({ ...entry, reaction, status });
                    continue;
                }
                const id = typeof row.id === 'string' ? lookupId(row.id) : null;
                const before = saved.find((allergy) => allergy.id === id);
                if (!before || list.kept.has(before.id))
                    add(errors, field('id'), 'Isian ini tidak sah.');
                else if (status) list.kept.set(before.id, { reaction, status });
            }
            // Alergen yang sudah ada di daftar tidak dicatat dua kali. Baris tersimpan yang dibuang tidak dihitung, jadi
            // alergennya boleh dicatat ulang.
            const keys = new Set(
                saved.flatMap((row) => {
                    const key = keyOf(row);
                    return key && list.kept.has(row.id) ? [key] : [];
                }),
            );
            for (const entry of added) {
                const key = keyOf(entry.allergy);
                if (key && keys.has(key)) {
                    add(
                        errors,
                        entry.field,
                        duplicateAllergyMessage(entry.label),
                    );
                    continue;
                }
                if (key) keys.add(key);
                list.added.push({
                    ...entry.allergy,
                    reaction: entry.reaction,
                    status: entry.status,
                });
            }
        }
        const active =
            [...list.kept.values()].some((row) => row.status === 'aktif') ||
            list.added.some((row) => row.status === 'aktif');
        if (none && active) add(errors, 'allergy.none', allergyNoneMessage);
        return list;
    }

    private async readNew(
        row: Record<string, unknown>,
        field: (name: string) => string,
        errors: Errors,
    ): Promise<NewEntry | null> {
        const category = row.category;
        if (!isCategory(category)) {
            add(errors, field('category'), 'Pilih jenis alergi.');
            return null;
        }
        const empty = { allergen_id: null, drug_id: null, name: null };
        switch (category) {
            case 'makanan':
            case 'udara':
                return this.readAllergen(
                    row.allergen_id,
                    category,
                    field,
                    errors,
                );
            case 'obat': {
                if (missing(row.drug_id) && !missing(row.allergen_id))
                    return this.readAllergen(
                        row.allergen_id,
                        category,
                        field,
                        errors,
                    );
                const drug = await this.drug(row.drug_id);
                if (!drug) {
                    add(errors, field('drug_id'), 'Pilih obat dari daftar.');
                    return null;
                }
                return {
                    allergy: { ...empty, category, drug_id: drug.id },
                    field: field('drug_id'),
                    label: drug.name,
                };
            }
            case 'lainnya': {
                const name = text(row.name, 500, field('name'), errors);
                if (name === null) {
                    if (!errors[field('name')])
                        add(errors, field('name'), 'Isi nama alergi.');
                    return null;
                }
                return {
                    allergy: { ...empty, category, name },
                    field: field('name'),
                    label: name,
                };
            }
            default: {
                const unknown: never = category;
                throw new Error(`Unknown allergy category ${String(unknown)}`);
            }
        }
    }

    // Alergen dari pilihan sim_m_alergi jenis yang sama.
    private async readAllergen(
        raw: unknown,
        category: 'makanan' | 'udara' | 'obat',
        field: (name: string) => string,
        errors: Errors,
    ) {
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string(), name: z.string() }),
                  `select id, nama as name from sim_m_alergi
                   where tenant_id = $1 and id = $2 and jenis = $3 and ${allergenChoice}`,
                  [this.tenantId, id, category],
              )
            : undefined;
        if (!found) {
            add(errors, field('allergen_id'), 'Pilih dari daftar.');
            return null;
        }
        return {
            allergy: {
                category,
                allergen_id: found.id,
                drug_id: null,
                name: null,
            },
            field: field('allergen_id'),
            label: found.name,
        };
    }

    // Alergi milik pasien, dan pasien bisa dibagi antar legal entity, jadi obat legal entity mana pun di tenant ini
    // diterima, termasuk yang tidak boleh diresepkan.
    private async drug(raw: unknown) {
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        return id
            ? this.db.one(
                  z.object({ id: z.string(), name: z.string() }),
                  `select o.id, b.nama as name from sim_m_obat o
                   join gd_m_barang b on b.tenant_id = o.tenant_id and b.id = o.id and b.deleted_at is null
                   where o.tenant_id = $1 and o.id = $2 and o.deleted_at is null`,
                  [this.tenantId, id],
              )
            : undefined;
    }

    // Baris yang dibuang diberi deleted_at lebih dulu, supaya alergen yang sama bisa dicatat ulang pada Simpan yang sama.
    // Baris tersimpan hanya diubah reaksi dan statusnya. Baris baru dicatat pada pemeriksaan ini, oleh pengguna ini.
    async write(
        patientId: string,
        recordId: string,
        list: AllergyList,
        stamp: string,
    ): Promise<void> {
        for (const row of list.saved)
            if (!list.kept.has(row.id))
                await this.update(row.id, {
                    deleted_at: stamp,
                    updated_at: stamp,
                });
        for (const row of list.saved) {
            const kept = list.kept.get(row.id);
            if (
                kept &&
                (kept.reaction !== row.reaction || kept.status !== row.status)
            )
                await this.update(row.id, {
                    reaksi: kept.reaction,
                    status: kept.status,
                    updated_at: stamp,
                });
        }
        const recorder = list.added.length
            ? await practitionerOfUser(
                  this.db,
                  this.tenantId,
                  this.workspace.userId,
              )
            : null;
        for (const row of list.added)
            await this.db.insert('sim_m_pasien_alergi', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.tenantId,
                pasien_id: patientId,
                kategori: row.category,
                alergi_id: row.allergen_id,
                obat_id: row.drug_id,
                nama: row.name,
                reaksi: row.reaction,
                status: row.status,
                pemeriksaan_id: recordId,
                dicatat_pada: stamp,
                dicatat_oleh: this.workspace.userId,
                dicatat_oleh_nakes_id: recorder,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    private async update(id: string, values: Record<string, string | null>) {
        const columns = Object.keys(values);
        await this.db.execute(
            `update sim_m_pasien_alergi
             set ${columns.map((column, index) => `${column} = $${index + 3}`).join(', ')}
             where tenant_id = $1 and id = $2`,
            [this.tenantId, id, ...Object.values(values)],
        );
    }
}
