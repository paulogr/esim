import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEsimGoProducts, mapEsimGoProducts } from "../esimgo.ts";
import type { EsimGoProduct, EsimGoProductList } from "../types.ts";

function makeAllowance(type: string, unit = "MB"): EsimGoProduct["allowances"][number] {
    return {
        type,
        service: "STANDARD",
        description: `${type} allowance`,
        amount: 1,
        unit,
        unlimited: false,
    };
}

function makeProduct(overrides: Partial<EsimGoProduct>): EsimGoProduct {
    return {
        name: "esim_1GB_7D_IT_V2",
        description: "eSIM, 1GB, 7 Days, Italy, V2",
        countries: [
            {
                country: {
                    name: "Italy",
                    region: "Europe",
                    iso: "IT",
                },
                networks: [
                    {
                        name: "Wind Tre S.p.A.",
                        brandName: "Wind Tre",
                        speeds: ["2G", "4G", "5G"],
                    },
                ],
                potentialNetworks: [],
            },
        ],
        roamingEnabled: null,
        dataAmount: 1000,
        duration: 7,
        unlimited: false,
        group: ["Standard Fixed"],
        price: 1.17,
        allowances: [],
        ...overrides,
    };
}

function wrap(products: EsimGoProduct[]): EsimGoProductList {
    return products;
}

function makeRawBundle(name: string): Record<string, unknown> {
    return {
        name,
        description: `eSIM bundle ${name}`,
        countries: [{ name: "Italy", region: "Europe", iso: "IT" }],
        dataAmount: 1000,
        duration: 7,
        unlimited: false,
        groups: ["Standard Fixed"],
        price: 1.17,
        allowances: [],
    };
}

