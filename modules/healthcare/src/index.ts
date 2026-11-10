import { patientRoutes } from './patient/patient/patient.routes.ts';
import { guarantorRoutes } from './setup/guarantor/guarantor.routes.ts';
import { patientTypeRoutes } from './setup/patient-type/patient-type.routes.ts';

export function healthcareRoutes() {
    return { ...patientRoutes(), ...patientTypeRoutes(), ...guarantorRoutes() };
}
