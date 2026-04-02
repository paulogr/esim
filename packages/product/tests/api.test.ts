import { describe, expect, it } from "vitest";

import { app } from "../api.ts";

type ProductRow = {
    provider: "esimaccess" | "esimgo" | "esimcard";
    name: string;
    type: "FIXED" | "DAILY";
    coverage: "COUNTRY" | "REGION";
    region: "Africa" | "Asia" | "Caribbean" | "Europe" | "Global" | "Middle East" | "North America" | "Oceania" | "South America" | "Unknow" | null;
    allowance: number;
    throttled: string | null;
    voice: number;
    sms: number;
    topup: number;
    ip: string;
    price: number;
    currency: string;
    status: "ACTIVE" | "DRAFT" | "DISABLED";
    validity: number;
    countries: string[];
};

class FakePreparedStatement {
    private params: unknown[] = [];

    constructor(
        private readonly products: ProductRow[],
        private readonly sql: string,
    ) {}

    bind(...params: unknown[]): FakePreparedStatement {
        this.params = params;
        return this;
    }

    async all<T>(): Promise<{ results: T[] }> {
        const results = this.sql.includes("product_country.code = ?")
            ? this.selectByCountry()
            : this.selectByRegion();

        return { results: results as T[] };
    }

    private selectByCountry(): Omit<ProductRow, "countries">[] {
        const [country, type, , limit, offset] = this.params as [string, ProductRow["type"] | null, ProductRow["type"] | null, number, number];

        return this.products
            .filter((product) => product.coverage === "COUNTRY")
            .filter((product) => product.countries.includes(country))
            .filter((product) => !type || product.type === type)
            .sort(compareProducts)
            .slice(offset, offset + limit)
            .map(stripCountries);
    }

    private selectByRegion(): Omit<ProductRow, "countries">[] {
        const [region, type, , limit, offset] = this.params as [NonNullable<ProductRow["region"]>, ProductRow["type"] | null, ProductRow["type"] | null, number, number];

        return this.products
            .filter((product) => product.coverage === "REGION")
            .filter((product) => product.region === region)
            .filter((product) => !type || product.type === type)
            .sort(compareProducts)
            .slice(offset, offset + limit)
            .map(stripCountries);
    }
}

class FakeD1Database {
    constructor(private readonly products: ProductRow[]) {}

    prepare(sql: string): FakePreparedStatement {
        return new FakePreparedStatement(this.products, sql);
    }
}

const PRODUCTS: ProductRow[] = [
    {
        provider: "esimgo",
        name: "br-daily-1gb",
        type: "DAILY",
        coverage: "COUNTRY",
        region: null,
        allowance: 1024,
        throttled: null,
        voice: 0,
        sms: 0,
        topup: 1,
        ip: '["4G","5G"]',
        price: 1000,
        currency: "USD",
        status: "ACTIVE",
        validity: 7,
        countries: ["BR"],
    },
    {
        provider: "esimcard",
        name: "br-fixed-3gb",
        type: "FIXED",
        coverage: "COUNTRY",
        region: null,
        allowance: 3072,
        throttled: null,
        voice: 1,
        sms: 0,
        topup: 0,
        ip: '[]',
        price: 2000,
        currency: "USD",
        status: "DRAFT",
        validity: 15,
        countries: ["AR", "BR"],
    },
    {
        provider: "esimaccess",
        name: "europe-fixed-5gb",
        type: "FIXED",
        coverage: "REGION",
        region: "Europe",
        allowance: 5120,
        throttled: "256kbps",
        voice: 0,
        sms: 1,
        topup: 0,
        ip: '["5G"]',
        price: 3000,
        currency: "USD",
        status: "ACTIVE",
        validity: 30,
        countries: [],
    },
    {
        provider: "esimgo",
        name: "asia-daily-3gb",
        type: "DAILY",
        coverage: "REGION",
        region: "Asia",
        allowance: 3072,
        throttled: null,
        voice: 0,
        sms: 0,
        topup: 0,
        ip: '["4G"]',
        price: 2500,
        currency: "USD",
        status: "ACTIVE",
        validity: 10,
        countries: [],
    },
];

