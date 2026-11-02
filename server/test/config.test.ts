import { describe, expect, it } from "vitest";
import { testnetTatumConfig } from "../src/infrastructure/config.js";

const settings = {
  TATUM_SUI_TESTNET_GRPC_URL: "https://testnet.invalid",
  TATUM_TESTNET_API_KEY: "testnet-placeholder",
  TATUM_API_KEY: "",
};

describe("Testnet Tatum configuration (no network)", () => {
  it("works with only the Testnet key", () => {
    expect(testnetTatumConfig(settings)).toEqual({
      grpcUrl: settings.TATUM_SUI_TESTNET_GRPC_URL,
      apiKey: "testnet-placeholder",
      network: "testnet",
    });
  });

  it("prefers the Testnet key and falls back to the Mainnet key only if needed", () => {
    expect(testnetTatumConfig({ ...settings, TATUM_API_KEY: "mainnet-placeholder" }).apiKey).toBe("testnet-placeholder");
    expect(testnetTatumConfig({ ...settings, TATUM_TESTNET_API_KEY: "", TATUM_API_KEY: "mainnet-placeholder" }).apiKey).toBe("mainnet-placeholder");
  });

  it("rejects missing keys before making any request", () => {
    expect(() => testnetTatumConfig({ ...settings, TATUM_TESTNET_API_KEY: "" }))
      .toThrow("Missing in .env: TATUM_TESTNET_API_KEY or TATUM_API_KEY");
  });
});
