import { clusterRoutes } from './clinical/cluster/cluster.routes.ts';
import { lifeCycleRoutes } from './clinical/life-cycle/life-cycle.routes.ts';
import { medicalRecordRoutes } from './examination/medical-record/medical-record.routes.ts';
import { examinationQueueRoutes } from './examination/queue/queue.routes.ts';
import { guarantorRoutes } from './coverage/guarantor/guarantor.routes.ts';
import { patientTypeRoutes } from './coverage/patient-type/patient-type.routes.ts';
import { patientRoutes } from './patient/patient/patient.routes.ts';
import { practitionerRoutes } from './practitioner/practitioner/practitioner.routes.ts';
import { professionRoutes } from './practitioner/profession/profession.routes.ts';
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
        ...professionRoutes(),
        ...sectionRoutes(),
        ...roomRoutes(),
        ...practiceScheduleRoutes(),
        ...clusterRoutes(),
        ...lifeCycleRoutes(),
        ...visitRoutes(),
        ...examinationQueueRoutes(),
        ...medicalRecordRoutes(),
    };
}
