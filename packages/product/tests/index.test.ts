import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../types.ts";

const {
    persistBatchMock,
    loadEsimAccessProductsMock,
    mapEsimAccessProductsMock,
    loadEsimCardProductsMock,
    mapEsimCardProductsMock,
    loadEsimGoProductsMock,
    mapEsimGoProductsMock,
} = vi.hoisted(() => ({
    persistBatchMock: vi.fn().mockResolvedValue(undefined),
    loadEsimAccessProductsMock: vi.fn().mockResolvedValue([]),
    mapEsimAccessProductsMock: vi.fn().mockReturnValue({ products: [], countries: [], networks: [] }),
    loadEsimCardProductsMock: vi.fn().mockResolvedValue([]),
    mapEsimCardProductsMock: vi.fn().mockReturnValue({ products: [], countries: [], networks: [] }),
    loadEsimGoProductsMock: vi.fn().mockResolvedValue([]),
    mapEsimGoProductsMock: vi.fn().mockReturnValue({ products: [], countries: [], networks: [] }),
}));

vi.mock("../db.ts", () => ({
    persistBatch: persistBatchMock,
}));

vi.mock("../esimaccess.ts", () => ({
    loadEsimAccessProducts: loadEsimAccessProductsMock,
    mapEsimAccessProducts: mapEsimAccessProductsMock,
}));

vi.mock("../esimcard.ts", () => ({
    loadEsimCardProducts: loadEsimCardProductsMock,
    mapEsimCardProducts: mapEsimCardProductsMock,
}));

vi.mock("../esimgo.ts", () => ({
    loadEsimGoProducts: loadEsimGoProductsMock,
    mapEsimGoProducts: mapEsimGoProductsMock,
}));

import worker from "../index.ts";

describe("product worker queue offload", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("enqueues one job per provider from the scheduler", async () => {
        const sendMock = vi.fn().mockResolvedValue(undefined);
        const env = makeEnv({ PRODUCT_INGEST_QUEUE: { send: sendMock, sendBatch: vi.fn().mockResolvedValue(undefined) } });

        await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

        expect(sendMock).toHaveBeenCalledTimes(3);
        expect(sendMock).toHaveBeenNthCalledWith(1, "esimaccess");
        expect(sendMock).toHaveBeenNthCalledWith(2, "esimcard");
        expect(sendMock).toHaveBeenNthCalledWith(3, "esimgo");
    });

    it("routes provider messages to the matching ingestion pipeline", async () => {
        const retryMock = vi.fn().mockResolvedValue(undefined);
        const message = { body: "esimaccess", attempts: 1, retry: retryMock };

        await worker.queue({ messages: [message] } as unknown as MessageBatch<Provider>, makeEnv(), {} as ExecutionContext);

        expect(loadEsimAccessProductsMock).toHaveBeenCalledTimes(1);
        expect(loadEsimCardProductsMock).not.toHaveBeenCalled();
        expect(loadEsimGoProductsMock).not.toHaveBeenCalled();
        expect(persistBatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: "esimaccess" }));
        expect(retryMock).not.toHaveBeenCalled();
    });

    it("retries malformed payloads with exponential delay", async () => {
        const retryMock = vi.fn().mockResolvedValue(undefined);
        const message = { body: "unknown-provider", attempts: 2, retry: retryMock };

        await worker.queue({ messages: [message] } as unknown as MessageBatch<Provider>, makeEnv(), {} as ExecutionContext);

        expect(retryMock).toHaveBeenCalledTimes(1);
        expect(retryMock).toHaveBeenCalledWith({ delaySeconds: 60 });
    });

    it("throws after retries are exhausted so message can move to DLQ", async () => {
        const retryMock = vi.fn().mockResolvedValue(undefined);
        const message = { body: "bad", attempts: 3, retry: retryMock };

        await expect(
            worker.queue({ messages: [message] } as unknown as MessageBatch<Provider>, makeEnv(), {} as ExecutionContext),
        ).rejects.toThrow("Unsupported provider payload");

        expect(retryMock).not.toHaveBeenCalled();
    });
});

function makeEnv(overrides: Partial<Env & { PRODUCT_INGEST_QUEUE: Queue<Provider> }> = {}): Env {
    return {
        DB: {} as D1Database,
        ESIMACCESS_API_KEY: "access-key",
        ESIMCARD_API_KEY: "card-key",
        ESIMGO_API_KEY: "go-key",
        PRODUCT_INGEST_QUEUE: {
            send: vi.fn().mockResolvedValue(undefined),
            sendBatch: vi.fn().mockResolvedValue(undefined),
        } as Queue<Provider>,
        ...overrides,
    } as Env;
}
