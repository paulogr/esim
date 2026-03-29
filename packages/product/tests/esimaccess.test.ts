import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEsimAccessProducts, mapEsimAccessProducts } from "../esimaccess.ts";
import type { EsimAccessResponse } from "../types.ts";

function makeResponse(overrides: Partial<EsimAccessResponse["obj"]["packageList"][number]>): EsimAccessResponse {
    return {
        success: true,
        errorCode: null,
        errorMsg: null,
        obj: {
            packageList: [
                {
                    packageCode: "PKG1",
                    slug: "EU-30_10_30",
                    name: "Europe 10GB 30Days",
                    price: 99000,
                    currencyCode: "USD",
                    volume: 10737418240,
                    dataType: 1,
                    duration: 30,
                    durationUnit: "DAY",
                    location: "DE,FR",
                    locationCode: "EU-30",
                    fupPolicy: "",
                    locationNetworkList: [
                        {
                            locationName: "Germany",
                            locationCode: "de",
                            operatorList: [{ operatorName: "Vodafone", networkType: "5g" }],
                        },
                        {
                            locationName: "France",
                            locationCode: "FR",
                            operatorList: [{ operatorName: "Orange", networkType: "4G" }],
                        },
                    ],
                    ...overrides,
                },
            ],
        },
    };
}

