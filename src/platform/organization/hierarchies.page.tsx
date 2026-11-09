import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { definePage, orpc } from '../shell/index.ts';
import {
    hierarchyProps,
    OrganizationHierarchies,
} from './organization-hierarchies.tsx';

const route = getRouteApi('/_app/settings/organization-hierarchies');

function HierarchiesPage(): ReactNode {
    const { data: props } = useSuspenseQuery(
        orpc.hierarchyPage.queryOptions({
            input: { query: {} },
            select: (response) => hierarchyProps(response.body),
        }),
    );
    const { q = '' } = route.useSearch();
    const navigate = route.useNavigate();

    return (
        <OrganizationHierarchies
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
    path: '/settings/organization-hierarchies',
    layout: 'app',
    title: 'Hierarki organisasi',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: HierarchiesPage,
});
