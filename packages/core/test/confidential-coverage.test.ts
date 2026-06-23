import { describe, it, expect, vi } from "vitest";
import { getAddress, decodeAbiParameters, encodeEventTopics } from "viem";
import { confidentialCoverageManagerAbi } from "@reineira-os/x402-shared";
import {
  purchaseConfidentialCoverage,
  disputeConfidentialCoverage,
  getCoverageStatus,
} from "../src/exact/confidential-coverage.js";
import { encryptAddress, encryptUint64 } from "../src/exact/confidential.js";
import type { ConfidentialClient, EncryptedInput } from "../src/exact/confidential.js";

vi.mock("../src/exact/confidential.js", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    encryptAddress: vi.fn(
      async (): Promise<EncryptedInput> => ({
        ctHash: 2n,
        securityZone: 0,
        utype: 7,
        signature: "0x02",
      }),
    ),
    encryptUint64: vi.fn(
      async (): Promise<EncryptedInput> => ({
        ctHash: 1n,
        securityZone: 0,
        utype: 5,
        signature: "0x01",
      }),
    ),
  };
});

const CM = getAddress("0x5555555555555555555555555555555555555555");
const POOL = getAddress("0x1111111111111111111111111111111111111111");
const POLICY = getAddress("0x2222222222222222222222222222222222222222");
const HOLDER = getAddress("0x4444444444444444444444444444444444444444");

function fakeViem(reads: Record<string, unknown>, logs: unknown[] = []) {
  const simulateContract = vi.fn(async (args: { functionName: string }) => ({
    request: { ...args },
  }));
  const writeContract = vi.fn(async () => "0xtx" as `0x${string}`);
  const waitForTransactionReceipt = vi.fn(async () => ({ status: "success", logs }));
  const readContract = vi.fn(async (args: { functionName: string }) => {
    if (args.functionName in reads) return reads[args.functionName];
    throw new Error(`unexpected read ${args.functionName}`);
  });
  return {
    publicClient: { simulateContract, readContract, waitForTransactionReceipt },
    walletClient: { writeContract, account: { address: HOLDER } },
  } as never;
}

const fhe = { account: HOLDER } as unknown as ConfidentialClient;

describe("purchaseConfidentialCoverage", () => {
  it("encrypts holder + amount and calls purchaseCoverage with escrowId-only policyData", async () => {
    const viem = fakeViem({ getCoveragesForEscrow: [41n, 42n] });
    const res = await purchaseConfidentialCoverage(fhe, viem, {
      coverageManager: CM,
      pool: POOL,
      policy: POLICY,
      escrowId: 7n,
      holder: HOLDER,
      amount: 250000n,
      expiry: 9999n,
    });
    const call = (viem as { publicClient: { simulateContract: ReturnType<typeof vi.fn> } })
      .publicClient.simulateContract.mock.calls[0]![0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("purchaseCoverage");
    expect((call.args[0] as EncryptedInput).utype).toBe(7); // holder
    expect((call.args[4] as EncryptedInput).utype).toBe(5); // amount
    // policyData (args[6]) is escrowId-only
    const [decodedEscrowId] = decodeAbiParameters(
      [{ type: "uint256" }],
      call.args[6] as `0x${string}`,
    );
    expect(decodedEscrowId).toBe(7n);
    // riskProof empty
    expect(call.args[7]).toBe("0x");
    // coverageId falls back to last of getCoveragesForEscrow when no event
    expect(res.coverageId).toBe(42n);
    expect(vi.mocked(encryptAddress)).toHaveBeenCalledWith(fhe, HOLDER);
    expect(vi.mocked(encryptUint64)).toHaveBeenCalledWith(fhe, 250000n);
  });

  it("recovers coverageId from the CoveragePurchased event, taking precedence over the fallback", async () => {
    const topics = encodeEventTopics({
      abi: confidentialCoverageManagerAbi,
      eventName: "CoveragePurchased",
      args: { coverageId: 100n },
    });
    const log = {
      address: CM,
      topics,
      data: "0x" as `0x${string}`,
      blockNumber: 1n,
      blockHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      logIndex: 0,
      transactionHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      transactionIndex: 0,
      removed: false,
    };
    const viem = fakeViem({ getCoveragesForEscrow: [999n] }, [log]);
    const res = await purchaseConfidentialCoverage(fhe, viem, {
      coverageManager: CM,
      pool: POOL,
      policy: POLICY,
      escrowId: 7n,
      holder: HOLDER,
      amount: 250000n,
      expiry: 9999n,
    });
    expect(res.coverageId).toBe(100n);
  });
});

describe("disputeConfidentialCoverage", () => {
  it("calls dispute with the coverageId and empty proof", async () => {
    const viem = fakeViem({});
    const tx = await disputeConfidentialCoverage(viem, { coverageManager: CM, coverageId: 42n });
    const call = (viem as { publicClient: { simulateContract: ReturnType<typeof vi.fn> } })
      .publicClient.simulateContract.mock.calls[0]![0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("dispute");
    expect(call.args[0]).toBe(42n);
    expect(call.args[1]).toBe("0x");
    expect(tx).toBe("0xtx");
  });
});

describe("getCoverageStatus", () => {
  it("reads coverageStatus and returns it as a number", async () => {
    const viem = fakeViem({ coverageStatus: 1 });
    const status = await getCoverageStatus(viem, { coverageManager: CM, coverageId: 42n });
    expect(status).toBe(1);
  });
});
