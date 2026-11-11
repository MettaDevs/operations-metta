// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.page.tsx`; jangan disunting tangan. `bun run build`
// dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as modulesHealthcareSrcCoverageGuarantorGuarantorsPage } from '../modules/healthcare/src/coverage/guarantor/guarantors.page.tsx';
import { page as modulesHealthcareSrcCoveragePatientTypePatientTypesPage } from '../modules/healthcare/src/coverage/patient-type/patient-types.page.tsx';
import { page as modulesHealthcareSrcDashboardDashboardPage } from '../modules/healthcare/src/dashboard/dashboard.page.tsx';
import { page as modulesHealthcareSrcPatientPatientPatientsPage } from '../modules/healthcare/src/patient/patient/patients.page.tsx';
import { page as modulesHealthcareSrcPractitionerPractitionerPractitionersPage } from '../modules/healthcare/src/practitioner/practitioner/practitioners.page.tsx';
import { page as modulesHealthcareSrcServiceRoomRoomsPage } from '../modules/healthcare/src/service/room/rooms.page.tsx';
import { page as modulesHealthcareSrcServiceSectionSectionsPage } from '../modules/healthcare/src/service/section/sections.page.tsx';
import { page as foundationCalendarCalendarsPage } from './foundation/calendar/calendars.page.tsx';
import { page as foundationCalendarWorkingTimeTemplatesPage } from './foundation/calendar/working-time-templates.page.tsx';
import { page as foundationNumberSequenceNumberSequencesPage } from './foundation/number-sequence/number-sequences.page.tsx';
import { page as platformAccessAccessPage } from './platform/access/access.page.tsx';
import { page as platformAccessRolesPage } from './platform/access/roles.page.tsx';
import { page as platformAccessSecurityConfigurationPage } from './platform/access/security-configuration.page.tsx';
import { page as platformAddressBookDuplicateSettingsPage } from './platform/address-book/duplicate-settings.page.tsx';
import { page as platformAddressBookGlobalAddressBookPage } from './platform/address-book/global-address-book.page.tsx';
import { page as platformAddressBookOccupationsPage } from './platform/address-book/occupations.page.tsx';
import { page as platformDashboardDashboardPage } from './platform/dashboard/dashboard.page.tsx';
import { page as platformDataSharingDataSharingPage } from './platform/data-sharing/data-sharing.page.tsx';
import { page as platformGeographyAddressSetupPage } from './platform/geography/address-setup.page.tsx';
import { page as platformOrganizationHierarchiesPage } from './platform/organization/hierarchies.page.tsx';
import { page as platformOrganizationLegalEntitiesPage } from './platform/organization/legal-entities.page.tsx';
import { page as platformOrganizationOperatingUnitsPage } from './platform/organization/operating-units.page.tsx';
import { page as platformShellHomePage } from './platform/shell/home.page.tsx';
import { page as platformShellLoginPage } from './platform/shell/login.page.tsx';
import {
    appLayoutRoute,
    authLayoutRoute,
    previousPathRoute,
    rootRoute,
    routerOptions,
    startClient,
} from './platform/shell/index.ts';

const modulesHealthcareSrcCoverageGuarantorGuarantorsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcCoverageGuarantorGuarantorsPage.path,
    component: modulesHealthcareSrcCoverageGuarantorGuarantorsPage.component,
    validateSearch:
        modulesHealthcareSrcCoverageGuarantorGuarantorsPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcCoverageGuarantorGuarantorsPage.title,
    },
});

const modulesHealthcareSrcCoveragePatientTypePatientTypesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcCoveragePatientTypePatientTypesPage.path,
    component:
        modulesHealthcareSrcCoveragePatientTypePatientTypesPage.component,
    validateSearch:
        modulesHealthcareSrcCoveragePatientTypePatientTypesPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcCoveragePatientTypePatientTypesPage.title,
    },
});

const modulesHealthcareSrcDashboardDashboardRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcDashboardDashboardPage.path,
    component: modulesHealthcareSrcDashboardDashboardPage.component,
    staticData: { title: modulesHealthcareSrcDashboardDashboardPage.title },
});

const modulesHealthcareSrcPatientPatientPatientsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcPatientPatientPatientsPage.path,
    component: modulesHealthcareSrcPatientPatientPatientsPage.component,
    validateSearch:
        modulesHealthcareSrcPatientPatientPatientsPage.validateSearch,
    staticData: { title: modulesHealthcareSrcPatientPatientPatientsPage.title },
});

const modulesHealthcareSrcPractitionerPractitionerPractitionersRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcPractitionerPractitionerPractitionersPage.path,
        component:
            modulesHealthcareSrcPractitionerPractitionerPractitionersPage.component,
        validateSearch:
            modulesHealthcareSrcPractitionerPractitionerPractitionersPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcPractitionerPractitionerPractitionersPage.title,
        },
    });

const modulesHealthcareSrcServiceRoomRoomsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcServiceRoomRoomsPage.path,
    component: modulesHealthcareSrcServiceRoomRoomsPage.component,
    validateSearch: modulesHealthcareSrcServiceRoomRoomsPage.validateSearch,
    staticData: { title: modulesHealthcareSrcServiceRoomRoomsPage.title },
});

const modulesHealthcareSrcServiceSectionSectionsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcServiceSectionSectionsPage.path,
    component: modulesHealthcareSrcServiceSectionSectionsPage.component,
    validateSearch:
        modulesHealthcareSrcServiceSectionSectionsPage.validateSearch,
    staticData: { title: modulesHealthcareSrcServiceSectionSectionsPage.title },
});

const foundationCalendarCalendarsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationCalendarCalendarsPage.path,
    component: foundationCalendarCalendarsPage.component,
    validateSearch: foundationCalendarCalendarsPage.validateSearch,
    staticData: { title: foundationCalendarCalendarsPage.title },
});

const foundationCalendarWorkingTimeTemplatesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationCalendarWorkingTimeTemplatesPage.path,
    component: foundationCalendarWorkingTimeTemplatesPage.component,
    validateSearch: foundationCalendarWorkingTimeTemplatesPage.validateSearch,
    staticData: { title: foundationCalendarWorkingTimeTemplatesPage.title },
});

const foundationNumberSequenceNumberSequencesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationNumberSequenceNumberSequencesPage.path,
    component: foundationNumberSequenceNumberSequencesPage.component,
    validateSearch: foundationNumberSequenceNumberSequencesPage.validateSearch,
    staticData: { title: foundationNumberSequenceNumberSequencesPage.title },
});

const platformAccessAccessRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformAccessAccessPage.path,
    component: platformAccessAccessPage.component,
    validateSearch: platformAccessAccessPage.validateSearch,
    staticData: { title: platformAccessAccessPage.title },
});

const platformAccessRolesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformAccessRolesPage.path,
    component: platformAccessRolesPage.component,
    validateSearch: platformAccessRolesPage.validateSearch,
    staticData: { title: platformAccessRolesPage.title },
});

const platformAccessSecurityConfigurationRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformAccessSecurityConfigurationPage.path,
    component: platformAccessSecurityConfigurationPage.component,
    validateSearch: platformAccessSecurityConfigurationPage.validateSearch,
    staticData: { title: platformAccessSecurityConfigurationPage.title },
});

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

const platformDashboardDashboardRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformDashboardDashboardPage.path,
    component: platformDashboardDashboardPage.component,
    staticData: { title: platformDashboardDashboardPage.title },
});

const platformDataSharingDataSharingRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformDataSharingDataSharingPage.path,
    component: platformDataSharingDataSharingPage.component,
    validateSearch: platformDataSharingDataSharingPage.validateSearch,
    staticData: { title: platformDataSharingDataSharingPage.title },
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

const platformShellHomeRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformShellHomePage.path,
    component: platformShellHomePage.component,
    staticData: { title: platformShellHomePage.title },
});

const platformShellLoginRoute = createRoute({
    getParentRoute: () => authLayoutRoute,
    path: platformShellLoginPage.path,
    component: platformShellLoginPage.component,
    validateSearch: platformShellLoginPage.validateSearch,
    staticData: { title: platformShellLoginPage.title },
});

const routeTree = rootRoute.addChildren([
    appLayoutRoute.addChildren([
        modulesHealthcareSrcCoverageGuarantorGuarantorsRoute,
        modulesHealthcareSrcCoveragePatientTypePatientTypesRoute,
        modulesHealthcareSrcDashboardDashboardRoute,
        modulesHealthcareSrcPatientPatientPatientsRoute,
        modulesHealthcareSrcPractitionerPractitionerPractitionersRoute,
        modulesHealthcareSrcServiceRoomRoomsRoute,
        modulesHealthcareSrcServiceSectionSectionsRoute,
        foundationCalendarCalendarsRoute,
        foundationCalendarWorkingTimeTemplatesRoute,
        foundationNumberSequenceNumberSequencesRoute,
        platformAccessAccessRoute,
        platformAccessRolesRoute,
        platformAccessSecurityConfigurationRoute,
        platformAddressBookDuplicateSettingsRoute,
        platformAddressBookGlobalAddressBookRoute,
        platformAddressBookOccupationsRoute,
        platformDashboardDashboardRoute,
        platformDataSharingDataSharingRoute,
        platformGeographyAddressSetupRoute,
        platformOrganizationHierarchiesRoute,
        platformOrganizationLegalEntitiesRoute,
        platformOrganizationOperatingUnitsRoute,
        platformShellHomeRoute,
    ]),
    authLayoutRoute.addChildren([platformShellLoginRoute]),
    previousPathRoute(
        '/healthcare/guarantors',
        modulesHealthcareSrcCoverageGuarantorGuarantorsPage.path,
    ),
    previousPathRoute(
        '/healthcare/patient-types',
        modulesHealthcareSrcCoveragePatientTypePatientTypesPage.path,
    ),
    previousPathRoute(
        '/healthcare/patients',
        modulesHealthcareSrcPatientPatientPatientsPage.path,
    ),
    previousPathRoute(
        '/settings/number-sequences',
        foundationNumberSequenceNumberSequencesPage.path,
    ),
    previousPathRoute('/settings/access', platformAccessAccessPage.path),
    previousPathRoute('/settings/roles', platformAccessRolesPage.path),
    previousPathRoute(
        '/settings/security-configuration',
        platformAccessSecurityConfigurationPage.path,
    ),
    previousPathRoute(
        '/settings/party-duplicate-check',
        platformAddressBookDuplicateSettingsPage.path,
    ),
    previousPathRoute(
        '/settings/global-address-book',
        platformAddressBookGlobalAddressBookPage.path,
    ),
    previousPathRoute(
        '/settings/occupations',
        platformAddressBookOccupationsPage.path,
    ),
    previousPathRoute(
        '/healthcare/sharing-policies',
        platformDataSharingDataSharingPage.path,
    ),
    previousPathRoute(
        '/healthcare/patient/sharing-policies',
        platformDataSharingDataSharingPage.path,
    ),
    previousPathRoute(
        '/settings/address-setup',
        platformGeographyAddressSetupPage.path,
    ),
    previousPathRoute(
        '/settings/organization-hierarchies',
        platformOrganizationHierarchiesPage.path,
    ),
    previousPathRoute(
        '/settings/legal-entities',
        platformOrganizationLegalEntitiesPage.path,
    ),
    previousPathRoute(
        '/settings/operating-units',
        platformOrganizationOperatingUnitsPage.path,
    ),
    previousPathRoute('/dashboard', platformShellHomePage.path),
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

startClient(router);
