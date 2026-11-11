import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage, orpc } from '../shell/index.ts';
import {
    directoryProps,
    OrganizationDirectory,
} from './organization-directory.tsx';

const route = getRouteApi('/_app/sysadmin/organization/legal-entities');

function LegalEntitiesPage(): ReactNode {
    const { data: props } = useSuspenseQuery(
        orpc.legalEntityPage.queryOptions({
            input: { query: {} },
            select: (response) => directoryProps(response.body),
        }),
    );
    const { q = '' } = route.useSearch();
    const navigate = route.useNavigate();

    return (
        <OrganizationDirectory
            classification="legal_entity"
            title="Legal entity"
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
    path: '/sysadmin/organization/legal-entities',
    previousPaths: ['/settings/legal-entities'],
    layout: 'app',
    title: 'Legal entity',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: LegalEntitiesPage,
});
