import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FieldDescription } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
import { Label } from '@operations-metta/ui/label';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '../shell/index.ts';

// Kartu akses satu staf: role yang dipegangnya beserta perusahaan dan unit kerja tempat role itu berlaku. Bentuknya
// mengikuti kartu pengguna Business Central (User Card dengan permission set per company): satu baris per role per
// unit. Duty dan privilege tidak tampil di sini; keduanya milik layar Susun role.

export type AccessPage = ApiBody<'accessPage'>['data'];
type Member = ApiBody<'membershipShow'>['data'];
type Role = AccessPage['roles'][number];
type Organization = AccessPage['organizations'][number];
type Scope = {
    policy_code: string;
    legal_entity_id: string | null;
    organization_id: string | null;
    hierarchy_id: string | null;
    include_descendants: boolean;
    unrestricted: boolean;
};
type Assignment = {
    role_id: string;
    role_name: string;
    source: string;
    policy_scopes: Scope[];
};
type Row = {
    key: string;
    assignment: Assignment;
    limit: string;
    scopes: Scope[];
};

// Batas yang sama untuk semua kebijakan data satu role tampil sebagai satu baris.
const limitKey = (scope: Scope) =>
    scope.unrestricted
        ? 'all'
        : [
              scope.legal_entity_id ?? '',
              scope.organization_id ?? '',
              scope.include_descendants ? scope.hierarchy_id : '',
          ].join('|');

const fromMember = (member: Member): Assignment[] =>
    member.assignments.map((assignment) => ({
        role_id: assignment.role_id,
        role_name: assignment.role_name,
        source: assignment.source,
        policy_scopes: assignment.policy_scopes.map((scope) => ({
            policy_code: scope.policy_code,
            legal_entity_id: scope.legal_entity_id,
            organization_id: scope.organization_id,
            hierarchy_id: scope.hierarchy_id,
            include_descendants: scope.include_descendants,
            unrestricted: scope.unrestricted,
        })),
    }));

export function limitLabel(
    scopes: Scope[],
    role: Pick<Role, 'data_policy_codes'> | undefined,
    organizations: Map<string, Organization>,
): string {
    const first = scopes[0];
    if (!first)
        return role?.data_policy_codes.length
            ? 'Belum diatur'
            : 'Tidak dibatasi unit';
    if (first.unrestricted) return 'Seluruh organisasi';
    const names = [first.organization_id, first.legal_entity_id]
        .filter((id): id is string => id !== null)
        .map((id) => organizations.get(id)?.name ?? 'Organisasi tidak aktif');
    return (
        names.join(' — ') +
        (first.include_descendants ? ' beserta turunannya' : '')
    );
}

