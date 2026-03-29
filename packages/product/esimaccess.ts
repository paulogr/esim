import { resolveRegionFromCountryCodes } from "./region.ts";
import { loadProducts, normalizeCountryCode, normalizeSpeedList } from "./util.ts";
import type {
    CanonicalProduct,
    CanonicalProductBatch,
    CanonicalProductCountry,
    CanonicalProductCountryNetwork,
    CoverageType,
    EsimAccessPackage,
    EsimAccessResponse,
    LoadProductsOptions,
    ProductType,
    RegionName,
} from "./types.ts";

export interface EsimAccessLoadOptions {
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

const DATA_TYPE_MAP: Record<number, ProductType> = {
    1: "FIXED",
    2: "DAILY",
};

export async function loadEsimAccessProducts(options: EsimAccessLoadOptions): Promise<EsimAccessResponse> {
    const requestOptions: LoadProductsOptions<EsimAccessResponse> = {
        url: options.url,
        method: options.method,
        headers: options.headers,
        query: options.query,
        body: options.body,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        parseAs: "json",
        auth: {
            type: "apiKeyHeader",
            header: options.apiKeyHeader ?? "RT-AccessCode",
            value: options.apiKey,
        },
        mapResponse: (raw) => transformEsimAccessResponse(raw),
    };

    return loadProducts(requestOptions);
}

function transformEsimAccessResponse(raw: unknown): EsimAccessResponse {
    if (!raw || typeof raw !== "object") {
        throw new Error("Invalid eSIMAccess response: expected object");
    }

    const response = raw as Record<string, unknown>;
    const obj = response.obj && typeof response.obj === "object"
        ? (response.obj as Record<string, unknown>)
        : {};

    return {
        success: response.success === true,
        errorCode: normalizeNullableValue(response.errorCode),
        errorMsg: normalizeNullableValue(response.errorMsg),
        obj: {
            packageList: Array.isArray(obj.packageList)
                ? (obj.packageList as EsimAccessPackage[])
                : [],
        },
    };
}

const REGION_PREFIX_RULES: ReadonlyArray<readonly [prefix: string, region: RegionName]> = [
    ["EU-", "Europe"],
    ["AS-", "Asia"],
    ["AF-", "Africa"],
    ["ME-", "Middle East"],
    ["NA-", "North America"],
    ["SA-", "South America"],
    ["CB-", "Caribbean"],
    ["GL-", "Global"],
    ["O-OC-", "Oceania"],
    ["AUNZ-", "Oceania"],
    ["USCA-", "North America"],
    ["CNJPKR-", "Asia"],
    ["CN-", "Asia"],
    ["SGMYTH-", "Asia"],
    ["SGMY-", "Asia"],
    ["SGMYVNTHID-", "Asia"],
    ["CNHK-", "Asia"],
    ["SAAEQAKWOMBH-", "Middle East"],
];

export function mapEsimAccessProducts(raw: EsimAccessResponse): CanonicalProductBatch {
    if (!raw.success) {
        throw new Error(`eSIMAccess response not successful: ${raw.errorMsg ?? "unknown error"}`);
    }

    const packageList = raw.obj?.packageList ?? [];
    const products: CanonicalProduct[] = [];
    const countries: CanonicalProductCountry[] = [];
    const networks: CanonicalProductCountryNetwork[] = [];

    for (const pkg of packageList) {
        const countryCodes = extractCountryCodes(pkg);
        if (countryCodes.length === 0) {
            throw new Error(`eSIMAccess package '${pkg.slug}' has no countries`);
        }

        const coverage = mapCoverage(countryCodes);
        // Legacy behavior (slug prefix): const region = coverage === "REGION" ? mapRegionFromSlug(pkg.slug) : null;
        const region = coverage === "REGION" ? resolveRegionFromCountryCodes(countryCodes).region : null;

        const mapped: CanonicalProduct = {
            provider: "esimaccess",
            name: pkg.slug,
            type: mapType(pkg.dataType),
            coverage,
            region,
            allowance: normalizeBytesToMb(pkg.volume),
            throttled: normalizeNullableText(pkg.fupPolicy),
            voice: false,
            sms: mapSms(pkg.smsStatus),
            topup: mapTopup(pkg.supportTopUpType),
            ip: mapIpExport(pkg.ipExport),
            price: pkg.price,
            currency: normalizeNullableText(pkg.currencyCode) ?? "USD",
            status: "DRAFT",
            validity: pkg.duration,
        };

        products.push(mapped);

        for (const code of countryCodes) {
            countries.push({
                productName: mapped.name,
                code,
            });
        }

        networks.push(...extractNetworks(mapped.name, pkg));
    }

    return {
        products,
        countries,
        networks,
    };
}

function mapCoverage(countryCodes: string[]): CoverageType {
    return countryCodes.length === 1 ? "COUNTRY" : "REGION";
}

function extractCountryCodes(pkg: EsimAccessPackage): string[] {
    const unique = new Set<string>();

    for (const location of pkg.locationNetworkList ?? []) {
        const code = normalizeCountryCode(location.locationCode);
        if (code.length > 0) {
            unique.add(code);
        }
    }

    return Array.from(unique);
}

function extractNetworks(productName: string, pkg: EsimAccessPackage): CanonicalProductCountryNetwork[] {
    const result: CanonicalProductCountryNetwork[] = [];
    const dedupe = new Set<string>();

    for (const location of pkg.locationNetworkList ?? []) {
        const countryCode = normalizeCountryCode(location.locationCode);
        if (countryCode.length === 0) {
            continue;
        }

        for (const operator of location.operatorList ?? []) {
            const name = normalizeNullableText(operator.operatorName);
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
                speeds: normalizeSpeedList([operator.networkType]),
            });
        }
    }

    return result;
}

function mapType(dataType: number): ProductType {
    const mapped = DATA_TYPE_MAP[dataType];
    if (mapped) {
        return mapped;
    }
    throw new Error(`Unknown eSIMAccess dataType: ${dataType}`);
}

// Legacy slug-prefix mapper kept for quick rollback.
function mapRegionFromSlug(slug: string): RegionName {
    const prefix = slug.split("_")[0]?.toUpperCase() ?? "";

    for (const [rulePrefix, region] of REGION_PREFIX_RULES) {
        if (prefix.startsWith(rulePrefix)) {
            return region;
        }
    }

    throw new Error(`Unknown eSIMAccess regional slug: ${slug}`);
}

function normalizeBytesToMb(bytes: number): number {
    return bytes / 1024 / 1024;
}

function normalizeNullableText(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeNullableValue(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function mapSms(value: number | undefined): boolean {
    return value === 1;
}

function mapTopup(value: number | undefined): boolean {
    return value === 2;
}

function mapIpExport(value: string | null | undefined): string[] {
    if (!value) {
        return [];
    }

    const unique = new Set<string>();

    for (const item of value.split("/")) {
        const code = item.trim().toUpperCase();
        if (code.length > 0) {
            unique.add(code);
        }
    }

    return Array.from(unique);
}
