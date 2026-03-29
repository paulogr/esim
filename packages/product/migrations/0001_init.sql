-- Migration number: 0001 	 2026-03-28T17:54:23.124Z

CREATE TABLE product (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('esimaccess', 'esimgo', 'esimcard')),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('FIXED', 'DAILY')),
    coverage TEXT NOT NULL CHECK (coverage IN ('COUNTRY', 'REGION')),
    region TEXT CHECK (
        region IS NULL OR region IN (
            'Africa',
            'Asia',
            'Caribbean',
            'Europe',
            'Global',
            'Middle East',
            'North America',
            'Oceania',
            'South America',
            'Unknow'
        )
    ),
    allowance REAL NOT NULL,
    throttled TEXT,
    price INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('ACTIVE', 'DRAFT', 'DISABLED')),
    validity INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, name),
    CHECK ((coverage = 'COUNTRY' AND region IS NULL) OR (coverage = 'REGION' AND region IS NOT NULL))
);

CREATE TABLE product_country (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code = UPPER(code)),
    FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE,
    UNIQUE(product_id, code)
);

CREATE TABLE product_country_network (
    id TEXT PRIMARY KEY,
    product_country_id TEXT NOT NULL,
    name TEXT NOT NULL,
    speeds TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (product_country_id) REFERENCES product_country(id) ON DELETE CASCADE,
    UNIQUE(product_country_id, name)
);

CREATE INDEX idx_product_provider ON product(provider);
CREATE INDEX idx_product_status ON product(status);
CREATE INDEX idx_product_type ON product(type);
CREATE INDEX idx_product_coverage ON product(coverage);
CREATE INDEX idx_product_region ON product(region);
CREATE INDEX idx_product_country_product_id ON product_country(product_id);
CREATE INDEX idx_product_country_network_country_id ON product_country_network(product_country_id);
