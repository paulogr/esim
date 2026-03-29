import type { RegionName } from "./types.ts";

type MappableRegion = Exclude<RegionName, "Global" | "Unknow">;

export interface ResolveRegionOptions {
    dominantThreshold?: number;
    unknownThreshold?: number;
}

export interface RegionResolution {
    region: RegionName;
    uniqueCountryCodes: string[];
    unknownCountryCodes: string[];
    regionCounts: Partial<Record<MappableRegion, number>>;
}

const DEFAULT_DOMINANT_THRESHOLD = 0.5;
const DEFAULT_UNKNOWN_THRESHOLD = 0.3;

const COUNTRY_CODE_ALIASES: Readonly<Record<string, string>> = {
    EL: "GR",
    UK: "GB",
    CYP: "CY",
    USHI: "US",
    "US-HI": "US",
};

const CARIBBEAN_COUNTRY_CODES = new Set<string>([
    "AG",
    "AI",
    "AN",
    "AW",
    "BB",
    "BL",
    "BM",
    "BQ",
    "BS",
    "CU",
    "CW",
    "DM",
    "DO",
    "GD",
    "GP",
    "HT",
    "JM",
    "KN",
    "KY",
    "LC",
    "MF",
    "MQ",
    "MS",
    "PR",
    "SX",
    "TC",
    "TT",
    "VC",
    "VG",
    "VI",
]);

const MIDDLE_EAST_COUNTRY_CODES = new Set<string>([
    "AE",
    "BH",
    "CY",
    "IL",
    "IQ",
    "IR",
    "JO",
    "KW",
    "LB",
    "OM",
    "PS",
    "QA",
    "SA",
    "SY",
    "TR",
    "YE",
]);

const AFRICA_COUNTRY_CODES = new Set<string>([
    "AO",
    "BF",
    "BI",
    "BJ",
    "BW",
    "CD",
    "CF",
    "CG",
    "CI",
    "CM",
    "CV",
    "DJ",
    "DZ",
    "EG",
    "EH",
    "ER",
    "ET",
    "GA",
    "GH",
    "GM",
    "GN",
    "GQ",
    "GW",
    "KE",
    "KM",
    "LR",
    "LS",
    "LY",
    "MA",
    "MG",
    "ML",
    "MR",
    "MU",
    "MW",
    "MZ",
    "NA",
    "NE",
    "NG",
    "RE",
    "RW",
    "SC",
    "SD",
    "SH",
    "SL",
    "SN",
    "SO",
    "SS",
    "ST",
    "SZ",
    "TD",
    "TG",
    "TN",
    "TZ",
    "UG",
    "YT",
    "ZA",
    "ZM",
    "ZW",
]);

const ASIA_COUNTRY_CODES = new Set<string>([
    "AF",
    "AM",
    "AZ",
    "BD",
    "BN",
    "BT",
    "CN",
    "GE",
    "HK",
    "ID",
    "IN",
    "JP",
    "KG",
    "KH",
    "KP",
    "KR",
    "KZ",
    "LA",
    "LK",
    "MM",
    "MN",
    "MO",
    "MV",
    "MY",
    "NP",
    "PH",
    "PK",
    "SG",
    "TH",
    "TJ",
    "TL",
    "TM",
    "TW",
    "UZ",
    "VN",
]);

const EUROPE_COUNTRY_CODES = new Set<string>([
    "AD",
    "AL",
    "AT",
    "AX",
    "BA",
    "BE",
    "BG",
    "BY",
    "CH",
    "CZ",
    "DE",
    "DK",
    "EE",
    "ES",
    "FI",
    "FO",
    "FR",
    "GB",
    "GG",
    "GI",
    "GR",
    "HR",
    "HU",
    "IE",
    "IM",
    "IS",
    "IT",
    "JE",
    "LI",
    "LT",
    "LU",
    "LV",
    "MC",
    "MD",
    "ME",
    "MK",
    "MT",
    "NL",
    "NO",
    "PL",
    "PT",
    "RO",
    "RS",
    "RU",
    "SE",
    "SI",
    "SJ",
    "SK",
    "SM",
    "UA",
    "VA",
    "XK",
]);

const NORTH_AMERICA_COUNTRY_CODES = new Set<string>([
    "BZ",
    "CA",
    "CR",
    "GL",
    "GT",
    "HN",
    "MX",
    "NI",
    "PA",
    "PM",
    "SV",
    "US",
]);

const SOUTH_AMERICA_COUNTRY_CODES = new Set<string>([
    "AR",
    "BO",
    "BR",
    "CL",
    "CO",
    "EC",
    "FK",
    "GF",
    "GY",
    "PE",
    "PY",
    "SR",
    "UY",
    "VE",
]);

