import { persistBatch } from "./db.ts";
import { loadEsimAccessProducts, mapEsimAccessProducts } from "./esimaccess.ts";
import { loadEsimCardProducts, mapEsimCardProducts } from "./esimcard.ts";
import { loadEsimGoProducts, mapEsimGoProducts } from "./esimgo.ts";
import type { Provider } from "./types.ts";

const ESIMACCESS_PRODUCTS_URL = "https://api.esimaccess.com/api/v1/open/package/list";
const ESIMCARD_PRODUCTS_URL = "https://portal.esimcard.com/api/developer/reseller/pricing";
const ESIMGO_PRODUCTS_URL = "https://api.esim-go.com/v2.5/catalogue";
const MAX_RETRIES = 2;

const PROVIDERS: readonly Provider[] = ["esimaccess", "esimcard", "esimgo"];

export default {
    async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
        await Promise.all(PROVIDERS.map((provider) => env.PRODUCT_INGEST_QUEUE.send(provider)));
    },

    async queue(batch: MessageBatch<Provider>, env: Env, ctx: ExecutionContext) {
        await Promise.all(batch.messages.map((message) => handleQueueMessage(message, env)));
    },
};

async function handleQueueMessage(message: Message<Provider>, env: Env): Promise<void> {
    try {
        const provider = parseProvider(message.body);

        await runProviderPipeline(provider, env);
    } catch (error) {
        if (message.attempts <= MAX_RETRIES) {
            await message.retry({ delaySeconds: calculateRetryDelaySeconds(message.attempts) });
            return;
        }

        throw error;
    }
}

function parseProvider(value: unknown): Provider {
    if (value === "esimaccess" || value === "esimcard" || value === "esimgo") {
        return value;
    }

    throw new Error(`Unsupported provider payload: ${String(value)}`);
}

function calculateRetryDelaySeconds(attempts: number): number {
    return Math.min(30 * 2 ** Math.max(0, attempts - 1), 300);
}

async function runProviderPipeline(provider: Provider, env: Env): Promise<void> {
    switch (provider) {
        case "esimaccess":
            await runEsimAccessPipeline(env);
            return;
        case "esimcard":
            await runEsimCardPipeline(env);
            return;
        case "esimgo":
            await runEsimGoPipeline(env);
            return;
    }
}

async function runEsimAccessPipeline(env: Env): Promise<void> {
    const raw = await loadEsimAccessProducts({
        url: ESIMACCESS_PRODUCTS_URL,
        apiKey: env.ESIMACCESS_API_KEY,
        method: "POST",
        body: {},
        retries: 2,
        timeoutMs: 30000,
    });

    const batch = mapEsimAccessProducts(raw);

    await persistBatch(env.DB, {
        provider: "esimaccess",
        batch,
    });
}

async function runEsimCardPipeline(env: Env): Promise<void> {
    const raw = await loadEsimCardProducts({
        url: ESIMCARD_PRODUCTS_URL,
        apiKey: env.ESIMCARD_API_KEY,
        method: "GET",
        retries: 2,
        timeoutMs: 60000,
    });

    const batch = mapEsimCardProducts(raw);

    await persistBatch(env.DB, {
        provider: "esimcard",
        batch,
    });
}

async function runEsimGoPipeline(env: Env): Promise<void> {
    const raw = await loadEsimGoProducts({
        url: ESIMGO_PRODUCTS_URL,
        apiKey: env.ESIMGO_API_KEY,
        method: "GET",
        retries: 2,
        timeoutMs: 30000,
    });

    const batch = mapEsimGoProducts(raw);

    await persistBatch(env.DB, {
        provider: "esimgo",
        batch,
    });
}