describe("loadEsimGoProducts", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("loads all pages using pageCount metadata", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                bundles: [makeRawBundle("page_1")],
                pageCount: 2,
                rows: 2,
                pageSize: 200,
            }), { status: 200, headers: { "Content-Type": "application/json" } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                bundles: [makeRawBundle("page_2")],
                pageCount: 2,
                rows: 2,
                pageSize: 200,
            }), { status: 200, headers: { "Content-Type": "application/json" } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                bundles: [],
                pageCount: 2,
                rows: 2,
                pageSize: 200,
            }), { status: 200, headers: { "Content-Type": "application/json" } }));

        vi.stubGlobal("fetch", fetchMock);

        const products = await loadEsimGoProducts({
            url: "https://api.esim-go.com/v2.5/catalogue",
            apiKey: "test-key",
            method: "GET",
        });

        expect(products.map((product) => product.name)).toEqual(["page_1", "page_2"]);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const [firstUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
        const [secondUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
        const [thirdUrl] = fetchMock.mock.calls[2] as [string, RequestInit];
        expect(new URL(firstUrl).searchParams.get("page")).toBe("1");
        expect(new URL(firstUrl).searchParams.get("perPage")).toBe("200");
        expect(new URL(secondUrl).searchParams.get("page")).toBe("2");
        expect(new URL(secondUrl).searchParams.get("perPage")).toBe("200");
        expect(new URL(thirdUrl).searchParams.get("page")).toBe("3");
        expect(new URL(thirdUrl).searchParams.get("perPage")).toBe("200");
    });

    it("falls back to empty-page stop when pageCount is missing", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                bundles: [makeRawBundle("only_page")],
            }), { status: 200, headers: { "Content-Type": "application/json" } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                bundles: [],
            }), { status: 200, headers: { "Content-Type": "application/json" } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                bundles: [makeRawBundle("speculative_page")],
            }), { status: 200, headers: { "Content-Type": "application/json" } }));

        vi.stubGlobal("fetch", fetchMock);

        const products = await loadEsimGoProducts({
            url: "https://api.esim-go.com/v2.5/catalogue",
            apiKey: "test-key",
            method: "GET",
        });

        expect(products.map((product) => product.name)).toEqual(["only_page"]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

describe("mapEsimGoProducts", () => {
    it("maps raw API bundle values without response parsing", () => {
        const batch = mapEsimGoProducts([
            makeRawBundle("raw_bundle_1") as unknown as EsimGoProduct,
        ]);

        expect(batch.products).toHaveLength(1);
        expect(batch.products[0].name).toBe("raw_bundle_1");
        expect(batch.countries.map((item) => item.code)).toEqual(["IT"]);
    });

    it("maps fixed single-country product", () => {
        const batch = mapEsimGoProducts(wrap([makeProduct({})]));

        expect(batch.products).toHaveLength(1);
        expect(batch.products[0].provider).toBe("esimgo");
        expect(batch.products[0].name).toBe("esim_1GB_7D_IT_V2");
        expect(batch.products[0].type).toBe("FIXED");
        expect(batch.products[0].coverage).toBe("COUNTRY");
        expect(batch.products[0].region).toBeNull();
        expect(batch.products[0].allowance).toBe(1024);
        expect(batch.products[0].throttled).toBeNull();
        expect(batch.products[0].voice).toBe(false);
        expect(batch.products[0].sms).toBe(false);
        expect(batch.products[0].topup).toBe(false);
        expect(batch.products[0].ip).toEqual([]);
        expect(batch.products[0].price).toBe(11700);
        expect(batch.products[0].currency).toBe("USD");
        expect(batch.products[0].status).toBe("DRAFT");
        expect(batch.products[0].validity).toBe(7);
        expect(batch.countries.map((item) => item.code)).toEqual(["IT"]);
    });

    it("maps canonical capabilities from allowances.type only", () => {
        const dataOnly = mapEsimGoProducts(
            wrap([
                makeProduct({
                    allowances: [makeAllowance("DATA")],
                }),
            ]),
        );

        expect(dataOnly.products[0].voice).toBe(false);
        expect(dataOnly.products[0].sms).toBe(false);
        expect(dataOnly.products[0].topup).toBe(false);
        expect(dataOnly.products[0].ip).toEqual([]);

        const withVoice = mapEsimGoProducts(
            wrap([
                makeProduct({
                    allowances: [makeAllowance("VOICE", "MINS")],
                }),
            ]),
        );

        expect(withVoice.products[0].voice).toBe(true);
        expect(withVoice.products[0].sms).toBe(false);

        const withSms = mapEsimGoProducts(
            wrap([
                makeProduct({
                    allowances: [makeAllowance("SMS", "SMS")],
                }),
            ]),
        );

        expect(withSms.products[0].voice).toBe(false);
        expect(withSms.products[0].sms).toBe(true);

        const withBoth = mapEsimGoProducts(
            wrap([
                makeProduct({
                    allowances: [makeAllowance("VOICE", "MINS"), makeAllowance("SMS", "SMS")],
                }),
            ]),
        );

        expect(withBoth.products[0].voice).toBe(true);
        expect(withBoth.products[0].sms).toBe(true);
    });

    it("maps regional product from roamingEnabled", () => {
        const batch = mapEsimGoProducts(
            wrap([
                makeProduct({
                    name: "esim_1GB_7D_REUP_V2",
                    countries: [
                        {
                            country: { name: "Europe+", region: "Europe", iso: "Europe+" },
                            networks: null,
                            potentialNetworks: [],
                        },
                    ],
                    roamingEnabled: [
                        {
                            country: { name: "Germany", region: "Europe", iso: "DE" },
                            networks: [{ name: "Vodafone GmbH", brandName: "Vodafone Germany", speeds: ["5G"] }],
                            potentialNetworks: [],
                        },
                        {
                            country: { name: "France", region: "Europe", iso: "FR" },
                            networks: [{ name: "Orange", brandName: "Orange", speeds: ["4G", "5G"] }],
                            potentialNetworks: [],
                        },
                    ],
                }),
            ]),
        );

        expect(batch.products[0].coverage).toBe("REGION");
        expect(batch.products[0].region).toBe("Europe");
        expect(batch.countries.map((item) => item.code).sort()).toEqual(["DE", "FR"]);
    });

    it("maps unlimited essential as daily with derived values", () => {
        const batch = mapEsimGoProducts(
            wrap([
                makeProduct({
                    name: "esim_ULE_3D_DE_V2",
                    dataAmount: -1,
                    duration: 3,
                    unlimited: true,
                    group: ["Standard Unlimited Essential"],
                    price: 4.04,
                }),
            ]),
        );

        expect(batch.products[0].type).toBe("DAILY");
        expect(batch.products[0].allowance).toBe(1024);
        expect(batch.products[0].throttled).toBe("1.25mbps");
        expect(batch.products[0].price).toBe(40400);
    });

    it("maps CENAM and CIS regional labels", () => {
        const cenam = mapEsimGoProducts(
            wrap([
                makeProduct({
                    countries: [{ country: { name: "CENAM", region: "CENAM", iso: "CENAM" }, networks: null, potentialNetworks: [] }],
                    roamingEnabled: [
                        {
                            country: { name: "United States", region: "North America", iso: "US" },
                            networks: [{ name: "Verizon", speeds: ["5G"] }],
                            potentialNetworks: [],
                        },
                        {
                            country: { name: "Canada", region: "North America", iso: "CA" },
                            networks: [{ name: "Rogers", speeds: ["4G", "5G"] }],
                            potentialNetworks: [],
                        },
                    ],
                }),
            ]),
        );

        const cis = mapEsimGoProducts(
            wrap([
                makeProduct({
                    countries: [{ country: { name: "CIS", region: "CIS", iso: "CIS" }, networks: null, potentialNetworks: [] }],
                    roamingEnabled: [
                        {
                            country: { name: "Kazakhstan", region: "Asia", iso: "KZ" },
                            networks: [{ name: "Beeline", speeds: ["4G"] }],
                            potentialNetworks: [],
                        },
                        {
                            country: { name: "Uzbekistan", region: "Asia", iso: "UZ" },
                            networks: [{ name: "Ucell", speeds: ["4G"] }],
                            potentialNetworks: [],
                        },
                    ],
                }),
            ]),
        );

        expect(cenam.products[0].region).toBe("North America");
        expect(cis.products[0].region).toBe("Asia");
    });

    it("normalizes speed arrays and keeps known generations only", () => {
        const batch = mapEsimGoProducts(
            wrap([
                makeProduct({
                    countries: [
                        {
                            country: { name: "Italy", region: "Europe", iso: "IT" },
                            networks: [
                                {
                                    name: "ILIAD",
                                    brandName: "ILIAD Italia",
                                    speeds: ["5G", "4G", "4G", "Unknown", "2g"],
                                },
                            ],
                            potentialNetworks: [],
                        },
                    ],
                }),
            ]),
        );

        expect(batch.networks).toHaveLength(1);
        expect(batch.networks[0].speeds).toEqual(["2G", "4G", "5G"]);
    });

    it("throws for unknown unlimited group", () => {
        expect(() => {
            mapEsimGoProducts(
                wrap([
                    makeProduct({
                        unlimited: true,
                        group: ["Unknown Tier"],
                        dataAmount: -1,
                    }),
                ]),
            );
        }).toThrow(/Unknown eSIMGo unlimited group/);
    });
});
