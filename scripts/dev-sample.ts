import type postgres from 'postgres';
import { z } from 'zod';
import { createApplication } from '../src/main.ts';
import type { Config } from '../src/platform/config/index.ts';
import {
    idRow,
    keyRow,
    required,
    sampleApi,
    type SampleApi,
} from './dev-sample-api.ts';

// Data contoh laptop developer untuk satu lingkungan: legal entity dan unit, role, petugas dengan batas datanya, master
// layanan kesehatan, persediaan obat beserta stoknya, lokasi layanan resep, dan kunjungan yang resepnya sudah menunggu
// di farmasi. Semuanya sintetis dan hanya untuk laptop; ini bukan data awal produk.
//
// Semuanya dibuat lewat API yang sama dengan layar, dengan admin pertama yang login, sehingga hook, penomoran, dan
// aturan bisnisnya ikut berjalan (misalnya sequence NRM bawaan, kartu gudang FEFO, dan event resep ke farmasi). Hanya
// pengguna dan keanggotaannya yang ditulis lewat SQL, sama dengan admin pertama di provisionEnvironment, karena
// identitas pengguna milik control plane dan repo ini tidak punya API untuk membuatnya.
const codeName = z.object({ code: z.string(), name: z.string() });

const drugSchema = codeName.extend({
    unit: z.string(),
    category: z.string(),
    drug_class: z.string(),
    generic: z.boolean(),
    formulary: z.boolean(),
    // Satuan beli dan jual berisi kode satuan; kosong berarti satuan dasar.
    packaging: z
        .array(z.object({ unit: z.string(), quantity_per_unit: z.number() }))
        .default([]),
    purchase_unit: z.string().optional(),
    sales_unit: z.string().optional(),
    // Batch yang masuk gudang lewat penerimaan vendor. Jumlah dan harga dalam satuan beli obat itu.
    batches: z.array(
        z.object({
            batch_number: z.string(),
            expiry_date: z.string(),
            quantity: z.number(),
            unit_cost: z.number(),
            funding_source: z.string(),
            procurement_program: z.string().optional(),
        }),
    ),
    // Jumlah amprah dari gudang per kode lokasi tujuan, dalam satuan dasar.
    transfers: z.record(z.string(), z.number()).default({}),
    // Stok minimum dan maksimum per kode lokasi.
    stock_levels: z
        .record(
            z.string(),
            z.object({ minimum: z.number(), maximum: z.number() }),
        )
        .default({}),
});

const inventorySchema = z.object({
    tracking_codes: z.array(
        codeName.extend({
            batch_required: z.boolean(),
            expiry_required: z.boolean(),
            strict_expiry: z.boolean(),
        }),
    ),
    item_categories: z.array(codeName.extend({ tracking_code: z.string() })),
    units_of_measure: z.array(codeName),
    funding_sources: z.array(codeName),
    procurement_programs: z.array(codeName),
    vendors: z.array(z.object({ name: z.string() })),
    locations: z.array(codeName.extend({ unit: z.string() })),
    receipt: z.object({
        vendor: z.string(),
        location: z.string(),
        vendor_document_number: z.string(),
        description: z.string(),
        budget_year: z.number(),
    }),
    transfers: z.array(
        z.object({ description: z.string(), from: z.string(), to: z.string() }),
    ),
    drugs: z.array(drugSchema),
});

const clinicSchema = z.object({
    rooms: z.array(codeName),
    sections: z.array(
        z.object({
            name: z.string(),
            kind: z.string(),
            queue_prefix: z.string(),
            rooms: z.array(z.string()),
        }),
    ),
    // Kelompok, kategori, dan tindakan (Setup Jasa sistem lama). Tindakan ditawarkan di section yang disebut namanya.
    procedure_groups: z
        .array(
            codeName.extend({
                international_name: z.string().optional(),
                treatment_group: z.string().optional(),
            }),
        )
        .default([]),
    procedure_categories: z
        .array(codeName.extend({ group: z.string() }))
        .default([]),
    // Kelas, kategori operasi, kategori plafon, dan alat penunjang (kunci tarif dan pilihan kartu Jasa sistem lama).
    care_classes: z.array(codeName).default([]),
    operation_categories: z.array(codeName).default([]),
    benefit_limit_categories: z.array(codeName).default([]),
    supporting_devices: z.array(codeName).default([]),
    procedures: z
        .array(
            codeName.extend({
                group: z.string(),
                category: z.string(),
                benefit_limit_category: z.string().optional(),
                supporting_device: z.string().optional(),
                sections: z.array(z.string()),
                // Tab Detail Harga: kelompok harga dan kelas lewat kodenya, komponen lewat kode komponen biaya.
                prices: z
                    .array(
                        z.object({
                            price_group: z.string(),
                            care_class: z.string().optional(),
                            components: z.array(
                                z.object({
                                    component: z.string(),
                                    initial_price: z.string().optional(),
                                    new_price: z.string(),
                                    new_bpjs_price: z.string().optional(),
                                }),
                            ),
                        }),
                    )
                    .default([]),
            }),
        )
        .default([]),
    // Spesialis dikenali dari namanya, sub spesialisnya ditulis sebagai nama.
    specialties: z
        .array(
            z.object({
                name: z.string(),
                subspecialties: z.array(z.string()),
            }),
        )
        .default([]),
    practitioners: z.array(
        z.object({
            name: z.string(),
            nik: z.string(),
            gender: z.string(),
            phone: z.string(),
            profession: z.string(),
            specialty: z.string().optional(),
        }),
    ),
    patients: z.array(
        z.object({
            name: z.string(),
            nationality: z.string(),
            nik: z.string(),
            gender: z.string(),
            birth_date: z.string(),
            phone: z.string(),
            patient_type: z.string(),
            ktp_patient: z.boolean().default(true),
            // Kode kelurahan/desa alamat KTP.
            village: z.string(),
            street: z.string(),
        }),
    ),
    // Satu kunjungan per baris: pasien (NIK) diperiksa dokter, lalu E-Resep-nya dikirim ke farmasi.
    visits: z.array(
        z.object({
            patient: z.string(),
            section: z.string(),
            room: z.string(),
            doctor: z.string(),
            condition: z.string(),
            physical: z.record(z.string(), z.union([z.number(), z.string()])),
            prescription: z.array(
                z.object({
                    drug: z.string(),
                    quantity: z.number(),
                    signa: z.string(),
                    usage_instruction: z.string(),
                }),
            ),
        }),
    ),
});

