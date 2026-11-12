// Dibuat `bun scripts/generate-client.ts` dari setiap berkas `.page.tsx`; jangan disunting tangan. `bun run build`
// dan `bun run dev` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
import { page as modulesHealthcareSrcClinicalClusterClustersPage } from '../modules/healthcare/src/clinical/cluster/clusters.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesPage } from '../modules/healthcare/src/clinical/diagnosis-reference/chronic-diseases.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesPage } from '../modules/healthcare/src/clinical/diagnosis-reference/diagnosis-cases.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesPage } from '../modules/healthcare/src/clinical/diagnosis-reference/diagnosis-types.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesPage } from '../modules/healthcare/src/clinical/diagnosis-reference/discharge-statuses.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsPage } from '../modules/healthcare/src/clinical/diagnosis-reference/dosage-forms.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsPage } from '../modules/healthcare/src/clinical/diagnosis-reference/drug-units.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsPage } from '../modules/healthcare/src/clinical/diagnosis-reference/procedure-groups.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferencePrognosesPage } from '../modules/healthcare/src/clinical/diagnosis-reference/prognoses.page.tsx';
import { page as modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsPage } from '../modules/healthcare/src/clinical/diagnosis-reference/usage-instructions.page.tsx';
import { page as modulesHealthcareSrcClinicalDrugDrugsPage } from '../modules/healthcare/src/clinical/drug/drugs.page.tsx';
import { page as modulesHealthcareSrcClinicalIcd10Icd10Page } from '../modules/healthcare/src/clinical/icd10/icd10.page.tsx';
import { page as modulesHealthcareSrcClinicalLifeCycleLifeCyclesPage } from '../modules/healthcare/src/clinical/life-cycle/life-cycles.page.tsx';
import { page as modulesHealthcareSrcClinicalProcedureProceduresPage } from '../modules/healthcare/src/clinical/procedure/procedures.page.tsx';
import { page as modulesHealthcareSrcCoverageGuarantorGuarantorsPage } from '../modules/healthcare/src/coverage/guarantor/guarantors.page.tsx';
import { page as modulesHealthcareSrcCoveragePatientTypePatientTypesPage } from '../modules/healthcare/src/coverage/patient-type/patient-types.page.tsx';
import { page as modulesHealthcareSrcDashboardDashboardPage } from '../modules/healthcare/src/dashboard/dashboard.page.tsx';
import { page as modulesHealthcareSrcExaminationQueueExaminationPage } from '../modules/healthcare/src/examination/queue/examination.page.tsx';
import { page as modulesHealthcareSrcExaminationQueueQueuePage } from '../modules/healthcare/src/examination/queue/queue.page.tsx';
import { page as modulesHealthcareSrcPatientPatientPatientsPage } from '../modules/healthcare/src/patient/patient/patients.page.tsx';
import { page as modulesHealthcareSrcPractitionerPractitionerPractitionersPage } from '../modules/healthcare/src/practitioner/practitioner/practitioners.page.tsx';
import { page as modulesHealthcareSrcPractitionerProfessionProfessionsPage } from '../modules/healthcare/src/practitioner/profession/professions.page.tsx';
import { page as modulesHealthcareSrcRegistrationVisitVisitNewPage } from '../modules/healthcare/src/registration/visit/visit-new.page.tsx';
import { page as modulesHealthcareSrcRegistrationVisitVisitPage } from '../modules/healthcare/src/registration/visit/visit.page.tsx';
import { page as modulesHealthcareSrcRegistrationVisitVisitsPage } from '../modules/healthcare/src/registration/visit/visits.page.tsx';
import { page as modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesPage } from '../modules/healthcare/src/service/practice-schedule/practice-schedules.page.tsx';
import { page as modulesHealthcareSrcServicePracticeSchedulePracticeSessionsPage } from '../modules/healthcare/src/service/practice-schedule/practice-sessions.page.tsx';
import { page as modulesHealthcareSrcServicePracticeScheduleScheduleParametersPage } from '../modules/healthcare/src/service/practice-schedule/schedule-parameters.page.tsx';
import { page as modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesPage } from '../modules/healthcare/src/service/practice-schedule/schedule-templates.page.tsx';
import { page as modulesHealthcareSrcServiceRoomRoomsPage } from '../modules/healthcare/src/service/room/rooms.page.tsx';
import { page as modulesHealthcareSrcServiceSectionSectionsPage } from '../modules/healthcare/src/service/section/sections.page.tsx';
import { page as foundationCalendarCalendarsPage } from './foundation/calendar/calendars.page.tsx';
import { page as foundationCalendarWorkingTimeTemplatesPage } from './foundation/calendar/working-time-templates.page.tsx';
import { page as foundationInventoryCodeListFundingSourcesPage } from './foundation/inventory/code-list/funding-sources.page.tsx';
import { page as foundationInventoryCodeListProcurementProgramsPage } from './foundation/inventory/code-list/procurement-programs.page.tsx';
import { page as foundationInventoryCodeListReasonCodesPage } from './foundation/inventory/code-list/reason-codes.page.tsx';
import { page as foundationInventoryCodeListUnitsOfMeasurePage } from './foundation/inventory/code-list/units-of-measure.page.tsx';
import { page as foundationInventoryItemCategoryItemCategoriesPage } from './foundation/inventory/item-category/item-categories.page.tsx';
import { page as foundationInventoryItemUnitItemUnitsPage } from './foundation/inventory/item-unit/item-units.page.tsx';
import { page as foundationInventoryLocationLocationsPage } from './foundation/inventory/location/locations.page.tsx';
import { page as foundationInventorySetupInventorySetupPage } from './foundation/inventory/setup/inventory-setup.page.tsx';
import { page as foundationInventoryTrackingCodeItemTrackingCodesPage } from './foundation/inventory/tracking-code/item-tracking-codes.page.tsx';
import { page as foundationInventoryTransferTransferOrdersPage } from './foundation/inventory/transfer/transfer-orders.page.tsx';
import { page as foundationInventoryTransferTransferReceiptsPage } from './foundation/inventory/transfer/transfer-receipts.page.tsx';
import { page as foundationInventoryTransferTransferShipmentsPage } from './foundation/inventory/transfer/transfer-shipments.page.tsx';
import { page as foundationNumberSequenceNumberSequencesPage } from './foundation/number-sequence/number-sequences.page.tsx';
import { page as foundationPurchasingReceiptReceiptsPage } from './foundation/purchasing/receipt/receipts.page.tsx';
import { page as foundationPurchasingVendorVendorsPage } from './foundation/purchasing/vendor/vendors.page.tsx';
import { page as platformAccessAccessPage } from './platform/access/access.page.tsx';
import { page as platformAccessRolesPage } from './platform/access/roles.page.tsx';
import { page as platformAccessSecurityConfigurationPage } from './platform/access/security-configuration.page.tsx';
import { page as platformAddressBookDuplicateSettingsPage } from './platform/address-book/duplicate-settings.page.tsx';
import { page as platformAddressBookGlobalAddressBookPage } from './platform/address-book/global-address-book.page.tsx';
import { page as platformAddressBookOccupationsPage } from './platform/address-book/occupations.page.tsx';
import { page as platformDashboardDashboardPage } from './platform/dashboard/dashboard.page.tsx';
import { page as platformDataSharingDataSharingPage } from './platform/data-sharing/data-sharing.page.tsx';
import { page as platformGeographyAddressSetupPage } from './platform/geography/address-setup.page.tsx';
import { page as platformIdentityProfilePage } from './platform/identity/profile.page.tsx';
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

