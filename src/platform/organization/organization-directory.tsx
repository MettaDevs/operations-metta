import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { FieldDescription } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { MasterDetailLayout } from '@operations-metta/ui/master-detail-layout';
import {
    PageDialog,
    PageDialogContent,
    PageDialogToolbar,
    PageDialogTrigger,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type {
    ListLoader,
    ListRequest,
} from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    draftPayload,
    emptyPartyDraft,
    errorText,
    FormErrorHeader,
    orpc,
    PartyAddressesSection,
    PartyContactsSection,
    type ApiBody,
    type PartyDraft,
} from '../shell/index.ts';

// Layar Legal entity dan Operating unit, dipindah dari organization-directory CoreERP. Bagian yang bergantung pada fitur
// yang belum dipindah tidak ditampilkan: identitas cetak, posting finance, dan penanda kode unit yang menahan posting
// finance. Alamat dan kontak dibaca dari party organisasi di buku alamat.

export type Organization = ApiBody<'organizationList'>['data'][number];
type Classification = Organization['classification'];
export type DirectoryProps = Extract<
    ApiBody<'legalEntityPage'>,
    { canManage: boolean }
>;
type Errors = Record<string, string[]>;

// Jawaban GET layar bergantung pada `incremental`; tanpa itu, isinya props halaman.
export function directoryProps(
    body: ApiBody<'legalEntityPage'>,
): DirectoryProps {
    if (!('canManage' in body))
        throw new Error('Jawaban layar organisasi tidak berisi props halaman.');
    return body;
}

function directoryBatch(
    classification: Classification,
    query: {
        q?: string;
        cursor?: string;
        sort?: string;
        direction?: 'asc' | 'desc';
        record_id?: string;
    },
    signal?: AbortSignal,
) {
    const input = { query: { incremental: '1' as const, ...query } };
    return (
        classification === 'legal_entity'
            ? api.legalEntityPage(input, { signal })
            : api.operatingUnitPage(input, { signal })
    ).then(({ body }) => {
        if (!('next_cursor' in body))
            throw new Error('Jawaban daftar organisasi tidak berisi batch.');
        return body;
    });
}

// Kegagalan simpan: error per field untuk 422, selain itu satu pesan yang tetap terlihat. Isian form tidak hilang.
function saveFailure(caught: unknown, fallback: string) {
    return caught instanceof ApiError && caught.status === 422
        ? { errors: caught.errors, message: null }
        : { errors: {}, message: errorText(caught, fallback) };
}

type OrganizationForm = {
    name: string;
    company_code: string;
    country_code: string;
    timezone: string;
    operating_unit_type: string;
    operating_unit_number: string;
};

function organizationFields(data: OrganizationForm, legalEntity: boolean) {
    return legalEntity
        ? {
              company_code: data.company_code,
              country_code: data.country_code,
              timezone: data.timezone,
          }
        : {
              operating_unit_type: data.operating_unit_type,
              operating_unit_number: data.operating_unit_number,
          };
}

/**
 * Zona waktu legal entity: bawaan bagi pengguna yang belum memilih zonanya sendiri di profil.
 * Saat form belum dalam mode ubah, nilainya tampil sebagai teks baca saja.
 */
function LegalEntityTimezoneField({
    timezones,
    value,
    onChange,
    editing = true,
    portalContainer,
}: {
    timezones: DirectoryProps['timezones'];
    value: string;
    onChange: (value: string) => void;
    editing?: boolean;
    portalContainer?: RefObject<HTMLElement | null>;
}) {
    const label =
        timezones.find((zone) => zone.value === value)?.label ?? value;

    return (
        <FormControl data-error-field="timezone">
            {editing ? (
                <Select
                    label="Zona waktu"
                    portalContainer={portalContainer}
                    items={timezones}
                    value={value || null}
                    onValueChange={(next) => next && onChange(next)}
                    searchPlaceholder="Cari zona waktu..."
                    emptyMessage="Zona waktu tidak ditemukan."
                />
            ) : (
                <Input label="Zona waktu" value={label} readOnly />
            )}
            <FieldDescription>
                Dipakai pengguna yang belum memilih zona waktunya sendiri di
                profil.
            </FieldDescription>
        </FormControl>
    );
}

