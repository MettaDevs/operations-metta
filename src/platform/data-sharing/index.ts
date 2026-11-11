// Data sharing antar perusahaan (Sys Admin → Data sharing), pola cross-company data sharing F&O. Module mendaftarkan
// jenis datanya di data_sharing_types lewat migration-nya, lalu membaca perusahaan yang saling melihat datanya lewat
// sharedLegalEntities saat menyaring data miliknya.
export { dataSharingRoutes } from './data-sharing.routes.ts';
export { sharedLegalEntities } from './data-sharing.service.ts';
