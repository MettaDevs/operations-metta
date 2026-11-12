import { z } from 'zod';

export const correlationHeader = 'X-Correlation-Id';

// Correlation id satu request: X-Correlation-Id kiriman pemanggil bila berupa UUID, kalau tidak dibuat baru. Event yang
// diterbitkan request itu membawanya, dan jawabannya mengembalikannya di header yang sama.
export function requestCorrelationId(request: Request): string {
    const sent = z.guid().safeParse(request.headers.get(correlationHeader));
    return sent.success ? sent.data.toLowerCase() : Bun.randomUUIDv7();
}