const modulesHealthcareSrcClinicalClusterClustersRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcClinicalClusterClustersPage.path,
    component: modulesHealthcareSrcClinicalClusterClustersPage.component,
    validateSearch:
        modulesHealthcareSrcClinicalClusterClustersPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcClinicalClusterClustersPage.title,
    },
});

const modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferencePrognosesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferencePrognosesPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferencePrognosesPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferencePrognosesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferencePrognosesPage.title,
        },
    });

const modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsPage.path,
        component:
            modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsPage.component,
        validateSearch:
            modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsPage.title,
        },
    });

const modulesHealthcareSrcClinicalDrugDrugsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcClinicalDrugDrugsPage.path,
    component: modulesHealthcareSrcClinicalDrugDrugsPage.component,
    validateSearch: modulesHealthcareSrcClinicalDrugDrugsPage.validateSearch,
    staticData: { title: modulesHealthcareSrcClinicalDrugDrugsPage.title },
});

const modulesHealthcareSrcClinicalIcd10Icd10Route = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcClinicalIcd10Icd10Page.path,
    component: modulesHealthcareSrcClinicalIcd10Icd10Page.component,
    validateSearch: modulesHealthcareSrcClinicalIcd10Icd10Page.validateSearch,
    staticData: { title: modulesHealthcareSrcClinicalIcd10Icd10Page.title },
});

