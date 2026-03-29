import { resolveRegionFromCountryCodes } from "./region.ts";
import { loadProducts, normalizeCountryCode, normalizeSpeedList } from "./util.ts";
import type {
    CanonicalProduct,
    CanonicalProductBatch,
    CanonicalProductCountry,
    CanonicalProductCountryNetwork,
    CoverageType,
    EsimCardCountry,
    EsimCardPackage,
    EsimCardResponse,
    LoadProductsOptions,
    ProductType,
} from "./types.ts";

export interface EsimCardLoadOptions {
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

const DAILY_UNKNOWN_ALLOWANCE = 0;

export async function loadEsimCardProducts(options: EsimCardLoadOptions): Promise<EsimCardResponse> {
    const requestOptions: LoadProductsOptions<EsimCardResponse> = {
        url: options.url,
        method: options.method,
        headers: options.headers,
        query: options.query,
        body: options.body,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        parseAs: "json",
        auth: {
            type: "bearer",
            token: options.apiKey,
        },
        mapResponse: (raw) => transformEsimCardResponse(raw),
    };

    return loadProducts(requestOptions);
}

function transformEsimCardResponse(raw: unknown): EsimCardResponse {
    if (!raw || typeof raw !== "object") {
        throw new Error("Invalid eSIMCard response: expected object");
    }

    const response = raw as Record<string, unknown>;
    const data = response.data && typeof response.data === "object"
        ? (response.data as Record<string, unknown>)
        : {};

    return {
        status: response.status === true,
        data: {
            countries: normalizeCountries(data.countries),
        },
    };
}

export function mapEsimCardProducts(raw: EsimCardResponse): CanonicalProductBatch {
    if (!raw.status) {
        throw new Error("eSIMCard response not successful");
    }

    const products: CanonicalProduct[] = [];
    const countries: CanonicalProductCountry[] = [];
    const networks: CanonicalProductCountryNetwork[] = [];

    for (const country of raw.data.countries) {
        const parentCountryCode = normalizeCountryCode(country.code);

        for (const pkg of country.packages) {
            const mappedType = mapType(pkg.unlimited);
            const countryCodes = extractCountryCodes(pkg, parentCountryCode);
            if (countryCodes.length === 0) {
                throw new Error(`eSIMCard package '${pkg.id}' has no countries`);
            }

            const coverage = mapCoverage(countryCodes);

            const mapped: CanonicalProduct = {
                provider: "esimcard",
                name: pkg.id,
                type: mappedType,
                coverage,
                // Legacy behavior: region: coverage === "REGION" ? "Unknow" : null,
                region: coverage === "REGION" ? resolveRegionFromCountryCodes(countryCodes).region : null,
                allowance: mapAllowance(pkg, mappedType),
                throttled: mapThrottled(pkg),
                voice: false,
                sms: false,
                topup: false,
                ip: [],
                price: decimalToPrice(pkg.price),
                currency: "USD",
                status: "DRAFT",
                validity: pkg.package_validity,
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

function mapType(unlimited: boolean): ProductType {
    return unlimited ? "DAILY" : "FIXED";
}

function extractCountryCodes(pkg: EsimCardPackage, parentCountryCode: string): string[] {
    const unique = new Set<string>();

    for (const coverage of pkg.coverage ?? []) {
        const code = normalizeCountryCode(coverage.code);
        if (code.length > 0) {
            unique.add(code);
        }
    }

    if (unique.size === 0 && parentCountryCode.length > 0) {
        unique.add(parentCountryCode);
    }

    return Array.from(unique);
}

function mapAllowance(pkg: EsimCardPackage, type: ProductType): number {
    if (type === "FIXED") {
        return mapFixedAllowance(pkg.data_quantity, pkg.data_unit, pkg.id);
    }

    return mapDailyAllowance(pkg.unthrottle_data);
}

function mapFixedAllowance(quantity: number, unit: string, packageId: string): number {
    const normalizedUnit = unit.trim().toUpperCase();
    if (normalizedUnit === "MB") {
        return quantity;
    }
    if (normalizedUnit === "GB") {
        return quantity * 1024;
    }

    throw new Error(`Unknown eSIMCard data_unit '${unit}' for '${packageId}'`);
}

function mapDailyAllowance(value: string | null): number {
    const parsed = parseAllowanceToMb(value);
    return parsed ?? DAILY_UNKNOWN_ALLOWANCE;
}

function parseAllowanceToMb(value: string | null): number | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim().toUpperCase();
    if (normalized.length === 0 || normalized === "UNLIMITED") {
        return null;
    }

    const match = normalized.match(/^(\d+(?:\.\d+)?)(MB|GB)$/);
    if (!match) {
        return null;
    }

    const quantity = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(quantity)) {
        return null;
    }

    return unit === "GB" ? quantity * 1024 : quantity;
}

function mapThrottled(pkg: EsimCardPackage): string | null {
    if (!pkg.throttle) {
        return null;
    }
    return normalizeNullableText(pkg.throttle_speed);
}

function extractNetworks(productName: string, pkg: EsimCardPackage): CanonicalProductCountryNetwork[] {
    const result: CanonicalProductCountryNetwork[] = [];
    const dedupe = new Set<string>();

    for (const coverage of pkg.coverage ?? []) {
        const countryCode = normalizeCountryCode(coverage.code);
        if (countryCode.length === 0) {
            continue;
        }

        const name = normalizeNullableText(coverage.network_name);
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
            speeds: normalizeSpeedList(coverage.supported_networks_coverages),
        });
    }

    return result;
}

function normalizeCountries(value: unknown): EsimCardCountry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const countries: EsimCardCountry[] = [];

    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }

        const raw = item as Record<string, unknown>;
        countries.push({
            code: asString(raw.code) ?? "",
            packages: normalizePackages(raw.packages),
        });
    }

    return countries;
}

function normalizePackages(value: unknown): EsimCardPackage[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const packages: EsimCardPackage[] = [];

    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }

        const raw = item as Record<string, unknown>;
        const id = asString(raw.id);
        if (!id) {
            continue;
        }

        packages.push({
            id,
            name: asString(raw.name) ?? "",
            price: asNumber(raw.price) ?? 0,
            data_quantity: asNumber(raw.data_quantity) ?? 0,
            data_unit: asString(raw.data_unit) ?? "",
            package_validity: asNumber(raw.package_validity) ?? 0,
            coverage: normalizeCoverage(raw.coverage),
            unlimited: asBoolean(raw.unlimited) ?? false,
            throttle: asBoolean(raw.throttle) ?? false,
            unthrottle_data: asString(raw.unthrottle_data),
            throttle_speed: asString(raw.throttle_speed),
        });
    }

    return packages;
}

function normalizeCoverage(value: unknown): EsimCardPackage["coverage"] {
    if (!Array.isArray(value)) {
        return [];
    }

    const coverage: EsimCardPackage["coverage"] = [];

    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }

        const raw = item as Record<string, unknown>;

        coverage.push({
            code: asString(raw.code) ?? "",
            network_name: asString(raw.network_name) ?? "",
            supported_networks_coverages: asStringArray(raw.supported_networks_coverages),
        });
    }

    return coverage;
}

function decimalToPrice(value: number): number {
    return Math.round(value * 10000);
}

function normalizeNullableText(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function asString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
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
