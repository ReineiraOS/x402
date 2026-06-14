"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "../../../ui/Icon";
import { SettlementTheater } from "../../components/SettlementTheater";
import {
  usdc,
  shortAddress,
  formatDeadline,
  type ClientAgent,
  type SpendRecord,
} from "../../components/agentTypes";
import {
  storedTreasuryAddress,
  getSessionStatus,
  type SessionStatus,
} from "../../../lib/passkeyTreasury";

function avatarGradient(addr: string): string {
  const h = parseInt(addr.slice(2, 8), 16) % 360;
  return `linear-gradient(135deg, hsl(${h} 68% 56%), hsl(${(h + 48) % 360} 64% 44%))`;
}

function spendState(r: SpendRecord, now: number): "held" | "releasable" | "released" | "direct" {
  if (!r.escrowId) return "direct";
  if (r.released) return "released";
  if (typeof r.deadline === "number") return now >= r.deadline ? "releasable" : "held";
  return "held";
}

export default function AgentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [agent, setAgent] = useState<ClientAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [treasuryAddr, setTreasuryAddr] = useState<`0x${string}` | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const json = (await res.json()) as { agent?: ClientAgent };
      setAgent(json.agent ?? null);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTreasuryAddr(storedTreasuryAddress());
    void getSessionStatus().then(setSession);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const copyAddress = () => {
    if (!agent) return;
    void navigator.clipboard.writeText(agent.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const spend = useMemo(() => {
    if (!agent) return { held: 0, releasable: 0, released: 0 };
    let held = 0;
    let releasable = 0;
    let released = 0;
    for (const r of agent.ledger) {
      const st = spendState(r, nowSec);
      if (st === "held") held += 1;
      else if (st === "releasable") releasable += 1;
      else if (st === "released") released += 1;
    }
    return { held, releasable, released };
  }, [agent, nowSec]);

  if (loading) {
    return (
      <div className="ws ws--center">
        <div className="page__empty">
          <span className="spin" aria-hidden>
            ◠
          </span>
          loading agent…
        </div>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="ws ws--center">
        <div className="page__empty bw-card">
          <p>Agent not found.</p>
          <Link href="/" className="btn-cta">
            Back to agents
          </Link>
        </div>
      </div>
    );
  }

  const remaining =
    session?.budgetAtomic != null
      ? (BigInt(session.budgetAtomic) - BigInt(session.spentAtomic ?? "0")).toString()
      : null;

  return (
    <div className="ws">
      <div className="ws__layout">
        <aside className="agside thin-scroll">
          <Link href="/" className="agside__back">
            <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(180deg)" }} />
            Agents
          </Link>

          <div className="agside__id">
            <span
              className="agside__avatar"
              style={{ background: avatarGradient(agent.address) }}
              aria-hidden
            />
            <div className="agside__id-meta">
              <div className="agside__name-row">
                <span className="agside__name">{agent.name}</span>
                {agent.isDefault ? <span className="pill agside__badge">Default</span> : null}
              </div>
              <button
                className="agside__addr mono"
                onClick={copyAddress}
                title="Copy agent address"
              >
                <Icon name={copied ? "check" : "copy"} size={12} stroke={2} />
                {shortAddress(agent.address)}
              </button>
            </div>
          </div>

          <div className="agside__card">
            <span className="agside__card-cap">Funding</span>
            {treasuryAddr ? (
              <>
                <div className="agside__bal">
                  <span className="agside__bal-v">{remaining != null ? usdc(remaining) : "—"}</span>
                  <span className="agside__bal-l">
                    {session?.granted
                      ? "left in treasury budget"
                      : "no spend budget — authorize it"}
                  </span>
                </div>
                <p className="agside__fund-note">
                  Pays from your passkey treasury{" "}
                  <span className="mono">{shortAddress(treasuryAddr)}</span> via a session key — no
                  per-agent wallet.
                </p>
                <Link href="/" className="btn-outline agside__manage">
                  <Icon name="passkey" size={14} stroke={2} /> Manage treasury
                </Link>
              </>
            ) : (
              <>
                <p className="agside__fund-note">
                  No treasury yet. Create a passkey treasury on the home page, fund it once and
                  authorize a budget — every agent pays from it.
                </p>
                <Link href="/" className="btn-cta agside__manage">
                  <Icon name="passkey" size={14} stroke={2} /> Set up treasury
                </Link>
              </>
            )}
          </div>

          <div className="agside__card">
            <span className="agside__card-cap">Spend</span>
            <div className="agside__sum">
              <div className="agside__stat">
                <span className="agside__stat-v">{agent.ledger.length}</span>
                <span className="agside__stat-l">purchases</span>
              </div>
              <div className="agside__stat">
                <span className="agside__stat-v agside__stat-v--held">{spend.held}</span>
                <span className="agside__stat-l">held</span>
              </div>
              <div className="agside__stat">
                <span className="agside__stat-v agside__stat-v--ok">{spend.releasable}</span>
                <span className="agside__stat-l">releasable</span>
              </div>
              <div className="agside__stat">
                <span className="agside__stat-v agside__stat-v--done">{spend.released}</span>
                <span className="agside__stat-l">released</span>
              </div>
            </div>
            <span className="agside__sum-foot">
              {usdc(agent.totalSpentAtomic)} total · open the Purchases tab to release funds
            </span>
          </div>

          <div className="agside__card">
            <span className="agside__card-cap">Config</span>
            <div className="agside__chips">
              <span className="agside__chip">
                <Icon name="clock" size={11} stroke={2} /> release after{" "}
                {formatDeadline(agent.deadlineSeconds)}
              </span>
              {agent.pluginIds.map((pid) => (
                <span key={pid} className="agside__chip agside__chip--plugin mono">
                  <Icon name="plug" size={11} stroke={2} /> {pid}
                </span>
              ))}
            </div>
            {agent.prePrompt ? (
              <p className="agside__prompt">{agent.prePrompt}</p>
            ) : (
              <p className="agside__prompt agside__prompt--muted">No pre-prompt set.</p>
            )}
          </div>

          <div className="agside__settings">
            <Link href={`/agents/${agent.id}/edit`} className="btn-outline agside__edit">
              <Icon name="edit" size={14} stroke={2} /> Edit agent
            </Link>
          </div>
        </aside>

        <div className="ws__stage">
          <SettlementTheater
            agent={agent}
            onSettled={() => {
              void load();
              void getSessionStatus().then(setSession);
            }}
          />
        </div>
      </div>
    </div>
  );
}
