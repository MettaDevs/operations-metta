import { onEvent } from '@core/platform/events/index.ts';
import { clusterRoutes } from './clinical/cluster/cluster.routes.ts';
import { diagnosisReferenceRoutes } from './clinical/diagnosis-reference/diagnosis-reference.routes.ts';
import { drugRoutes } from './clinical/drug/drug.routes.ts';
import { icd10Routes } from './clinical/icd10/icd10.routes.ts';
import { lifeCycleRoutes } from './clinical/life-cycle/life-cycle.routes.ts';
import { procedureCategoryRoutes } from './clinical/procedure-category/procedure-category.routes.ts';
import { procedureRoutes } from './clinical/procedure/procedure.routes.ts';
import { cpptRoutes } from './examination/cppt/cppt.routes.ts';
import { dischargeRoutes } from './examination/discharge/discharge.routes.ts';
import {
    prescriptionDispensed,
    receiveDispensing,
    receiveReturn,
    returnPosted,
    returnReversed,
} from './examination/medical-record/dispensing.events.ts';
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
import { moduleId } from './module.ts';

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
        ...icd10Routes(),
        ...procedureRoutes(),
        ...procedureCategoryRoutes(),
        ...drugRoutes(),
        ...diagnosisReferenceRoutes(),
        ...visitRoutes(),
        ...examinationQueueRoutes(),
        ...medicalRecordRoutes(),
        ...dischargeRoutes(),
        ...cpptRoutes(),
    };
}

let registered = false;

// Dipanggil src/main.ts dan src/worker.ts. Proses yang tidak memanggilnya tidak mengantar penyerahan dan retur obat ke
// E-Resep.
export function registerHealthcareEventHandlers(): void {
    if (registered) return;
    registered = true;
    onEvent(prescriptionDispensed, moduleId, receiveDispensing);
    onEvent(returnPosted, moduleId, receiveReturn);
    onEvent(returnReversed, moduleId, receiveReturn);
}
