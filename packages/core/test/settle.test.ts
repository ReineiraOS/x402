import { describe, it, expect, vi } from "vitest";
import { getAddress, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  settleExact,
  toFacilitatorEvmSigner,
  type FacilitatorEvmSigner,
} from "../src/exact/settle.js";
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

function requirement(): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
    extra: { name: "USD Coin", version: "2" },
  };
}

async function signedPayload(): Promise<PaymentPayload> {
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
  return { x402Version: 2, accepted: requirement(), payload: { authorization, signature } };
}

function publicClient() {
  const readContract = vi.fn(async (args: { functionName: string }) => {
    if (args.functionName === "authorizationState") return false;
    if (args.functionName === "balanceOf") return BigInt(AMOUNT);
    throw new Error(`unexpected read: ${args.functionName}`);
  });
  return { readContract } as unknown as Pick<PublicClient, "readContract">;
}

function signer(receiptStatus = "success") {
  const writeContract = vi.fn(async () => TX_HASH);
  const waitForTransactionReceipt = vi.fn(async () => ({ status: receiptStatus }));
  const s: FacilitatorEvmSigner = {
    getAddresses: () => [getAddress("0x3333333333333333333333333333333333333333")],
    readContract: vi.fn(),
    writeContract,
    waitForTransactionReceipt,
  };
  return { signer: s, writeContract, waitForTransactionReceipt };
}

describe("toFacilitatorEvmSigner", () => {
  it("wraps a client's single address into getAddresses()", () => {
    const address = getAddress("0x4444444444444444444444444444444444444444");
    const wrapped = toFacilitatorEvmSigner({
      address,
      readContract: vi.fn(),
      writeContract: vi.fn(async () => TX_HASH),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    });
    expect(wrapped.getAddresses()).toEqual([address]);
  });
});

describe("settleExact", () => {
  it("happy path: calls transferWithAuthorization (v/r/s overload) and returns the tx hash", async () => {
    const payload = await signedPayload();
    const { signer: s, writeContract, waitForTransactionReceipt } = signer();
    const res = await settleExact(payload, requirement(), {
      signer: s,
      publicClient: publicClient(),
    });

    expect(res.success).toBe(true);
    expect(res.transaction).toBe(TX_HASH);
    expect(res.network).toBe(NETWORK);
    expect(getAddress(res.payer as string)).toBe(getAddress(FROM));

    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0]![0] as {
      address: string;
      functionName: string;
      args: unknown[];
    };
    expect(getAddress(call.address)).toBe(USDC);
    expect(call.functionName).toBe("transferWithAuthorization");
    expect(call.args).toHaveLength(9);
    expect(getAddress(call.args[0] as string)).toBe(getAddress(FROM));
    expect(getAddress(call.args[1] as string)).toBe(PAY_TO);
    expect(call.args[2]).toBe(BigInt(AMOUNT));
    expect(call.args[5]).toBe(NONCE);
    expect([27, 28]).toContain(call.args[6]);
    expect(call.args[7]).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(call.args[8]).toMatch(/^0x[0-9a-fA-F]{64}$/);

    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
  });

  it("returns success:false with errorReason when the receipt status is not success", async () => {
    const payload = await signedPayload();
    const { signer: s } = signer("reverted");
    const res = await settleExact(payload, requirement(), {
      signer: s,
      publicClient: publicClient(),
    });
    expect(res.success).toBe(false);
    expect(res.errorReason).toBe("invalid_exact_evm_transaction_failed");
    expect(res.transaction).toBe(TX_HASH);
  });

  it("short-circuits an invalid payload without writing on-chain", async () => {
    const payload = await signedPayload();
    (payload.payload as { authorization: { value: string } }).authorization.value = "999999";
    const { signer: s, writeContract } = signer();
    const res = await settleExact(payload, requirement(), {
      signer: s,
      publicClient: publicClient(),
    });
    expect(res.success).toBe(false);
    expect(res.errorReason).toBe("invalid_exact_evm_signature");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("returns success:false when writeContract throws", async () => {
    const payload = await signedPayload();
    const s: FacilitatorEvmSigner = {
      getAddresses: () => [getAddress("0x3333333333333333333333333333333333333333")],
      readContract: vi.fn(),
      writeContract: vi.fn(async () => {
        throw new Error("nonce too low");
      }),
      waitForTransactionReceipt: vi.fn(),
    };
    const res = await settleExact(payload, requirement(), {
      signer: s,
      publicClient: publicClient(),
    });
    expect(res.success).toBe(false);
    expect(res.errorReason).toBe("nonce too low");
  });
});