const pharmacySchema = z.object({
    // section kosong berarti lokasi bawaan unit itu.
    service_locations: z.array(
        z.object({
            unit: z.string(),
            section: z.string().nullable(),
            location: z.string(),
        }),
    ),
    // Kelompok grading dikenali dari namanya. Grading harga menunjuk kode kelompok harga dan nama kelompok grading;
    // grading_group kosong berarti semua barang, dan ktp_patient bawaannya untuk pasien ber-KTP. drug_grading_groups
    // memetakan kode obat ke nama kelompok gradingnya.
    grading_groups: z.array(z.string()).default([]),
    price_gradings: z
        .array(
            z.object({
                price_group: z.string(),
                grading_group: z.string().nullable(),
                ktp_patient: z.boolean().default(true),
                price_from: z.number(),
                price_to: z.number(),
                markup_percent: z.number(),
                discount_percent: z.number().default(0),
                effective_from: z.string(),
            }),
        )
        .default([]),
    drug_grading_groups: z.record(z.string(), z.string()).default({}),
});

export const sampleSchema = z.object({
    legal_entities: z.array(
        z.object({
            name: z.string(),
            company_code: z.string(),
            units: z.array(z.object({ name: z.string(), number: z.string() })),
        }),
    ),
    roles: z.array(z.object({ name: z.string(), duties: z.array(z.string()) })),
    // Role tambahan admin pertama, dengan batas data seluruh organisasi untuk kebijakan data yang disebut.
    admin: z.object({ role: z.string(), unrestricted: z.array(z.string()) }),
    staff: z.array(
        z.object({
            name: z.string(),
            email: z.string(),
            password: z.string().min(12),
            role: z.string(),
            // Nomor unit tempat petugas bekerja; batas datanya unit itu di legal entity pemiliknya.
            unit: z.string(),
            policy: z.string(),
        }),
    ),
    // Kelompok harga Core, ditunjuk tipe pasien lewat kodenya, dan komponen biaya selain komponen bawaan tenant.
    pricing: z
        .object({
            price_groups: z.array(codeName),
            charge_components: z
                .array(
                    codeName.extend({
                        sort_order: z.number(),
                        account_group: z.string().optional(),
                        posting_to: z.string().optional(),
                        payable_to: z.string().optional(),
                        service_group: z.string().optional(),
                    }),
                )
                .default([]),
        })
        .optional(),
    healthcare: z
        .object({
            patient_types: z.array(
                z.object({
                    code: z.string(),
                    name: z.string(),
                    behaviors: z.array(z.string()).default([]),
                    default: z.boolean().default(false),
                    price_group: z.string().optional(),
                    // Tarif jasa (kode procedureTariffs) dan kode kelompok harga yang tarif jasanya dicari.
                    procedure_tariff: z.string().optional(),
                    procedure_tariff_price_group: z.string().optional(),
                }),
            ),
            guarantors: z.array(
                z.object({
                    name: z.string(),
                    patient_type: z.string(),
                    default: z.boolean().default(false),
                }),
            ),
        })
        .optional(),
    // Kode legal entity dan nomor unit tempat admin bekerja untuk persediaan, kunjungan, dan farmasi.
    workspace: z.object({ legal_entity: z.string(), unit: z.string() }),
    inventory: inventorySchema.optional(),
    clinic: clinicSchema.optional(),
    pharmacy: pharmacySchema.optional(),
});
export type Sample = z.infer<typeof sampleSchema>;

const coreInventory = '/api/v1/inventory';
const corePricing = '/api/v1/pricing';
const healthcareApi = '/api/modules/healthcare/v1';
const pharmacyApi = '/api/modules/pharmacy/v1';

const documentRow = z.object({
    id: z.string(),
    status: z.string(),
    version: z.number(),
});

