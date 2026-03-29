import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paralleldrive/cuid2", () => {
    let counter = 0;
    return {
        createId: () => {
            counter += 1;
            return `id_${counter}`;
        },
    };
});

import { persistBatch } from "../db.ts";
import type { CanonicalProductBatch, PersistInput } from "../types.ts";

type StatementRecord = {
    sql: string;
    params: unknown[];
};

class FakePreparedStatement {
    readonly sql: string;
    params: unknown[] = [];
    private readonly db: FakeD1Database;

    constructor(db: FakeD1Database, sql: string) {
        this.db = db;
        this.sql = sql;
    }

    bind(...params: unknown[]): FakePreparedStatement {
        this.params = params;
        return this;
    }

    async first<T>(): Promise<T | null> {
        return this.db.first(this.sql, this.params) as T | null;
    }
}

class FakeD1Database {
    private readonly existingProductIds = new Map<string, string>();
    readonly batches: StatementRecord[][] = [];

    setExistingProductId(provider: string, name: string, id: string): void {
        this.existingProductIds.set(`${provider}::${name}`, id);
    }

    prepare(sql: string): FakePreparedStatement {
        return new FakePreparedStatement(this, sql);
    }

    async batch(statements: FakePreparedStatement[]): Promise<unknown[]> {
        this.batches.push(
            statements.map((statement) => ({
                sql: statement.sql,
                params: [...statement.params],
            })),
        );
        return [];
    }

    first(sql: string, params: unknown[]): { id: string } | null {
        if (!sql.includes("SELECT id") || !sql.includes("FROM product")) {
            return null;
        }

        const provider = String(params[0]);
        const name = String(params[1]);
        const id = this.existingProductIds.get(`${provider}::${name}`);
        return id ? { id } : null;
    }
}

function makeInput(): PersistInput {
    const batch: CanonicalProductBatch = {
        products: [
            {
                provider: "esimgo",
                name: "esim_1GB_7D_IT_V2",
                type: "FIXED",
                coverage: "COUNTRY",
                region: null,
                allowance: 1024,
                throttled: null,
                voice: false,
                sms: false,
                topup: false,
                ip: [],
                price: 11700,
                currency: "USD",
                status: "DRAFT",
                validity: 7,
            },
        ],
        countries: [
            { productName: "esim_1GB_7D_IT_V2", code: "IT" },
            { productName: "esim_1GB_7D_IT_V2", code: "IT" },
        ],
        networks: [
            {
                productName: "esim_1GB_7D_IT_V2",
                countryCode: "IT",
                name: "Wind Tre",
                speeds: ["4G", "5G"],
            },
            {
                productName: "esim_1GB_7D_IT_V2",
                countryCode: "IT",
                name: "Wind Tre",
                speeds: ["4G", "5G"],
            },
            {
                productName: "esim_1GB_7D_IT_V2",
                countryCode: "FR",
                name: "Orange",
                speeds: ["5G"],
            },
        ],
    };

    return {
        provider: "esimgo",
        batch,
    };
}

describe("persistBatch", () => {
    let db: FakeD1Database;

    beforeEach(() => {
        db = new FakeD1Database();
    });

    it("builds one batch per product and uses existing product id", async () => {
        const input = makeInput();
        db.setExistingProductId("esimgo", "esim_1GB_7D_IT_V2", "existing_product_id");

        await persistBatch(db as unknown as D1Database, input);

        expect(db.batches).toHaveLength(1);
        const statements = db.batches[0];

        const upsert = statements.find((statement) => statement.sql.includes("INSERT INTO product"));
        expect(upsert?.params[0]).toBe("existing_product_id");
    });

    it("generates ids and deduplicates country/network inserts", async () => {
        const input = makeInput();

        await persistBatch(db as unknown as D1Database, input);

        expect(db.batches).toHaveLength(1);
        const statements = db.batches[0];

        const countryInserts = statements.filter((statement) => statement.sql.includes("INSERT INTO product_country "));
        const networkInserts = statements.filter((statement) => statement.sql.includes("INSERT INTO product_country_network"));

        expect(countryInserts).toHaveLength(1);
        expect(networkInserts).toHaveLength(1);

        const upsert = statements.find((statement) => statement.sql.includes("INSERT INTO product"));
        expect(String(upsert?.params[0])).toMatch(/^id_/);
        expect(upsert?.params[8]).toBe(false);
        expect(upsert?.params[9]).toBe(false);
        expect(upsert?.params[10]).toBe(false);
        expect(upsert?.params[11]).toBe("[]");
    });

    it("ignores products from other providers", async () => {
        const input = makeInput();
        input.batch.products.push({
            provider: "esimaccess",
            name: "EU-30_1_7",
            type: "FIXED",
            coverage: "REGION",
            region: "Europe",
            allowance: 1024,
            throttled: null,
            voice: false,
            sms: false,
            topup: false,
            ip: [],
            price: 10000,
            currency: "USD",
            status: "DRAFT",
            validity: 7,
        });

        await persistBatch(db as unknown as D1Database, input);

        expect(db.batches).toHaveLength(1);
    });
});
