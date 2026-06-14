import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeFunctionData,
  getAddress,
  parseSignature,
  verifyTypedData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  encodePaymentRequiredHeader as x402EncodePaymentRequiredHeader,
  decodePaymentRequiredHeader as x402DecodePaymentRequiredHeader,
  encodePaymentSignatureHeader as x402EncodePaymentSignatureHeader,
  decodePaymentSignatureHeader as x402DecodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  ExactEvmScheme as X402ClientScheme,
  toClientEvmSigner as x402ToClientEvmSigner,
  eip3009ABI,
} from "@x402/evm";
import { ExactEvmScheme as X402FacilitatorScheme } from "@x402/evm/exact/facilitator";

import {
  encodePaymentRequiredHeader,
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  decodePaymentSignatureHeader,
} from "../src/http.js";
import { ExactEvmScheme as CoreClientScheme } from "../src/exact/client.js";
import { verifyExact } from "../src/exact/verify.js";
import { settleExact } from "../src/exact/settle.js";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "../src/types.js";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const FROM = ACCOUNT.address;
const PAY_TO = getAddress("0x000000000000000000000000000000000000dEaD");
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const NETWORK = "eip155:421614" as const;
const AMOUNT = "100000";
const FIXED_NONCE = ("0x" + "ab".repeat(32)) as Hex;
const FIXED_NOW_MS = 1717689600000;

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

function samplePaymentRequired(): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "https://example.com/api/resource",
      description: "Mock batch-inference job (1 batch, 12 shards)",
      mimeType: "application/json",
    },
    accepts: [requirement()],
  };
}

