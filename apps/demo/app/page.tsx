"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "../ui/Icon";
import { TreasuryPanel } from "./components/TreasuryPanel";
import { usdc, shortAddress, type ClientAgent } from "./components/agentTypes";

export default function DashboardPage() {
  const [agents, setAgents] = useState<ClientAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      const json = (await res.json()) as { agents?: ClientAgent[] };
      setAgents(json.agents ?? []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Portal showcase</span>
          <h1 className="page__title">Agentic Payments</h1>
          <p className="page__lead">
            Each agent pays x402 resources from your passkey treasury. Funds settle into
            Escrow and release only when a Gate&apos;s condition is met. Create one, authorize
            a budget, and watch it settle on-chain.
          </p>
        </div>
      </div>

      <TreasuryPanel agents={agents} onChange={() => void load()} />

      {loading ? (
        <div className="page__empty">
          <span className="spin" aria-hidden>
            ◠
          </span>
          loading agents…
        </div>
      ) : agents.length === 0 ? (
        <div className="page__empty bw-card">
          <Icon name="plug" size={28} stroke={1.5} />
          <p>No agents yet.</p>
          <Link href="/agents/new" className="btn-cta">
            Create your first agent
          </Link>
        </div>
      ) : (
        <>
          <div className="agent-grid">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="agent-card bw-card group"
              >
                <div className="agent-card__top">
                  <span className="agent-card__name">{agent.name}</span>
                  {agent.isDefault ? <span className="pill agent-card__badge">Default</span> : null}
                </div>
                <code className="agent-card__addr mono">{shortAddress(agent.address)}</code>
                <div className="agent-card__stats">
                  <div>
                    <span className="agent-card__stat-label">Balance</span>
                    <span className="agent-card__stat-value">{usdc(agent.usdcBalanceAtomic)}</span>
                  </div>
                  <div>
                    <span className="agent-card__stat-label">Spent</span>
                    <span className="agent-card__stat-value">{usdc(agent.totalSpentAtomic)}</span>
                  </div>
                  <div>
                    <span className="agent-card__stat-label">Plugins</span>
                    <span className="agent-card__stat-value">{agent.pluginIds.length}</span>
                  </div>
                </div>
                <span className="agent-card__open">
                  Open workspace <Icon name="arrowRight" size={14} stroke={2} />
                </span>
              </Link>
            ))}
          </div>
          <div className="agent-foot">
            <Link href="/agents/new" className="btn-cta">
              <Icon name="plus" size={16} stroke={2} /> New agent
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
