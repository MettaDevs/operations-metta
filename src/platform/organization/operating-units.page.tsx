import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage, orpc } from '../shell/index.ts';
import {
    directoryProps,
    OrganizationDirectory,
} from './organization-directory.tsx';

const route = getRouteApi('/_app/sysadmin/organization/operating-units');

function OperatingUnitsPage(): ReactNode {
    const { data: props } = useSuspenseQuery(
        orpc.operatingUnitPage.queryOptions({
            input: { query: {} },
            select: (response) => directoryProps(response.body),
        }),
    );
    const { q = '' } = route.useSearch();
    const navigate = route.useNavigate();

    return (
        <OrganizationDirectory
            classification="operating_unit"
            title="Operating unit"
            props={props}
            search={q}
            onSearchChange={(next) =>
                void navigate({
                    search: next ? { q: next } : {},
                    replace: true,
                })
            }
        />
    );
}

export const page = definePage({
    path: '/sysadmin/organization/operating-units',
    previousPaths: ['/settings/operating-units'],
    layout: 'app',
    title: 'Operating unit',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: OperatingUnitsPage,
});