function OrganizationFields({
    data,
    setData,
    legalEntity,
    editing,
    props,
    portalContainer,
}: {
    data: OrganizationForm;
    setData: (field: keyof OrganizationForm, value: string) => void;
    legalEntity: boolean;
    editing: boolean;
    props: DirectoryProps;
    portalContainer?: RefObject<HTMLElement | null>;
}) {
    const unitTypes: Record<string, string> = props.operatingUnitTypes;
    const numbered = ['business_unit', 'department'].includes(
        data.operating_unit_type,
    );

    return legalEntity ? (
        <>
            <FormControl data-error-field="company_code">
                <Input
                    label="Kode legal entity"
                    required
                    value={data.company_code}
                    readOnly={!editing}
                    onChange={(event) =>
                        setData('company_code', event.target.value)
                    }
                    placeholder="Contoh: PT-ERS"
                />
                {editing && (
                    <FieldDescription>2–16 karakter unik.</FieldDescription>
                )}
            </FormControl>
            <FormControl data-error-field="country_code">
                <Input
                    label="Kode Negara (ISO)"
                    required
                    value={data.country_code}
                    readOnly={!editing}
                    onChange={(event) =>
                        setData('country_code', event.target.value)
                    }
                    maxLength={2}
                    placeholder="ID"
                />
            </FormControl>
            <LegalEntityTimezoneField
                timezones={props.timezones}
                portalContainer={portalContainer}
                value={data.timezone}
                onChange={(value) => setData('timezone', value)}
                editing={editing}
            />
        </>
    ) : (
        <>
            <FormControl data-error-field="operating_unit_type">
                {editing ? (
                    <Select
                        label="Tipe operating unit"
                        required
                        items={Object.entries(unitTypes).map(
                            ([value, label]) => ({ value, label }),
                        )}
                        value={data.operating_unit_type || null}
                        onValueChange={(value) =>
                            setData('operating_unit_type', value ?? '')
                        }
                        portalContainer={portalContainer}
                    />
                ) : (
                    <Input
                        label="Tipe operating unit"
                        value={
                            unitTypes[data.operating_unit_type] ??
                            data.operating_unit_type
                        }
                        readOnly
                    />
                )}
            </FormControl>
            <FormControl data-error-field="operating_unit_number">
                <Input
                    label="Kode unit"
                    required={editing && numbered}
                    value={data.operating_unit_number}
                    readOnly={!editing}
                    onChange={(event) =>
                        setData(
                            'operating_unit_number',
                            event.target.value.toUpperCase(),
                        )
                    }
                    maxLength={30}
                    placeholder={editing ? 'Contoh: KLN-A' : 'Belum diisi'}
                />
                <FieldDescription>
                    Kode unik untuk membedakan unit yang namanya sama. Gunakan
                    huruf besar, angka, atau tanda hubung. Kode ini juga dikirim
                    ke Finance.
                </FieldDescription>
            </FormControl>
        </>
    );
}