// Mengisi data contoh yang belum ada dan mengembalikan jumlah data yang dibuat; 0 berarti lingkungan sudah lengkap.
// Setiap data dikenali dari kode, nama, atau nomor dokumennya, jadi lingkungan lama mendapat yang belum dimilikinya dan
// perintah yang diulang tidak menggandakan apa pun.
export async function seedSample(
    config: Config,
    sql: postgres.Sql,
    options: {
        host: string;
        tenantId: string;
        admin: { email: string; password: string };
        sample: Sample;
    },
): Promise<number> {
    const application = createApplication(config);
    try {
        const api = sampleApi(application, options.host);
        await api.call('POST', '/login', options.admin);
        await seedOrganizations(api, sql, options);
        const shell = z
            .object({
                auth: z.object({ membership: z.object({ id: z.string() }) }),
            })
            .parse(await api.call('GET', '/api/v1/shell'));
        await api.call('PUT', '/api/v1/workspace-context', {
            membership_id: shell.auth.membership.id,
            legal_entity_id: await api.organization(
                options.sample.workspace.legal_entity,
            ),
            org_unit_id: await api.organization(options.sample.workspace.unit),
        });
        // Tanggal posting dokumen contoh: hari ini menurut jam laptop, dalam bentuk YYYY-MM-DD.
        const today = new Date().toLocaleDateString('sv');
        if (options.sample.inventory)
            await seedInventory(api, options.sample.inventory, today);
        if (options.sample.clinic)
            await seedClinic(
                api,
                options.sample.clinic,
                options.sample.workspace.unit,
            );
        if (options.sample.clinic) {
            await seedProcedures(
                api,
                options.sample.clinic,
                options.sample.workspace.unit,
            );
            await seedSpecialties(api, options.sample.clinic);
        }
        if (options.sample.pharmacy)
            await seedPharmacy(api, options.sample.pharmacy);
        return api.created();
    } finally {
        await application.close();
    }
}

// Organisasi dikenali dari kode legal entity dan nomor unitnya, role dan penjamin dari namanya, tipe pasien dari kodenya,
// dan petugas dari email-nya. Role contoh hanya diberikan kepada anggota yang belum punya role manual, supaya role yang
// sudah diatur di layar tidak tertimpa.
async function seedOrganizations(
    api: SampleApi,
    sql: postgres.Sql,
    options: {
        tenantId: string;
        admin: { email: string };
        sample: Sample;
    },
): Promise<void> {
    const organization = async (code: string, body: object) =>
        (await api.findOrganization(code)) ??
        (await api.data(idRow, 'POST', '/api/v1/organizations', body)).id;
    const units = new Map<string, { id: string; legalEntity: string }>();
    for (const company of options.sample.legal_entities) {
        const legalEntity = await organization(company.company_code, {
            classification: 'legal_entity',
            name: company.name,
            company_code: company.company_code,
            country_code: 'ID',
        });
        for (const unit of company.units)
            units.set(unit.number, {
                legalEntity,
                id: await organization(unit.number, {
                    classification: 'operating_unit',
                    name: unit.name,
                    operating_unit_type: 'department',
                    operating_unit_number: unit.number,
                }),
            });
    }
    const roles = new Map<string, string>();
    for (const role of options.sample.roles)
        roles.set(
            role.name,
            await api.ensure('/api/v1/roles', 'name', role.name, {
                name: role.name,
                duty_codes: role.duties,
            }),
        );
    const assign = async (
        membershipId: string,
        assignments: unknown[],
    ): Promise<void> => {
        const member = await api.data(
            z.object({
                version: z.number(),
                assignments: z.array(z.object({ source: z.string() })),
            }),
            'GET',
            `/api/v1/memberships/${membershipId}`,
        );
        if (member.assignments.some((row) => row.source === 'manual')) return;
        await api.call('PATCH', `/api/v1/memberships/${membershipId}`, {
            version: member.version,
            assignments,
        });
    };
    const membership = async (email: string) =>
        (
            await sql<{ id: string }[]>`
                select m.id from tenant_memberships m join users u on u.id = m.user_id
                where m.tenant_id = ${options.tenantId} and u.email = ${email}`
        )[0]?.id;
    const adminMembership = await membership(options.admin.email);
    if (!adminMembership)
        throw new Error('Keanggotaan admin pertama tidak ditemukan.');
    await assign(adminMembership, [
        {
            role_id: required(roles, options.sample.admin.role, 'Role'),
            policy_scopes: options.sample.admin.unrestricted.map((policy) => ({
                policy_code: policy,
                include_descendants: false,
                unrestricted: true,
            })),
        },
    ]);
    for (const person of options.sample.staff) {
        const unit = required(units, person.unit, 'Unit');
        let membershipId = await membership(person.email);
        if (!membershipId) {
            const userId = Bun.randomUUIDv7();
            const created = Bun.randomUUIDv7();
            const hash = await Bun.password.hash(person.password, {
                algorithm: 'bcrypt',
            });
            await sql.begin(async (transaction) => {
                await transaction.unsafe(
                    "insert into users (id, name, email, password, account_type, created_at, updated_at) values ($1, $2, $3, $4, 'person', now(), now())",
                    [userId, person.name, person.email, hash],
                );
                await transaction.unsafe(
                    "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
                    [created, options.tenantId, userId],
                );
            });
            membershipId = created;
        }
        await assign(membershipId, [
            {
                role_id: required(roles, person.role, 'Role'),
                policy_scopes: [
                    {
                        policy_code: person.policy,
                        legal_entity_id: unit.legalEntity,
                        organization_id: unit.id,
                        include_descendants: false,
                    },
                ],
            },
        ]);
    }
    const priceGroups = options.sample.pricing
        ? await api.ensureEach(
              `${corePricing}/price-groups`,
              options.sample.pricing.price_groups,
          )
        : new Map<string, string>();
    if (options.sample.pricing)
        await api.ensureEach(
            `${corePricing}/charge-components`,
            options.sample.pricing.charge_components,
        );
    const healthcare = options.sample.healthcare;
    if (healthcare) {
        const types = new Map<string, string>();
        for (const type of healthcare.patient_types) {
            const priceGroupId = type.price_group
                ? required(priceGroups, type.price_group, 'Kelompok harga')
                : null;
            const id = await api.ensure(
                `${healthcareApi}/patient-types`,
                'code',
                type.code,
                {
                    code: type.code,
                    name: type.name,
                    behaviors: type.behaviors,
                    is_default: type.default,
                    price_group_id: priceGroupId,
                    procedure_tariff: type.procedure_tariff,
                    procedure_tariff_price_group_id:
                        type.procedure_tariff_price_group
                            ? required(
                                  priceGroups,
                                  type.procedure_tariff_price_group,
                                  'Kelompok harga',
                              )
                            : null,
                },
            );
            types.set(type.code, id);
            await assignPriceGroup(api, id, type.code, priceGroupId);
        }
        for (const guarantor of healthcare.guarantors)
            await api.ensure(
                `${healthcareApi}/guarantors`,
                'name',
                guarantor.name,
                {
                    name: guarantor.name,
                    patient_type_id: types.get(guarantor.patient_type),
                    is_default: guarantor.default,
                },
            );
    }
}

