import { resolveRegionFromCountryCodes } from "./region.ts";
import { loadProducts, normalizeCountryCode, normalizeSpeedList } from "./util.ts";
import type {
    CanonicalProduct,
    CanonicalProductBatch,
    CanonicalProductCountry,
    CanonicalProductCountryNetwork,
    CoverageType,
    EsimGoCountryEntry,
    EsimGoProduct,
    EsimGoProductList,
    EsimGoResponse,
    LoadProductsOptions,
    ProductType,
    RegionName,
} from "./types.ts";

type UnlimitedRule = {
    allowance: number;
    throttled: string;
};

const ESIMGO_PER_PAGE = 6000;

const UNLIMITED_GROUP_RULES: Record<string, UnlimitedRule> = {
    "Standard Unlimited Lite": {
        allowance: 1024,
        throttled: "512kbps",
    },
    "Standard Unlimited Essential": {
        allowance: 1024,
        throttled: "1.25mbps",
    },
    "Standard Unlimited Plus": {
        allowance: 2048,
        throttled: "2mbps",
    },
};

const REGION_MAP: Record<string, RegionName> = {
    "Africa": "Africa",
    "Asia": "Asia",
    "Caribbean": "Caribbean",
    "CENAM": "North America",
    "CIS": "Asia",
    "Europe": "Europe",
    "Europe Extra": "Europe",
    "Europe Lite": "Europe",
    "Global": "Global",
    "Middle East": "Middle East",
    "North America": "North America",
    "Oceania": "Oceania",
    "South America": "South America",
    "Europe + USA + Business Hubs": "Global",
    "South East Europe": "Europe",
    "Europe + USA": "Europe",
    "Global - Light": "Global",
    "Global - Max": "Global",
    "Global - Standard": "Global",
    "Americas + US + CA": "South America"
};

export interface EsimGoLoadOptions {
    url: string;
    apiKey: string;
    apiKeyHeader?: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    retries?: number;
}

export async function loadEsimGoProducts(options: EsimGoLoadOptions): Promise<EsimGoProductList> {
    const response = await fetchEsimGoCatalogue(options);
    return response.bundles;
}

export async function fetchEsimGoCatalogue(
    options: EsimGoLoadOptions,
): Promise<EsimGoResponse> {
    const query = {
        ...(options.query ?? {}),
        perPage: String(ESIMGO_PER_PAGE),
    };

    const requestOptions: LoadProductsOptions<EsimGoResponse> = {
        url: options.url,
        method: options.method,
        headers: options.headers,
        query,
        body: options.body,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        parseAs: "json",
        auth: {
            type: "apiKeyHeader",
            header: options.apiKeyHeader ?? "X-API-Key",
            value: options.apiKey,
        },
        mapResponse: (raw) => transformEsimGoResponse(raw as EsimGoResponse),
    };

    return loadProducts(requestOptions);
}

function transformEsimGoResponse(raw: EsimGoResponse): EsimGoResponse {
    return {
        bundles: raw.bundles,
        pageCount: toNullableInteger(raw.pageCount),
        rows: toNullableInteger(raw.rows),
        pageSize: toNullableInteger(raw.pageSize),
    };
}

export function mapEsimGoProducts(raw: EsimGoProductList): CanonicalProductBatch {
    const products: CanonicalProduct[] = [];
    const countries: CanonicalProductCountry[] = [];
    const networks: CanonicalProductCountryNetwork[] = [];

    for (const rawProduct of raw) {
        const product = normalizeEsimGoProduct(rawProduct);
        const countryEntries = selectCountryEntries(product);
        const countryCodes = extractCountryCodes(countryEntries);
        if (countryCodes.length === 0) {
            throw new Error(`eSIMGo product '${product.name}' has no countries`);
        }

        const coverage = mapCoverage(countryCodes);
        const { allowance, throttled } = mapAllowanceAndThrottle(product);
        const capabilities = mapCapabilities(product.allowances);

        const mapped: CanonicalProduct = {
            provider: "esimgo",
            name: product.name,
            type: mapType(product.unlimited),
            coverage,
            // Legacy behavior (provider label): coverage === "REGION" ? mapRegion(product) : null,
            region: coverage === "REGION" ? resolveRegionFromCountryCodes(countryCodes).region : null,
            allowance,
            throttled,
            voice: capabilities.voice,
            sms: capabilities.sms,
            topup: capabilities.topup,
            ip: capabilities.ip,
            price: decimalToPrice(product.price),
            currency: "USD",
            status: "DRAFT",
            validity: product.duration,
        };

        products.push(mapped);

        for (const code of countryCodes) {
            countries.push({
                productName: mapped.name,
                code,
            });
        }

        networks.push(...extractNetworks(mapped.name, countryEntries));
    }

    return {
        products,
        countries,
        networks,
    };
}

function mapCapabilities(allowances: EsimGoProduct["allowances"]): Pick<CanonicalProduct, "voice" | "sms" | "topup" | "ip"> {
    const allowanceTypes = new Set(allowances.map((allowance) => allowance.type));

    return {
        voice: allowanceTypes.has("VOICE"),
        sms: allowanceTypes.has("SMS"),
        topup: false,
        ip: [],
    };
}

function mapCoverage(countryCodes: string[]): CoverageType {
    return countryCodes.length === 1 ? "COUNTRY" : "REGION";
}

function selectCountryEntries(product: EsimGoProduct): EsimGoCountryEntry[] {
    if (product.roamingEnabled && product.roamingEnabled.length > 0) {
        return product.roamingEnabled;
    }
    return product.countries;
}

