import { createId } from "@paralleldrive/cuid2";
import type {
    CanonicalProduct,
    CanonicalProductCountry,
    CanonicalProductCountryNetwork,
    PersistInput,
} from "./types.ts";

const SQL_SELECT_PRODUCT_ID = `
SELECT id
FROM product
WHERE provider = ? AND name = ?
LIMIT 1
`;

const SQL_UPSERT_PRODUCT = `
INSERT INTO product (
    id,
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
    validity,
    created_at,
    updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(provider, name) DO UPDATE SET
    type = excluded.type,
    coverage = excluded.coverage,
    region = excluded.region,
    allowance = excluded.allowance,
    throttled = excluded.throttled,
    voice = excluded.voice,
    sms = excluded.sms,
    topup = excluded.topup,
    ip = excluded.ip,
    price = excluded.price,
    currency = excluded.currency,
    status = excluded.status,
    validity = excluded.validity,
    updated_at = CURRENT_TIMESTAMP
`;

const SQL_DELETE_PRODUCT_COUNTRY_NETWORKS = `
DELETE FROM product_country_network
WHERE product_country_id IN (
    SELECT id
    FROM product_country
    WHERE product_id = ?
)
`;

const SQL_DELETE_PRODUCT_COUNTRIES = `
DELETE FROM product_country
WHERE product_id = ?
`;

const SQL_INSERT_PRODUCT_COUNTRY = `
INSERT INTO product_country (id, product_id, code)
VALUES (?, ?, ?)
`;

const SQL_INSERT_PRODUCT_COUNTRY_NETWORK = `
INSERT INTO product_country_network (id, product_country_id, name, speeds)
VALUES (?, ?, ?, ?)
ON CONFLICT(product_country_id, name) DO UPDATE SET
    speeds = excluded.speeds
`;

export async function persistBatch(db: D1Database, input: PersistInput): Promise<void> {
    const products = input.batch.products.filter((product) => product.provider === input.provider);

    for (const product of products) {
        const productId = await getOrCreateProductId(db, product);

        const countries = input.batch.countries.filter((country) => country.productName === product.name);
        const networks = input.batch.networks.filter((network) => network.productName === product.name);

        const statements = buildPersistStatements(db, product, productId, countries, networks);
        await db.batch(statements);
    }
}

async function getOrCreateProductId(db: D1Database, product: CanonicalProduct): Promise<string> {
    const row = await db
        .prepare(SQL_SELECT_PRODUCT_ID)
        .bind(product.provider, product.name)
        .first<{ id: string }>();

    if (row?.id) {
        return row.id;
    }

    return createId();
}

function buildPersistStatements(
    db: D1Database,
    product: CanonicalProduct,
    productId: string,
    countries: CanonicalProductCountry[],
    networks: CanonicalProductCountryNetwork[],
): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];

    statements.push(
        db.prepare(SQL_UPSERT_PRODUCT).bind(
            productId,
            product.provider,
            product.name,
            product.type,
            product.coverage,
            product.region,
            product.allowance,
            product.throttled,
            product.voice,
            product.sms,
            product.topup,
            JSON.stringify(product.ip),
            product.price,
            product.currency,
            product.status,
            product.validity,
        ),
    );

    statements.push(db.prepare(SQL_DELETE_PRODUCT_COUNTRY_NETWORKS).bind(productId));
    statements.push(db.prepare(SQL_DELETE_PRODUCT_COUNTRIES).bind(productId));

    const countryIdByCode = new Map<string, string>();

    for (const country of countries) {
        if (countryIdByCode.has(country.code)) {
            continue;
        }

        const countryId = createId();
        countryIdByCode.set(country.code, countryId);
        statements.push(db.prepare(SQL_INSERT_PRODUCT_COUNTRY).bind(countryId, productId, country.code));
    }

    const networkKeys = new Set<string>();

    for (const network of networks) {
        const productCountryId = countryIdByCode.get(network.countryCode);
        if (!productCountryId) {
            continue;
        }

        const key = `${productCountryId}::${network.name}`;
        if (networkKeys.has(key)) {
            continue;
        }
        networkKeys.add(key);

        statements.push(
            db.prepare(SQL_INSERT_PRODUCT_COUNTRY_NETWORK).bind(
                createId(),
                productCountryId,
                network.name,
                JSON.stringify(network.speeds),
            ),
        );
    }

    return statements;
}
