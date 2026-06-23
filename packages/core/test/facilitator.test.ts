import { describe, it, expect, vi } from "vitest";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { X402Facilitator, registerExactEvmScheme } from "../src/facilitator.js";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "../src/exact/settle.js";
import type { PaymentPayload, PaymentRequirements } from "../src/types.js";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const FROM = ACCOUNT.address;
const PAY_TO = getAddress("0x000000000000000000000000000000000000dEaD");
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const NETWORK = "eip155:421614" as const;
const AMOUNT = "100000";
const NONCE = ("0x" + "ab".repeat(32)) as `0x${string}`;
const TX_HASH = ("0x" + "ee".repeat(32)) as `0x${string}`;
const SIGNER_ADDRESS = getAddress("0x3333333333333333333333333333333333333333");

const TransferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function requirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

async function signedPayload(
  accepted: PaymentRequirements = requirement(),
): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: FROM,
    to: PAY_TO,
    value: AMOUNT,
    validAfter: (now - 600).toString(),
    validBefore: (now + 120).toString(),
    nonce: NONCE,
  };
  const signature = await ACCOUNT.signTypedData({
    domain: { name: "USD Coin", version: "2", chainId: 421614, verifyingContract: USDC },
    types: TransferWithAuthorizationTypes,
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  return { x402Version: 2, accepted, payload: { authorization, signature } };
}

function buildSigner(receiptStatus = "success"): FacilitatorEvmSigner {
  const readContract = vi.fn(async (args: { functionName: string }) => {
    if (args.functionName === "authorizationState") return false;
    if (args.functionName === "balanceOf") return BigInt(AMOUNT);
    throw new Error(`unexpected read: ${args.functionName}`);
  });
  return {
    getAddresses: () => [SIGNER_ADDRESS],
    readContract,
    writeContract: vi.fn(async () => TX_HASH),
    waitForTransactionReceipt: vi.fn(async () => ({ status: receiptStatus })),
  };
}

describe("X402Facilitator", () => {
  it("a fresh facilitator supports no networks", () => {
    const facilitator = new X402Facilitator();
    expect(facilitator.getSupported().kinds.some((k) => k.network === NETWORK)).toBe(false);
  });

  it("registerExactEvmScheme wires eip155:421614 into getSupported", () => {
    const facilitator = new X402Facilitator();
    registerExactEvmScheme(facilitator, { signer: buildSigner(), networks: NETWORK });

    const supported = facilitator.getSupported();
    expect(
      supported.kinds.some(
        (k) => k.network === NETWORK && k.scheme === "exact" && k.x402Version === 2,
      ),
    ).toBe(true);
    expect(supported.signers["eip155"]).toContain(SIGNER_ADDRESS);
  });

  it("exposes verify and settle methods", () => {
    const facilitator = new X402Facilitator();
    registerExactEvmScheme(facilitator, { signer: buildSigner(), networks: NETWORK });
    expect(typeof facilitator.verify).toBe("function");
    expect(typeof facilitator.settle).toBe("function");
  });

  it("registers an array of networks", () => {
    const facilitator = new X402Facilitator();
    registerExactEvmScheme(facilitator, {
      signer: buildSigner(),
      networks: [NETWORK, "eip155:84532"],
    });
    const networks = facilitator.getSupported().kinds.map((k) => k.network);
    expect(networks).toContain(NETWORK);
    expect(networks).toContain("eip155:84532");
  });

  it("verify delegates to the exact scheme and returns isValid:true", async () => {
    const facilitator = new X402Facilitator();
    registerExactEvmScheme(facilitator, { signer: buildSigner(), networks: NETWORK });
    const res = await facilitator.verify(await signedPayload(), requirement());
    expect(res.isValid).toBe(true);
    expect(getAddress(res.payer as string)).toBe(getAddress(FROM));
  });

  it("settle delegates to the exact scheme and returns the tx hash", async () => {
    const facilitator = new X402Facilitator();
    registerExactEvmScheme(facilitator, { signer: buildSigner(), networks: NETWORK });
    const res = await facilitator.settle(await signedPayload(), requirement());
    expect(res.success).toBe(true);
    expect(res.transaction).toBe(TX_HASH);
    expect(res.network).toBe(NETWORK);
  });

  it("verify throws when no scheme is registered for the network", async () => {
    const facilitator = new X402Facilitator();
    registerExactEvmScheme(facilitator, { signer: buildSigner(), networks: NETWORK });
    await expect(
      facilitator.verify(
        await signedPayload(requirement({ network: "eip155:84532" })),
        requirement({ network: "eip155:84532" }),
      ),
    ).rejects.toThrow(/No facilitator registered/);
  });

  it("toFacilitatorEvmSigner-built signer is accepted by registerExactEvmScheme", () => {
    const facilitator = new X402Facilitator();
    const signer = toFacilitatorEvmSigner({
      address: SIGNER_ADDRESS,
      readContract: vi.fn(async () => false),
      writeContract: vi.fn(async () => TX_HASH),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    });
    registerExactEvmScheme(facilitator, { signer, networks: NETWORK });
    expect(facilitator.getSupported().signers["eip155"]).toContain(SIGNER_ADDRESS);
  });
});
