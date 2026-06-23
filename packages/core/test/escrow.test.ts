import { describe, it, expect, vi } from "vitest";
import {
  decodeAbiParameters,
  getAddress,
  hashTypedData,
  recoverTypedDataAddress,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { paymentAuthorizationAbiParameters } from "@reineira-os/x402-shared";
import {
  deriveEscrowNonce,
  encodePaymentAuthorization,
  getEscrowExtra,
  ReceiveWithAuthorizationTypes,
} from "../src/exact/escrow.js";
import { ExactEvmScheme } from "../src/exact/client.js";
import { verifyExact } from "../src/exact/verify.js";
import { settleExact } from "../src/exact/settle.js";
import type { PaymentPayload, PaymentRequirements } from "../src/types.js";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const FROM = ACCOUNT.address;
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const RECEIVER = getAddress("0x1111111111111111111111111111111111111111");
const ESCROW = getAddress("0x2222222222222222222222222222222222222222");
const NETWORK = "eip155:421614" as const;
const AMOUNT = "100000";
const ESCROW_ID = "7";
const SALT = ("0x" + "00".repeat(31) + "ab") as `0x${string}`;

// cast keccak $(cast abi-encode "f(uint256,bytes32)" 7 0x00..ab)
const EXPECTED_NONCE = "0x89f7b0b4367d0fcce3b212957a1b1d291a2233228dbe23ba5a35fc72b112aebe";

function escrowRequirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC,
    payTo: RECEIVER,
    maxTimeoutSeconds: 120,
    extra: {
      name: "USD Coin",
      version: "2",
      escrow: { escrowId: ESCROW_ID, salt: SALT, receiver: RECEIVER, escrow: ESCROW },
    },
    ...overrides,
  };
}

function publicClient(
  opts: {
    nonceUsed?: boolean;
    balance?: bigint;
    erc1271?: `0x${string}` | Error;
  } = {},
) {
  const readContract = vi.fn(async (args: { functionName: string }) => {
    if (args.functionName === "authorizationState") return opts.nonceUsed ?? false;
    if (args.functionName === "balanceOf") return opts.balance ?? BigInt(AMOUNT);
    if (args.functionName === "isValidSignature") {
      if (opts.erc1271 instanceof Error) throw opts.erc1271;
      return opts.erc1271 ?? "0xffffffff";
    }
    throw new Error(`unexpected read: ${args.functionName}`);
  });
  return { readContract } as unknown as Pick<PublicClient, "readContract">;
}

async function escrowPayload(
  requirements: PaymentRequirements = escrowRequirement(),
): Promise<PaymentPayload> {
  const scheme = new ExactEvmScheme({
    address: FROM,
    signTypedData: (message) =>
      ACCOUNT.signTypedData(message as Parameters<typeof ACCOUNT.signTypedData>[0]),
  });
  const partial = await scheme.createPaymentPayload(2, requirements);
  return {
    x402Version: 2,
    accepted: requirements,
    payload: partial.payload as unknown as Record<string, unknown>,
  };
}

describe("deriveEscrowNonce", () => {
  it("matches Solidity keccak256(abi.encode(uint256,bytes32))", () => {
    expect(deriveEscrowNonce(BigInt(ESCROW_ID), SALT)).toBe(EXPECTED_NONCE);
  });

  it("changes when escrowId or salt change", () => {
    expect(deriveEscrowNonce(8n, SALT)).not.toBe(EXPECTED_NONCE);
    expect(
      deriveEscrowNonce(BigInt(ESCROW_ID), ("0x" + "00".repeat(31) + "ac") as `0x${string}`),
    ).not.toBe(EXPECTED_NONCE);
  });
});

