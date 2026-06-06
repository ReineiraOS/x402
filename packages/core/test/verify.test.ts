import { describe, it, expect, vi } from "vitest";
import { getAddress, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyExact } from "../src/exact/verify.js";
import type { PaymentPayload, PaymentRequirements } from "../src/types.js";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const FROM = ACCOUNT.address;
const PAY_TO = getAddress("0x000000000000000000000000000000000000dEaD");
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const NETWORK = "eip155:421614" as const;
const AMOUNT = "100000";
const NONCE = ("0x" + "ab".repeat(32)) as `0x${string}`;

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
  authOverrides: Partial<{
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
  }> = {},
  accepted: PaymentRequirements = requirement(),
): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: FROM,
    to: authOverrides.to ?? PAY_TO,
    value: authOverrides.value ?? AMOUNT,
    validAfter: authOverrides.validAfter ?? (now - 600).toString(),
    validBefore: authOverrides.validBefore ?? (now + 120).toString(),
    nonce: authOverrides.nonce ?? NONCE,
  };

  const signature = await ACCOUNT.signTypedData({
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 421614,
      verifyingContract: USDC,
    },
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

  return {
    x402Version: 2,
    accepted,
    payload: { authorization, signature },
  };
}

function publicClient(opts: { nonceUsed?: boolean; balance?: bigint } = {}) {
  const readContract = vi.fn(async (args: { functionName: string }) => {
    if (args.functionName === "authorizationState") return opts.nonceUsed ?? false;
    if (args.functionName === "balanceOf") return opts.balance ?? BigInt(AMOUNT);
    throw new Error(`unexpected read: ${args.functionName}`);
  });
  return { readContract } as unknown as Pick<PublicClient, "readContract">;
}

describe("verifyExact", () => {
  it("returns isValid:true with payer for a well-formed signed payload", async () => {
    const payload = await signedPayload();
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(true);
    expect(getAddress(res.payer as string)).toBe(getAddress(FROM));
    expect(res.invalidReason).toBeUndefined();
  });

  it("rejects a scheme mismatch", async () => {
    const payload = await signedPayload({}, requirement());
    payload.accepted = requirement({ scheme: "upto" });
    const res = await verifyExact(payload, requirement({ scheme: "upto" }), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_scheme");
  });

  it("rejects missing eip712 domain (extra null)", async () => {
    const payload = await signedPayload({}, requirement({ extra: null }));
    const res = await verifyExact(payload, requirement({ extra: null }), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_missing_eip712_domain");
  });

  it("rejects a network mismatch between payload.accepted and requirements", async () => {
    const accepted = requirement({ network: "eip155:84532" });
    const payload = await signedPayload({}, accepted);
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_network_mismatch");
  });

  it("rejects an asset mismatch", async () => {
    const otherAsset = getAddress("0x1111111111111111111111111111111111111111");
    const accepted = requirement({ asset: otherAsset });
    const payload = await signedPayload({}, accepted);
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_asset_mismatch");
  });

  it("rejects a tampered signature (recovered signer != from)", async () => {
    const payload = await signedPayload();
    const inner = payload.payload as { authorization: { value: string } };
    inner.authorization.value = "999999";
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_signature");
  });

  it("rejects a recipient mismatch (to != payTo)", async () => {
    const otherTo = getAddress("0x2222222222222222222222222222222222222222");
    const payload = await signedPayload({ to: otherTo });
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_recipient_mismatch");
  });

  it("rejects an expired validBefore", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = await signedPayload({ validBefore: (now - 1).toString() });
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_payload_authorization_valid_before");
  });

  it("rejects a not-yet-valid validAfter", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = await signedPayload({ validAfter: (now + 600).toString() });
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_payload_authorization_valid_after");
  });

  it("rejects a value != requirements.amount", async () => {
    const payload = await signedPayload({ value: "200000" });
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient(),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_authorization_value");
  });

  it("rejects a used nonce", async () => {
    const payload = await signedPayload();
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient({ nonceUsed: true }),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_nonce_already_used");
  });

  it("rejects an insufficient balance", async () => {
    const payload = await signedPayload();
    const res = await verifyExact(payload, requirement(), {
      publicClient: publicClient({ balance: BigInt(AMOUNT) - 1n }),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_exact_evm_insufficient_balance");
  });
});
