import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEsimCardProducts, mapEsimCardProducts } from "../esimcard.ts";
import type { EsimCardResponse } from "../types.ts";

function makeResponse(overrides: Partial<EsimCardResponse["data"]["countries"][number]["packages"][number]>): EsimCardResponse {
    return {
        status: true,
        data: {
            countries: [
                {
                    code: "it",
                    packages: [
                        {
                            id: "pkg_1",
                            name: "Italy 5GB",
                            price: 4.5,
                            data_quantity: 5,
                            data_unit: "GB",
                            package_validity: 7,
                            coverage: [
                                {
                                    code: "it",
                                    network_name: "Wind Tre",
                                    supported_networks_coverages: ["5G", "4g"],
                                },
                            ],
                            unlimited: false,
                            throttle: false,
                            unthrottle_data: null,
                            throttle_speed: null,
                            ...overrides,
                        },
                    ],
                },
            ],
        },
    };
}

describe("mapEsimCardProducts", () => {
    it("maps fixed single-country product", () => {
        const batch = mapEsimCardProducts(makeResponse({}));

        expect(batch.products).toHaveLength(1);
        expect(batch.products[0].provider).toBe("esimcard");
        expect(batch.products[0].name).toBe("pkg_1");
        expect(batch.products[0].type).toBe("FIXED");
        expect(batch.products[0].coverage).toBe("COUNTRY");
        expect(batch.products[0].region).toBeNull();
        expect(batch.products[0].allowance).toBe(5120);
        expect(batch.products[0].throttled).toBeNull();
        expect(batch.products[0].voice).toBe(false);
        expect(batch.products[0].sms).toBe(false);
        expect(batch.products[0].topup).toBe(false);
        expect(batch.products[0].ip).toEqual([]);
        expect(batch.products[0].price).toBe(45000);
        expect(batch.products[0].currency).toBe("USD");
        expect(batch.products[0].status).toBe("DRAFT");
        expect(batch.products[0].validity).toBe(7);
        expect(batch.countries).toEqual([{ productName: "pkg_1", code: "IT" }]);
        expect(batch.networks[0].name).toBe("Wind Tre");
        expect(batch.networks[0].speeds).toEqual(["4G", "5G"]);
    });

    it("maps unlimited product as daily with parsed cap and throttle", () => {
        const batch = mapEsimCardProducts(makeResponse({
            id: "pkg_daily",
            unlimited: true,
            throttle: true,
            unthrottle_data: "2GB",
            throttle_speed: "2mbps",
            data_quantity: -1,
            data_unit: "GB",
        }));

        expect(batch.products[0].type).toBe("DAILY");
        expect(batch.products[0].allowance).toBe(2048);
        expect(batch.products[0].throttled).toBe("2mbps");
    });

    it("uses zero allowance when daily cap is unknown", () => {
        const batch = mapEsimCardProducts(makeResponse({
            id: "pkg_uncapped",
            unlimited: true,
            throttle: false,
            unthrottle_data: "Unlimited",
            throttle_speed: null,
        }));

        expect(batch.products[0].type).toBe("DAILY");
        expect(batch.products[0].allowance).toBe(0);
        expect(batch.products[0].throttled).toBeNull();
    });

    it("maps region from country list for multi-country products", () => {
        const batch = mapEsimCardProducts(makeResponse({
            id: "pkg_region",
            coverage: [
                {
                    code: "de",
                    network_name: "Vodafone",
                    supported_networks_coverages: ["4G", "5G"],
                },
                {
                    code: "fr",
                    network_name: "Orange",
                    supported_networks_coverages: ["4G"],
                },
            ],
        }));

        expect(batch.products[0].coverage).toBe("REGION");
        expect(batch.products[0].region).toBe("Europe");
        expect(batch.countries.map((item) => item.code).sort()).toEqual(["DE", "FR"]);
    });

    it("falls back to parent country code when coverage is empty", () => {
        const batch = mapEsimCardProducts(makeResponse({
            id: "pkg_empty_coverage",
            coverage: [],
        }));

        expect(batch.products[0].coverage).toBe("COUNTRY");
        expect(batch.countries).toEqual([{ productName: "pkg_empty_coverage", code: "IT" }]);
        expect(batch.networks).toEqual([]);
    });

    it("throws for unknown fixed allowance unit", () => {
        expect(() => {
            mapEsimCardProducts(makeResponse({
                id: "pkg_bad_unit",
                data_unit: "KB",
                data_quantity: 100,
            }));
        }).toThrow(/Unknown eSIMCard data_unit/);
    });
});

describe("loadEsimCardProducts", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses bearer authorization by default", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(makeResponse({})), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));

        vi.stubGlobal("fetch", fetchMock);

        const response = await loadEsimCardProducts({
            url: "https://portal.esimcard.com/api/reseller/package/list",
            apiKey: "test-key",
            method: "GET",
        });

        expect(response.status).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = new Headers(init.headers);
        expect(headers.get("Authorization")).toBe("Bearer test-key");
        expect(headers.get("X-API-Key")).toBeNull();
    });

    it("ignores apiKeyHeader override and keeps bearer authorization", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(makeResponse({})), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));

        vi.stubGlobal("fetch", fetchMock);

        const response = await loadEsimCardProducts({
            url: "https://portal.esimcard.com/api/reseller/package/list",
            apiKey: "override-key",
            apiKeyHeader: "X-Partner-Key",
            method: "GET",
        });

        expect(response.status).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = new Headers(init.headers);
        expect(headers.get("Authorization")).toBe("Bearer override-key");
        expect(headers.get("X-Partner-Key")).toBeNull();
        expect(headers.get("X-API-Key")).toBeNull();
    });
});
