export type Provider = "esimaccess" | "esimgo" | "esimcard";

export type ProductType = "FIXED" | "DAILY";

export type CoverageType = "COUNTRY" | "REGION";

export type ProductStatus = "ACTIVE" | "DRAFT" | "DISABLED";

export type NetworkSpeed = "2G" | "3G" | "4G" | "5G";

export type RegionName =
    | "Africa"
    | "Asia"
    | "Caribbean"
    | "Europe"
    | "Global"
    | "Middle East"
    | "North America"
    | "Oceania"
    | "South America"
    | "Unknow";

export interface EsimCardCoverage {
    code: string;
    network_name: string;
    supported_networks_coverages: string[];
}

export interface EsimCardPackage {
    id: string;
    name: string;
    price: number;
    data_quantity: number;
    data_unit: string;
    package_validity: number;
    voice_quantity: number;
    sms_quantity: number;
    coverage: EsimCardCoverage[];
    unlimited: boolean;
    throttle: boolean;
    unthrottle_data: string | null;
    throttle_speed: string | null;
}

export interface EsimCardCountry {
    code: string;
    packages: EsimCardPackage[];
}

export interface EsimCardResponse {
    status: boolean;
    data: {
        countries: EsimCardCountry[];
    };
}

export interface CanonicalProduct {
    provider: Provider;
    name: string;
    type: ProductType;
    coverage: CoverageType;
    region: RegionName | null;
    allowance: number;
    throttled: string | null;
    voice: boolean;
    sms: boolean;
    topup: boolean;
    ip: string[];
    price: number;
    currency: string;
    status: ProductStatus;
    validity: number;
}

export interface CanonicalProductCountry {
    productName: string;
    code: string;
}

export interface CanonicalProductCountryNetwork {
    productName: string;
    countryCode: string;
    name: string;
    speeds: NetworkSpeed[];
}

export interface CanonicalProductBatch {
    products: CanonicalProduct[];
    countries: CanonicalProductCountry[];
    networks: CanonicalProductCountryNetwork[];
}

export interface EsimAccessOperator {
    operatorName: string;
    networkType: string;
}

export interface EsimAccessLocationNetwork {
    locationName: string;
    locationCode: string;
    operatorList: EsimAccessOperator[];
}

export interface EsimAccessPackage {
    packageCode: string;
    slug: string;
    name: string;
    price: number;
    currencyCode: string;
    volume: number;
    dataType: number;
    duration: number;
    durationUnit: string;
    location: string;
    locationCode: string;
    fupPolicy: string;
    smsStatus?: number;
    supportTopUpType?: number;
    ipExport?: string | null;
    locationNetworkList: EsimAccessLocationNetwork[];
}

export interface EsimAccessResponse {
    success: boolean;
    errorCode: string | null;
    errorMsg: string | null;
    obj: {
        packageList: EsimAccessPackage[];
    };
}

export interface EsimGoCountryRef {
    name: string;
    region: string;
    iso: string;
}

export interface EsimGoNetwork {
    name: string;
    brandName?: string;
    speeds?: string[];
}

export interface EsimGoCountryEntry {
    country: EsimGoCountryRef;
    networks: EsimGoNetwork[] | null;
    potentialNetworks: unknown[];
}

export interface EsimGoAllowance {
    type: string;
    service: string;
    description: string;
    amount: number;
    unit: string;
    unlimited: boolean;
}

export interface EsimGoProduct {
    name: string;
    description: string;
    countries: EsimGoCountryEntry[];
    roamingEnabled: EsimGoCountryEntry[] | null;
    dataAmount: number;
    duration: number;
    unlimited: boolean;
    group: string[];
    price: number;
    allowances: EsimGoAllowance[];
}

export type EsimGoProductList = EsimGoProduct[];

export interface EsimGoResponse {
    bundles: EsimGoProductList;
    pageCount: number | null;
    rows: number | null;
    pageSize: number | null;
}

export type AuthStrategy =
    | { type: "none" }
    | { type: "apiKeyHeader"; header: string; value: string }
    | { type: "bearer"; token: string }
    | { type: "query"; key: string; value: string };

export interface LoadProductsOptions<TResponse> {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    auth?: AuthStrategy;
    timeoutMs?: number;
    retries?: number;
    parseAs?: "json" | "text";
    mapResponse?: (raw: unknown) => TResponse;
}

export interface PersistInput {
    provider: Provider;
    batch: CanonicalProductBatch;
}

export type ProductIngestMessage = {
    provider: Provider;
};
