import { describe, it, expect } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { confidentialCoverageManagerAbi } from "../src/abis.js";

const encAddr = { ctHash: 2n, securityZone: 0, utype: 7, signature: "0x02" as `0x${string}` };
const encAmount = { ctHash: 1n, securityZone: 0, utype: 5, signature: "0x01" as `0x${string}` };
const POOL = "0x1111111111111111111111111111111111111111";
const POLICY = "0x2222222222222222222222222222222222222222";

describe("confidentialCoverageManagerAbi.purchaseCoverage", () => {
  it("encodes the InEaddress/InEuint64 tuples in the right positions and round-trips", () => {
    const data = encodeFunctionData({
      abi: confidentialCoverageManagerAbi,
      functionName: "purchaseCoverage",
      args: [encAddr, POOL, POLICY, 7n, encAmount, 9999n, "0x", "0x"],
    });
    const decoded = decodeFunctionData({ abi: confidentialCoverageManagerAbi, data });
    expect(decoded.functionName).toBe("purchaseCoverage");
    const args = decoded.args as readonly unknown[];
    expect((args[0] as { utype: number }).utype).toBe(7); // encrypted holder (address)
    expect((args[4] as { utype: number }).utype).toBe(5); // encrypted coverage amount (uint64)
    expect(args[3]).toBe(7n);
  });
});

describe("confidentialCoverageManagerAbi shape", () => {
  it("declares dispute, coverageStatus, getCoveragesForEscrow and the CoveragePurchased event", () => {
    const names = confidentialCoverageManagerAbi.map((e) => ("name" in e ? e.name : ""));
    expect(names).toContain("dispute");
    expect(names).toContain("coverageStatus");
    expect(names).toContain("getCoveragesForEscrow");
    expect(names).toContain("CoveragePurchased");
  });
});
