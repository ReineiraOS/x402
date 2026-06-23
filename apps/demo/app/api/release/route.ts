import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { escrowAbi, timeLockResolverAbi } from "@reineira-os/x402-shared";
import { getSellerEscrowConfig } from "../../../lib/sellerEscrow";
import { deliveryResolverAbi } from "../../../lib/coverage";
import { markSpendReleased } from "../../../lib/agentStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = getSellerEscrowConfig();
  if (!config) {
    return NextResponse.json(
      { error: "escrow mode is not configured (see .env.example)" },
      { status: 400 },
    );
  }

  let body: { escrowId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.escrowId) {
    return NextResponse.json({ error: "escrowId is required" }, { status: 400 });
  }
  const escrowId = BigInt(body.escrowId);

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(config.rpcUrl),
  });
  // Deadlines are created from max(wall-clock, block.timestamp) (sellerEscrow.ts) because
  // Arbitrum Sepolia's block clock can lead wall-clock; gate against the same clock the
  // on-chain resolver enforces so the breach/timelock boundary can't mis-fire.
  const wall = BigInt(Math.floor(Date.now() / 1000));
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const now = block.timestamp > wall ? block.timestamp : wall;

  const resolver = getAddress(
    (await publicClient.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "getConditionResolver",
      args: [escrowId],
    })) as string,
  );
  const isDelivery = !!config.deliveryResolver && resolver === config.deliveryResolver;

  const seller = privateKeyToAccount(config.sellerKey);
  const walletClient = createWalletClient({
    account: seller,
    chain: arbitrumSepolia,
    transport: http(config.rpcUrl),
  });

  // Delivery escrows release on a seller attestation, not a timer. Attest first (the
  // honest "delivered" path); if the deadline has passed unattested it is a breach and
  // the buyer must claim from the underwriter pool instead.
  if (isDelivery) {
    const [delivered, deadline] = (await Promise.all([
      publicClient.readContract({
        address: config.deliveryResolver!,
        abi: deliveryResolverAbi,
        functionName: "isDelivered",
        args: [escrowId],
      }),
      publicClient.readContract({
        address: config.deliveryResolver!,
        abi: deliveryResolverAbi,
        functionName: "deadlineOf",
        args: [escrowId],
      }),
    ])) as [boolean, bigint];

    if (!delivered) {
      if (now > deadline) {
        return NextResponse.json(
          {
            error: "delivery breached",
            detail:
              "the seller did not attest delivery before the deadline — funds cannot be released; the buyer can file an insurance claim.",
            breached: true,
          },
          { status: 409 },
        );
      }
      try {
        const { request: attestReq } = await publicClient.simulateContract({
          account: seller,
          address: config.deliveryResolver!,
          abi: deliveryResolverAbi,
          functionName: "attestDelivery",
          args: [escrowId],
        });
        const attestTx = await walletClient.writeContract(attestReq);
        await publicClient.waitForTransactionReceipt({ hash: attestTx });
      } catch (error) {
        return NextResponse.json(
          {
            error: "delivery attestation failed",
            detail: error instanceof Error ? error.message : String(error),
          },
          { status: 502 },
        );
      }
    }
  } else {
    const deadline = (await publicClient.readContract({
      address: config.timeLockResolver,
      abi: timeLockResolverAbi,
      functionName: "deadlineOf",
      args: [config.escrow, escrowId],
    })) as bigint;
    if (deadline === 0n) {
      return NextResponse.json(
        { error: "escrow has no timelock condition configured" },
        { status: 400 },
      );
    }
    if (now < deadline) {
      return NextResponse.json(
        {
          error: "timelock not expired yet",
          deadline: deadline.toString(),
          secondsRemaining: (deadline - now).toString(),
        },
        { status: 409 },
      );
    }
  }

  try {
    const { request: txRequest } = await publicClient.simulateContract({
      account: seller,
      address: config.escrow,
      abi: escrowAbi,
      functionName: "redeem",
      args: [escrowId],
    });
    const txHash = await walletClient.writeContract(txRequest);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "release reverted", txHash }, { status: 502 });
    }
    await markSpendReleased(body.escrowId, txHash);
    return NextResponse.json({
      txHash,
      escrowId: body.escrowId,
      recipient: config.sellerAddress,
      arbiscan: `https://sepolia.arbiscan.io/tx/${txHash}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "release failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
