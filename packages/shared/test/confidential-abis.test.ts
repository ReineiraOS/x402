import { describe, it, expect } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { confidentialEscrowAbi, confidentialX402ReceiverAbi } from "../src/abis.js";

const encInput = {
  ctHash: 123456789n,
  securityZone: 0,
  utype: 5,
  signature: "0xdeadbeef" as `0x${string}`,
};
const encAddr = { ...encInput, utype: 7 };

describe("confidentialEscrowAbi.create", () => {
  it("encodes the InEaddress/InEuint64 tuples and round-trips", () => {
    const data = encodeFunctionData({
      abi: confidentialEscrowAbi,
      functionName: "create",
      args: [encAddr, encInput, "0x000000000000000000000000000000000000dEaD", "0x"],
    });
    const decoded = decodeFunctionData({ abi: confidentialEscrowAbi, data });
    expect(decoded.functionName).toBe("create");
    expect((decoded.args as readonly unknown[])[1]).toMatchObject({ ctHash: 123456789n, utype: 5 });
  });
});

describe("confidentialEscrowAbi getters", () => {
  it("declares encrypted handle getters returning uint256", () => {
    const getAmount = confidentialEscrowAbi.find(
      (e) => e.type === "function" && e.name === "getAmount",
    );
    expect(getAmount).toBeDefined();
    expect((getAmount as { outputs: { type: string }[] }).outputs[0]!.type).toBe("uint256");
  });
});

describe("confidentialX402ReceiverAbi.settle", () => {
  it("has the same (uint256,bytes) settle selector as the plaintext receiver", () => {
    const data = encodeFunctionData({
      abi: confidentialX402ReceiverAbi,
      functionName: "settle",
      args: [7n, "0x00"],
    });
    expect(data.slice(0, 10)).toBe("0x39c2ebb9");
  });
});
