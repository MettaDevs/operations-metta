// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.page.tsx`; jangan disunting tangan. `bun run build`
// dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as platformAddressBookDuplicateSettingsPage } from './platform/address-book/duplicate-settings.page.tsx';
import { page as platformAddressBookGlobalAddressBookPage } from './platform/address-book/global-address-book.page.tsx';
import { page as platformAddressBookOccupationsPage } from './platform/address-book/occupations.page.tsx';
import { page as platformGeographyAddressSetupPage } from './platform/geography/address-setup.page.tsx';
import { page as platformOrganizationHierarchiesPage } from './platform/organization/hierarchies.page.tsx';
import { page as platformOrganizationLegalEntitiesPage } from './platform/organization/legal-entities.page.tsx';
import { page as platformOrganizationOperatingUnitsPage } from './platform/organization/operating-units.page.tsx';
import { page as platformShellDashboardPage } from './platform/shell/dashboard.page.tsx';
import { page as platformShellLoginPage } from './platform/shell/login.page.tsx';
import {
    appLayoutRoute,
    authLayoutRoute,
    indexRoute,
    rootRoute,
    routerOptions,
    startClient,
} from './platform/shell/index.ts';

const platformAddressBookDuplicateSettingsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformAddressBookDuplicateSettingsPage.path,
    component: platformAddressBookDuplicateSettingsPage.component,
    staticData: { title: platformAddressBookDuplicateSettingsPage.title },
});

const platformAddressBookGlobalAddressBookRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformAddressBookGlobalAddressBookPage.path,
    component: platformAddressBookGlobalAddressBookPage.component,
    validateSearch: platformAddressBookGlobalAddressBookPage.validateSearch,
    staticData: { title: platformAddressBookGlobalAddressBookPage.title },
});

const platformAddressBookOccupationsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformAddressBookOccupationsPage.path,
    component: platformAddressBookOccupationsPage.component,
    validateSearch: platformAddressBookOccupationsPage.validateSearch,
    staticData: { title: platformAddressBookOccupationsPage.title },
});

const platformGeographyAddressSetupRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformGeographyAddressSetupPage.path,
    component: platformGeographyAddressSetupPage.component,
    validateSearch: platformGeographyAddressSetupPage.validateSearch,
    staticData: { title: platformGeographyAddressSetupPage.title },
});

const platformOrganizationHierarchiesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformOrganizationHierarchiesPage.path,
    component: platformOrganizationHierarchiesPage.component,
    validateSearch: platformOrganizationHierarchiesPage.validateSearch,
    staticData: { title: platformOrganizationHierarchiesPage.title },
});

const platformOrganizationLegalEntitiesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformOrganizationLegalEntitiesPage.path,
    component: platformOrganizationLegalEntitiesPage.component,
    validateSearch: platformOrganizationLegalEntitiesPage.validateSearch,
    staticData: { title: platformOrganizationLegalEntitiesPage.title },
});

const platformOrganizationOperatingUnitsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformOrganizationOperatingUnitsPage.path,
    component: platformOrganizationOperatingUnitsPage.component,
    validateSearch: platformOrganizationOperatingUnitsPage.validateSearch,
    staticData: { title: platformOrganizationOperatingUnitsPage.title },
});

const platformShellDashboardRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformShellDashboardPage.path,
    component: platformShellDashboardPage.component,
    staticData: { title: platformShellDashboardPage.title },
});

const platformShellLoginRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: platformShellLoginPage.path,
    component: platformShellLoginPage.component,
    validateSearch: platformShellLoginPage.validateSearch,
    staticData: { title: platformShellLoginPage.title },
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    appLayoutRoute.addChildren([
        platformAddressBookDuplicateSettingsRoute,
        platformAddressBookGlobalAddressBookRoute,
        platformAddressBookOccupationsRoute,
        platformGeographyAddressSetupRoute,
        platformOrganizationHierarchiesRoute,
        platformOrganizationLegalEntitiesRoute,
        platformOrganizationOperatingUnitsRoute,
        platformShellDashboardRoute,
    ]),
    authLayoutRoute.addChildren([platformShellLoginRoute]),
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

startClient(router);