// Tipe pasien yang lahir sebelum kelompok harga ada di data contoh mendapat kelompoknya. Tipe yang sudah punya kelompok
// tidak diubah, supaya pilihan yang diatur di layar tidak tertimpa.
async function assignPriceGroup(
    api: SampleApi,
    id: string,
    code: string,
    priceGroupId: string | null,
): Promise<void> {
    if (!priceGroupId) return;
    const type = await api.find(
        z.object({
            id: z.string(),
            code: z.string(),
            name: z.string(),
            behaviors: z.array(z.string()),
            is_active: z.boolean(),
            is_default: z.boolean(),
            max_visits_per_section_per_day: z.number(),
            price_group_id: z.string().nullable(),
            procedure_tariff: z.string(),
            procedure_tariff_price_group_id: z.string().nullable(),
            version: z.number(),
        }),
        `${healthcareApi}/patient-types`,
        code,
        (row) => row.id === id,
    );
    if (!type || type.price_group_id) return;
    await api.call('PATCH', `${healthcareApi}/patient-types/${id}`, {
        ...type,
        price_group_id: priceGroupId,
    });
}

// Master persediaan dan obat dikenali dari kodenya. Penerimaan dikenali dari nomor surat jalan vendor dan amprah dari
// keterangannya, lalu dibawa sampai terposting, jadi dokumen yang tertinggal sebagai draf ikut selesai.
async function seedInventory(
    api: SampleApi,
    inventory: z.infer<typeof inventorySchema>,
    today: string,
): Promise<void> {
    const trackingCodes = await api.ensureEach(
        `${coreInventory}/item-tracking-codes`,
        inventory.tracking_codes,
    );
    // Profil pelacakan kategori juga diberikan ke obatnya, karena kartu obat tidak membawa kategori.
    const categoryTracking = new Map(
        inventory.item_categories.map((category) => [
            category.code,
            required(trackingCodes, category.tracking_code, 'Profil pelacakan'),
        ]),
    );
    const categories = await api.ensureEach(
        `${coreInventory}/item-categories`,
        inventory.item_categories,
        (category) =>
            Promise.resolve({
                code: category.code,
                name: category.name,
                tracking_code_id: categoryTracking.get(category.code),
            }),
    );
    const units = await api.ensureEach(
        `${coreInventory}/units-of-measure`,
        inventory.units_of_measure,
    );
    const fundingSources = await api.ensureEach(
        `${coreInventory}/funding-sources`,
        inventory.funding_sources,
    );
    const programs = await api.ensureEach(
        `${coreInventory}/procurement-programs`,
        inventory.procurement_programs,
    );
    const vendors = new Map<string, string>();
    for (const vendor of inventory.vendors)
        vendors.set(
            vendor.name,
            await api.ensure(
                '/api/v1/purchasing/vendors',
                'name',
                vendor.name,
                vendor,
            ),
        );
    const locations = await api.ensureEach(
        `${coreInventory}/locations`,
        inventory.locations,
        async (location) => ({
            code: location.code,
            name: location.name,
            operating_unit_id: await api.organization(location.unit),
        }),
    );

    const items = new Map<string, { id: string; unit: string }>();
    for (const drug of inventory.drugs) {
        const unit = required(units, drug.unit, 'Satuan');
        // Obat dibuat lewat kartu obat layanan kesehatan, supaya E-Resep bisa meresepkannya. Kategori dan profil
        // pelacakan milik kartu barang persediaan, dan diisi hanya bila barang belum berkategori.
        const id = await api.ensure(
            `${healthcareApi}/drugs`,
            'code',
            drug.code,
            {
                code: drug.code,
                name: drug.name,
                base_unit_id: unit,
                dosage_form_id: null,
                is_prescribable: true,
            },
        );
        items.set(drug.code, { id, unit });
        const item = await api.find(
            z.object({
                id: z.string(),
                code: z.string(),
                name: z.string(),
                base_unit: idRow,
                category: idRow.nullable(),
                version: z.number(),
            }),
            `${coreInventory}/items`,
            drug.code,
            (row) => row.id === id,
        );
        for (const packaging of drug.packaging) {
            const unitId = required(units, packaging.unit, 'Satuan');
            const existing = await api.find(
                idRow,
                `${coreInventory}/item-units?item_id=${id}`,
                packaging.unit,
                (row) => row.id === unitId,
            );
            if (!existing)
                await api.call('POST', `${coreInventory}/item-units`, {
                    item_id: id,
                    unit_id: unitId,
                    quantity_per_unit: packaging.quantity_per_unit,
                });
        }
        if (item && !item.category)
            await api.call('PATCH', `${coreInventory}/items/${id}`, {
                code: item.code,
                name: item.name,
                base_unit_id: item.base_unit.id,
                category_id: required(categories, drug.category, 'Kategori'),
                tracking_code_id: categoryTracking.get(drug.category),
                purchase_unit_id: drug.purchase_unit
                    ? required(units, drug.purchase_unit, 'Satuan')
                    : null,
                sales_unit_id: drug.sales_unit
                    ? required(units, drug.sales_unit, 'Satuan')
                    : null,
                version: item.version,
            });
        // Versi 0 berarti obat ini belum pernah diberi data farmasi.
        const pharmacyDrug = await api.find(
            z.object({ id: z.string(), version: z.number() }),
            `${pharmacyApi}/drugs`,
            drug.code,
            (row) => row.id === id,
        );
        if (pharmacyDrug?.version === 0)
            await api.call('PUT', `${pharmacyApi}/drugs/${id}`, {
                drug_class_id: await api.codeId(
                    `${pharmacyApi}/drug-classes`,
                    drug.drug_class,
                ),
                is_generic: drug.generic,
                is_formulary: drug.formulary,
                version: 0,
            });
    }

    const receipts = '/api/v1/purchasing/receipts';
    const receiptRow = documentRow.extend({
        vendor_document_number: z.string().nullable(),
    });
    const sample = inventory.receipt;
    const receipt =
        (await api.find(
            receiptRow,
            receipts,
            sample.vendor_document_number,
            (row) =>
                row.vendor_document_number === sample.vendor_document_number,
        )) ??
        (await api.data(receiptRow, 'POST', receipts, {
            vendor_id: required(vendors, sample.vendor, 'Vendor'),
            location_id: required(locations, sample.location, 'Lokasi'),
            posting_date: today,
            vendor_document_number: sample.vendor_document_number,
            description: sample.description,
            lines: inventory.drugs.flatMap((drug) =>
                drug.batches.map((batch) => ({
                    item_id: items.get(drug.code)?.id,
                    quantity: batch.quantity,
                    unit_cost: batch.unit_cost,
                    batch_number: batch.batch_number,
                    expiry_date: batch.expiry_date,
                    funding_source_id: required(
                        fundingSources,
                        batch.funding_source,
                        'Sumber dana',
                    ),
                    procurement_program_id: batch.procurement_program
                        ? required(
                              programs,
                              batch.procurement_program,
                              'Program pengadaan',
                          )
                        : null,
                    budget_year: sample.budget_year,
                })),
            ),
        }));
    if (receipt.status === 'draf')
        await api.call('POST', `${receipts}/${receipt.id}/post`, {
            version: receipt.version,
        });

    const orders = `${coreInventory}/transfer-orders`;
    const orderRow = documentRow.extend({ description: z.string().nullable() });
    for (const transfer of inventory.transfers) {
        let order =
            (await api.find(
                orderRow,
                orders,
                transfer.description,
                (row) => row.description === transfer.description,
            )) ??
            (await api.data(orderRow, 'POST', orders, {
                from_location_id: required(locations, transfer.from, 'Lokasi'),
                to_location_id: required(locations, transfer.to, 'Lokasi'),
                posting_date: today,
                description: transfer.description,
                lines: inventory.drugs.flatMap((drug) => {
                    const quantity = drug.transfers[transfer.to];
                    const item = required(items, drug.code, 'Obat');
                    return quantity
                        ? [{ item_id: item.id, unit_id: item.unit, quantity }]
                        : [];
                }),
            }));
        if (order.status === 'draf')
            order = await api.data(
                orderRow,
                'POST',
                `${orders}/${order.id}/submit`,
                {
                    version: order.version,
                },
            );
        if (order.status === 'diajukan')
            await api.call('POST', `${orders}/${order.id}/ship`, {
                version: order.version,
                posting_date: today,
            });
    }

    const stockkeeping = `${coreInventory}/stockkeeping-units`;
    for (const drug of inventory.drugs) {
        const item = required(items, drug.code, 'Obat');
        for (const [location, level] of Object.entries(drug.stock_levels)) {
            const found = await api.find(
                z.object({ location: z.object({ code: z.string() }) }),
                `${stockkeeping}?item_id=${item.id}`,
                location,
                (row) => row.location.code === location,
            );
            if (!found)
                await api.call('POST', stockkeeping, {
                    item_id: item.id,
                    location_id: required(locations, location, 'Lokasi'),
                    minimum_quantity: level.minimum,
                    maximum_quantity: level.maximum,
                });
        }
    }
}

