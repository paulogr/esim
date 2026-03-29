import { persistBatch } from "./db.ts";
import { loadEsimAccessProducts, mapEsimAccessProducts } from "./esimaccess.ts";
import { loadEsimCardProducts, mapEsimCardProducts } from "./esimcard.ts";
import { loadEsimGoProducts, mapEsimGoProducts } from "./esimgo.ts";

const ESIMACCESS_PRODUCTS_URL = "https://api.esimaccess.com/api/v1/open/package/list";
const ESIMCARD_PRODUCTS_URL = "https://portal.esimcard.com/api/developer/reseller/pricing";
const ESIMGO_PRODUCTS_URL = "https://api.esim-go.com/v2.5/catalogue";

export default {
    async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
        const results = await Promise.allSettled([
            runEsimAccessPipeline(env),
            runEsimCardPipeline(env),
            runEsimGoPipeline(env),
        ]);

        for (const result of results) {
            if (result.status === "rejected") {
                console.error("Provider ingestion failed", result.reason);
            }
        }
    },
};

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