describe("getEscrowExtra", () => {
  it("returns null when no escrow extra is present", () => {
    expect(
      getEscrowExtra(escrowRequirement({ extra: { name: "USD Coin", version: "2" } })),
    ).toBeNull();
  });

  it("parses and checksums a well-formed escrow extra", () => {
    const extra = getEscrowExtra(escrowRequirement());
    expect(extra).toEqual({
      escrowId: ESCROW_ID,
      salt: SALT,
      receiver: RECEIVER,
      escrow: ESCROW,
    });
  });

  it("throws on a malformed escrow extra", () => {
    expect(() =>
      getEscrowExtra(
        escrowRequirement({
          extra: { name: "USD Coin", version: "2", escrow: { escrowId: 7 } },
        }),
      ),
    ).toThrow();
  });
});

describe("ExactEvmScheme escrow mode", () => {
  it("binds the nonce to the escrow and signs ReceiveWithAuthorization", async () => {
    const payload = await escrowPayload();
    const exact = payload.payload as unknown as {
      authorization: Record<string, string>;
      signature: `0x${string}`;
    };

    expect(exact.authorization.nonce).toBe(EXPECTED_NONCE);
    expect(getAddress(exact.authorization.to)).toBe(RECEIVER);

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 421614,
        verifyingContract: USDC,
      },
      types: ReceiveWithAuthorizationTypes,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: getAddress(exact.authorization.from),
        to: getAddress(exact.authorization.to),
        value: BigInt(exact.authorization.value),
        validAfter: BigInt(exact.authorization.validAfter),
        validBefore: BigInt(exact.authorization.validBefore),
        nonce: exact.authorization.nonce as `0x${string}`,
      },
      signature: exact.signature,
    });
    expect(getAddress(recovered)).toBe(getAddress(FROM));
  });
});

describe("verifyExact escrow mode", () => {
  it("accepts a valid escrow payment from an EOA signer", async () => {
    const payload = await escrowPayload();
    const res = await verifyExact(payload, escrowRequirement(), {
      publicClient: publicClient(),
    });
    expect(res).toMatchObject({ isValid: true, payer: FROM });
  });

  it("rejects a nonce that is not bound to the escrow", async () => {
    const requirements = escrowRequirement();
    const payload = await escrowPayload(requirements);
    const tamperedRequirements = escrowRequirement({
      extra: {
        name: "USD Coin",
        version: "2",
        escrow: { escrowId: "8", salt: SALT, receiver: RECEIVER, escrow: ESCROW },
      },
    });
    const res = await verifyExact(
      { ...payload, accepted: tamperedRequirements },
      tamperedRequirements,
      { publicClient: publicClient() },
    );
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain("escrow_nonce_mismatch");
  });

  it("rejects when payTo does not match the escrow receiver", async () => {
    const bad = escrowRequirement({ payTo: ESCROW });
    const payload = await escrowPayload(bad);
    const res = await verifyExact(payload, bad, { publicClient: publicClient() });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain("escrow_receiver_mismatch");
  });

  it("accepts a contract signer via ERC-1271 when ecrecover does not match", async () => {
    const contractPayer = getAddress("0x3333333333333333333333333333333333333333");
    const payload = await escrowPayload();
    const exact = payload.payload as unknown as {
      authorization: Record<string, string>;
      signature: `0x${string}`;
    };
    exact.authorization.from = contractPayer;

    const client = publicClient({ erc1271: "0x1626ba7e" });
    const res = await verifyExact(payload, escrowRequirement(), {
      publicClient: client,
    });
    expect(res).toMatchObject({ isValid: true, payer: contractPayer });

    const isValidSigCall = (client.readContract as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as { functionName: string }).functionName === "isValidSignature",
    );
    expect(isValidSigCall).toBeDefined();
    const callArgs = isValidSigCall![0] as {
      address: `0x${string}`;
      args: [`0x${string}`, `0x${string}`];
    };
    expect(getAddress(callArgs.address)).toBe(contractPayer);
    const expectedDigest = hashTypedData({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 421614,
        verifyingContract: USDC,
      },
      types: ReceiveWithAuthorizationTypes,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: contractPayer,
        to: getAddress(exact.authorization.to),
        value: BigInt(exact.authorization.value),
        validAfter: BigInt(exact.authorization.validAfter),
        validBefore: BigInt(exact.authorization.validBefore),
        nonce: exact.authorization.nonce as `0x${string}`,
      },
    });
    expect(callArgs.args[0]).toBe(expectedDigest);
  });

  it("rejects a contract signer when isValidSignature does not return the magic", async () => {
    const contractPayer = getAddress("0x3333333333333333333333333333333333333333");
    const payload = await escrowPayload();
    (payload.payload as unknown as { authorization: Record<string, string> }).authorization.from =
      contractPayer;

    const res = await verifyExact(payload, escrowRequirement(), {
      publicClient: publicClient({ erc1271: "0xffffffff" }),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain("signature");
  });

  it("rejects a non-contract payer whose signature does not recover", async () => {
    const stranger = getAddress("0x4444444444444444444444444444444444444444");
    const payload = await escrowPayload();
    (payload.payload as unknown as { authorization: Record<string, string> }).authorization.from =
      stranger;

    const res = await verifyExact(payload, escrowRequirement(), {
      publicClient: publicClient({ erc1271: new Error("no code at address") }),
    });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain("signature");
  });
});