const modulesHealthcareSrcClinicalLifeCycleLifeCyclesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcClinicalLifeCycleLifeCyclesPage.path,
    component: modulesHealthcareSrcClinicalLifeCycleLifeCyclesPage.component,
    validateSearch:
        modulesHealthcareSrcClinicalLifeCycleLifeCyclesPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcClinicalLifeCycleLifeCyclesPage.title,
    },
});

const modulesHealthcareSrcClinicalProcedureProceduresRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcClinicalProcedureProceduresPage.path,
    component: modulesHealthcareSrcClinicalProcedureProceduresPage.component,
    validateSearch:
        modulesHealthcareSrcClinicalProcedureProceduresPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcClinicalProcedureProceduresPage.title,
    },
});

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

const modulesHealthcareSrcExaminationQueueExaminationRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcExaminationQueueExaminationPage.path,
    component: modulesHealthcareSrcExaminationQueueExaminationPage.component,
    staticData: {
        title: modulesHealthcareSrcExaminationQueueExaminationPage.title,
    },
});

const modulesHealthcareSrcExaminationQueueQueueRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcExaminationQueueQueuePage.path,
    component: modulesHealthcareSrcExaminationQueueQueuePage.component,
    validateSearch:
        modulesHealthcareSrcExaminationQueueQueuePage.validateSearch,
    staticData: { title: modulesHealthcareSrcExaminationQueueQueuePage.title },
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

const modulesHealthcareSrcPractitionerProfessionProfessionsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcPractitionerProfessionProfessionsPage.path,
    component:
        modulesHealthcareSrcPractitionerProfessionProfessionsPage.component,
    validateSearch:
        modulesHealthcareSrcPractitionerProfessionProfessionsPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcPractitionerProfessionProfessionsPage.title,
    },
});

const modulesHealthcareSrcRegistrationVisitVisitNewRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcRegistrationVisitVisitNewPage.path,
    component: modulesHealthcareSrcRegistrationVisitVisitNewPage.component,
    validateSearch:
        modulesHealthcareSrcRegistrationVisitVisitNewPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcRegistrationVisitVisitNewPage.title,
    },
});

const modulesHealthcareSrcRegistrationVisitVisitRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcRegistrationVisitVisitPage.path,
    component: modulesHealthcareSrcRegistrationVisitVisitPage.component,
    validateSearch:
        modulesHealthcareSrcRegistrationVisitVisitPage.validateSearch,
    staticData: { title: modulesHealthcareSrcRegistrationVisitVisitPage.title },
});

const modulesHealthcareSrcRegistrationVisitVisitsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: modulesHealthcareSrcRegistrationVisitVisitsPage.path,
    component: modulesHealthcareSrcRegistrationVisitVisitsPage.component,
    validateSearch:
        modulesHealthcareSrcRegistrationVisitVisitsPage.validateSearch,
    staticData: {
        title: modulesHealthcareSrcRegistrationVisitVisitsPage.title,
    },
});

const modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesPage.path,
        component:
            modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesPage.component,
        validateSearch:
            modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesPage.title,
        },
    });

const modulesHealthcareSrcServicePracticeSchedulePracticeSessionsRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcServicePracticeSchedulePracticeSessionsPage.path,
        component:
            modulesHealthcareSrcServicePracticeSchedulePracticeSessionsPage.component,
        validateSearch:
            modulesHealthcareSrcServicePracticeSchedulePracticeSessionsPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcServicePracticeSchedulePracticeSessionsPage.title,
        },
    });

const modulesHealthcareSrcServicePracticeScheduleScheduleParametersRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcServicePracticeScheduleScheduleParametersPage.path,
        component:
            modulesHealthcareSrcServicePracticeScheduleScheduleParametersPage.component,
        staticData: {
            title: modulesHealthcareSrcServicePracticeScheduleScheduleParametersPage.title,
        },
    });

const modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesRoute =
    createRoute({
        getParentRoute: () => appLayoutRoute,
        path: modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesPage.path,
        component:
            modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesPage.component,
        validateSearch:
            modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesPage.validateSearch,
        staticData: {
            title: modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesPage.title,
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

const foundationInventoryCodeListFundingSourcesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryCodeListFundingSourcesPage.path,
    component: foundationInventoryCodeListFundingSourcesPage.component,
    validateSearch:
        foundationInventoryCodeListFundingSourcesPage.validateSearch,
    staticData: { title: foundationInventoryCodeListFundingSourcesPage.title },
});

const foundationInventoryCodeListProcurementProgramsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryCodeListProcurementProgramsPage.path,
    component: foundationInventoryCodeListProcurementProgramsPage.component,
    validateSearch:
        foundationInventoryCodeListProcurementProgramsPage.validateSearch,
    staticData: {
        title: foundationInventoryCodeListProcurementProgramsPage.title,
    },
});

const foundationInventoryCodeListReasonCodesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryCodeListReasonCodesPage.path,
    component: foundationInventoryCodeListReasonCodesPage.component,
    validateSearch: foundationInventoryCodeListReasonCodesPage.validateSearch,
    staticData: { title: foundationInventoryCodeListReasonCodesPage.title },
});

const foundationInventoryCodeListUnitsOfMeasureRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryCodeListUnitsOfMeasurePage.path,
    component: foundationInventoryCodeListUnitsOfMeasurePage.component,
    validateSearch:
        foundationInventoryCodeListUnitsOfMeasurePage.validateSearch,
    staticData: { title: foundationInventoryCodeListUnitsOfMeasurePage.title },
});

const foundationInventoryItemCategoryItemCategoriesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryItemCategoryItemCategoriesPage.path,
    component: foundationInventoryItemCategoryItemCategoriesPage.component,
    validateSearch:
        foundationInventoryItemCategoryItemCategoriesPage.validateSearch,
    staticData: {
        title: foundationInventoryItemCategoryItemCategoriesPage.title,
    },
});

const foundationInventoryItemUnitItemUnitsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryItemUnitItemUnitsPage.path,
    component: foundationInventoryItemUnitItemUnitsPage.component,
    validateSearch: foundationInventoryItemUnitItemUnitsPage.validateSearch,
    staticData: { title: foundationInventoryItemUnitItemUnitsPage.title },
});

const foundationInventoryLocationLocationsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryLocationLocationsPage.path,
    component: foundationInventoryLocationLocationsPage.component,
    validateSearch: foundationInventoryLocationLocationsPage.validateSearch,
    staticData: { title: foundationInventoryLocationLocationsPage.title },
});

const foundationInventorySetupInventorySetupRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventorySetupInventorySetupPage.path,
    component: foundationInventorySetupInventorySetupPage.component,
    staticData: { title: foundationInventorySetupInventorySetupPage.title },
});

const foundationInventoryTrackingCodeItemTrackingCodesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryTrackingCodeItemTrackingCodesPage.path,
    component: foundationInventoryTrackingCodeItemTrackingCodesPage.component,
    validateSearch:
        foundationInventoryTrackingCodeItemTrackingCodesPage.validateSearch,
    staticData: {
        title: foundationInventoryTrackingCodeItemTrackingCodesPage.title,
    },
});

const foundationInventoryTransferTransferOrdersRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryTransferTransferOrdersPage.path,
    component: foundationInventoryTransferTransferOrdersPage.component,
    validateSearch:
        foundationInventoryTransferTransferOrdersPage.validateSearch,
    staticData: { title: foundationInventoryTransferTransferOrdersPage.title },
});

const foundationInventoryTransferTransferReceiptsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryTransferTransferReceiptsPage.path,
    component: foundationInventoryTransferTransferReceiptsPage.component,
    validateSearch:
        foundationInventoryTransferTransferReceiptsPage.validateSearch,
    staticData: {
        title: foundationInventoryTransferTransferReceiptsPage.title,
    },
});

const foundationInventoryTransferTransferShipmentsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationInventoryTransferTransferShipmentsPage.path,
    component: foundationInventoryTransferTransferShipmentsPage.component,
    validateSearch:
        foundationInventoryTransferTransferShipmentsPage.validateSearch,
    staticData: {
        title: foundationInventoryTransferTransferShipmentsPage.title,
    },
});

const foundationNumberSequenceNumberSequencesRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationNumberSequenceNumberSequencesPage.path,
    component: foundationNumberSequenceNumberSequencesPage.component,
    validateSearch: foundationNumberSequenceNumberSequencesPage.validateSearch,
    staticData: { title: foundationNumberSequenceNumberSequencesPage.title },
});

const foundationPurchasingReceiptReceiptsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationPurchasingReceiptReceiptsPage.path,
    component: foundationPurchasingReceiptReceiptsPage.component,
    validateSearch: foundationPurchasingReceiptReceiptsPage.validateSearch,
    staticData: { title: foundationPurchasingReceiptReceiptsPage.title },
});

const foundationPurchasingVendorVendorsRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: foundationPurchasingVendorVendorsPage.path,
    component: foundationPurchasingVendorVendorsPage.component,
    validateSearch: foundationPurchasingVendorVendorsPage.validateSearch,
    staticData: { title: foundationPurchasingVendorVendorsPage.title },
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

const platformIdentityProfileRoute = createRoute({
    getParentRoute: () => appLayoutRoute,
    path: platformIdentityProfilePage.path,
    component: platformIdentityProfilePage.component,
    validateSearch: platformIdentityProfilePage.validateSearch,
    staticData: { title: platformIdentityProfilePage.title },
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
        modulesHealthcareSrcClinicalClusterClustersRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceChronicDiseasesRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisCasesRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceDiagnosisTypesRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceDischargeStatusesRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceDosageFormsRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceDrugUnitsRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceProcedureGroupsRoute,
        modulesHealthcareSrcClinicalDiagnosisReferencePrognosesRoute,
        modulesHealthcareSrcClinicalDiagnosisReferenceUsageInstructionsRoute,
        modulesHealthcareSrcClinicalDrugDrugsRoute,
        modulesHealthcareSrcClinicalIcd10Icd10Route,
        modulesHealthcareSrcClinicalLifeCycleLifeCyclesRoute,
        modulesHealthcareSrcClinicalProcedureProceduresRoute,
        modulesHealthcareSrcCoverageGuarantorGuarantorsRoute,
        modulesHealthcareSrcCoveragePatientTypePatientTypesRoute,
        modulesHealthcareSrcDashboardDashboardRoute,
        modulesHealthcareSrcExaminationQueueExaminationRoute,
        modulesHealthcareSrcExaminationQueueQueueRoute,
        modulesHealthcareSrcPatientPatientPatientsRoute,
        modulesHealthcareSrcPractitionerPractitionerPractitionersRoute,
        modulesHealthcareSrcPractitionerProfessionProfessionsRoute,
        modulesHealthcareSrcRegistrationVisitVisitNewRoute,
        modulesHealthcareSrcRegistrationVisitVisitRoute,
        modulesHealthcareSrcRegistrationVisitVisitsRoute,
        modulesHealthcareSrcServicePracticeSchedulePracticeSchedulesRoute,
        modulesHealthcareSrcServicePracticeSchedulePracticeSessionsRoute,
        modulesHealthcareSrcServicePracticeScheduleScheduleParametersRoute,
        modulesHealthcareSrcServicePracticeScheduleScheduleTemplatesRoute,
        modulesHealthcareSrcServiceRoomRoomsRoute,
        modulesHealthcareSrcServiceSectionSectionsRoute,
        foundationCalendarCalendarsRoute,
        foundationCalendarWorkingTimeTemplatesRoute,
        foundationInventoryCodeListFundingSourcesRoute,
        foundationInventoryCodeListProcurementProgramsRoute,
        foundationInventoryCodeListReasonCodesRoute,
        foundationInventoryCodeListUnitsOfMeasureRoute,
        foundationInventoryItemCategoryItemCategoriesRoute,
        foundationInventoryItemUnitItemUnitsRoute,
        foundationInventoryLocationLocationsRoute,
        foundationInventorySetupInventorySetupRoute,
        foundationInventoryTrackingCodeItemTrackingCodesRoute,
        foundationInventoryTransferTransferOrdersRoute,
        foundationInventoryTransferTransferReceiptsRoute,
        foundationInventoryTransferTransferShipmentsRoute,
        foundationNumberSequenceNumberSequencesRoute,
        foundationPurchasingReceiptReceiptsRoute,
        foundationPurchasingVendorVendorsRoute,
        platformAccessAccessRoute,
        platformAccessRolesRoute,
        platformAccessSecurityConfigurationRoute,
        platformAddressBookDuplicateSettingsRoute,
        platformAddressBookGlobalAddressBookRoute,
        platformAddressBookOccupationsRoute,
        platformDashboardDashboardRoute,
        platformDataSharingDataSharingRoute,
        platformGeographyAddressSetupRoute,
        platformIdentityProfileRoute,
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
