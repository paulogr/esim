import { persistBatch } from "./db.ts";
import { loadEsimAccessProducts, mapEsimAccessProducts } from "./esimaccess.ts";
import { loadEsimCardProducts, mapEsimCardProducts } from "./esimcard.ts";
import { loadEsimGoProducts, mapEsimGoProducts } from "./esimgo.ts";
import type { Provider } from "./types.ts";

const ESIMACCESS_PRODUCTS_URL = "https://api.esimaccess.com/api/v1/open/package/list";
const ESIMCARD_PRODUCTS_URL = "https://portal.esimcard.com/api/developer/reseller/pricing";
const ESIMGO_PRODUCTS_URL = "https://api.esim-go.com/v2.5/catalogue";
const INGEST_PROVIDERS: readonly Provider[] = ["esimaccess", "esimcard", "esimgo"];
const RETRY_BASE_DELAY_SECONDS = 15;
const RETRY_MAX_DELAY_SECONDS = 300;

type ProductIngestMessage = {
    provider: Provider;
};

export default {
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        await Promise.all(
            INGEST_PROVIDERS.map((provider) =>
                env.PRODUCT_INGEST_QUEUE.send({ provider } satisfies ProductIngestMessage),
            ),
        );
    },

    async queue(batch: MessageBatch<ProductIngestMessage>, env: Env, _ctx: ExecutionContext) {
        for (const message of batch.messages) {
            if (!isProductIngestMessage(message.body)) {
                console.error("Invalid product ingestion message payload", message.body);
                message.ack();
                continue;
            }

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
        }
    },
};

function isProductIngestMessage(payload: unknown): payload is ProductIngestMessage {
    if (typeof payload !== "object" || payload === null) {
        return false;
    }

    const provider = (payload as { provider?: unknown }).provider;
    return typeof provider === "string" && isProvider(provider);
}

function isProvider(provider: string): provider is Provider {
    return INGEST_PROVIDERS.includes(provider as Provider);
}

function calculateRetryDelaySeconds(attempts: number): number {
    const exponent = Math.max(attempts - 1, 0);
    return Math.min(RETRY_BASE_DELAY_SECONDS * 2 ** exponent, RETRY_MAX_DELAY_SECONDS);
}

async function runProviderPipeline(provider: Provider, env: Env): Promise<void> {
    switch (provider) {
        case "esimaccess":
            await runEsimAccessPipeline(env);
            break;
        case "esimcard":
            await runEsimCardPipeline(env);
            break;
        case "esimgo":
            await runEsimGoPipeline(env);
            break;
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
