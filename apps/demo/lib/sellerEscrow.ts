import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  parseEventLogs,
  toHex,
  type Hex,
  type PublicClient,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { escrowAbi } from "@reineira-os/x402-rss-shared";
import type { X402EscrowExtra } from "@reineira-os/x402-rss-shared";

export interface SellerEscrowConfig {
  escrow: `0x${string}`;
  receiver: `0x${string}`;
  timeLockResolver: `0x${string}`;
  deliveryResolver: `0x${string}` | null;
  sellerAddress: `0x${string}`;
  sellerKey: Hex;
  deadlineSeconds: number;
  rpcUrl: string;
}

export function getSellerEscrowConfig(): SellerEscrowConfig | null {
  const escrow = process.env.ESCROW_ADDRESS;
  const receiver = process.env.X402_RECEIVER_ADDRESS;
  const timeLockResolver = process.env.TIMELOCK_RESOLVER_ADDRESS;
  const deliveryResolver = process.env.DELIVERY_DEADLINE_RESOLVER_ADDRESS;
  const sellerKey = process.env.SELLER_PRIVATE_KEY;
  if (!escrow || !receiver || !timeLockResolver || !sellerKey) {
    return null;
  }
  const seller = privateKeyToAccount(sellerKey as Hex);
  return {
    escrow: getAddress(escrow),
    receiver: getAddress(receiver),
    timeLockResolver: getAddress(timeLockResolver),
    deliveryResolver: deliveryResolver ? getAddress(deliveryResolver) : null,
    sellerAddress: seller.address,
    sellerKey: sellerKey as Hex,
    deadlineSeconds: Number(process.env.ESCROW_DEADLINE_SECONDS ?? 900),
    rpcUrl:
      process.env.ARBITRUM_SEPOLIA_RPC_URL ??
      "https://sepolia-rollup.arbitrum.io/rpc",
  };
}

// Which resolver gates a sale: TimeLock by default, or the DeliveryDeadlineResolver
// when the buyer's agent runs the coverage plugin (its breach is what insurance underwrites).
export function resolverForSale(
  config: SellerEscrowConfig,
  useDelivery: boolean,
): `0x${string}` {
  if (useDelivery && config.deliveryResolver) return config.deliveryResolver;
  return config.timeLockResolver;
}

function publicClientFor(config: SellerEscrowConfig): PublicClient {
  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http(config.rpcUrl),
  });
}

function randomSalt(): Hex {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export interface IssuedEscrow {
  extra: X402EscrowExtra;
  deadline: number;
  txHash: `0x${string}`;
}

export async function createEscrowForSale(
  config: SellerEscrowConfig,
  amountAtomic: bigint,
  deadlineSecondsOverride?: number,
  useDelivery = false,
): Promise<IssuedEscrow> {
  const publicClient = publicClientFor(config);
  const seller = privateKeyToAccount(config.sellerKey);
  const walletClient = createWalletClient({
    account: seller,
    chain: arbitrumSepolia,
    transport: http(config.rpcUrl),
  });

  const windowSeconds =
    deadlineSecondsOverride && deadlineSecondsOverride > 0
      ? Math.floor(deadlineSecondsOverride)
      : config.deadlineSeconds;
  // Arbitrum Sepolia's block.timestamp can run ahead of wall-clock; basing the
  // deadline on max(local, chain) keeps the resolver's `deadline > block.timestamp`
  // check from reverting with InvalidDeadline on short windows.
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const base = Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp));
  const deadline = base + windowSeconds;
  const resolver = resolverForSale(config, useDelivery);
  const isDelivery = useDelivery && !!config.deliveryResolver;
  // Delivery escrows release on an attestation, not a timer, so the resolver needs
  // both the deadline and the attester (the seller) it will accept attestations from.
  const resolverData = isDelivery
    ? encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }],
        [BigInt(deadline), config.sellerAddress],
      )
    : encodeAbiParameters([{ type: "uint256" }], [BigInt(deadline)]);

  const { request } = await publicClient.simulateContract({
    account: seller,
    address: config.escrow,
    abi: escrowAbi,
    functionName: "create",
    args: [config.sellerAddress, amountAtomic, resolver, resolverData],
  });

  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`escrow create reverted in tx ${txHash}`);
  }

  let escrowId: bigint | undefined;
  const created = parseEventLogs({
    abi: escrowAbi,
    eventName: "EscrowCreated",
    logs: receipt.logs,
  }).find((entry) => getAddress(entry.address) === config.escrow);
  if (created) {
    escrowId = created.args.escrowId;
  } else {
    const total = (await publicClient.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "total",
    })) as bigint;
    const candidate = total - 1n;
    const owner = (await publicClient.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "getOwner",
      args: [candidate],
    })) as string;
    if (getAddress(owner) === config.sellerAddress) {
      escrowId = candidate;
    }
  }
  if (escrowId === undefined) {
    throw new Error(`could not determine escrowId from tx ${txHash}`);
  }

  return {
    extra: {
      escrowId: escrowId.toString(),
      salt: randomSalt(),
      receiver: config.receiver,
      escrow: config.escrow,
    },
    deadline,
    txHash,
  };
}

