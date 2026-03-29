import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRequestError, loadProducts, normalizeCountryCode, normalizeSpeedList } from "../util.ts";

describe("normalize helpers", () => {
    it("normalizes country code", () => {
        expect(normalizeCountryCode(" br ")).toBe("BR");
    });

    it("normalizes speed list with dedupe and ordering", () => {
        expect(normalizeSpeedList(["5g", "2G", "4G", "4G", "unknown", "3g"]))
            .toEqual(["2G", "3G", "4G", "5G"]);
    });

    it("returns empty speed list for nullish values", () => {
        expect(normalizeSpeedList(undefined)).toEqual([]);
        expect(normalizeSpeedList(null)).toEqual([]);
    });
});

describe("loadProducts", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("loads JSON with api key header auth", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ ok: true, source: "header" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const data = await loadProducts<{ ok: boolean; source: string }>({
            url: "https://example.com/products",
            auth: { type: "apiKeyHeader", header: "X-API-KEY", value: "secret" },
            parseAs: "json",
        });

        expect(data).toEqual({ ok: true, source: "header" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://example.com/products");
        expect((init.headers as Headers).get("X-API-KEY")).toBe("secret");
    });

    it("adds auth query parameter and custom query parameters", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response("ok", { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const data = await loadProducts<string>({
            url: "https://example.com/products",
            query: { locale: "en" },
            auth: { type: "query", key: "apiKey", value: "q-secret" },
            parseAs: "text",
        });

        expect(data).toBe("ok");
        const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("locale=en");
        expect(url).toContain("apiKey=q-secret");
    });

    it("retries on retryable HTTP status and succeeds", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response("temporary", { status: 500, statusText: "Server Error" }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const data = await loadProducts<{ ok: boolean }>({
            url: "https://example.com/retry",
            retries: 1,
            parseAs: "json",
        });

        expect(data).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws HttpRequestError on non-retryable response", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response("bad request", { status: 400, statusText: "Bad Request" }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            loadProducts({
                url: "https://example.com/fail",
                retries: 2,
                parseAs: "json",
            }),
        ).rejects.toBeInstanceOf(HttpRequestError);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
