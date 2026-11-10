import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import { api, type ApiBody } from '../shell/index.ts';
import type { Organization } from './organization-directory.tsx';

type HierarchyBatchRow = Exclude<
    ApiBody<'hierarchyPage'>,
    { purposes: unknown }
>['data'][number];

function isOrganization(row: HierarchyBatchRow): row is Organization {
    return 'classification' in row;
}

/**
 * Organisasi aktif tenant ini untuk hierarki, dimuat bertahap dari layar hierarki. Dengan `excludeVersionId`,
 * organisasi yang sudah ditempatkan di draft itu tidak ditawarkan lagi.
 */
export function OrganizationLookup({
    value,
    onChange,
    label,
    portalContainer,
    excludeVersionId,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    portalContainer?: RefObject<HTMLElement | null>;
    excludeVersionId?: string;
}) {
    const [selected, setSelected] = useState<Organization | null>(null);
    const loader = useCallback<LookupLoader<Organization>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.hierarchyPage(
                {
                    query: {
                        incremental: '1',
                        resource: 'organizations',
                        q: query,
                        ...(cursor ? { cursor } : {}),
                        ...(excludeVersionId
                            ? { exclude_version_id: excludeVersionId }
                            : {}),
                    },
                },
                { signal },
            );
            if (!('next_cursor' in body))
                throw new Error(
                    'Jawaban daftar organisasi tidak berisi batch.',
                );
            const items = body.data.filter(isOrganization);
            if (items.length !== body.data.length)
                throw new Error(
                    'Jawaban daftar organisasi berisi baris yang bukan organisasi.',
                );
            return {
                items,
                nextCursor: body.next_cursor,
            };
        },
        [excludeVersionId],
    );

    return (
        <InlineLookup
            label={label}
            required
            value={selected?.id === value ? selected : null}
            onValueChange={(item) => {
                setSelected(item);
                onChange(item.id);
            }}
            loadItems={loader}
            getItemValue={(item) => item.id}
            getItemLabel={(item) => item.name}
            columns={[
                {
                    id: 'code',
                    header: 'Kode',
                    cell: (item) =>
                        item.legal_entity?.company_code ??
                        item.operating_unit?.number ??
                        '-',
                },
                {
                    id: 'name',
                    header: 'Nama organisasi',
                    cell: (item) => item.name,
                },
            ]}
            portalContainer={portalContainer}
            showDetails={false}
        />
    );
}