async function fixedSignedPayload(
  authOverrides: Partial<{
    to: Hex;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
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
    nonce: authOverrides.nonce ?? FIXED_NONCE,
  };
  const signature = await ACCOUNT.signTypedData({
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 421614,
      verifyingContract: USDC,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
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

/**
 * Pin crypto + clock so the random-nonce / Date.now()-driven scheme code in both
 * core and @x402/evm produces byte-identical output. Used only for the EIP-712
 * parity test where the real schemes generate their own authorization.
 */
function pinNonceAndClock(): () => void {
  const fixedBytes = new Uint8Array(32).fill(0xab);
  const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const realNow = Date.now;
  globalThis.crypto.getRandomValues = ((arr: ArrayBufferView) => {
    if (arr instanceof Uint8Array && arr.length === 32) {
      arr.set(fixedBytes);
      return arr;
    }
    return realGetRandomValues(arr as Uint8Array);
  }) as typeof globalThis.crypto.getRandomValues;
  Date.now = () => FIXED_NOW_MS;
  return () => {
    globalThis.crypto.getRandomValues = realGetRandomValues;
    Date.now = realNow;
  };
}

/**
 * Facilitator EVM signer for the REAL @x402/evm facilitator scheme that runs
 * fully offline: ECDSA verification is delegated to viem's offline verifyTypedData,
 * and the simulation / on-chain reads are stubbed identically to core's mock RPC.
 */
function x402OfflineFacilitatorSigner(opts: { simulateOk?: boolean } = {}) {
  return {
    address: getAddress("0x1111111111111111111111111111111111111111"),
    getAddresses: () => [getAddress("0x1111111111111111111111111111111111111111")],
    verifyTypedData: (args: {
      address: Hex;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: Hex;
    }) => verifyTypedData(args as Parameters<typeof verifyTypedData>[0]),
    getCode: async () => "0x" as Hex,
    readContract: async (args: { functionName: string }) => {
      if (args.functionName === "transferWithAuthorization") {
        if (opts.simulateOk === false) throw new Error("revert: simulation failed");
        return undefined;
      }
      if (args.functionName === "balanceOf") return BigInt(AMOUNT);
      if (args.functionName === "authorizationState") return false;
      if (args.functionName === "name") return "USD Coin";
      if (args.functionName === "version") return "2";
      throw new Error(`unexpected read: ${args.functionName}`);
    },
    writeContract: async () => "0x" + "11".repeat(32),
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as ConstructorParameters<typeof X402FacilitatorScheme>[0];
}

function coreOfflineReadContract(opts: { nonceUsed?: boolean; balance?: bigint } = {}) {
  return {
    readContract: async (args: { functionName: string }) => {
      if (args.functionName === "authorizationState") return opts.nonceUsed ?? false;
      if (args.functionName === "balanceOf") return opts.balance ?? BigInt(AMOUNT);
      throw new Error(`unexpected read: ${args.functionName}`);
    },
  };
}

describe("differential oracle — core vs installed @x402 runtime", () => {
  describe("(a) encodePaymentRequiredHeader byte-equal vs @x402/core/http", () => {
    it("produces a byte-identical header for a fixed PaymentRequired", () => {
      const pr = samplePaymentRequired();
      const coreHeader = encodePaymentRequiredHeader(pr);
      const x402Header = x402EncodePaymentRequiredHeader(
        pr as unknown as Parameters<typeof x402EncodePaymentRequiredHeader>[0],
      );
      expect(coreHeader).toBe(x402Header);
    });

    it("decodes a @x402-encoded header to the identical object", () => {
      const pr = samplePaymentRequired();
      const x402Header = x402EncodePaymentRequiredHeader(
        pr as unknown as Parameters<typeof x402EncodePaymentRequiredHeader>[0],
      );
      const coreDecoded = decodePaymentRequiredHeader(x402Header);
      const x402Decoded = x402DecodePaymentRequiredHeader(x402Header);
      expect(coreDecoded).toEqual(x402Decoded);
      expect(coreDecoded).toEqual(pr);
    });
  });

  describe("(b) decodePaymentSignatureHeader shape-equal vs @x402/core/http", () => {
    it("decodes a fixed header to the identical { accepted, payload, x402Version } shape", async () => {
      const payload = await fixedSignedPayload();
      const header = x402EncodePaymentSignatureHeader(
        payload as unknown as Parameters<typeof x402EncodePaymentSignatureHeader>[0],
      );
      const coreDecoded = decodePaymentSignatureHeader(header);
      const x402Decoded = x402DecodePaymentSignatureHeader(header);
      expect(coreDecoded).toEqual(x402Decoded);
      expect(Object.keys(coreDecoded as object).sort()).toEqual(
        Object.keys(x402Decoded as object).sort(),
      );
    });

    it("core-encoded payload header is byte-equal to @x402-encoded", async () => {
      const payload = await fixedSignedPayload();
      const coreHeader = encodePaymentSignatureHeader(payload);
      const x402Header = x402EncodePaymentSignatureHeader(
        payload as unknown as Parameters<typeof x402EncodePaymentSignatureHeader>[0],
      );
      expect(coreHeader).toBe(x402Header);
    });
  });

  describe("(c) EIP-712 parity — same account + requirement + fixed authorization", () => {
    let restore: () => void;
    beforeEach(() => {
      restore = pinNonceAndClock();
    });
    afterEach(() => {
      restore();
    });

    it("core ExactEvmScheme produces byte-equal authorization + signature vs @x402/evm", async () => {
      const requirements = requirement();

      const x402Signer = x402ToClientEvmSigner(
        ACCOUNT as unknown as Parameters<typeof x402ToClientEvmSigner>[0],
      );
      const x402Scheme = new X402ClientScheme(x402Signer);
      const coreSigner = {
        address: ACCOUNT.address,
        signTypedData: (m: Parameters<typeof ACCOUNT.signTypedData>[0]) =>
          ACCOUNT.signTypedData(m),
      };
      const coreScheme = new CoreClientScheme(coreSigner);

      const x402Out = await x402Scheme.createPaymentPayload(
        2,
        requirements as unknown as Parameters<typeof x402Scheme.createPaymentPayload>[1],
      );
      const coreOut = await coreScheme.createPaymentPayload(2, requirements);

      const x402Auth = (x402Out.payload as { authorization: unknown }).authorization;
      const coreAuth = coreOut.payload.authorization;
      expect(coreAuth).toEqual(x402Auth);

      const x402Sig = (x402Out.payload as { signature: Hex }).signature;
      const coreSig = coreOut.payload.signature;
      expect(coreSig).toBe(x402Sig);

      // The signature must be a valid TransferWithAuthorization signature for both.
      const valid = await verifyTypedData({
        address: FROM,
        domain: {
          name: "USD Coin",
          version: "2",
          chainId: 421614,
          verifyingContract: USDC,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: FROM,
          to: PAY_TO,
          value: BigInt(AMOUNT),
          validAfter: BigInt((coreAuth as { validAfter: string }).validAfter),
          validBefore: BigInt((coreAuth as { validBefore: string }).validBefore),
          nonce: (coreAuth as { nonce: Hex }).nonce,
        },
        signature: coreSig,
      });
      expect(valid).toBe(true);
    });
  });

  describe("(d) verifyExact decision matches @x402/evm verify on fixed payloads", () => {
    async function x402Verify(
      payload: PaymentPayload,
      requirements: PaymentRequirements,
      opts: { simulateOk?: boolean } = {},
    ) {
      const scheme = new X402FacilitatorScheme(x402OfflineFacilitatorSigner(opts));
      return scheme.verify(
        payload as unknown as Parameters<typeof scheme.verify>[0],
        requirements as unknown as Parameters<typeof scheme.verify>[1],
      );
    }

    async function coreVerify(
      payload: PaymentPayload,
      requirements: PaymentRequirements,
      opts: { nonceUsed?: boolean; balance?: bigint } = {},
    ) {
      return verifyExact(payload, requirements, {
        publicClient: coreOfflineReadContract(opts),
      });
    }

    it("both accept a well-formed fixed payload (isValid + payer match)", async () => {
      const payload = await fixedSignedPayload();
      const req = requirement();
      const x402Res = await x402Verify(payload, req);
      const coreRes = await coreVerify(payload, req);
      expect(coreRes.isValid).toBe(x402Res.isValid);
      expect(coreRes.isValid).toBe(true);
      expect(getAddress(coreRes.payer as string)).toBe(getAddress(x402Res.payer as string));
      expect(getAddress(coreRes.payer as string)).toBe(getAddress(FROM));
    });

    it("both reject a scheme mismatch with the same invalidReason", async () => {
      const req = requirement({ scheme: "upto" });
      const payload = await fixedSignedPayload({}, req);
      const x402Res = await x402Verify(payload, req);
      const coreRes = await coreVerify(payload, req);
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject a missing EIP-712 domain with the same invalidReason", async () => {
      const req = requirement({ extra: null });
      const payload = await fixedSignedPayload({}, req);
      const x402Res = await x402Verify(payload, req);
      const coreRes = await coreVerify(payload, req);
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject a network mismatch with the same invalidReason", async () => {
      const accepted = requirement({ network: "eip155:84532" });
      const payload = await fixedSignedPayload({}, accepted);
      const x402Res = await x402Verify(payload, requirement());
      const coreRes = await coreVerify(payload, requirement());
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject a tampered signature with the same invalidReason", async () => {
      const payload = await fixedSignedPayload();
      (payload.payload as { authorization: { value: string } }).authorization.value = "999999";
      const x402Res = await x402Verify(payload, requirement());
      const coreRes = await coreVerify(payload, requirement());
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject a recipient mismatch with the same invalidReason", async () => {
      const otherTo = getAddress("0x2222222222222222222222222222222222222222");
      const payload = await fixedSignedPayload({ to: otherTo });
      const x402Res = await x402Verify(payload, requirement());
      const coreRes = await coreVerify(payload, requirement());
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject an expired validBefore with the same invalidReason", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = await fixedSignedPayload({ validBefore: (now - 1).toString() });
      const x402Res = await x402Verify(payload, requirement());
      const coreRes = await coreVerify(payload, requirement());
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject a not-yet-valid validAfter with the same invalidReason", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = await fixedSignedPayload({ validAfter: (now + 600).toString() });
      const x402Res = await x402Verify(payload, requirement());
      const coreRes = await coreVerify(payload, requirement());
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });

    it("both reject a value != requirements.amount with the same invalidReason", async () => {
      const payload = await fixedSignedPayload({ value: "200000" });
      const req = requirement();
      const x402Res = await x402Verify(payload, req);
      const coreRes = await coreVerify(payload, req);
      expect(coreRes.isValid).toBe(false);
      expect(x402Res.isValid).toBe(false);
      expect(coreRes.invalidReason).toBe(x402Res.invalidReason);
    });
  });

  describe("(d') settle wire parity — transferWithAuthorization calldata byte-equal", () => {
    it("core settleExact and @x402/evm emit identical transferWithAuthorization calldata", async () => {
      const payload = await fixedSignedPayload();
      const req = requirement();
      const auth = (payload.payload as { authorization: Record<string, string> }).authorization;
      const signature = (payload.payload as { signature: Hex }).signature;

      let coreCalldata: Hex | undefined;
      const coreSigner = {
        getAddresses: () => [getAddress("0x1111111111111111111111111111111111111111")],
        readContract: async (args: { functionName: string }) => {
          if (args.functionName === "authorizationState") return false;
          if (args.functionName === "balanceOf") return BigInt(AMOUNT);
          throw new Error(`unexpected read: ${args.functionName}`);
        },
        writeContract: async (args: {
          abi: readonly unknown[];
          functionName: string;
          args: readonly unknown[];
        }) => {
          coreCalldata = encodeFunctionData({
            abi: args.abi as never,
            functionName: args.functionName as never,
            args: args.args as never,
          });
          return ("0x" + "11".repeat(32)) as Hex;
        },
        waitForTransactionReceipt: async () => ({ status: "success" }),
      };

      const coreRes = await settleExact(payload, req, {
        signer: coreSigner as never,
        publicClient: coreSigner as never,
      });
      expect(coreRes.success).toBe(true);

      // Build the @x402 calldata exactly as @x402/evm executeTransferWithAuthorization does:
      // ECDSA (65-byte) sig -> v/r/s overload, args identical.
      const parsed = parseSignature(signature);
      const x402Calldata = encodeFunctionData({
        abi: eip3009ABI as never,
        functionName: "transferWithAuthorization",
        args: [
          getAddress(auth.from as Hex),
          getAddress(auth.to as Hex),
          BigInt(auth.value),
          BigInt(auth.validAfter),
          BigInt(auth.validBefore),
          auth.nonce,
          parsed.v ?? BigInt(parsed.yParity ?? 0),
          parsed.r,
          parsed.s,
        ] as never,
      });

      expect(coreCalldata).toBe(x402Calldata);
    });
  });
});
