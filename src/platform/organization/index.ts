import { hierarchyRoutes } from './hierarchy.routes.ts';
import { organizationRoutes as directoryRoutes } from './organization.routes.ts';

// Legal entity, operating unit, dan hierarchy organisasi: route pengguna tenant di bawah `/api/v1/settings/...` dan
// `/api/v1/organizations`. Di CoreERP data layar ada di `/settings/...`; di sini URL itu milik layar, dan datanya
// berpindah ke bawah `/api/` dengan bentuk yang sama.
export function organizationRoutes() {
    return { ...directoryRoutes(), ...hierarchyRoutes() };
}
