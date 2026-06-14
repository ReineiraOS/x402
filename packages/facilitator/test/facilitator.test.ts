import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createFacilitator } from "../src/facilitator.js";

describe("createFacilitator", () => {
  it("builds an x402Facilitator exposing verify and settle", () => {
    const account = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const facilitator = createFacilitator({ account });
    expect(typeof facilitator.verify).toBe("function");
    expect(typeof facilitator.settle).toBe("function");
  });
});