export async function validateIssuedEscrow(
  config: SellerEscrowConfig,
  extra: X402EscrowExtra,
  expectedAmountAtomic: bigint,
  useDelivery = false,
): Promise<{ ok: boolean; reason?: string }> {
  if (getAddress(extra.receiver) !== config.receiver) {
    return { ok: false, reason: "unknown receiver" };
  }
  if (getAddress(extra.escrow) !== config.escrow) {
    return { ok: false, reason: "unknown escrow contract" };
  }

  const publicClient = publicClientFor(config);
  const escrowId = BigInt(extra.escrowId);

  const [owner, amount, resolver] = await Promise.all([
    publicClient.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "getOwner",
      args: [escrowId],
    }),
    publicClient.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "getAmount",
      args: [escrowId],
    }),
    publicClient.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "getConditionResolver",
      args: [escrowId],
    }),
  ]);

  if (getAddress(owner as string) !== config.sellerAddress) {
    return { ok: false, reason: "escrow not owned by seller" };
  }
  if ((amount as bigint) !== expectedAmountAtomic) {
    return { ok: false, reason: "escrow amount mismatch" };
  }
  const expectedResolver = resolverForSale(config, useDelivery);
  if (getAddress(resolver as string) !== expectedResolver) {
    return { ok: false, reason: "escrow resolver mismatch" };
  }
  return { ok: true };
}

export async function isEscrowFunded(
  config: SellerEscrowConfig,
  escrowId: bigint,
): Promise<boolean> {
  const publicClient = publicClientFor(config);
  const paid = (await publicClient.readContract({
    address: config.escrow,
    abi: escrowAbi,
    functionName: "getPaidAmount",
    args: [escrowId],
  })) as bigint;
  const amount = (await publicClient.readContract({
    address: config.escrow,
    abi: escrowAbi,
    functionName: "getAmount",
    args: [escrowId],
  })) as bigint;
  return paid >= amount;
}

const deliveryAttestAbi = [
  {
    type: "function",
    name: "attestDelivery",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isDelivered",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "deadlineOf",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export interface AttestRedeemResult {
  attestTx?: `0x${string}`;
  redeemTx: `0x${string}`;
}

// The seller's autonomous on-chain delivery: attest delivery on the resolver (only
// valid before the deadline) then redeem the escrow to the seller. Throws on a passed
// deadline (a breach) or revert, so the caller can fall back to the breach narrative.
export async function attestAndRedeem(
  config: SellerEscrowConfig,
  escrowId: bigint,
): Promise<AttestRedeemResult> {
  if (!config.deliveryResolver) {
    throw new Error("delivery resolver not configured");
  }
  const publicClient = publicClientFor(config);
  const seller = privateKeyToAccount(config.sellerKey);
  const walletClient = createWalletClient({
    account: seller,
    chain: arbitrumSepolia,
    transport: http(config.rpcUrl),
  });

  let attestTx: `0x${string}` | undefined;
  const [delivered, deadline] = (await Promise.all([
    publicClient.readContract({
      address: config.deliveryResolver,
      abi: deliveryAttestAbi,
      functionName: "isDelivered",
      args: [escrowId],
    }),
    publicClient.readContract({
      address: config.deliveryResolver,
      abi: deliveryAttestAbi,
      functionName: "deadlineOf",
      args: [escrowId],
    }),
  ])) as [boolean, bigint];

  if (!delivered) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now > deadline) {
      throw new Error("delivery deadline already passed — cannot attest (breach)");
    }
    const { request: attestReq } = await publicClient.simulateContract({
      account: seller,
      address: config.deliveryResolver,
      abi: deliveryAttestAbi,
      functionName: "attestDelivery",
      args: [escrowId],
    });
    attestTx = await walletClient.writeContract(attestReq);
    await publicClient.waitForTransactionReceipt({ hash: attestTx });
  }

  const { request: redeemReq } = await publicClient.simulateContract({
    account: seller,
    address: config.escrow,
    abi: escrowAbi,
    functionName: "redeem",
    args: [escrowId],
  });
  const redeemTx = await walletClient.writeContract(redeemReq);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemTx });
  if (receipt.status !== "success") {
    throw new Error(`redeem reverted in ${redeemTx}`);
  }
  return { attestTx, redeemTx };
}
