import { Hono } from "hono";
import { z } from "zod";

import type { CanonicalProduct, CoverageType, ProductStatus, ProductType, RegionName } from "./types.ts";
import { normalizeCountryCode } from "./util.ts";

const COVERAGE_TYPES = ["COUNTRY", "REGION"] as const satisfies readonly CoverageType[];
const PRODUCT_TYPES = ["FIXED", "DAILY"] as const satisfies readonly ProductType[];
const REGION_NAMES = [
    "Africa",
    "Asia",
    "Caribbean",
    "Europe",
    "Global",
    "Middle East",
    "North America",
    "Oceania",
    "South America",
    "Unknow",
] as const satisfies readonly RegionName[];

const productQuerySchema = z.object({
    coverage: z.enum(COVERAGE_TYPES).default("COUNTRY"),
    country: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional()),
    region: z.preprocess(emptyStringToUndefined, z.enum(REGION_NAMES).optional()),
    type: z.preprocess(emptyStringToUndefined, z.enum(PRODUCT_TYPES).optional()),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(0).default(20).transform((value) => Math.min(value, 100)),
}).superRefine((value, ctx) => {
    if (value.coverage === "COUNTRY" && !value.country) {
        ctx.addIssue({
            code: "custom",
            path: ["country"],
            message: "country is required when coverage is COUNTRY",
        });
    }

    if (value.coverage === "REGION" && !value.region) {
        ctx.addIssue({
            code: "custom",
            path: ["region"],
            message: "region is required when coverage is REGION",
        });
    }
});

const SQL_SELECT_PRODUCTS_BY_COUNTRY = `
SELECT
    provider,
    name,
    type,
    coverage,
    region,
    allowance,
    throttled,
    voice,
    sms,
    topup,
    ip,
    price,
    currency,
    status,
    validity
FROM product
WHERE coverage = 'COUNTRY'
  AND EXISTS (
      SELECT 1
      FROM product_country
      WHERE product_country.product_id = product.id
        AND product_country.code = ?
  )
  AND (? IS NULL OR type = ?)
ORDER BY name, provider
LIMIT ? OFFSET ?
`;

const SQL_SELECT_PRODUCTS_BY_REGION = `
SELECT
    provider,
    name,
    type,
    coverage,
    region,
    allowance,
    throttled,
    voice,
    sms,
    topup,
    ip,
    price,
    currency,
    status,
    validity
FROM product
WHERE coverage = 'REGION'
  AND region = ?
  AND (? IS NULL OR type = ?)
ORDER BY name, provider
LIMIT ? OFFSET ?
`;

type ProductRow = {
    provider: CanonicalProduct["provider"];
    name: string;
    type: ProductType;
    coverage: CoverageType;
    region: RegionName | null;
    allowance: number;
    throttled: string | null;
    voice: number | boolean;
    sms: number | boolean;
    topup: number | boolean;
    ip: string;
    price: number;
    currency: string;
    status: ProductStatus;
    validity: number;
};

export const app = new Hono<{ Bindings: Env }>();

app.get("/product", async (c) => {
    const parsed = productQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
        return c.json({
            error: "Invalid query",
            issues: parsed.error.issues,
        }, 400);
    }

    const query = parsed.data.coverage === "COUNTRY"
        ? {
            ...parsed.data,
            country: normalizeCountryCode(parsed.data.country!),
        }
        : parsed.data;

    const statement = query.coverage === "COUNTRY"
        ? c.env.DB.prepare(SQL_SELECT_PRODUCTS_BY_COUNTRY).bind(
            query.country,
            query.type ?? null,
            query.type ?? null,
            query.limit,
            query.offset,
        )
        : c.env.DB.prepare(SQL_SELECT_PRODUCTS_BY_REGION).bind(
            query.region,
            query.type ?? null,
            query.type ?? null,
            query.limit,
            query.offset,
        );

    const result = await statement.all<ProductRow>();

    return c.json({
        products: (result.results ?? []).map(mapProductRow),
        offset: query.offset,
        limit: query.limit,
    });
});

function emptyStringToUndefined(value: unknown): unknown {
    if (typeof value !== "string") {
        return value;
    }

    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function mapProductRow(row: ProductRow): CanonicalProduct {
    return {
        provider: row.provider,
        name: row.name,
        type: row.type,
        coverage: row.coverage,
        region: row.region,
        allowance: row.allowance,
        throttled: row.throttled,
        voice: Boolean(row.voice),
        sms: Boolean(row.sms),
        topup: Boolean(row.topup),
        ip: parseIpList(row.ip),
        price: row.price,
        currency: row.currency,
        status: row.status,
        validity: row.validity,
    };
}

function parseIpList(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}
