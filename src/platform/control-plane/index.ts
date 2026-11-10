import { createHash, createSign } from 'node:crypto';
import { z } from 'zod';

// Klien API worker control-plane-metta (`contracts/worker/openapi.yaml` di repo itu). Setiap request ditandatangani
// HTTP Message Signatures (RFC 9421) persis seperti yang diperiksa control plane: label sig1, komponen "@method"
// "@path" "content-digest", parameter created, keyid, alg dalam urutan itu, dan alg rsa-v1_5-sha256.

// Operasi tidak lagi dipegang host ini (diambil alih, ditutup, atau tenggatnya lewat). Worker harus berhenti.
export class OperationLost extends Error {}

const claimedSchema = z.object({
    operation: z.object({
        id: z.uuid(),
        operation: z.string(),
        environment_id: z.uuid(),
        parameters: z.unknown(),
        lease_until: z.string(),
    }),
});
export type ClaimedOperation = z.infer<typeof claimedSchema>['operation'];
export type StepReport = {
    status: 'running' | 'succeeded' | 'failed';
    step: string;
    failure_message?: string;
};
export type ControlPlaneClient = {
    claim(): Promise<ClaimedOperation | null>;
    report(operationId: string, step: StepReport): Promise<void>;
};

export function controlPlaneClient(settings: {
    url: string;
    hostId: string;
    privateKey: string;
}): ControlPlaneClient {
    async function post(path: string, body: unknown): Promise<Response> {
        const url = new URL(path, settings.url);
        const text = JSON.stringify(body);
        const digest = `sha-256=:${createHash('sha256').update(text).digest('base64')}:`;
        const parameters = `("@method" "@path" "content-digest");created=${Math.floor(Date.now() / 1000)};keyid="${settings.hostId}";alg="rsa-v1_5-sha256"`;
        const signature = createSign('sha256')
            .update(
                [
                    '"@method": POST',
                    `"@path": ${url.pathname}`,
                    `"content-digest": ${digest}`,
                    `"@signature-params": ${parameters}`,
                ].join('\n'),
            )
            .sign(settings.privateKey, 'base64');
        return fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-digest': digest,
                'signature-input': `sig1=${parameters}`,
                signature: `sig1=:${signature}:`,
            },
            body: text,
        });
    }

    return {
        async claim() {
            const response = await post('/api/worker/v1/operations/claim', {});
            if (response.status === 204) return null;
            if (response.status !== 200)
                throw new Error(
                    `Claim answered ${response.status}: ${await response.text()}`,
                );
            return claimedSchema.parse(await response.json()).operation;
        },
        async report(operationId, step) {
            const response = await post(
                `/api/worker/v1/operations/${operationId}/steps`,
                step,
            );
            if (response.status === 409)
                throw new OperationLost(
                    `Operation ${operationId} is no longer held by this host.`,
                );
            if (response.status !== 200)
                throw new Error(
                    `Step ${step.step} answered ${response.status}: ${await response.text()}`,
                );
        },
    };
}
