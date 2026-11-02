import { describe, expect, it } from "vitest";
import { publicTestnetBalances } from "../src/spike/public-balance.js";

describe("public Testnet balance lookup", () => {
  it("reads SUI and USDC, including the distinction between coin objects and address balance", async () => {
    const fakeFetch: typeof fetch = async (input, init) => {
      expect(input).toBe("https://graphql.testnet.sui.io/graphql");
      const query = JSON.parse(String(init?.body)).query as string;
      expect(query).toContain('usdc: balance(coinType: "0xabc::usdc::USDC")');
      return Response.json({ data: { address: {
        sui: { totalBalance: "1000000000", coinBalance: "1000000000", addressBalance: "0" },
        usdc: { totalBalance: "20000000", coinBalance: "20000000", addressBalance: "0" },
      } } });
    };
    expect(await publicTestnetBalances("0x123", "0xabc::usdc::USDC", fakeFetch)).toEqual({
      sui: { balance: "1000000000", coinBalance: "1000000000", addressBalance: "0" },
      usdc: { balance: "20000000", coinBalance: "20000000", addressBalance: "0" },
    });
  });

  it("reports a zero balance when an address has no USDC yet", async () => {
    const fakeFetch: typeof fetch = async () => Response.json({ data: { address: {
      sui: { totalBalance: "0", coinBalance: "0", addressBalance: "0" }, usdc: null,
    } } });
    expect((await publicTestnetBalances("0x123", "0xabc::usdc::USDC", fakeFetch)).usdc.balance).toBe("0");
  });
});
