/** Read-only balances from the public Sui Testnet GraphQL service. No API key. */
export interface BalanceParts {
  balance: string;
  coinBalance: string;
  addressBalance: string;
}

const ZERO: BalanceParts = { balance: "0", coinBalance: "0", addressBalance: "0" };

export async function publicTestnetBalances(
  owner: string,
  usdcType: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sui: BalanceParts; usdc: BalanceParts }> {
  // Both values are produced by SDK address/type parsers, not user supplied GraphQL fragments.
  const query = `{
    address(address: "${owner}") {
      sui: balance(coinType: "0x2::sui::SUI") { totalBalance coinBalance addressBalance }
      usdc: balance(coinType: "${usdcType}") { totalBalance coinBalance addressBalance }
    }
  }`;
  const response = await fetcher("https://graphql.testnet.sui.io/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Sui Testnet GraphQL returned HTTP ${response.status}`);
  const body = (await response.json()) as {
    data?: { address?: { sui?: { totalBalance: string; coinBalance: string; addressBalance: string } | null; usdc?: { totalBalance: string; coinBalance: string; addressBalance: string } | null } | null };
    errors?: { message?: string }[];
  };
  if (body.errors?.length) throw new Error(`Sui Testnet GraphQL: ${body.errors[0]?.message ?? "query failed"}`);
  if (!body.data) throw new Error("Sui Testnet GraphQL returned no data");
  const normalize = (v: { totalBalance: string; coinBalance: string; addressBalance: string } | null | undefined): BalanceParts =>
    v ? { balance: v.totalBalance, coinBalance: v.coinBalance, addressBalance: v.addressBalance } : ZERO;
  return { sui: normalize(body.data.address?.sui), usdc: normalize(body.data.address?.usdc) };
}
