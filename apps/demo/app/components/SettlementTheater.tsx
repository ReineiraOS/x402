"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/Icon";
import { usdc, shortAddress, type ClientAgent, type SpendRecord, type TranscriptLine } from "./agentTypes";
import { storedTreasuryAddress } from "../../lib/passkeyTreasury";

type RunEvent = {
  zone?: "buyer" | "system" | "provider" | "seller";
  level?: "error" | "info";
  kind?: "deal" | "escrow" | "coverage";
  deal?: string;
  price?: string;
  network?: string;
  escrowId?: string;
  escrowDeadline?: number | null;
  coverageId?: string | null;
  status?: string;
  msg?: string;
  detail?: string;
  tx?: string;
  arbiscan?: string;
  done?: boolean;
  stream?: boolean;
  streamEnd?: boolean;
  final?: boolean;
};

type SessionKind = "cmd" | "thinking" | "action" | "payment" | "result" | "event" | "seller";
type SessionLine = {
  id: number;
  kind: SessionKind;
  text?: string;
  detail?: string;
  tx?: string;
  arbiscan?: string;
  streaming?: boolean;
  error?: boolean;
};

type DealStatus = "idle" | "awaiting payment" | "signing" | "settling" | "settled" | "failed";
type Tab = "console" | "purchases";

type PurchaseState = "held" | "releasable" | "released" | "direct";

function purchaseState(record: SpendRecord, nowSec: number): PurchaseState {
  if (!record.escrowId) return "direct";
  if (record.released) return "released";
  if (typeof record.deadline === "number") {
    return nowSec >= record.deadline ? "releasable" : "held";
  }
  return "held";
}

