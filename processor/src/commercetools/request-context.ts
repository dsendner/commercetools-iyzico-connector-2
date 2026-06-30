import { RequestContextData } from "@commercetools/connect-payments-sdk";
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<RequestContextData>();

export function getRequestContext(): RequestContextData {
    return (
        storage.getStore() ?? {
            correlationId: '',
            requestId: '',
            authentication: undefined,
        }
    );
}

export function updateRequestContext(ctx: Partial<RequestContextData>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, ctx);
}

export function runWithRequestContext<T>(
    seed: Partial<RequestContextData>,
    fn: () => T
): T {
    const ctx: RequestContextData = {
        correlationId: seed.correlationId ?? '',
        requestId: seed.requestId ?? '',
        authentication: seed.authentication ?? undefined,
    };
    return storage.run(ctx, fn);
}
