import { guarantorRoutes } from './coverage/guarantor/guarantor.routes.ts';
import { patientTypeRoutes } from './coverage/patient-type/patient-type.routes.ts';
import { sharingPolicyRoutes } from './patient/patient-sharing/sharing-policy.routes.ts';
import { patientRoutes } from './patient/patient/patient.routes.ts';

export function healthcareRoutes() {
    return {
        ...patientRoutes(),
        ...patientTypeRoutes(),
        ...guarantorRoutes(),
        ...sharingPolicyRoutes(),
    };
}
