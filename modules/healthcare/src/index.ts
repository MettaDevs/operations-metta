import { clusterRoutes } from './clinical/cluster/cluster.routes.ts';
import { lifeCycleRoutes } from './clinical/life-cycle/life-cycle.routes.ts';
import { guarantorRoutes } from './coverage/guarantor/guarantor.routes.ts';
import { patientTypeRoutes } from './coverage/patient-type/patient-type.routes.ts';
import { patientRoutes } from './patient/patient/patient.routes.ts';
import { practitionerRoutes } from './practitioner/practitioner/practitioner.routes.ts';
import { visitRoutes } from './registration/visit/visit.routes.ts';
import { practiceScheduleRoutes } from './service/practice-schedule/practice-schedule.routes.ts';
import { roomRoutes } from './service/room/room.routes.ts';
import { sectionRoutes } from './service/section/section.routes.ts';

export function healthcareRoutes() {
    return {
        ...patientRoutes(),
        ...patientTypeRoutes(),
        ...guarantorRoutes(),
        ...practitionerRoutes(),
        ...sectionRoutes(),
        ...roomRoutes(),
        ...practiceScheduleRoutes(),
        ...clusterRoutes(),
        ...lifeCycleRoutes(),
        ...visitRoutes(),
    };
}
