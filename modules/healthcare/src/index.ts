import { guarantorRoutes } from './coverage/guarantor/guarantor.routes.ts';
import { patientTypeRoutes } from './coverage/patient-type/patient-type.routes.ts';
import { patientRoutes } from './patient/patient/patient.routes.ts';
import { practitionerRoutes } from './practitioner/practitioner/practitioner.routes.ts';

export function healthcareRoutes() {
    return {
        ...patientRoutes(),
        ...patientTypeRoutes(),
        ...guarantorRoutes(),
        ...practitionerRoutes(),
    };
}