function formatSecs(total: number): string {
  if (total <= 0) return "0s";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STATE_TEXT: Record<PurchaseState, string> = {
  held: "held in escrow",
  releasable: "releasable now",
  released: "released to seller",
  direct: "paid directly",
};

function renderTLine(line: TranscriptLine, i: number) {
  if (line.kind === "thinking") {
    return (
      <div key={i} className="cl cl--thinking">
        <span className="cl__gutter">//</span>
        <span className="cl__text">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "result") {
    return (
      <div key={i} className="cl cl--result">
        <span className="cl__tag">✓ result</span>
        <span className="cl__text">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "action") {
    return (
      <div key={i} className="cl cl--action">
        <span className="cl__gutter">▸</span>
        <span className="cl__text">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "coverage") {
    return (
      <div key={i} className="cl cl--coverage">
        <span className="cl__tag cl__tag--cov">☂ coverage</span>
        <span className="cl__text">
          {line.text}
          {line.tx ? (
            <a className="cl__tx" href={`https://sepolia.arbiscan.io/tx/${line.tx}`} target="_blank" rel="noreferrer">
              {" "}
              {line.tx.slice(0, 12)}… ↗
            </a>
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <div key={i} className="cl cl--event">
      <span className="cl__gutter">·</span>
      <span className="cl__text">
        {line.text}
        {line.detail ? <em className="cl__detail"> — {line.detail}</em> : null}
        {line.tx ? (
          <a className="cl__tx" href={`https://sepolia.arbiscan.io/tx/${line.tx}`} target="_blank" rel="noreferrer">
            {" "}
            {line.tx.slice(0, 12)}… ↗
          </a>
        ) : null}
      </span>
    </div>
  );
}

function PurchaseDetail({
  record,
  nowSec,
  onClose,
}: {
  record: SpendRecord;
  nowSec: number;
  onClose: () => void;
}) {
  const st = purchaseState(record, nowSec);
  const left = typeof record.deadline === "number" ? Math.max(0, record.deadline - nowSec) : 0;
  const artifactJson = record.artifact ? JSON.stringify(record.artifact, null, 2) : null;
  const lines = record.transcript ?? [];
  return (
    <div className="pd-overlay" onClick={onClose} role="presentation">
      <div className="pd bw-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="pd__bar">
          <div className="pd__title">
            <span className="pd__name">{record.resourceName ?? record.description}</span>
            <span className="pd__sub mono">
              {new Date(record.ts).toLocaleString()} · {record.escrowId ? `escrow #${record.escrowId}` : "direct"}
            </span>
          </div>
          <button className="pd__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} stroke={2} />
          </button>
        </div>
        <div className="pd__body thin-scroll">
          <div className="pd__facts">
            <div className="pd__fact">
              <span className="pd__fact-l">price</span>
              <span className="pd__fact-v">{usdc(record.amountAtomic)}</span>
            </div>
            <div className="pd__fact">
              <span className="pd__fact-l">escrow</span>
              <span className={`pd__fact-v purch__status--${st}`}>
                {st === "held" && typeof record.deadline === "number"
                  ? `held · ${formatSecs(left)}`
                  : STATE_TEXT[st]}
              </span>
            </div>
            <div className="pd__fact">
              <span className="pd__fact-l">payment</span>
              <span className="pd__fact-v">
                {record.tx ? (
                  <a className="cl__tx" href={`https://sepolia.arbiscan.io/tx/${record.tx}`} target="_blank" rel="noreferrer">
                    {record.tx.slice(0, 12)}… ↗
                  </a>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <div className="pd__fact">
              <span className="pd__fact-l">release</span>
              <span className="pd__fact-v">
                {record.releaseTx ? (
                  <a className="cl__tx" href={`https://sepolia.arbiscan.io/tx/${record.releaseTx}`} target="_blank" rel="noreferrer">
                    {record.releaseTx.slice(0, 12)}… ↗
                  </a>
                ) : (
                  "—"
                )}
              </span>
            </div>
            {record.coverage ? (
              <div className="pd__fact">
                <span className="pd__fact-l">coverage</span>
                <span className={`pd__fact-v purch__cov--${record.coverage.status}`}>
                  {record.coverage.status === "active"
                    ? record.coverage.claimed
                      ? `claimed · ${usdc(record.coverage.claimPayoutAtomic ?? "0")}`
                      : `active · #${record.coverage.coverageId}`
                    : record.coverage.status === "pending-setup"
                      ? "pending setup"
                      : "failed"}
                  {record.coverage.claimTx ?? record.coverage.tx ? (
                    <a
                      className="cl__tx"
                      href={`https://sepolia.arbiscan.io/tx/${record.coverage.claimTx ?? record.coverage.tx}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {" "}
                      tx ↗
                    </a>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>

          {record.coverage ? (
            <p className="pd__cov-note">
              {record.coverage.status === "active"
                ? "Delivery coverage is live on-chain via the underwriter pool. If the seller breaches delivery (no attestation past the deadline), the buyer claims a payout from the pool. Premium is zero on testnet."
                : record.coverage.status === "pending-setup"
                  ? `Coverage is wired but pending a one-time protocol-owner setup before it can be purchased on-chain. ${record.coverage.note ?? ""}`
                  : `Coverage could not be attached. ${record.coverage.note ?? ""}`}
            </p>
          ) : null}

          <div className="pd__sec">
            <span className="pd__sec-cap">Agent reasoning · settlement log</span>
            <div className="pd__log">
              {lines.length > 0 ? (
                lines.map(renderTLine)
              ) : (
                <p className="agents__muted mono">No reasoning log captured for this purchase.</p>
              )}
            </div>
          </div>

          {artifactJson ? (
            <div className="pd__sec">
              <span className="pd__sec-cap">Delivered data</span>
              {record.result ? <p className="pd__result">“{record.result}”</p> : null}
              <pre className="pd__json thin-scroll">{artifactJson}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<DealStatus, string> = {
  idle: "ready",
  "awaiting payment": "requested",
  signing: "signing",
  settling: "settling",
  settled: "settled",
  failed: "failed",
};

type ResourceOption = { id: string; name: string; description: string; priceAtomic: string };

function stripMd(t: string): string {
  return t.replace(/\*\*/g, "");
}

export function SettlementTheater({
  agent,
  onSettled,
}: {
  agent: ClientAgent;
  onSettled?: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<DealStatus>("idle");
  const [deal, setDeal] = useState<{ deal: string; price: string; network: string } | null>(null);
  const [session, setSession] = useState<SessionLine[]>([]);
  const [tx, setTx] = useState<string | null>(null);
  const [arbiscan, setArbiscan] = useState<string | null>(null);
  const [escrowId, setEscrowId] = useState<string | null>(null);
  const [escrowDeadline, setEscrowDeadline] = useState<number | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [released, setReleased] = useState(false);
  const [tab, setTab] = useState<Tab>("console");
  const [notice, setNotice] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [resourceId, setResourceId] = useState<string>("");
  const [forceDecline, setForceDecline] = useState(false);
  const [busyEscrow, setBusyEscrow] = useState<string | null>(null);
  const [batchReleasing, setBatchReleasing] = useState(false);
  const [detail, setDetail] = useState<SpendRecord | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/resources", { cache: "no-store" });
      const json = (await res.json()) as { resources?: ResourceOption[] };
      if (active && json.resources?.length) {
        setResources(json.resources);
        setResourceId((cur) => cur || json.resources![0]!.id);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const payPushedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [session, status, tx]);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const push = useCallback((line: Omit<SessionLine, "id">) => {
    setSession((prev) => [...prev, { id: nextId(), ...line }]);
  }, []);

  const stream = useCallback((delta: string, final: boolean) => {
    setSession((prev) => {
      const last = prev[prev.length - 1];
      const kind: SessionKind = final ? "result" : "thinking";
      if (last && last.streaming && last.kind !== "seller") {
        return [...prev.slice(0, -1), { ...last, text: (last.text ?? "") + delta, kind }];
      }
      return [...prev, { id: nextId(), kind, text: delta, streaming: true }];
    });
  }, []);

  const endStream = useCallback(() => {
    setSession((prev) => {
      const last = prev[prev.length - 1];
      if (!last || !last.streaming || last.kind === "seller") return prev;
      return [...prev.slice(0, -1), { ...last, streaming: false }];
    });
  }, []);

  // The seller is a second agent: stream its reasoning into its own voice so the console
  // reads as a conversation between two agents rather than one agent and a passive API.
  const streamSeller = useCallback((delta: string) => {
    setSession((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.streaming && last.kind === "seller") {
        return [...prev.slice(0, -1), { ...last, text: (last.text ?? "") + delta }];
      }
      return [...prev, { id: nextId(), kind: "seller", text: delta, streaming: true }];
    });
  }, []);

  const endStreamSeller = useCallback(() => {
    setSession((prev) => {
      const last = prev[prev.length - 1];
      if (!last || !last.streaming || last.kind !== "seller") return prev;
      return [...prev.slice(0, -1), { ...last, streaming: false }];
    });
  }, []);

  const advanceStatus = useCallback((msg: string) => {
    const t = msg.toLowerCase();
    if (t.includes("sign")) setStatus((s) => (s === "settled" || s === "failed" ? s : "signing"));
    else if (t.includes("verif") || t.includes("settle"))
      setStatus((s) => (s === "settled" || s === "failed" ? s : "settling"));
  }, []);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      if (event.level === "error") {
        setStatus("failed");
        push({ kind: "event", text: event.msg ?? "error", error: true });
        setRunning(false);
        return;
      }
      if (event.done) {
        setStatus((s) => (s === "failed" ? s : "settled"));
        setRunning(false);
        onSettled?.();
        return;
      }
      if (event.kind === "deal") {
        setDeal({ deal: event.deal ?? "—", price: event.price ?? "—", network: event.network ?? "—" });
        if (!payPushedRef.current) {
          payPushedRef.current = true;
          push({ kind: "payment" });
        }
        return;
      }
      if (event.kind === "escrow") {
        setEscrowId(event.escrowId ?? null);
        setEscrowDeadline(typeof event.escrowDeadline === "number" ? event.escrowDeadline : null);
        return;
      }
      if (event.kind === "coverage") {
        // Narration arrives as a following system line; nothing to fold into deal state.
        return;
      }
      if (event.zone === "seller") {
        if (event.streamEnd) return endStreamSeller();
        if (event.stream) return streamSeller(event.msg ?? "");
        // A seller line carrying a tx is the on-chain attest+redeem → escrow released.
        if (event.tx) setReleased(true);
        push({ kind: "seller", text: event.msg ?? "", tx: event.tx, arbiscan: event.arbiscan });
        return;
      }
      if (event.zone === "buyer" && event.streamEnd) return endStream();
      if (event.zone === "buyer" && event.stream) return stream(event.msg ?? "", event.final ?? false);

      const msg = event.msg ?? "";
      if (event.zone === "buyer") {
        // settlement mechanics flow into the payment tool-block; keep reasoning/decisions as lines
        if (/smart wallet|balance|signs the payment/i.test(msg)) {
          advanceStatus(msg);
          return;
        }
        push({ kind: "action", text: msg });
        advanceStatus(msg);
      } else if (event.zone === "provider") {
        // delivery is a distinct phase after payment — show it in the console
        push({ kind: "event", text: msg, detail: event.detail });
      } else {
        // system settlement events fold into the x402 payment tool-block (status/tx)
        advanceStatus(msg);
        if (event.tx) {
          setTx(event.tx);
          setStatus("settled");
        }
        if (event.arbiscan) setArbiscan(event.arbiscan);
      }
    },
    [push, stream, endStream, streamSeller, endStreamSeller, advanceStatus, onSettled],
  );

  const runDeal = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    payPushedRef.current = false;
    setRunning(true);
    setStatus("awaiting payment");
    setDeal(null);
    setTx(null);
    setArbiscan(null);
    setEscrowId(null);
    setEscrowDeadline(null);
    setReleased(false);
    setNotice(null);
    setTab("console");
    setSession([]);
    push({
      kind: "cmd",
      text: `settle --agent ${agent.name.toLowerCase().replace(/\s+/g, "-")} --resource "live on-chain report" --max 1.00 USDC`,
    });

    try {
      const treasury = storedTreasuryAddress();
      const runUrl = `/api/run?agentId=${encodeURIComponent(agent.id)}${
        resourceId ? `&resourceId=${encodeURIComponent(resourceId)}` : ""
      }${treasury ? `&treasury=${encodeURIComponent(treasury)}` : ""}${
        forceDecline ? "&sellerDecline=1" : ""
      }`;
      const res = await fetch(runUrl, { cache: "no-store", signal: controller.signal });
      if (!res.body) throw new Error("no response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            handleEvent(JSON.parse(dataLine.slice(6)) as RunEvent);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      push({ kind: "event", text: error instanceof Error ? error.message : String(error), error: true });
      setStatus("failed");
      setRunning(false);
    }
  }, [running, handleEvent, push, agent.id, agent.name, resourceId, forceDecline]);

  // Release a single past purchase (the seller redeems the escrow). Shared by the
  // per-row button and the "release all eligible" batch action.
  const releaseOne = useCallback(async (eid: string): Promise<boolean> => {
    const res = await fetch("/api/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ escrowId: eid }),
    });
    const json = (await res.json()) as {
      txHash?: string;
      error?: string;
      detail?: string;
      secondsRemaining?: string;
    };
    if (!res.ok) {
      setNotice(
        json.secondsRemaining
          ? `escrow #${eid}: timelock active — ${json.secondsRemaining}s remaining`
          : json.detail ?? json.error ?? `release failed (${res.status})`,
      );
      return false;
    }
    return true;
  }, []);

  const releasePurchase = useCallback(
    async (eid: string) => {
      if (busyEscrow || batchReleasing) return;
      setBusyEscrow(eid);
      setNotice(null);
      const ok = await releaseOne(eid);
      setBusyEscrow(null);
      if (ok) onSettled?.();
    },
    [busyEscrow, batchReleasing, releaseOne, onSettled],
  );

  // File an insurance claim on a covered purchase whose delivery was breached. The
  // dispute is sent from the buyer's treasury (the coverage holder); a real payout
  // lands back in the treasury.
  const claimPurchase = useCallback(
    async (eid: string) => {
      if (busyEscrow || batchReleasing) return;
      setBusyEscrow(eid);
      setNotice(null);
      try {
        const res = await fetch("/api/coverage/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ escrowId: eid }),
        });
        const json = (await res.json()) as {
          txHash?: string;
          payoutAtomic?: string;
          error?: string;
          detail?: string;
        };
        if (!res.ok) throw new Error(json.detail ?? json.error ?? `claim failed (${res.status})`);
        setNotice(
          `Insurance paid out ${usdc(json.payoutAtomic ?? "0")} to the treasury · ${json.txHash?.slice(0, 10)}…`,
        );
        onSettled?.();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyEscrow(null);
      }
    },
    [busyEscrow, batchReleasing, onSettled],
  );

  const releaseAllEligible = useCallback(
    async (ids: string[]) => {
      if (batchReleasing || busyEscrow || ids.length === 0) return;
      setBatchReleasing(true);
      setNotice(null);
      for (const eid of ids) {
        await releaseOne(eid);
      }
      setBatchReleasing(false);
      onSettled?.();
    },
    [batchReleasing, busyEscrow, releaseOne, onSettled],
  );

  // derived escrow phases
  const funded = !!escrowId;
  const secondsLeft = escrowDeadline ? Math.max(0, escrowDeadline - nowSec) : 0;
  const locked = funded && escrowDeadline != null && nowSec < escrowDeadline && !released;
  const unlockable = funded && escrowDeadline != null && nowSec >= escrowDeadline && !released;
  // A covered escrow past its deadline is a delivery breach: the seller can no longer
  // redeem (release reverts), so the buyer files an insurance claim instead of releasing.
  const currentCoverage = escrowId
    ? (agent.ledger.find((r) => r.escrowId === escrowId)?.coverage ?? null)
    : null;
  const breach = unlockable && !!currentCoverage && currentCoverage.status === "active";
  const claimable = breach && !currentCoverage?.claimed;
  const claimedCov = breach && !!currentCoverage?.claimed;
  const paying = running && !funded;
  const pct = locked ? Math.max(4, Math.min(100, (secondsLeft / Math.max(1, agent.deadlineSeconds)) * 100)) : 100;
  const escrowState = released
    ? "released"
    : breach
      ? "breach"
      : unlockable
        ? "unlockable"
        : locked
          ? "locked"
          : funded
            ? "funded"
            : "empty";
  const selectedResource = resources.find((r) => r.id === resourceId);
  const escrowAmt = funded ? (deal?.price ?? "—") : selectedResource ? usdc(selectedResource.priceAtomic) : "—";

  const phaseIdx = status === "settled" ? 4 : status === "settling" ? 3 : status === "signing" ? 2 : deal ? 1 : 0;
  const paySteps = [
    { label: "402 — payment required", sub: deal?.price ? `provider asks ${deal.price}` : "" },
    { label: "authorization signed", sub: "EIP-3009 · ERC-1271" },
    { label: "settled into escrow", sub: escrowId ? `escrow #${escrowId}` : "" },
    { label: "paid", sub: "USDC → escrow" },
  ];

  // ── Purchases: ledger enriched with live escrow status + spend analytics ──
  const purchases = [...agent.ledger].reverse();
  const totalSpent = agent.ledger.reduce((sum, r) => sum + BigInt(r.amountAtomic), 0n);
  const stateOf = (r: SpendRecord) => purchaseState(r, nowSec);
  const heldCount = agent.ledger.filter((r) => stateOf(r) === "held").length;
  const releasableRecords = agent.ledger.filter((r) => stateOf(r) === "releasable");
  const releasableIds = Array.from(
    new Set(releasableRecords.map((r) => r.escrowId).filter((x): x is string => !!x)),
  );

  const byResource = (() => {
    const map = new Map<string, { name: string; amount: bigint; count: number }>();
    for (const r of agent.ledger) {
      const key = r.resourceId ?? r.resourceName ?? r.description ?? "resource";
      const name = r.resourceName ?? r.description ?? "resource";
      const cur = map.get(key) ?? { name, amount: 0n, count: 0 };
      cur.amount += BigInt(r.amountAtomic);
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1));
  })();
  const maxResourceAmt = byResource.reduce((m, b) => (b.amount > m ? b.amount : m), 1n);

  const renderPurchase = (r: SpendRecord, i: number) => {
    const st = stateOf(r);
    const eid = r.escrowId;
    const left = typeof r.deadline === "number" ? Math.max(0, r.deadline - nowSec) : 0;
    const busy = !!eid && (busyEscrow === eid || batchReleasing);
    const statusText =
      st === "held"
        ? typeof r.deadline === "number"
          ? `held · seller redeems in ${formatSecs(left)}`
          : "held in escrow"
        : st === "releasable"
          ? "releasable now"
          : st === "released"
            ? "released to seller"
            : "paid directly";
    return (
      <div key={`${r.ts}-${i}`} className={`purch purch--${st}`}>
        <div className="purch__top">
          <div className="purch__id">
            <span className="purch__name">{r.resourceName ?? r.description}</span>
            <span className="purch__meta mono">
              {new Date(r.ts).toLocaleString()} · {eid ? `escrow #${eid}` : "direct"}
            </span>
          </div>
          <span className="purch__price">{usdc(r.amountAtomic)}</span>
        </div>
        {r.result ? <p className="purch__data">“{r.result}”</p> : null}
        <div className="purch__foot">
          <span className={`purch__status purch__status--${st}`}>
            {st === "held" ? <Icon name="lock" size={11} stroke={2} /> : null}
            {st === "released" ? <Icon name="check" size={11} stroke={2} /> : null}
            {statusText}
          </span>
          <button className="purch__audit" onClick={() => setDetail(r)}>
            <Icon name="terminal" size={11} stroke={2} /> Audit log
          </button>
          {r.tx ? (
            <a className="purch__tx" href={`https://sepolia.arbiscan.io/tx/${r.tx}`} target="_blank" rel="noreferrer">
              pay tx {r.tx.slice(0, 8)}… ↗
            </a>
          ) : null}
          {st === "released" && r.releaseTx ? (
            <a className="purch__tx" href={`https://sepolia.arbiscan.io/tx/${r.releaseTx}`} target="_blank" rel="noreferrer">
              release tx {r.releaseTx.slice(0, 8)}… ↗
            </a>
          ) : null}
          {st === "releasable" && eid ? (
            <button className="purch__release" onClick={() => void releasePurchase(eid)} disabled={busy}>
              {busy ? "Releasing…" : "Release →"}
            </button>
          ) : null}
          {r.coverage ? (
            <span
              className={`purch__cov purch__cov--${r.coverage.status}`}
              title={r.coverage.note ?? undefined}
            >
              <Icon name="shield" size={11} stroke={2} />
              {r.coverage.status === "active"
                ? r.coverage.claimed
                  ? `claimed ${usdc(r.coverage.claimPayoutAtomic ?? "0")}`
                  : `insured #${r.coverage.coverageId}`
                : r.coverage.status === "pending-setup"
                  ? "coverage pending setup"
                  : "coverage failed"}
            </span>
          ) : null}
          {r.coverage?.status === "active" && !r.coverage.claimed && st === "releasable" && eid ? (
            <button className="purch__claim" onClick={() => void claimPurchase(eid)} disabled={busy}>
              {busy ? "Filing…" : "File claim →"}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderLine = (line: SessionLine) => {
    if (line.kind === "cmd") {
      return (
        <div key={line.id} className="cl cl--cmd">
          <span className="cl__caret">❯</span>
          <span className="cl__cmd-text mono">{line.text}</span>
        </div>
      );
    }
    if (line.kind === "thinking") {
      return (
        <div key={line.id} className="cl cl--thinking">
          <span className="cl__gutter">//</span>
          <span className="cl__text">
            {stripMd(line.text ?? "")}
            {line.streaming ? <span className="cl__cursor" aria-hidden>▍</span> : null}
          </span>
        </div>
      );
    }
    if (line.kind === "result") {
      return (
        <div key={line.id} className="cl cl--result">
          <span className="cl__tag">✓ market read</span>
          <span className="cl__text">
            {stripMd(line.text ?? "")}
            {line.streaming ? <span className="cl__cursor" aria-hidden>▍</span> : null}
          </span>
        </div>
      );
    }
    if (line.kind === "action") {
      return (
        <div key={line.id} className="cl cl--action">
          <span className="cl__gutter">▸</span>
          <span className="cl__text">{stripMd(line.text ?? "")}</span>
        </div>
      );
    }
    if (line.kind === "seller") {
      return (
        <div key={line.id} className="cl cl--seller">
          <span className="cl__seller-tag">⊙ seller</span>
          <span className="cl__text">
            {stripMd(line.text ?? "")}
            {line.streaming ? <span className="cl__cursor" aria-hidden>▍</span> : null}
            {line.tx ? (
              <a
                className="cl__tx"
                href={line.arbiscan ?? `https://sepolia.arbiscan.io/tx/${line.tx}`}
                target="_blank"
                rel="noreferrer"
              >
                {" "}
                {line.tx.slice(0, 12)}… ↗
              </a>
            ) : null}
          </span>
        </div>
      );
    }
    if (line.kind === "payment") {
      return (
        <div key={line.id} className={`pay pay--${escrowState}`}>
          <div className="pay__head">
            <span className="pay__icon">
              <Icon name="bolt" size={20} stroke={2.2} />
            </span>
            <span className="pay__title">x402 payment</span>
            <span className={`pay__status pay__status--${status === "settled" ? "ok" : status === "failed" ? "err" : "run"}`}>
              {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="pay__fields">
            <div className="pay__field">
              <span className="pay__k">from</span>
              <span className="pay__v mono">
                {shortAddress(agent.address)} <em>agent smart wallet</em>
              </span>
            </div>
            <div className="pay__field">
              <span className="pay__k">to</span>
              <span className="pay__v mono">{escrowId ? `escrow #${escrowId}` : "escrow …"}</span>
            </div>
            <div className="pay__field">
              <span className="pay__k">value</span>
              <span className="pay__v pay__v--amt">{deal?.price ?? "—"}</span>
            </div>
          </div>
          <ol className="pay__steps">
            {paySteps.map((step, i) => {
              const done = phaseIdx > i + 1 || (phaseIdx === i + 1 && !running);
              const active = running && phaseIdx === i + 1 && !done;
              const state = done ? "done" : active ? "active" : "pending";
              return (
                <li key={step.label} className={`pay__step pay__step--${state}`}>
                  <span className="pay__mark">
                    {done ? "✓" : active ? <span className="spin" aria-hidden>◠</span> : "·"}
                  </span>
                  <span className="pay__step-label">
                    {step.label}
                    {step.sub ? <em> · {step.sub}</em> : null}
                    {i === 3 && tx ? (
                      <a className="cl__tx" href={arbiscan ?? `https://sepolia.arbiscan.io/tx/${tx}`} target="_blank" rel="noreferrer">
                        {" "}
                        {tx.slice(0, 12)}… ↗
                      </a>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      );
    }
    // event
    return (
      <div key={line.id} className={`cl cl--event${line.error ? " cl--error" : ""}`}>
        <span className="cl__gutter">{line.error ? "✗" : "·"}</span>
        <span className="cl__text">
          {line.text}
          {line.tx ? (
            <a className="cl__tx" href={line.arbiscan ?? `https://sepolia.arbiscan.io/tx/${line.tx}`} target="_blank" rel="noreferrer">
              {" "}
              {line.tx.slice(0, 12)}… ↗
            </a>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div className="cns">
      {/* compact settlement pipe */}
      <div className="pipe bw-card">
        <div className="pipe__zone">
          <div className="pipe__node">
            <span className={`pipe__chip${paying ? " pipe__chip--active" : ""}`}>
              <Icon name="bolt" size={15} stroke={2} />
            </span>
            <div className="pipe__node-meta">
              <span className="pipe__node-name">{agent.name}</span>
              <span className="pipe__node-sub">via passkey treasury</span>
            </div>
          </div>
          <span
            className={`pipe__arrow${paying ? " pipe__arrow--active" : ""}${funded ? " pipe__arrow--done" : ""}`}
            aria-hidden
          >
            <span className="pipe__spark" />
          </span>
        </div>

        <div className={`pipe__escrow pipe__escrow--${escrowState}`}>
          <span className="pipe__escrow-icon">
            <Icon name={released ? "check" : breach ? "shield" : "lock"} size={16} stroke={2} />
          </span>
          <div className="pipe__escrow-meta">
            <span className="pipe__escrow-id mono">{escrowId ? `Escrow #${escrowId}` : "Escrow"}</span>
            <span className={`pipe__escrow-amt${funded ? "" : " pipe__escrow-amt--pending"}`}>{escrowAmt}</span>
          </div>
          {locked ? (
            <div className="pipe__time">
              <span className="pipe__time-s mono">seller redeems · {secondsLeft}s</span>
              <span className="pipe__timebar"><span style={{ width: `${pct}%` }} /></span>
            </div>
          ) : claimable ? (
            <button
              className="pipe__claim"
              onClick={() => escrowId && void claimPurchase(escrowId)}
              disabled={busyEscrow === escrowId}
            >
              {busyEscrow === escrowId ? "Filing…" : "File claim →"}
            </button>
          ) : claimedCov ? (
            <span className="pipe__escrow-hint pipe__escrow-hint--claim">
              claimed · {usdc(currentCoverage?.claimPayoutAtomic ?? "0")}
            </span>
          ) : unlockable ? (
            <span className="pipe__escrow-hint pipe__escrow-hint--claim">not delivered</span>
          ) : funded || released ? (
            <span className="pipe__escrow-hint">{released ? "released" : "held"}</span>
          ) : null}
        </div>

        <div className="pipe__zone pipe__zone--right">
          <span
            className={`pipe__arrow${running && funded && !released ? " pipe__arrow--active" : ""}${released ? " pipe__arrow--done" : ""}`}
            aria-hidden
          >
            <span className="pipe__spark" />
          </span>
          <div className="pipe__node">
            <span
              className={`pipe__chip pipe__chip--seller${
                released ? " pipe__chip--active" : running && funded ? " pipe__chip--thinking" : ""
              }`}
            >
              <Icon name="feed" size={15} stroke={2} />
            </span>
            <div className="pipe__node-meta">
              <span className="pipe__node-name">Data Desk</span>
              <span className="pipe__node-sub">
                {released ? "delivered ✓" : running && funded ? "reasoning…" : "seller agent"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* terminal */}
      <div className="term bw-card">
        <div className="term__bar">
          <div className="term__title">
            <span className="term__dots" aria-hidden><i /><i /><i /></span>
            <span className="term__path mono">
              {agent.name.toLowerCase().replace(/\s+/g, "-")}@reineira
              <span className="term__path-dim"> · settlement session</span>
            </span>
          </div>
          <div className="term__tabs">
            <button className={`term__tab${tab === "console" ? " term__tab--active" : ""}`} onClick={() => setTab("console")}>
              Console
            </button>
            <button className={`term__tab${tab === "purchases" ? " term__tab--active" : ""}`} onClick={() => setTab("purchases")}>
              Purchases · {agent.ledger.length}
            </button>
          </div>
        </div>

        {tab === "console" ? (
          <div className="term__body thin-scroll" ref={bodyRef}>
            {session.length === 0 ? (
              <div className="term__empty mono">
                <span className="cl__caret">❯</span> awaiting run — pick a resource below and hit{" "}
                <span className="term__kbd">Run deal</span>
              </div>
            ) : (
              <div className="term__lines">{session.map(renderLine)}</div>
            )}
            {running ? (
              <div className="term__running-line mono">
                <span className="spin" aria-hidden>◠</span> {status}…
              </div>
            ) : null}
            {notice ? <div className="term__notice">{notice}</div> : null}
          </div>
        ) : (
          <div className="term__body thin-scroll term__purch">
            {agent.ledger.length === 0 ? (
              <div className="purch-empty">
                <Icon name="feed" size={22} stroke={1.5} />
                <p>No purchases yet.</p>
                <span className="agents__muted">Run a deal — every resource the agent buys lands here with its data and escrow status.</span>
              </div>
            ) : (
              <>
                <div className="purch-tools">
                  <span className="purch-tools__sum">
                    <strong>{agent.ledger.length}</strong> purchases · <strong>{usdc(totalSpent.toString())}</strong> spent
                    {heldCount > 0 ? <span className="purch-tools__held"> · {heldCount} held</span> : null}
                  </span>
                  {releasableIds.length > 0 ? (
                    <button
                      className="purch-tools__batch"
                      onClick={() => void releaseAllEligible(releasableIds)}
                      disabled={batchReleasing || !!busyEscrow}
                    >
                      {batchReleasing ? "Releasing…" : `Release all eligible (${releasableIds.length})`}
                    </button>
                  ) : null}
                </div>

                {byResource.length > 1 ? (
                  <div className="purch-bars">
                    <span className="purch-bars__cap">Spend by resource</span>
                    {byResource.map((b) => (
                      <div key={b.name} className="purch-bar">
                        <span className="purch-bar__l">{b.name}</span>
                        <span className="purch-bar__track">
                          <span style={{ width: `${Number((b.amount * 100n) / maxResourceAmt)}%` }} />
                        </span>
                        <span className="purch-bar__v mono">
                          {usdc(b.amount.toString())} · {b.count}×
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="purch-list">{purchases.map(renderPurchase)}</div>
              </>
            )}
            {notice ? <div className="term__notice">{notice}</div> : null}
          </div>
        )}

        {tab === "console" ? (
          <div className="term__foot">
            <span className="term__input-mark mono">❯</span>
            <span className="term__input-kw mono">buy</span>
            <select
              className="term__resource-sel"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              disabled={running}
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {usdc(r.priceAtomic)}
                </option>
              ))}
            </select>
            <label
              className="term__decline"
              title="Make the seller agent decline this order so the escrow breaches — for demoing the insurance claim path"
            >
              <input
                type="checkbox"
                checked={forceDecline}
                onChange={(e) => setForceDecline(e.target.checked)}
                disabled={running}
              />
              force breach
            </label>
            <button className="term__run" onClick={() => void runDeal()} disabled={running}>
              {running ? (
                <>
                  <span className="spin" aria-hidden>◠</span> Running…
                </>
              ) : (
                <>
                  <Icon name="play" size={14} stroke={2} /> Run deal
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {detail ? <PurchaseDetail record={detail} nowSec={nowSec} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
