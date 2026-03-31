import { persistBatch } from "./db.ts";
import { loadEsimAccessProducts, mapEsimAccessProducts } from "./esimaccess.ts";
import { loadEsimCardProducts, mapEsimCardProducts } from "./esimcard.ts";
import { loadEsimGoProducts, mapEsimGoProducts } from "./esimgo.ts";
import type { Provider, ProductIngestMessage } from "./types.ts";

const ESIMACCESS_PRODUCTS_URL = "https://api.esimaccess.com/api/v1/open/package/list";
const ESIMCARD_PRODUCTS_URL = "https://portal.esimcard.com/api/developer/reseller/pricing";
const ESIMGO_PRODUCTS_URL = "https://api.esim-go.com/v2.5/catalogue";
const INGEST_PROVIDERS: readonly Provider[] = ["esimaccess", "esimcard", "esimgo"];
const RETRY_BASE_DELAY_SECONDS = 15;
const RETRY_MAX_DELAY_SECONDS = 300;
const TIMEOUT_MS = 120 * 1000

export default {
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        await Promise.all(INGEST_PROVIDERS.map((provider) => env.PRODUCT_INGEST_QUEUE.send({ provider })));
    },
    async queue(batch: MessageBatch<ProductIngestMessage>, env: Env, _ctx: ExecutionContext) {
        const message = batch.messages[0]
        const { provider } = message.body;

        try {
            await runProviderPipeline(provider, env);
            message.ack();
        } catch (error) {
            const delaySeconds = calculateRetryDelaySeconds(message.attempts);

            console.error("Provider ingestion failed", {
                provider,
                attempts: message.attempts,
                delaySeconds,
                error,
            });

            message.retry({ delaySeconds });
        }
    },
};

function calculateRetryDelaySeconds(attempts: number): number {
    const exponent = Math.max(attempts - 1, 0);
    return Math.min(RETRY_BASE_DELAY_SECONDS * 2 ** exponent, RETRY_MAX_DELAY_SECONDS);
}

function runProviderPipeline(provider: Provider, env: Env): Promise<void> {
    if (provider === 'esimaccess') return runEsimAccessPipeline(env)
    if (provider === 'esimcard') return runEsimCardPipeline(env)
    if (provider === 'esimgo') return runEsimGoPipeline(env)
    
    throw Error('Unknow provider')
}

async function runEsimAccessPipeline(env: Env): Promise<void> {
    const raw = await loadEsimAccessProducts({
        url: ESIMACCESS_PRODUCTS_URL,
        apiKey: env.ESIMACCESS_API_KEY,
        method: "POST",
        body: {},
        retries: 2,
        timeoutMs: TIMEOUT_MS,
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
        timeoutMs: TIMEOUT_MS,
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
        timeoutMs: TIMEOUT_MS,
    });

    const batch = mapEsimGoProducts(raw);

    await persistBatch(env.DB, {
        provider: "esimgo",
        batch,
    });
}