function AddRole({
    page,
    portalContainer,
    onAdd,
    onCancel,
}: {
    page: AccessPage;
    portalContainer: React.RefObject<HTMLDivElement | null>;
    onAdd: (role: Role, scopes: Scope[]) => void;
    onCancel: () => void;
}) {
    const [role, setRole] = useState<Role | null>(null);
    const [company, setCompany] = useState<Organization | null>(null);
    const [unit, setUnit] = useState<Organization | null>(null);
    const [everywhere, setEverywhere] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const policies = page.dataPolicies.filter((policy) =>
        role?.data_policy_codes.includes(policy.code),
    );
    const needsCompany = policies.some(
        (policy) => policy.requires_legal_entity,
    );
    const needsUnit = policies.some((policy) => policy.requires_operating_unit);
    const companies = page.organizations.filter(
        (item) => item.classification === 'legal_entity',
    );
    const units = page.organizations.filter(
        (item) => item.classification === 'operating_unit',
    );
    const columns = [
        {
            id: 'name',
            header: 'Nama',
            cell: (item: { name: string }) => (
                <DataTableText>{item.name}</DataTableText>
            ),
        },
    ];

    const add = () => {
        if (!role) {
            setError('Pilih role yang akan diberikan.');
            return;
        }
        if (policies.length && !everywhere) {
            if (needsCompany && !company) {
                setError('Pilih perusahaan tempat role ini berlaku.');
                return;
            }
            if (needsUnit && !unit) {
                setError('Pilih unit kerja tempat role ini berlaku.');
                return;
            }
            if (!company && !unit) {
                setError(
                    'Pilih perusahaan atau unit kerja, atau berlakukan di seluruh organisasi.',
                );
                return;
            }
        }
        onAdd(
            role,
            policies.map((policy) => ({
                policy_code: policy.code,
                legal_entity_id: everywhere ? null : (company?.id ?? null),
                organization_id: everywhere ? null : (unit?.id ?? null),
                hierarchy_id: null,
                include_descendants: false,
                unrestricted: everywhere,
            })),
        );
    };

    return (
        <section
            aria-label="Tambah role"
            className="border-b border-border px-4 pt-3 pb-4"
        >
            <FormGrid>
                <FormControl>
                    <InlineLookup
                        label="Role"
                        required
                        items={page.roles}
                        value={role}
                        onValueChange={(item) => {
                            setRole(item);
                            setError(null);
                        }}
                        getItemValue={(item) => item.id}
                        getItemLabel={(item) => item.name}
                        columns={columns}
                        portalContainer={portalContainer}
                        showDetails={false}
                    />
                </FormControl>
                {role && policies.length > 0 && (
                    <FormControl>
                        <div className="flex h-full items-center gap-2">
                            <Switch
                                id="add-role-everywhere"
                                checked={everywhere}
                                onCheckedChange={setEverywhere}
                            />
                            <Label htmlFor="add-role-everywhere">
                                Berlaku di seluruh organisasi
                            </Label>
                        </div>
                    </FormControl>
                )}
                {role && policies.length > 0 && !everywhere && (
                    <>
                        <FormControl>
                            <InlineLookup
                                label="Perusahaan"
                                required={needsCompany}
                                items={companies}
                                value={company}
                                onValueChange={setCompany}
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                columns={columns}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        </FormControl>
                        <FormControl>
                            <InlineLookup
                                label="Unit kerja"
                                required={needsUnit}
                                items={units}
                                value={unit}
                                onValueChange={setUnit}
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                columns={columns}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        </FormControl>
                    </>
                )}
            </FormGrid>
            {role && policies.length === 0 && (
                <FieldDescription className="mt-2">
                    Role ini tidak dibatasi per unit kerja, jadi berlaku di
                    semua unit.
                </FieldDescription>
            )}
            {error && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="mt-3 flex gap-1">
                <ActionButton action="add" type="button" onClick={add} />
                <ActionButton action="cancel" onClick={onCancel} />
            </div>
        </section>
    );
}

export function StaffAccessCard({
    memberId,
    page,
    busy,
    onBusyChange,
    onDirtyChange,
    onSaved,
}: {
    memberId: string;
    page: AccessPage;
    busy: boolean;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
    onSaved: () => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const contentRef = useRef<HTMLDivElement>(null);
    const query = orpc.membershipShow.queryOptions({
        input: { params: { id: memberId } },
        select: (response) => response.body.data,
    });
    const { data: member } = useSuspenseQuery(query);
    const [editing, setEditing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState<Assignment[]>(() => fromMember(member));
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const roles = useMemo(
        () => new Map(page.roles.map((role) => [role.id, role])),
        [page.roles],
    );
    const organizations = useMemo(
        () => new Map(page.organizations.map((item) => [item.id, item])),
        [page.organizations],
    );
    const canEdit = page.canManage && member.can_edit_access;

    const rows: Row[] = draft.flatMap((assignment) => {
        const groups = Map.groupBy(assignment.policy_scopes, limitKey);
        const role = roles.get(assignment.role_id);
        if (!groups.size)
            return [
                {
                    key: `${assignment.role_id}:none`,
                    assignment,
                    limit: limitLabel([], role, organizations),
                    scopes: [],
                },
            ];
        return [...groups].map(([key, scopes]) => ({
            key: `${assignment.role_id}:${key}`,
            assignment,
            limit: limitLabel(scopes, role, organizations),
            scopes,
        }));
    });

    const change = (next: Assignment[]) => {
        setDraft(next);
        onDirtyChange(true);
    };

    const add = (role: Role, scopes: Scope[]) => {
        const existing = draft.find(
            (assignment) => assignment.role_id === role.id,
        );
        if (existing?.source && existing.source !== 'manual') {
            setMessage(
                `${role.name} sudah diberikan otomatis dan tidak diatur dari kartu ini.`,
            );
            return;
        }
        const keys = new Set(existing?.policy_scopes.map(limitKey));
        if (existing && scopes.every((scope) => keys.has(limitKey(scope)))) {
            setMessage(`${role.name} sudah berlaku di batas yang sama.`);
            return;
        }
        setMessage(null);
        change(
            existing
                ? draft.map((assignment) =>
                      assignment.role_id === role.id
                          ? {
                                ...assignment,
                                // Seluruh organisasi menggantikan batas lain pada role yang sama.
                                policy_scopes: scopes.some(
                                    (scope) => scope.unrestricted,
                                )
                                    ? scopes
                                    : [
                                          ...assignment.policy_scopes.filter(
                                              (scope) => !scope.unrestricted,
                                          ),
                                          ...scopes,
                                      ],
                            }
                          : assignment,
                  )
                : [
                      ...draft,
                      {
                          role_id: role.id,
                          role_name: role.name,
                          source: 'manual',
                          policy_scopes: scopes,
                      },
                  ],
        );
        setAdding(false);
    };

    // Mencabut batas terakhir sebuah role mencabut role itu.
    const revoke = (row: Row) => {
        const remaining = row.assignment.policy_scopes.filter(
            (scope) => !row.scopes.includes(scope),
        );
        change(
            remaining.length
                ? draft.map((assignment) =>
                      assignment === row.assignment
                          ? { ...assignment, policy_scopes: remaining }
                          : assignment,
                  )
                : draft.filter((assignment) => assignment !== row.assignment),
        );
    };

    const reset = () => {
        setDraft(fromMember(member));
        setErrors({});
        setMessage(null);
        setAdding(false);
        setEditing(false);
        onDirtyChange(false);
    };

    const save = async () => {
        onBusyChange(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.membershipUpdate({
                params: { id: member.id },
                body: {
                    version: member.version,
                    assignments: draft
                        .filter((assignment) => assignment.source === 'manual')
                        .map((assignment) => ({
                            role_id: assignment.role_id,
                            policy_scopes: assignment.policy_scopes,
                        })),
                },
            });
            queryClient.setQueryData(query.queryKey, {
                status: 200,
                headers: {},
                body,
            });
            setDraft(fromMember(body.data));
            setEditing(false);
            setAdding(false);
            onDirtyChange(false);
            toast.success('Akses staf disimpan.');
            onSaved();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Akses staf belum disimpan.'));
        } finally {
            onBusyChange(false);
        }
    };

    return (
        <PageDialogContent
            ref={contentRef}
            title="Akses staf"
            recordTitle={member.name}
            editing={editing}
            busy={busy}
            onEdit={canEdit && !editing ? () => setEditing(true) : undefined}
        >
            {editing && (
                <PageDialogToolbar>
                    <ActionButton
                        action="save"
                        type="button"
                        disabled={busy}
                        pending={busy}
                        onClick={() => void save()}
                    />
                    <ActionButton
                        action="cancel"
                        disabled={busy}
                        onClick={reset}
                    />
                    {!adding && (
                        <ActionButton
                            action="add"
                            type="button"
                            disabled={busy}
                            onClick={() => setAdding(true)}
                        />
                    )}
                </PageDialogToolbar>
            )}
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Akses staf belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl>
                        <Input label="Email" value={member.email} readOnly />
                    </FormControl>
                    <FormControl>
                        <Input
                            label="Status"
                            value={
                                member.status === 'active'
                                    ? 'Aktif'
                                    : 'Nonaktif'
                            }
                            readOnly
                        />
                    </FormControl>
                </FormGrid>
                {adding && (
                    <div className="mt-4">
                        <AddRole
                            page={page}
                            portalContainer={contentRef}
                            onAdd={add}
                            onCancel={() => setAdding(false)}
                        />
                    </div>
                )}
                <h3 className="mt-4 mb-2 text-sm font-semibold">
                    Role dan unit kerja
                </h3>
                <DataTable
                    data={rows}
                    getRowKey={(row) => row.key}
                    getRowLabel={(row) => row.assignment.role_name}
                    scrollMode="inline"
                    showRowNumbers={false}
                    actionsPlacement="inline"
                    actions={editing ? [{ id: 'revoke', label: 'Cabut' }] : []}
                    getRowActions={(row) =>
                        editing && row.assignment.source === 'manual'
                            ? [
                                  {
                                      id: 'revoke',
                                      label: 'Cabut',
                                      destructive: true,
                                  },
                              ]
                            : []
                    }
                    onRowAction={(_, row) => revoke(row)}
                    emptyMessage={
                        editing
                            ? 'Belum ada role. Pilih Tambah untuk memberikan role.'
                            : 'Staf ini belum memegang role.'
                    }
                    columns={[
                        {
                            id: 'role',
                            header: 'Role',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.assignment.role_name}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'limit',
                            header: 'Berlaku di',
                            width: 320,
                            cell: (row) => (
                                <DataTableText>{row.limit}</DataTableText>
                            ),
                        },
                        {
                            id: 'source',
                            header: 'Diberikan',
                            width: 120,
                            cell: (row) => (
                                <Badge variant="outline">
                                    {row.assignment.source === 'manual'
                                        ? 'Manual'
                                        : 'Otomatis'}
                                </Badge>
                            ),
                        },
                    ]}
                />
            </PageDialogBody>
        </PageDialogContent>
    );
}