function extractCountryCodes(entries: EsimGoCountryEntry[]): string[] {
    const unique = new Set<string>();

    for (const entry of entries) {
        const code = normalizeCountryCode(entry.country.iso);
        if (code.length > 0) {
            unique.add(code);
        }
    }

    return Array.from(unique);
}

function mapType(unlimited: boolean): ProductType {
    return unlimited ? "DAILY" : "FIXED";
}

function mapAllowanceAndThrottle(product: EsimGoProduct): { allowance: number; throttled: string | null } {
    if (!product.unlimited) {
        return {
            allowance: normalizeEsimGoAmountToMb(product.dataAmount),
            throttled: null,
        };
    }

    const group = product.group.find((value) => value in UNLIMITED_GROUP_RULES);
    if (!group) {
        throw new Error(`Unknown eSIMGo unlimited group for '${product.name}'`);
    }

    const rule = UNLIMITED_GROUP_RULES[group];
    return {
        allowance: rule.allowance,
        throttled: rule.throttled,
    };
}

function normalizeEsimGoAmountToMb(value: number): number {
    return Math.round((value / 1000) * 1024);
}

// Legacy provider-label mapper kept for quick rollback.
function mapRegion(product: EsimGoProduct): RegionName {
    const label = product.countries.find((entry) => entry.country.region.trim().length > 0)?.country.region;
    if (!label) {
        throw new Error(`Missing eSIMGo region for '${product.name}'`);
    }

    const mapped = REGION_MAP[label];
    if (!mapped) {
        throw new Error(`Unknown eSIMGo region label '${label}' for '${product.name}'`);
    }

    return mapped;
}

function extractNetworks(productName: string, entries: EsimGoCountryEntry[]): CanonicalProductCountryNetwork[] {
    const result: CanonicalProductCountryNetwork[] = [];
    const dedupe = new Set<string>();

    for (const entry of entries) {
        const countryCode = normalizeCountryCode(entry.country.iso);
        if (countryCode.length === 0) {
            continue;
        }

        for (const network of entry.networks ?? []) {
            const name = (network.brandName ?? network.name)?.trim();
            if (!name) {
                continue;
            }

            const key = `${countryCode}::${name}`;
            if (dedupe.has(key)) {
                continue;
            }
            dedupe.add(key);

            result.push({
                productName,
                countryCode,
                name,
                speeds: normalizeSpeedList(network.speeds),
            });
        }
    }

    return result;
}

function decimalToPrice(value: number): number {
    return Math.round(value * 10000);
}

function normalizeEsimGoProduct(value: unknown): EsimGoProduct {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid eSIMGo bundle: expected object");
    }

    const raw = value as Record<string, unknown>;

    const name = asString(raw.name);
    if (!name) {
        throw new Error("Invalid eSIMGo bundle: missing name");
    }

    const groups = asStringArray(raw.groups);
    const group = groups.length > 0 ? groups : asStringArray(raw.group);

    return {
        name,
        description: asString(raw.description) ?? "",
        countries: normalizeCountryEntries(raw.countries),
        roamingEnabled: normalizeOptionalCountryEntries(raw.roamingEnabled),
        dataAmount: asNumber(raw.dataAmount) ?? 0,
        duration: asNumber(raw.duration) ?? 0,
        unlimited: asBoolean(raw.unlimited) ?? false,
        group,
        price: asNumber(raw.price) ?? 0,
        allowances: normalizeAllowances(raw.allowances),
    };
}

function normalizeCountryEntries(value: unknown): EsimGoCountryEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const result: EsimGoCountryEntry[] = [];
    for (const item of value) {
        const entry = normalizeCountryEntry(item);
        if (entry) {
            result.push(entry);
        }
    }
    return result;
}

function normalizeOptionalCountryEntries(value: unknown): EsimGoCountryEntry[] | null {
    if (value == null) {
        return null;
    }

    if (!Array.isArray(value)) {
        return null;
    }

    const entries = normalizeCountryEntries(value);
    return entries;
}

function normalizeCountryEntry(value: unknown): EsimGoCountryEntry | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const raw = value as Record<string, unknown>;
    const countryObj = (raw.country && typeof raw.country === "object")
        ? (raw.country as Record<string, unknown>)
        : raw;

    const iso = asString(countryObj.iso);
    if (!iso) {
        return null;
    }

    const country = {
        name: asString(countryObj.name) ?? iso,
        region: asString(countryObj.region) ?? "",
        iso,
    };

    return {
        country,
        networks: normalizeNetworks(raw.networks),
        potentialNetworks: Array.isArray(raw.potentialNetworks) ? raw.potentialNetworks : [],
    };
}

function normalizeNetworks(value: unknown): EsimGoCountryEntry["networks"] {
    if (!Array.isArray(value)) {
        return null;
    }

    const result: NonNullable<EsimGoCountryEntry["networks"]> = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }

        const raw = item as Record<string, unknown>;
        const name = asString(raw.name);
        const brandName = asString(raw.brandName);
        if (!name && !brandName) {
            continue;
        }

        result.push({
            name: name ?? brandName ?? "",
            brandName: brandName ?? undefined,
            speeds: asStringArray(raw.speeds),
        });
    }

    return result;
}

function normalizeAllowances(value: unknown): EsimGoProduct["allowances"] {
    if (!Array.isArray(value)) {
        return [];
    }

    const result: EsimGoProduct["allowances"] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }

        const raw = item as Record<string, unknown>;
        result.push({
            type: asString(raw.type) ?? "",
            service: asString(raw.service) ?? "",
            description: asString(raw.description) ?? "",
            amount: asNumber(raw.amount) ?? 0,
            unit: asString(raw.unit) ?? "",
            unlimited: asBoolean(raw.unlimited) ?? false,
        });
    }

    return result;
}

function asString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === "string");
}
