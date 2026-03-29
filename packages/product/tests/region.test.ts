import { describe, expect, it } from "vitest";

import {
    mapCountryCodeToRegion,
    normalizeRegionalCountryCode,
    resolveRegionFromCountryCodes,
} from "../region.ts";

describe("normalizeRegionalCountryCode", () => {
    it("normalizes casing, trims spaces, and applies aliases", () => {
        expect(normalizeRegionalCountryCode(" uk ")).toBe("GB");
        expect(normalizeRegionalCountryCode("el")).toBe("GR");
        expect(normalizeRegionalCountryCode("CYP")).toBe("CY");
        expect(normalizeRegionalCountryCode("US-HI")).toBe("US");
    });
});

describe("mapCountryCodeToRegion", () => {
    it("maps country codes into traveler-facing regions", () => {
        expect(mapCountryCodeToRegion("DE")).toBe("Europe");
        expect(mapCountryCodeToRegion("TH")).toBe("Asia");
        expect(mapCountryCodeToRegion("AE")).toBe("Middle East");
        expect(mapCountryCodeToRegion("NC")).toBe("Oceania");
    });

    it("keeps Caribbean priority for overlapping geographies", () => {
        expect(mapCountryCodeToRegion("AG")).toBe("Caribbean");
        expect(mapCountryCodeToRegion("PR")).toBe("Caribbean");
    });

    it("returns null for unknown country code", () => {
        expect(mapCountryCodeToRegion("ZZ")).toBeNull();
    });
});

describe("resolveRegionFromCountryCodes", () => {
    it("returns Unknow for empty input", () => {
        const result = resolveRegionFromCountryCodes([]);

        expect(result.region).toBe("Unknow");
        expect(result.uniqueCountryCodes).toEqual([]);
        expect(result.unknownCountryCodes).toEqual([]);
        expect(result.regionCounts).toEqual({});
    });

    it("resolves single-region list", () => {
        const result = resolveRegionFromCountryCodes([" DE ", "FR", "IT"]);

        expect(result.region).toBe("Europe");
        expect(result.uniqueCountryCodes).toEqual(["DE", "FR", "IT"]);
        expect(result.unknownCountryCodes).toEqual([]);
        expect(result.regionCounts).toEqual({ Europe: 3 });
    });

    it("resolves dominant region in multi-region list", () => {
        const result = resolveRegionFromCountryCodes(["DE", "FR", "IT", "ES", "CY"]);

        expect(result.region).toBe("Europe");
        expect(result.regionCounts).toEqual({ Europe: 4, "Middle East": 1 });
    });

    it("resolves two-region lists by simple majority", () => {
        const result = resolveRegionFromCountryCodes(["AM", "GE", "KG", "KZ", "MD", "RU", "UA"]);

        expect(result.region).toBe("Asia");
        expect(result.regionCounts).toEqual({ Asia: 4, Europe: 3 });
    });

    it("resolves dominant region for plans spanning exactly three regions", () => {
        const result = resolveRegionFromCountryCodes(["DE", "FR", "IT", "ES", "AE", "TH"]);

        expect(result.region).toBe("Europe");
        expect(result.regionCounts).toEqual({ Europe: 4, "Middle East": 1, Asia: 1 });
    });

    it("resolves Global for plans spanning at least four regions", () => {
        const result = resolveRegionFromCountryCodes(["DE", "FR", "IT", "ES", "AE", "TH", "US"]);

        expect(result.region).toBe("Global");
        expect(result.regionCounts).toEqual({ Europe: 4, "Middle East": 1, Asia: 1, "North America": 1 });
    });

    it("resolves Global when no dominant region exists", () => {
        const result = resolveRegionFromCountryCodes(["DE", "FR", "AE", "TH", "US", "BR"]);

        expect(result.region).toBe("Global");
    });

    it("returns Unknow when unknown ratio exceeds threshold", () => {
        const result = resolveRegionFromCountryCodes(["DE", "FR", "ZZ", "YY"], {
            unknownThreshold: 0.3,
        });

        expect(result.region).toBe("Unknow");
        expect(result.unknownCountryCodes).toEqual(["ZZ", "YY"]);
    });

    it("respects stricter dominant threshold option", () => {
        const result = resolveRegionFromCountryCodes(["DE", "FR", "IT", "AE"], {
            dominantThreshold: 0.8,
        });

        expect(result.region).toBe("Global");
        expect(result.regionCounts).toEqual({ Europe: 3, "Middle East": 1 });
    });
});