function CreateOrganizationDialog({
    classification,
    props,
    onCreated,
}: {
    classification: Classification;
    props: DirectoryProps;
    onCreated: (organization: Organization) => void;
}) {
    const legalEntity = classification === 'legal_entity';
    // Tanpa pilihan zona waktu, bawaan kolom di server yang berlaku. CoreERP mengisinya dengan zona pengguna dari
    // jam server; data itu belum dikirim `/api/v1/shell`.
    const blank: OrganizationForm = {
        name: '',
        company_code: '',
        country_code: 'ID',
        timezone: '',
        operating_unit_type: 'department',
        operating_unit_number: '',
    };
    const [open, setOpen] = useState(false);
    const [data, setFormData] = useState(blank);
    const [details, setDetails] = useState<PartyDraft>(emptyPartyDraft);
    // Pilihan form alamat dan kontak organisasi baru; alamat dan kontaknya disimpan bersama organisasi.
    const options = useQuery({
        ...orpc.partyMetadata.queryOptions({
            select: (response) => response.body.data,
        }),
        enabled: open,
    });
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const setData = (field: keyof OrganizationForm, value: string) =>
        setFormData((current) => ({ ...current, [field]: value }));
    const reset = () => {
        setFormData(blank);
        setDetails(emptyPartyDraft);
        setErrors({});
        setMessage(null);
    };

    const submit = async () => {
        setProcessing(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.organizationCreate({
                body: {
                    classification,
                    name: data.name,
                    ...organizationFields(data, legalEntity),
                    party_details: draftPayload(details),
                },
            });
            // Jawaban pembuatan tidak membawa versi baris; record lengkap diambil dari daftar yang sama.
            const [saved] = (
                await directoryBatch(classification, {
                    record_id: body.data.id,
                })
            ).data;
            toast.success('Organisasi dibuat.');
            reset();
            setOpen(false);
            if (saved) onCreated(saved);
        } catch (caught) {
            const failure = saveFailure(caught, 'Organisasi belum dibuat.');
            setErrors(failure.errors);
            setMessage(failure.message);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <PageDialog
            open={open}
            dirty={
                JSON.stringify([data, details]) !==
                JSON.stringify([blank, emptyPartyDraft])
            }
            onOpenChange={(next) => {
                if (processing) return;
                if (!next) reset();
                setOpen(next);
            }}
        >
            <PageDialogTrigger asChild>
                <ActionButton action="create" />
            </PageDialogTrigger>
            <PageDialogContent
                ref={contentRef}
                title={legalEntity ? 'Legal entity' : 'Operating unit'}
                recordTitle={
                    [
                        legalEntity
                            ? data.company_code
                            : data.operating_unit_number,
                        data.name,
                    ]
                        .filter(Boolean)
                        .join(' · ') ||
                    (legalEntity ? 'Legal entity baru' : 'Operating unit baru')
                }
                editing
                busy={processing}
            >
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <PageDialogToolbar>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={processing}
                        />
                        <ActionButton
                            action="cancel"
                            type="button"
                            onClick={() => {
                                if (processing) return;
                                reset();
                                setOpen(false);
                            }}
                            disabled={processing}
                        />
                    </PageDialogToolbar>
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Organisasi belum dibuat"
                    />
                    <div
                        data-page-dialog-body=""
                        className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
                    >
                        <FormGrid>
                            <FormControl data-error-field="name">
                                <Input
                                    label="Nama Organisasi"
                                    required
                                    value={data.name}
                                    onChange={(event) =>
                                        setData('name', event.target.value)
                                    }
                                    placeholder={
                                        legalEntity
                                            ? 'Nama legal entity'
                                            : 'Nama operating unit'
                                    }
                                />
                            </FormControl>
                            <OrganizationFields
                                data={data}
                                setData={setData}
                                legalEntity={legalEntity}
                                editing
                                props={props}
                                portalContainer={contentRef}
                            />
                        </FormGrid>
                        {options.data && (
                            <CollapsibleSectionGroup
                                defaultValue={[]}
                                className="mt-4 space-y-3"
                            >
                                <CollapsibleSection
                                    value="addresses"
                                    title="Alamat"
                                    summary={`${details.locations.length} alamat`}
                                >
                                    <PartyAddressesSection
                                        owner={null}
                                        canManage
                                        draft={{
                                            value: details,
                                            onChange: setDetails,
                                            options: options.data,
                                        }}
                                    />
                                </CollapsibleSection>
                                <CollapsibleSection
                                    value="contacts"
                                    title="Informasi kontak"
                                    summary={`${details.contacts.length} kontak`}
                                >
                                    <PartyContactsSection
                                        owner={null}
                                        canManage
                                        draft={{
                                            value: details,
                                            onChange: setDetails,
                                            options: options.data,
                                        }}
                                    />
                                </CollapsibleSection>
                            </CollapsibleSectionGroup>
                        )}
                    </div>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

function formOf(organization: Organization): OrganizationForm {
    return {
        name: organization.name,
        company_code: organization.legal_entity?.company_code ?? '',
        country_code: organization.legal_entity?.country_code ?? 'ID',
        timezone: organization.legal_entity?.timezone ?? '',
        operating_unit_type: organization.operating_unit?.type ?? 'department',
        operating_unit_number: organization.operating_unit?.number ?? '',
    };
}

function OrganizationDetail({
    organization,
    props,
    onUpdated,
}: {
    organization: Organization;
    props: DirectoryProps;
    onUpdated: (organization: Organization) => void;
}) {
    const legalEntity = organization.classification === 'legal_entity';
    const canManage = props.canManage;
    // Organisasi tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = canManage;
    const [data, setFormData] = useState(() => formOf(organization));
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const setData = (field: keyof OrganizationForm, value: string) =>
        setFormData((current) => ({ ...current, [field]: value }));
    const formId = `organization-form-${organization.id}`;

    const submit = async () => {
        setProcessing(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.organizationUpdate({
                params: { id: organization.id },
                body: {
                    name: data.name,
                    ...organizationFields(data, legalEntity),
                    version: organization.version,
                },
            });
            toast.success('Organisasi diperbarui.');
            onUpdated(body.data);
        } catch (caught) {
            const failure = saveFailure(caught, 'Perubahan belum disimpan.');
            setErrors(failure.errors);
            setMessage(failure.message);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card text-foreground">
            <RecordActionBar
                title={organization.name}
                trailing={
                    <Badge variant="outline">
                        {organization.status === 'active'
                            ? 'Aktif'
                            : 'Nonaktif'}
                    </Badge>
                }
            >
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            form={formId}
                            disabled={processing}
                        />
                        <ActionButton
                            action="cancel"
                            onClick={() => {
                                setFormData(formOf(organization));
                                setErrors({});
                                setMessage(null);
                            }}
                            disabled={processing}
                        />
                    </>
                )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
                <form
                    noValidate
                    id={formId}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Perubahan belum disimpan"
                    />
                    <CollapsibleSectionGroup
                        defaultValue={['general']}
                        className="space-y-3"
                    >
                        <CollapsibleSection
                            value="general"
                            title="Umum"
                            summary={`${(legalEntity ? organization.legal_entity?.company_code : organization.operating_unit?.number) ?? '-'} - ${organization.name}`}
                        >
                            <FormGrid>
                                <FormControl data-error-field="name">
                                    <Input
                                        label="Nama Organisasi"
                                        required
                                        value={data.name}
                                        readOnly={!editing}
                                        onChange={(event) =>
                                            setData('name', event.target.value)
                                        }
                                    />
                                </FormControl>
                                <OrganizationFields
                                    data={data}
                                    setData={setData}
                                    legalEntity={legalEntity}
                                    editing={editing}
                                    props={props}
                                />
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="addresses"
                            title="Alamat"
                            summary="Alamat organisasi"
                        >
                            <PartyAddressesSection
                                owner={{
                                    kind: 'organization',
                                    id: organization.id,
                                }}
                                canManage={canManage}
                            />
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="contacts"
                            title="Informasi kontak"
                            summary="Telepon, email, dan kontak lain"
                        >
                            <PartyContactsSection
                                owner={{
                                    kind: 'organization',
                                    id: organization.id,
                                }}
                                canManage={canManage}
                            />
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </form>
            </div>
        </div>
    );
}

export function OrganizationDirectory({
    classification,
    title,
    props,
    search,
    onSearchChange,
}: {
    classification: Classification;
    title: string;
    props: DirectoryProps;
    search: string;
    onSearchChange: (search: string) => void;
}): ReactNode {
    const [selected, setSelected] = useState<Organization | null>(null);
    const [showDetail, setShowDetail] = useState(false);
    const loader = useCallback<ListLoader<Organization>>(
        async ({ query, cursor, sort, signal }: ListRequest) => {
            const batch = await directoryBatch(
                classification,
                {
                    q: query,
                    ...(cursor ? { cursor } : {}),
                    ...(sort
                        ? { sort: sort.columnId, direction: sort.direction }
                        : {}),
                },
                signal,
            );
            return { items: batch.data, nextCursor: batch.next_cursor };
        },
        [classification],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search,
        getKey: (item) => item.id,
    });
    const code = (item: Organization) =>
        item.legal_entity?.company_code ?? item.operating_unit?.number ?? '';
    const saved = (organization: Organization) => {
        setSelected(organization);
        setShowDetail(true);
        list.reload();
    };

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title={title}
                    search={{
                        value: search,
                        onValueChange: onSearchChange,
                        label: `Cari ${title.toLocaleLowerCase()}`,
                        placeholder: 'Cari nama atau kode...',
                    }}
                >
                    {props.canManage && (
                        <CreateOrganizationDialog
                            classification={classification}
                            props={props}
                            onCreated={(organization) => {
                                saved(organization);
                                onSearchChange('');
                            }}
                        />
                    )}
                </RecordActionBar>
            }
        >
            <MasterDetailLayout
                detailOpen={showDetail}
                onDetailOpenChange={setShowDetail}
                list={
                    <aside className="flex h-full min-h-0 min-w-0 flex-col">
                        <DataTable
                            data={list.items}
                            getRowKey={(item) => item.id}
                            columns={[
                                {
                                    id: 'code',
                                    header: 'Kode',
                                    cell: (item) => (
                                        <DataTableText>
                                            {code(item) || 'Belum ada nomor'}
                                        </DataTableText>
                                    ),
                                    sortValue: code,
                                    width: 110,
                                },
                                {
                                    id: 'name',
                                    header: 'Nama',
                                    cell: (item) => (
                                        <DataTableText>
                                            {item.name}
                                        </DataTableText>
                                    ),
                                    sortValue: (item) => item.name,
                                },
                            ]}
                            activeRowKey={selected?.id}
                            rowActivation="single-click"
                            onRowClick={(organization) => {
                                setShowDetail(true);
                                if (organization.id !== selected?.id)
                                    setSelected(organization);
                            }}
                            sort={list.sort}
                            onSortChange={list.onSortChange}
                            serverSort
                            incremental={list}
                            emptyMessage="Belum ada organisasi yang cocok."
                        />
                    </aside>
                }
            >
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    {selected ? (
                        <OrganizationDetail
                            key={`${selected.id}:${selected.version}`}
                            organization={selected}
                            props={props}
                            onUpdated={saved}
                        />
                    ) : (
                        <Empty>
                            <EmptyHeader>
                                <EmptyTitle>
                                    Pilih {title.toLocaleLowerCase()}
                                </EmptyTitle>
                                <EmptyDescription>
                                    Pilih organisasi dari daftar untuk melihat
                                    atau mengubah rinciannya.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </div>
            </MasterDetailLayout>
        </ListPageLayout>
    );
}