// Kunjungan contoh diisi selama antrean farmasi masih kosong: ruangan, section, nakes, dan pasien dikenali dari kode,
// nama, atau NIK-nya, lalu setiap kunjungan diperiksa dan E-Resep-nya dikirim ke farmasi lewat event, sama dengan
// dokter di layar pemeriksaan.
// Kelompok, kategori, dan tindakan dikenali dari kodenya. Seed klinik berhenti bila resep contoh sudah ada, jadi bagian
// ini berjalan sendiri supaya lingkungan lama ikut mendapat tindakan contoh. Section dicari dari namanya di unit kerja.
async function seedProcedures(
    api: SampleApi,
    clinic: z.infer<typeof clinicSchema>,
    unitNumber: string,
): Promise<void> {
    const unit = await api.organization(unitNumber);
    const sections = new Map<string, string>();
    for (const section of clinic.sections) {
        const found = await api.find(
            keyRow,
            `${healthcareApi}/sections?operating_unit_id=${unit}`,
            section.name,
            (row) => row.name === section.name,
        );
        if (found) sections.set(section.name, found.id);
    }
    const procedureGroups = await api.ensureEach(
        `${healthcareApi}/procedure-groups`,
        clinic.procedure_groups,
    );
    const lists = `${healthcareApi}/diagnosis-references`;
    const careClasses = await api.ensureEach(
        `${lists}/care-classes`,
        clinic.care_classes,
    );
    await api.ensureEach(
        `${lists}/operation-categories`,
        clinic.operation_categories,
    );
    const benefitLimitCategories = await api.ensureEach(
        `${lists}/benefit-limit-categories`,
        clinic.benefit_limit_categories,
    );
    const supportingDevices = await api.ensureEach(
        `${lists}/supporting-devices`,
        clinic.supporting_devices,
    );
    const procedureCategories = await api.ensureEach(
        `${healthcareApi}/procedure-categories`,
        clinic.procedure_categories,
        (category) =>
            Promise.resolve({
                code: category.code,
                name: category.name,
                group_id: required(
                    procedureGroups,
                    category.group,
                    'Kelompok tindakan',
                ),
            }),
    );
    const procedures = await api.ensureEach(
        `${healthcareApi}/procedures`,
        clinic.procedures,
        (procedure) =>
            Promise.resolve({
                code: procedure.code,
                name: procedure.name,
                group_id: required(
                    procedureGroups,
                    procedure.group,
                    'Kelompok tindakan',
                ),
                category_id: required(
                    procedureCategories,
                    procedure.category,
                    'Kategori tindakan',
                ),
                benefit_limit_category_id: procedure.benefit_limit_category
                    ? required(
                          benefitLimitCategories,
                          procedure.benefit_limit_category,
                          'Kategori plafon',
                      )
                    : null,
                supporting_device_id: procedure.supporting_device
                    ? required(
                          supportingDevices,
                          procedure.supporting_device,
                          'Alat penunjang',
                      )
                    : null,
                section_ids: procedure.sections.map((name) =>
                    required(sections, name, 'Section'),
                ),
            }),
    );
    await seedProcedurePrices(api, clinic, procedures, careClasses);
}

