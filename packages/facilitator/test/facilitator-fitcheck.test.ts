import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, publicActions } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { X402Facilitator, registerExactEvmScheme } from "@reineira-os/x402-core/facilitator";
import { toFacilitatorEvmSigner } from "@reineira-os/x402-core/exact/settle";

const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function buildFacilitator() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(),
  }).extend(publicActions);
  const signer = toFacilitatorEvmSigner(
    Object.assign(wallet, { address: account.address }),
  );
  const facilitator = new X402Facilitator();
  registerExactEvmScheme(facilitator, { signer, networks: "eip155:421614" });
  return facilitator;
}

describe("x402 v2 facilitator reuse fit-check (Arbitrum Sepolia)", () => {
  it("registerExactEvmScheme wires eip155:421614 into getSupported", () => {
    const fresh = new X402Facilitator();
    expect(
      fresh.getSupported().kinds.some((k) => k.network === "eip155:421614"),
    ).toBe(false);

    const facilitator = buildFacilitator();
    const supported = facilitator.getSupported();
    expect(
      supported.kinds.some(
        (k) => k.network === "eip155:421614" && k.scheme === "exact",
      ),
    ).toBe(true);
  });
});