describe("GET /product", () => {
    it("defaults coverage to COUNTRY and normalizes country code", async () => {
        const response = await request("http://localhost/product?country=br");
        const data = await parseJson<ProductResponse>(response);

        expect(response.status).toBe(200);
        expect(data).toEqual({
            products: [
                expect.objectContaining({ name: "br-daily-1gb", coverage: "COUNTRY" }),
                expect.objectContaining({ name: "br-fixed-3gb", coverage: "COUNTRY" }),
            ],
            offset: 0,
            limit: 20,
        });
        expect(data.items).toBeUndefined();
    });

    it("returns validation error when country is missing for default COUNTRY coverage", async () => {
        const response = await request("http://localhost/product");
        const data = await parseJson<ErrorResponse>(response);

        expect(response.status).toBe(400);
        expect(data.error).toBe("Invalid query");
        expect(data.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: ["country"], message: "country is required when coverage is COUNTRY" }),
            ]),
        );
    });

    it("returns validation error when country is missing for explicit COUNTRY coverage", async () => {
        const response = await request("http://localhost/product?coverage=COUNTRY");
        const data = await parseJson<ErrorResponse>(response);

        expect(response.status).toBe(400);
        expect(data.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: ["country"], message: "country is required when coverage is COUNTRY" }),
            ]),
        );
    });

    it("returns validation error when region is missing for REGION coverage", async () => {
        const response = await request("http://localhost/product?coverage=REGION");
        const data = await parseJson<ErrorResponse>(response);

        expect(response.status).toBe(400);
        expect(data.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: ["region"], message: "region is required when coverage is REGION" }),
            ]),
        );
    });

    it("rejects non-canonical regions", async () => {
        const response = await request("http://localhost/product?coverage=REGION&region=EUROPE");
        const data = await parseJson<ErrorResponse>(response);

        expect(response.status).toBe(400);
        expect(data.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: ["region"] }),
            ]),
        );
    });

    it("filters by optional type for region coverage", async () => {
        const response = await request("http://localhost/product?coverage=REGION&region=Europe&type=FIXED");
        const data = await parseJson<ProductResponse>(response);

        expect(response.status).toBe(200);
        expect(data.products).toHaveLength(1);
        expect(data.products[0]).toEqual(expect.objectContaining({ name: "europe-fixed-5gb", type: "FIXED" }));
    });

    it("applies offset and clamps limit to 100", async () => {
        const response = await request("http://localhost/product?country=BR&offset=1&limit=999");
        const data = await parseJson<ProductResponse>(response);

        expect(response.status).toBe(200);
        expect(data.offset).toBe(1);
        expect(data.limit).toBe(100);
        expect(data.products).toHaveLength(1);
        expect(data.products[0]).toEqual(expect.objectContaining({ name: "br-fixed-3gb" }));
    });
});

function request(url: string): Promise<Response> {
    return Promise.resolve(app.fetch(
        new Request(url),
        { DB: new FakeD1Database(PRODUCTS) as unknown as D1Database } as Env,
        {} as ExecutionContext,
    ));
}

async function parseJson<T>(response: Response): Promise<T> {
    return await response.json() as T;
}

function compareProducts(left: ProductRow, right: ProductRow): number {
    return left.name.localeCompare(right.name) || left.provider.localeCompare(right.provider);
}

function stripCountries({ countries: _countries, ...product }: ProductRow): Omit<ProductRow, "countries"> {
    return product;
}

type ProductResponse = {
    products: Array<{
        name: string;
        type: ProductRow["type"];
        coverage: ProductRow["coverage"];
    }>;
    offset: number;
    limit: number;
    items?: never;
};

type ErrorResponse = {
    error: string;
    issues: Array<{
        path: string[];
        message: string;
    }>;
};