// Harga contoh hanya diisi untuk tindakan yang belum punya baris harga, supaya harga yang diatur di layar tidak
// tertimpa. Isian kartu lainnya dikirim kembali apa adanya; harga baris dijumlahkan server dari komponennya.
async function seedProcedurePrices(
    api: SampleApi,
    clinic: z.infer<typeof clinicSchema>,
    procedures: Map<string, string>,
    careClasses: Map<string, string>,
): Promise<void> {
    const today = new Date().toLocaleDateString('sv');
    for (const procedure of clinic.procedures) {
        if (!procedure.prices.length) continue;
        const path = `${healthcareApi}/procedures/${required(procedures, procedure.code, 'Tindakan')}`;
        const record = await api.data(
            z.looseObject({ prices: z.array(z.unknown()) }),
            'GET',
            path,
        );
        if (record.prices.length) continue;
        const prices = [];
        for (const price of procedure.prices) {
            const components = [];
            for (const component of price.components)
                components.push({
                    charge_component_id: await api.codeId(
                        `${corePricing}/charge-components`,
                        component.component,
                    ),
                    quantity: '1',
                    initial_price: component.initial_price ?? '0',
                    new_price: component.new_price,
                    new_bpjs_price: component.new_bpjs_price ?? '0',
                });
            prices.push({
                price_group_id: await api.codeId(
                    `${corePricing}/price-groups`,
                    price.price_group,
                ),
                care_class_id: price.care_class
                    ? required(careClasses, price.care_class, 'Kelas')
                    : null,
                new_price_date: today,
                components,
            });
        }
        await api.call('PATCH', path, { ...record, prices });
    }
}