describe("settleExact escrow mode", () => {
  it("settles through the receiver with the ABI-encoded payment authorization", async () => {
    const payload = await escrowPayload();
    const exact = payload.payload as unknown as {
      authorization: {
        from: `0x${string}`;
        to: `0x${string}`;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
      };
      signature: `0x${string}`;
    };

    const writeContract = vi.fn(async () => "0xtxhash" as `0x${string}`);
    const readContract = vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "authorizationState") return false;
      if (args.functionName === "balanceOf") return BigInt(AMOUNT);
      throw new Error(`unexpected read: ${args.functionName}`);
    });
    const signer = {
      getAddresses: () => ["0x5555555555555555555555555555555555555555"] as const,
      readContract,
      writeContract,
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };

    const res = await settleExact(payload, escrowRequirement(), {
      signer,
      publicClient: { readContract },
    });

    expect(res.success).toBe(true);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0]![0] as unknown as {
      address: `0x${string}`;
      functionName: string;
      args: [bigint, `0x${string}`];
    };
    expect(getAddress(call.address)).toBe(RECEIVER);
    expect(call.functionName).toBe("settle");
    expect(call.args[0]).toBe(BigInt(ESCROW_ID));

    const [decoded] = decodeAbiParameters(paymentAuthorizationAbiParameters, call.args[1]);
    expect(decoded).toMatchObject({
      from: getAddress(exact.authorization.from),
      value: BigInt(exact.authorization.value),
      nonce: EXPECTED_NONCE,
      salt: SALT,
      signature: exact.signature,
    });

    const encoded = encodePaymentAuthorization(exact.authorization, SALT, exact.signature);
    expect(call.args[1]).toBe(encoded);
  });

  it("keeps the legacy transferWithAuthorization path for non-escrow payments", async () => {
    const requirements = escrowRequirement({
      payTo: "0x000000000000000000000000000000000000dEaD",
      extra: { name: "USD Coin", version: "2" },
    });
    const payload = await escrowPayload(requirements);

    const writeContract = vi.fn(async () => "0xtxhash" as `0x${string}`);
    const readContract = vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "authorizationState") return false;
      if (args.functionName === "balanceOf") return BigInt(AMOUNT);
      throw new Error(`unexpected read: ${args.functionName}`);
    });
    const signer = {
      getAddresses: () => ["0x5555555555555555555555555555555555555555"] as const,
      readContract,
      writeContract,
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };

    const res = await settleExact(payload, requirements, {
      signer,
      publicClient: { readContract },
    });

    expect(res.success).toBe(true);
    const call = writeContract.mock.calls[0]![0] as unknown as {
      address: `0x${string}`;
      functionName: string;
    };
    expect(getAddress(call.address)).toBe(USDC);
    expect(call.functionName).toBe("transferWithAuthorization");
  });
});
