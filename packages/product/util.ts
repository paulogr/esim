import type { AuthStrategy, LoadProductsOptions, NetworkSpeed } from "./types.ts";

const SPEED_ORDER: readonly NetworkSpeed[] = ["2G", "3G", "4G", "5G"];

export class HttpRequestError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly body: string;

    constructor(status: number, statusText: string, body: string) {
        super(`HTTP ${status} ${statusText}`);
        this.name = "HttpRequestError";
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}

export async function loadProducts<TResponse>(options: LoadProductsOptions<TResponse>): Promise<TResponse> {
    const retries = options.retries ?? 0;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs ?? 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(buildUrl(options.url, options.query, options.auth), {
                method: options.method ?? "GET",
                headers: buildHeaders(options.headers, options.auth),
                body: buildBody(options.body, options.headers),
                signal: controller.signal,
            });

            if (!response.ok) {
                const body = await response.text();
                const error = new HttpRequestError(response.status, response.statusText, body);
                if (attempt < retries && isRetryableStatus(response.status)) {
                    lastError = error;
                    continue;
                }
                throw error;
            }

            const parsed = options.parseAs === "text"
                ? await response.text()
                : await response.json();

            return options.mapResponse ? options.mapResponse(parsed) : (parsed as TResponse);
        } catch (error) {
            const canRetry = attempt < retries && isRetryableError(error);
            if (!canRetry) {
                throw error;
            }
            lastError = error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export function normalizeCountryCode(value: string): string {
    return value.trim().toUpperCase();
}

export function normalizeSpeedList(values: ReadonlyArray<string> | null | undefined): NetworkSpeed[] {
    if (!values || values.length === 0) {
        return [];
    }

    const valid = new Set<NetworkSpeed>();

    for (const value of values) {
        const normalized = value.trim().toUpperCase();
        if (normalized === "2G" || normalized === "3G" || normalized === "4G" || normalized === "5G") {
            valid.add(normalized);
        }
    }

    return SPEED_ORDER.filter((speed) => valid.has(speed));
}

function buildUrl(baseUrl: string, query: Record<string, string> | undefined, auth: AuthStrategy | undefined): string {
    const url = new URL(baseUrl);

    if (query) {
        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, value);
        }
    }

    if (auth?.type === "query") {
        url.searchParams.set(auth.key, auth.value);
    }

    return url.toString();
}

function buildHeaders(
    headers: Record<string, string> | undefined,
    auth: AuthStrategy | undefined,
): Headers {
    const result = new Headers(headers);

    if (!auth || auth.type === "none" || auth.type === "query") {
        return result;
    }

    if (auth.type === "apiKeyHeader") {
        result.set(auth.header, auth.value);
        return result;
    }

    result.set("Authorization", `Bearer ${auth.token}`);
    return result;
}

function buildBody(body: unknown, headers: Record<string, string> | undefined): BodyInit | undefined {
    if (body === undefined || body === null) {
        return undefined;
    }

    if (typeof body === "string") {
        return body;
    }

    const contentType = findContentType(headers);
    if (contentType && contentType.toLowerCase().includes("application/json")) {
        return JSON.stringify(body);
    }

    return JSON.stringify(body);
}

function findContentType(headers: Record<string, string> | undefined): string | undefined {
    if (!headers) {
        return undefined;
    }

    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "content-type") {
            return value;
        }
    }

    return undefined;
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
    if (error instanceof HttpRequestError) {
        return isRetryableStatus(error.status);
    }

    if (error instanceof DOMException && error.name === "AbortError") {
        return true;
    }

    return error instanceof TypeError;
}