const OCEANIA_COUNTRY_CODES = new Set<string>([
    "AS",
    "AU",
    "CK",
    "FJ",
    "FM",
    "GU",
    "KI",
    "MH",
    "MP",
    "NC",
    "NF",
    "NR",
    "NU",
    "NZ",
    "PF",
    "PG",
    "PN",
    "PW",
    "SB",
    "TK",
    "TO",
    "TV",
    "VU",
    "WF",
    "WS",
]);

export function resolveRegionFromCountryCodes(
    countryCodes: ReadonlyArray<string>,
    options: ResolveRegionOptions = {},
): RegionResolution {
    const dominantThreshold = clamp(options.dominantThreshold ?? DEFAULT_DOMINANT_THRESHOLD, 0, 1);
    const unknownThreshold = clamp(options.unknownThreshold ?? DEFAULT_UNKNOWN_THRESHOLD, 0, 1);

    const uniqueCountryCodes = uniqueNormalizedCodes(countryCodes);
    if (uniqueCountryCodes.length === 0) {
        return {
            region: "Unknow",
            uniqueCountryCodes,
            unknownCountryCodes: [],
            regionCounts: {},
        };
    }

    const regionCounts: Partial<Record<MappableRegion, number>> = {};
    const unknownCountryCodes: string[] = [];

    for (const code of uniqueCountryCodes) {
        const region = mapCountryCodeToRegion(code);
        if (!region) {
            unknownCountryCodes.push(code);
            continue;
        }

        regionCounts[region] = (regionCounts[region] ?? 0) + 1;
    }

    const mappedCount = uniqueCountryCodes.length - unknownCountryCodes.length;
    if (mappedCount === 0) {
        return {
            region: "Unknow",
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    const unknownRatio = unknownCountryCodes.length / uniqueCountryCodes.length;
    if (unknownRatio > unknownThreshold) {
        return {
            region: "Unknow",
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    const rankedRegions = Object.entries(regionCounts)
        .filter((entry): entry is [MappableRegion, number] => typeof entry[0] === "string" && typeof entry[1] === "number")
        .sort((left, right) => right[1] - left[1]);

    if (rankedRegions.length === 0) {
        return {
            region: "Unknow",
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    if (rankedRegions.length === 1) {
        return {
            region: rankedRegions[0][0],
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    if (rankedRegions.length >= 4) {
        return {
            region: "Global",
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    const [topRegion, topCount] = rankedRegions[0];
    const secondCount = rankedRegions[1][1];

    if (topCount === secondCount) {
        return {
            region: "Global",
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    const topRatio = topCount / mappedCount;
    if (topRatio > dominantThreshold) {
        return {
            region: topRegion,
            uniqueCountryCodes,
            unknownCountryCodes,
            regionCounts,
        };
    }

    return {
        region: "Global",
        uniqueCountryCodes,
        unknownCountryCodes,
        regionCounts,
    };
}

export function mapCountryCodeToRegion(countryCode: string): MappableRegion | null {
    const normalizedCode = normalizeRegionalCountryCode(countryCode);
    if (normalizedCode.length === 0) {
        return null;
    }

    if (CARIBBEAN_COUNTRY_CODES.has(normalizedCode)) {
        return "Caribbean";
    }
    if (MIDDLE_EAST_COUNTRY_CODES.has(normalizedCode)) {
        return "Middle East";
    }
    if (AFRICA_COUNTRY_CODES.has(normalizedCode)) {
        return "Africa";
    }
    if (ASIA_COUNTRY_CODES.has(normalizedCode)) {
        return "Asia";
    }
    if (EUROPE_COUNTRY_CODES.has(normalizedCode)) {
        return "Europe";
    }
    if (NORTH_AMERICA_COUNTRY_CODES.has(normalizedCode)) {
        return "North America";
    }
    if (SOUTH_AMERICA_COUNTRY_CODES.has(normalizedCode)) {
        return "South America";
    }
    if (OCEANIA_COUNTRY_CODES.has(normalizedCode)) {
        return "Oceania";
    }

    return null;
}

export function normalizeRegionalCountryCode(value: string): string {
    const normalized = value.trim().toUpperCase();
    return COUNTRY_CODE_ALIASES[normalized] ?? normalized;
}

function uniqueNormalizedCodes(countryCodes: ReadonlyArray<string>): string[] {
    const dedupe = new Set<string>();
    for (const code of countryCodes) {
        const normalized = normalizeRegionalCountryCode(code);
        if (normalized.length > 0) {
            dedupe.add(normalized);
        }
    }
    return Array.from(dedupe);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
