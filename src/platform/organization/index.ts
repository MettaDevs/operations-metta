import { hierarchyRoutes } from './hierarchy.routes.ts';
import { organizationRoutes as directoryRoutes } from './organization.routes.ts';

// Legal entity, operating unit, dan hierarchy organisasi: route pengguna tenant di bawah `/settings/...` dan
// `/api/v1/organizations`, sama dengan CoreERP.
export function organizationRoutes() {
    return { ...directoryRoutes(), ...hierarchyRoutes() };
}