describe("mapEsimAccessProducts", () => {
    it("maps fixed regional package", () => {
        const batch = mapEsimAccessProducts(makeResponse({}));

        expect(batch.products).toHaveLength(1);
        expect(batch.products[0].provider).toBe("esimaccess");
        expect(batch.products[0].name).toBe("EU-30_10_30");
        expect(batch.products[0].type).toBe("FIXED");
        expect(batch.products[0].coverage).toBe("REGION");
        expect(batch.products[0].region).toBe("Europe");
        expect(batch.products[0].allowance).toBe(10240);
        expect(batch.products[0].voice).toBe(false);
        expect(batch.products[0].sms).toBe(false);
        expect(batch.products[0].topup).toBe(false);
        expect(batch.products[0].ip).toEqual([]);
        expect(batch.products[0].status).toBe("DRAFT");
        expect(batch.products[0].price).toBe(99000);
        expect(batch.products[0].currency).toBe("USD");
        expect(batch.products[0].validity).toBe(30);
        expect(batch.countries.map((item) => item.code).sort()).toEqual(["DE", "FR"]);
    });

    it("maps daily single-country package", () => {
        const batch = mapEsimAccessProducts(
            makeResponse({
                slug: "AU_10_Daily",
                dataType: 2,
                duration: 1,
                volume: 10737418240,
                fupPolicy: "384 Kbps",
                locationCode: "AU",
                location: "AU",
                locationNetworkList: [
                    {
                        locationName: "Australia",
                        locationCode: "au",
                        operatorList: [{ operatorName: "Optus", networkType: "5G" }],
                    },
                ],
            }),
        );

        expect(batch.products[0].type).toBe("DAILY");
        expect(batch.products[0].coverage).toBe("COUNTRY");
        expect(batch.products[0].region).toBeNull();
        expect(batch.products[0].throttled).toBe("384 Kbps");
        expect(batch.products[0].allowance).toBe(10240);
        expect(batch.countries.map((item) => item.code)).toEqual(["AU"]);
    });

    it("maps region from country list instead of slug prefix", () => {
        const oceania = mapEsimAccessProducts(makeResponse({
            slug: "AUNZ-2_1_7",
            locationCode: "AUNZ-2",
            locationNetworkList: [
                {
                    locationName: "Australia",
                    locationCode: "AU",
                    operatorList: [{ operatorName: "Optus", networkType: "5G" }],
                },
                {
                    locationName: "New Zealand",
                    locationCode: "NZ",
                    operatorList: [{ operatorName: "Spark", networkType: "5G" }],
                },
            ],
        }));
        const global = mapEsimAccessProducts(makeResponse({
            slug: "GL-120_1_7",
            locationCode: "GL-120",
            locationNetworkList: [
                {
                    locationName: "Germany",
                    locationCode: "DE",
                    operatorList: [{ operatorName: "Vodafone", networkType: "5G" }],
                },
                {
                    locationName: "United States",
                    locationCode: "US",
                    operatorList: [{ operatorName: "AT&T", networkType: "5G" }],
                },
                {
                    locationName: "Thailand",
                    locationCode: "TH",
                    operatorList: [{ operatorName: "AIS", networkType: "5G" }],
                },
            ],
        }));
        const middleEast = mapEsimAccessProducts(
            makeResponse({
                slug: "SAAEQAKWOMBH-6_1_7",
                locationCode: "SAAEQAKWOMBH-6",
                locationNetworkList: [
                    {
                        locationName: "United Arab Emirates",
                        locationCode: "AE",
                        operatorList: [{ operatorName: "du", networkType: "5G" }],
                    },
                    {
                        locationName: "Saudi Arabia",
                        locationCode: "SA",
                        operatorList: [{ operatorName: "stc", networkType: "5G" }],
                    },
                    {
                        locationName: "Oman",
                        locationCode: "OM",
                        operatorList: [{ operatorName: "Omantel", networkType: "5G" }],
                    },
                ],
            }),
        );

        expect(oceania.products[0].region).toBe("Oceania");
        expect(global.products[0].region).toBe("Global");
        expect(middleEast.products[0].region).toBe("Middle East");
    });

    it("normalizes speeds and deduplicates networks by country/name", () => {
        const batch = mapEsimAccessProducts(
            makeResponse({
                locationNetworkList: [
                    {
                        locationName: "Germany",
                        locationCode: "DE",
                        operatorList: [
                            { operatorName: "Vodafone", networkType: "5g" },
                            { operatorName: "Vodafone", networkType: "4G" },
                            { operatorName: "Telekom", networkType: "2G" },
                        ],
                    },
                ],
                location: "DE",
                locationCode: "DE",
            }),
        );

        expect(batch.networks).toHaveLength(2);
        const vodafone = batch.networks.find((item) => item.name === "Vodafone");
        const telekom = batch.networks.find((item) => item.name === "Telekom");

        expect(vodafone?.speeds).toEqual(["5G"]);
        expect(telekom?.speeds).toEqual(["2G"]);
    });

    it("does not depend on slug prefix for regional classification", () => {
        const batch = mapEsimAccessProducts(
            makeResponse({
                slug: "UNKNOWN-1_1_7",
                locationCode: "UNKNOWN-1",
                locationNetworkList: [
                    {
                        locationName: "Germany",
                        locationCode: "DE",
                        operatorList: [{ operatorName: "Vodafone", networkType: "5G" }],
                    },
                    {
                        locationName: "France",
                        locationCode: "FR",
                        operatorList: [{ operatorName: "Orange", networkType: "5G" }],
                    },
                ],
            }),
        );

        expect(batch.products[0].region).toBe("Europe");
    });
});

describe("loadEsimAccessProducts", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses RT-AccessCode header by default", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(makeResponse({})), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));

        vi.stubGlobal("fetch", fetchMock);

        const response = await loadEsimAccessProducts({
            url: "https://api.esimaccess.com/api/v1/open/package/list",
            apiKey: "test-key",
            method: "POST",
            body: {},
        });

        expect(response.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = new Headers(init.headers);
        expect(headers.get("RT-AccessCode")).toBe("test-key");
    });

    it("uses custom api key header when provided", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(makeResponse({})), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));

        vi.stubGlobal("fetch", fetchMock);

        const response = await loadEsimAccessProducts({
            url: "https://api.esimaccess.com/api/v1/open/package/list",
            apiKey: "override-key",
            apiKeyHeader: "X-API-Key",
            method: "POST",
            body: {},
        });

        expect(response.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = new Headers(init.headers);
        expect(headers.get("X-API-Key")).toBe("override-key");
        expect(headers.get("RT-AccessCode")).toBeNull();
    });
});
