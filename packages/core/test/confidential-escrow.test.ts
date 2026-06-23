import { describe, it, expect, vi } from "vitest";
import { getAddress } from "viem";
import {
  createConfidentialEscrow,
  readConfidentialAmount,
} from "../src/exact/confidential-escrow.js";
import type { ConfidentialClient, EncryptedInput } from "../src/exact/confidential.js";

vi.mock("../src/exact/confidential.js", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    encryptUint64: vi.fn(
      async (): Promise<EncryptedInput> => ({
        ctHash: 1n,
        securityZone: 0,
        utype: 5,
        signature: "0x01",
      }),
    ),
    encryptAddress: vi.fn(
      async (): Promise<EncryptedInput> => ({
        ctHash: 2n,
        securityZone: 0,
        utype: 7,
        signature: "0x02",
      }),
    ),
    decryptUint64: vi.fn(async () => 250000n),
  };
});

const ESCROW = getAddress("0x2222222222222222222222222222222222222222");
const RESOLVER = getAddress("0x3333333333333333333333333333333333333333");
const SELLER = getAddress("0x4444444444444444444444444444444444444444");

function fakeViem(overrides: Record<string, unknown> = {}) {
  const simulateContract = vi.fn(async (args: { functionName: string }) => ({
    request: { ...args },
  }));
  const writeContract = vi.fn(async () => "0xtx" as `0x${string}`);
  const waitForTransactionReceipt = vi.fn(async () => ({
    status: "success",
    logs: [],
  }));
  const readContract = vi.fn(async (args: { functionName: string }) => {
    if (args.functionName === "total") return 5n;
    if (args.functionName === "getOwner") return SELLER;
    if (args.functionName === "getAmount") return 999n; // ciphertext handle
    throw new Error(`unexpected read ${args.functionName}`);
  });
  return {
    publicClient: {
      simulateContract,
      readContract,
      waitForTransactionReceipt,
      getBlock: vi.fn(async () => ({ timestamp: 0n })),
    },
    walletClient: { writeContract, account: { address: SELLER } },
    ...overrides,
  } as never;
}

const fhe = { account: SELLER } as unknown as ConfidentialClient;

describe("createConfidentialEscrow", () => {
  it("encrypts owner + amount and calls create with the two encrypted tuples", async () => {
    const viem = fakeViem();
    const { confidential } = await import("../src/exact/confidential.js");
    void confidential;
    const res = await createConfidentialEscrow(fhe, viem, {
      escrow: ESCROW,
      owner: SELLER,
      amount: 250000n,
      resolver: RESOLVER,
      resolverData: "0x",
    });
    const call = (viem as { publicClient: { simulateContract: ReturnType<typeof vi.fn> } })
      .publicClient.simulateContract.mock.calls[0]![0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("create");
    expect((call.args[0] as EncryptedInput).utype).toBe(7); // encrypted owner (address)
    expect((call.args[1] as EncryptedInput).utype).toBe(5); // encrypted amount (uint64)
    expect(call.args[2]).toBe(RESOLVER);
    expect(res.escrowId).toBe(4n); // total(5) - 1, owner matched
  });
});

describe("readConfidentialAmount", () => {
  it("reads the encrypted handle then decrypts it", async () => {
    const viem = fakeViem();
    const amount = await readConfidentialAmount(fhe, viem, { escrow: ESCROW, escrowId: 4n });
    expect(amount).toBe(250000n);
  });
});
