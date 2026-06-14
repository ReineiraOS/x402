import {
  createPublicClient,
  getAddress,
  http,
  type PublicClient,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import {
  toWebAuthnKey,
  toPasskeyValidator,
  deserializePasskeyValidator,
  WebAuthnMode,
  PasskeyValidatorContractVersion,
} from "@zerodev/passkey-validator";
import { toPermissionValidator, serializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { toSudoPolicy } from "@zerodev/permissions/policies";
import { addressToEmptyAccount, createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { ARBITRUM_SEPOLIA } from "@reineira-os/x402-rss-shared";
import { zerodevPasskeyServerUrl } from "./zerodev";

const PASSKEY_SERVER_URL = zerodevPasskeyServerUrl();
const PUBLIC_RPC =
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
const USDC = getAddress(ARBITRUM_SEPOLIA.usdc);

const SERIALIZED_KEY = "pa-treasury-serialized";
const ADDRESS_KEY = "pa-treasury-address";
const SESSION_KEY = "pa-treasury-session";

const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;
// ZeroDev's gateway blocks the UNPATCHED passkey validators (V0_0_1/V0_0_2) with
// "Unauthorized: wapk" after a Sept-2025 passkey vulnerability disclosure (zerodevapp/sdk#235).
// The PATCHED validator is the remediation and is what current ZeroDev docs use.
const validatorContractVersion = PasskeyValidatorContractVersion.V0_0_3_PATCHED;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function publicClient(): PublicClient {
  return createPublicClient({ chain: arbitrumSepolia, transport: http(PUBLIC_RPC) });
}

export function storedTreasuryAddress(): `0x${string}` | null {
  if (typeof window === "undefined") return null;
  const a = window.localStorage.getItem(ADDRESS_KEY);
  return a ? (a as `0x${string}`) : null;
}

function storedSerialized(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SERIALIZED_KEY);
}

async function accountFromValidator(validator: Awaited<ReturnType<typeof toPasskeyValidator>>) {
  const pc = publicClient();
  return createKernelAccount(pc, {
    entryPoint,
    kernelVersion,
    plugins: { sudo: validator },
  });
}

// Register (or log in to) a passkey and provision the passkey-owned treasury wallet.
// The WebAuthn ceremony (the fingerprint) happens inside toWebAuthnKey.
export async function registerTreasury(
  name: string,
  mode: "register" | "login" = "register",
): Promise<{ address: `0x${string}`; serialized: string }> {
  const webAuthnKey = await toWebAuthnKey({
    passkeyName: name,
    passkeyServerUrl: PASSKEY_SERVER_URL,
    mode: mode === "register" ? WebAuthnMode.Register : WebAuthnMode.Login,
  });
  const validator = await toPasskeyValidator(publicClient(), {
    webAuthnKey,
    entryPoint,
    kernelVersion,
    validatorContractVersion,
  });
  const serialized = validator.getSerializedData();
  const account = await accountFromValidator(validator);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SERIALIZED_KEY, serialized);
    window.localStorage.setItem(ADDRESS_KEY, account.address);
  }
  return { address: account.address, serialized };
}

export function forgetTreasury(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SERIALIZED_KEY);
  window.localStorage.removeItem(ADDRESS_KEY);
  window.localStorage.removeItem(SESSION_KEY);
}

export async function treasuryUsdcBalance(address: `0x${string}`): Promise<bigint> {
  return publicClient().readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export interface SessionStatus {
  granted: boolean;
  sessionKeyAddress: `0x${string}` | null;
  budgetAtomic: string | null;
  spentAtomic: string;
}

export async function getSessionStatus(): Promise<SessionStatus | null> {
  const treasury = storedTreasuryAddress();
  if (!treasury) return null;
  const res = await fetch(`/api/session?treasuryAddress=${treasury}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as SessionStatus;
}

// Grant a server-held ECDSA session key permission over the treasury, bounded by a
// spend budget. The passkey owner signs the "enable" approval (the fingerprint),
// entirely off-chain — no paymaster call — then the server can spend within the budget.
export async function grantSessionKey(budgetAtomic: string): Promise<void> {
  const treasury = storedTreasuryAddress();
  const serialized = storedSerialized();
  if (!treasury || !serialized) throw new Error("no passkey treasury on this device");

  const keyRes = await fetch("/api/session/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ treasuryAddress: treasury }),
  });
  const keyJson = (await keyRes.json()) as { sessionKeyAddress?: `0x${string}`; error?: string };
  if (!keyRes.ok || !keyJson.sessionKeyAddress) {
    throw new Error(keyJson.error ?? "could not provision session key");
  }

  const pc = publicClient();
  const passkeyValidator = await deserializePasskeyValidator(pc, {
    serializedData: serialized,
    entryPoint,
    kernelVersion,
  });
  const emptyAccount = addressToEmptyAccount(keyJson.sessionKeyAddress);
  const emptySessionKeySigner = await toECDSASigner({ signer: emptyAccount });
  const permissionValidator = await toPermissionValidator(pc, {
    signer: emptySessionKeySigner,
    policies: [toSudoPolicy({})],
    entryPoint,
    kernelVersion,
  });
  const account = await createKernelAccount(pc, {
    entryPoint,
    kernelVersion,
    plugins: { sudo: passkeyValidator, regular: permissionValidator },
  });
  const approval = await serializePermissionAccount(account);

  const grantRes = await fetch("/api/session/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ treasuryAddress: treasury, approval, budgetAtomic }),
  });
  if (!grantRes.ok) {
    const j = (await grantRes.json()) as { error?: string };
    throw new Error(j.error ?? "grant failed");
  }
  if (typeof window !== "undefined") window.localStorage.setItem(SESSION_KEY, "1");
}