const practitionerRow = z.object({
    id: z.string(),
    name: z.string(),
    profession_id: z.string(),
    specialty_id: z.string().nullable(),
    license_number: z.string().nullable(),
    license_valid_until: z.string().nullable(),
    bpjs_doctor_code: z.string().nullable(),
    user_id: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

// Spesialis dikenali dari namanya. Nakes contoh dibuat seed klinik, jadi spesialisnya diisi sesudahnya, hanya bila nakes
// itu belum punya spesialis; isian nakes lainnya dikirim kembali apa adanya.
async function seedSpecialties(
    api: SampleApi,
    clinic: z.infer<typeof clinicSchema>,
): Promise<void> {
    const specialties = new Map<string, string>();
    for (const specialty of clinic.specialties)
        specialties.set(
            specialty.name,
            await api.ensure(
                `${healthcareApi}/specialties`,
                'name',
                specialty.name,
                {
                    name: specialty.name,
                    subspecialties: specialty.subspecialties.map((name) => ({
                        name,
                    })),
                },
            ),
        );
    for (const person of clinic.practitioners) {
        if (!person.specialty) continue;
        const found = await api.find(
            practitionerRow,
            `${healthcareApi}/practitioners`,
            person.name,
            (row) => row.name === person.name,
        );
        if (found?.specialty_id !== null) continue;
        const { id, name: _name, ...columns } = found;
        await api.call('PATCH', `${healthcareApi}/practitioners/${id}`, {
            ...columns,
            specialty_id: required(specialties, person.specialty, 'Spesialis'),
        });
    }
}

async function seedClinic(
    api: SampleApi,
    clinic: z.infer<typeof clinicSchema>,
    unitNumber: string,
): Promise<void> {
    const queue = await api.data(
        z.array(idRow),
        'GET',
        `${pharmacyApi}/prescriptions?per_page=1`,
    );
    if (queue.length) return;
    const unit = await api.organization(unitNumber);
    const rooms = await api.ensureEach(
        `${healthcareApi}/rooms`,
        clinic.rooms,
        (room) =>
            Promise.resolve({
                code: room.code,
                name: room.name,
                operating_unit_id: unit,
            }),
    );
    const sections = new Map<string, string>();
    for (const section of clinic.sections)
        sections.set(
            section.name,
            await api.ensure(
                `${healthcareApi}/sections`,
                'name',
                section.name,
                {
                    operating_unit_id: unit,
                    name: section.name,
                    kind: section.kind,
                    queue_prefix: section.queue_prefix,
                    room_ids: section.rooms.map((code) =>
                        required(rooms, code, 'Ruangan'),
                    ),
                },
                section.name,
                `${healthcareApi}/sections?operating_unit_id=${unit}`,
            ),
        );
    const practitioners = new Map<string, string>();
    for (const person of clinic.practitioners)
        practitioners.set(
            person.name,
            await api.ensure(
                `${healthcareApi}/practitioners`,
                'name',
                person.name,
                {
                    name: person.name,
                    nik: person.nik,
                    gender: person.gender,
                    phone: person.phone,
                    profession_id: await api.codeId(
                        `${healthcareApi}/professions`,
                        person.profession,
                    ),
                },
            ),
        );
    const patients = new Map<string, { id: string; type: string }>();
    for (const patient of clinic.patients) {
        const type = await api.codeId(
            `${healthcareApi}/patient-types`,
            patient.patient_type,
        );
        const id = await api.ensure(
            `${healthcareApi}/patients`,
            'name',
            patient.name,
            {
                name: patient.name,
                nationality_country_code: patient.nationality,
                nik: patient.nik,
                gender: patient.gender,
                birth_date: patient.birth_date,
                phone: patient.phone,
                ktp_patient: patient.ktp_patient,
                identity_address: {
                    ...(await region(api, patient.village)),
                    street: patient.street,
                },
                payment_methods: [{ patient_type_id: type }],
            },
            patient.nik,
        );
        patients.set(patient.nik, { id, type });
    }

    const examination = `${healthcareApi}/examination`;
    const metadata = await api.call(
        'GET',
        `${examination}/medical-record/metadata`,
    );
    const usage = z
        .object({ usage_instructions: z.array(keyRow) })
        .parse(metadata).usage_instructions;
    for (const visit of clinic.visits) {
        const patient = required(patients, visit.patient, 'Pasien');
        const registered = await api.data(
            z.object({ destinations: z.array(idRow).min(1) }),
            'POST',
            `${healthcareApi}/visits`,
            {
                patient_id: patient.id,
                patient_type_id: patient.type,
                visit_condition: visit.condition,
                section_id: required(sections, visit.section, 'Section'),
            },
        );
        const destination = `${examination}/destinations/${registered.destinations[0]?.id}`;
        await api.call('POST', `${destination}/start`, {
            room_id: required(rooms, visit.room, 'Ruangan'),
        });
        const record = `${destination}/medical-record`;
        const opened = await api.data(
            z.looseObject({
                physical: z.record(z.string(), z.unknown()),
                anamnesis: z.record(z.string(), z.unknown()),
            }),
            'GET',
            record,
        );
        const lines = [];
        for (const line of visit.prescription)
            lines.push({
                drug_id: await api.codeId(
                    `${healthcareApi}/drugs?prescribable=true`,
                    line.drug,
                ),
                compound: null,
                quantity: line.quantity,
                signa: line.signa,
                usage_instruction_id: usage.find(
                    (row) => row.name === line.usage_instruction,
                )?.id,
                notes: null,
            });
        const doctor = required(practitioners, visit.doctor, 'Nakes');
        await api.call('PUT', record, {
            ...opened,
            physical: { ...opened.physical, ...visit.physical },
            anamnesis: { ...opened.anamnesis, doctor_id: doctor },
        });
        const saved = await api.data(
            z.object({ version: z.number() }),
            'GET',
            record,
        );
        await api.call('POST', `${destination}/prescriptions/send`, {
            version: saved.version,
            doctor_id: doctor,
            prescriptions: [{ id: null, notes: null, lines }],
        });
    }
}

// Wilayah alamat KTP dari kode kelurahan/desa: desa menunjuk kecamatan, kecamatan menunjuk kabupaten, dan kabupaten
// menunjuk provinsi.
async function region(api: SampleApi, village: string) {
    const divisions = '/api/v1/settings/address-setup/divisions';
    const found = await api.find(
        z.object({ id: z.string(), code: z.string(), district_id: z.string() }),
        `${divisions}?section=villages`,
        village,
        (row) => row.code === village,
    );
    if (!found) throw new Error(`Kelurahan/desa ${village} tidak ada.`);
    const [district] = await api.data(
        z.array(z.object({ regency_id: z.string() })),
        'GET',
        `${divisions}?section=districts&district_id=${found.district_id}`,
    );
    const [regency] = await api.data(
        z.array(z.object({ province_id: z.string() })),
        'GET',
        `${divisions}?section=regencies&include_cities=1&regency_id=${district?.regency_id}`,
    );
    if (!regency) throw new Error(`Wilayah ${village} tidak lengkap.`);
    return {
        province_id: regency.province_id,
        regency_id: district?.regency_id,
        district_id: found.district_id,
        village_id: found.id,
    };
}

// Lokasi layanan resep dikenali dari unit dan section-nya. Section dikenal farmasi dari resep yang sudah diterima,
// jadi baris per section menunggu kunjungan contoh.
async function seedPharmacy(
    api: SampleApi,
    pharmacy: z.infer<typeof pharmacySchema>,
): Promise<void> {
    const path = `${pharmacyApi}/service-locations`;
    const existing = await api.data(
        z.array(
            z.object({
                operating_unit: idRow,
                section: idRow.nullable(),
            }),
        ),
        'GET',
        `${path}?per_page=100`,
    );
    for (const mapping of pharmacy.service_locations) {
        const unit = await api.organization(mapping.unit);
        const section =
            mapping.section === null
                ? null
                : await api.find(
                      keyRow,
                      `${pharmacyApi}/lookups/sections`,
                      mapping.section,
                      (row) => row.name === mapping.section,
                  );
        if (section === undefined)
            throw new Error(
                `Section ${mapping.section} belum dikenal farmasi: belum ada resep dari section itu.`,
            );
        const sectionId = section?.id ?? null;
        if (
            existing.some(
                (row) =>
                    row.operating_unit.id === unit &&
                    (row.section?.id ?? null) === sectionId,
            )
        )
            continue;
        await api.call('POST', path, {
            operating_unit_id: unit,
            section_id: sectionId,
            location_id: await api.codeId(
                `${pharmacyApi}/lookups/locations`,
                mapping.location,
            ),
        });
    }
    await seedDrugPrices(api, pharmacy);
}

// Kelompok grading dikenali dari namanya, baris grading dari kelompok harga, kelompok grading, Patient KTP, tanggal
// berlaku, dan harga dasar dari-nya. Obat hanya diberi kelompok grading bila belum punya, supaya pilihan di layar tidak
// tertimpa.
async function seedDrugPrices(
    api: SampleApi,
    pharmacy: z.infer<typeof pharmacySchema>,
): Promise<void> {
    const gradingGroups = new Map<string, string>();
    for (const name of pharmacy.grading_groups)
        gradingGroups.set(
            name,
            await api.ensure(`${pharmacyApi}/grading-groups`, 'name', name, {
                name,
            }),
        );
    const gradingRow = z.object({
        grading_group: z.object({ name: z.string() }).nullable(),
        ktp_patient: z.boolean(),
        price_from: z.string(),
        effective_from: z.string(),
    });
    for (const grading of pharmacy.price_gradings) {
        const priceGroupId = await api.codeId(
            '/api/v1/pricing/price-groups',
            grading.price_group,
        );
        const existing = await api.data(
            z.array(gradingRow),
            'GET',
            `${pharmacyApi}/drug-prices?price_group_id=${priceGroupId}&per_page=100`,
        );
        if (
            existing.some(
                (row) =>
                    (row.grading_group?.name ?? null) ===
                        grading.grading_group &&
                    row.ktp_patient === grading.ktp_patient &&
                    row.effective_from === grading.effective_from &&
                    row.price_from === String(grading.price_from),
            )
        )
            continue;
        await api.call('POST', `${pharmacyApi}/drug-prices`, {
            price_group_id: priceGroupId,
            grading_group_id:
                grading.grading_group === null
                    ? null
                    : required(
                          gradingGroups,
                          grading.grading_group,
                          'Kelompok grading',
                      ),
            ktp_patient: grading.ktp_patient,
            price_from: grading.price_from,
            price_to: grading.price_to,
            markup_percent: grading.markup_percent,
            discount_percent: grading.discount_percent,
            effective_from: grading.effective_from,
        });
    }
    for (const [code, group] of Object.entries(pharmacy.drug_grading_groups)) {
        const drug = await api.find(
            z.object({
                id: z.string(),
                code: z.string(),
                drug_class: idRow.nullable(),
                grading_group: idRow.nullable(),
                is_generic: z.boolean(),
                is_formulary: z.boolean(),
                version: z.number(),
            }),
            `${pharmacyApi}/drugs`,
            code,
            (row) => row.code === code,
        );
        if (!drug || drug.grading_group) continue;
        await api.call('PUT', `${pharmacyApi}/drugs/${drug.id}`, {
            drug_class_id: drug.drug_class?.id ?? null,
            grading_group_id: required(
                gradingGroups,
                group,
                'Kelompok grading',
            ),
            is_generic: drug.is_generic,
            is_formulary: drug.is_formulary,
            version: drug.version,
        });
    }
}
