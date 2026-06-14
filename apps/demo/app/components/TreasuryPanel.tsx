"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";
import { usdc, shortAddress, type ClientAgent } from "./agentTypes";
import {
  registerTreasury,
  storedTreasuryAddress,
  treasuryUsdcBalance,
  grantSessionKey,
  getSessionStatus,
  forgetTreasury,
  type SessionStatus,
} from "../../lib/passkeyTreasury";

function toAtomic(value: string): bigint {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1e6));
}

export function TreasuryPanel({ agents, onChange }: { agents: ClientAgent[]; onChange: () => void }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [balance, setBalance] = useState<string>("0");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [budgetInput, setBudgetInput] = useState("25");
  const [granting, setGranting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBalance = useCallback(async (addr: `0x${string}`) => {
    try {
      setBalance((await treasuryUsdcBalance(addr)).toString());
    } catch {
      setBalance("0");
    }
  }, []);

  const refreshSession = useCallback(async () => {
    setSession(await getSessionStatus());
  }, []);

  useEffect(() => {
    const addr = storedTreasuryAddress();
    if (addr) {
      setAddress(addr);
      void loadBalance(addr);
      void refreshSession();
    }
  }, [loadBalance, refreshSession]);

  const create = useCallback(
    async (mode: "register" | "login") => {
      setBusy(true);
      setNotice(null);
      try {
        const { address: addr } = await registerTreasury("payment-agents-treasury", mode);
        setAddress(addr);
        await loadBalance(addr);
        await refreshSession();
        setNotice(mode === "register" ? "Treasury created — owned by your passkey ✓" : "Passkey treasury restored ✓");
      } catch (error) {
        setNotice(`Passkey ${mode} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [loadBalance, refreshSession],
  );

  const copy = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const fund = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address);
    window.open("https://faucet.circle.com", "_blank", "noopener");
    setNotice("Treasury address copied · Circle faucet opened — send Arbitrum Sepolia USDC, then refresh.");
  };

  const refresh = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    await loadBalance(address);
    await refreshSession();
    setRefreshing(false);
  }, [address, loadBalance, refreshSession]);

  const reset = () => {
    forgetTreasury();
    setAddress(null);
    setSession(null);
    setBalance("0");
    setNotice(null);
    setOpen(false);
  };

  const budgetAtomic = session?.budgetAtomic ? BigInt(session.budgetAtomic) : 0n;
  const spentAtomic = BigInt(session?.spentAtomic ?? "0");
  const remainingAtomic = budgetAtomic > spentAtomic ? budgetAtomic - spentAtomic : 0n;
  const showGrant = !session?.granted || reauth;

  const doGrant = async () => {
    const b = toAtomic(budgetInput);
    if (b <= 0n || granting) return;
    setGranting(true);
    setNotice(null);
    try {
      await grantSessionKey(b.toString());
      await refreshSession();
      onChange();
      setReauth(false);
      setNotice("Spend budget authorized with passkey ✓ — agents can now pay autonomously within it.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setGranting(false);
    }
  };

  if (!address) {
    return (
      <section className="treasury treasury--empty bw-card">
        <div className="treasury__id">
          <span className="treasury__icon">
            <Icon name="passkey" size={27} stroke={2} />
          </span>
          <div className="treasury__meta">
            <span className="treasury__cap">Treasury · passkey wallet</span>
            <span className="treasury__intro">
              Create a passkey-owned treasury — you approve with your fingerprint, fund it once, and your
              agents pay from it within a budget you set. No per-agent wallets.
            </span>
          </div>
        </div>
        <div className="treasury__actions">
          <button className="btn-cta treasury__btn" onClick={() => void create("register")} disabled={busy}>
            <Icon name="fingerprint" size={15} stroke={2} />
            {busy ? "Waiting for passkey…" : "Create with passkey"}
          </button>
          <button className="btn-outline treasury__btn" onClick={() => void create("login")} disabled={busy}>
            Use existing
          </button>
        </div>
        {notice ? <div className="treasury__notice">{notice}</div> : null}
      </section>
    );
  }

  return (
    <section className="treasury bw-card">
      <div className="treasury__id">
        <span className="treasury__icon">
          <Icon name="passkey" size={27} stroke={2} />
        </span>
        <div className="treasury__meta">
          <span className="treasury__cap">
            Treasury · <span className="treasury__owned">passkey-owned</span>
          </span>
          <button className="treasury__addr mono" onClick={copy} title="Copy treasury address">
            <Icon name={copied ? "check" : "copy"} size={12} stroke={2} />
            {shortAddress(address)}
          </button>
        </div>
      </div>

      <div className="treasury__bal">
        <span className="treasury__bal-v">{usdc(balance)}</span>
        <span className="treasury__bal-l">
          {session?.granted ? (
            <>{usdc(remainingAtomic.toString())} left of {usdc(session.budgetAtomic ?? "0")} agent budget</>
          ) : (
            <>fund once · authorize a budget · agents pay from it</>
          )}
        </span>
      </div>

      <div className="treasury__actions">
        <button className="treasury__reset" onClick={reset} title="Forget this passkey treasury on this device and create a new one">
          Reset
        </button>
        <button
          className="ws__icon-btn"
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Refresh balance"
          aria-label="Refresh treasury balance"
        >
          <span className={refreshing ? "spin" : undefined}>
            <Icon name="refresh" size={14} stroke={2} />
          </span>
        </button>
        <button className="btn-outline treasury__btn" onClick={fund}>
          <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(-90deg)" }} />
          Fund
        </button>
        <button
          className="btn-cta treasury__btn"
          onClick={() => {
            setNotice(null);
            setReauth(false);
            setOpen(true);
          }}
        >
          <Icon name="shield" size={14} stroke={2} />
          {session?.granted ? "Budget" : "Authorize budget"}
        </button>
      </div>

      {notice && !open ? <div className="treasury__notice">{notice}</div> : null}

      {open ? (
        <div className="pd-overlay" onClick={() => setOpen(false)} role="presentation">
          <div className="pd bw-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
            <div className="pd__bar">
              <div className="pd__title">
                <span className="pd__name">Agent spend budget</span>
                <span className="pd__sub mono">treasury holds {usdc(balance)}</span>
              </div>
              <button className="pd__close" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="x" size={16} stroke={2} />
              </button>
            </div>
            <div className="pd__body thin-scroll">
              {showGrant ? (
                <div className="grant">
                  <p className="grant__lead">
                    Authorize a <strong>spend budget</strong> with one passkey signature. Your{" "}
                    {agents.length} agent{agents.length === 1 ? "" : "s"} can then pay for x402 resources{" "}
                    <strong>autonomously from the treasury</strong>, up to this budget — no fingerprint per
                    transaction, no per-agent wallets. Revoke or change anytime.
                  </p>
                  <label className="grant__field">
                    <span className="grant__label">Spend budget</span>
                    <span className="grant__input">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        placeholder="25"
                      />
                      <span>USDC</span>
                    </span>
                  </label>
                  <div className="grant__actions">
                    {session?.granted ? (
                      <button className="dist__split" onClick={() => setReauth(false)} disabled={granting}>
                        Cancel
                      </button>
                    ) : null}
                    <button className="btn-cta" onClick={() => void doGrant()} disabled={granting || toAtomic(budgetInput) <= 0n}>
                      <Icon name="fingerprint" size={15} stroke={2} />
                      {granting ? "Approve in passkey…" : "Authorize with passkey"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grant">
                  <div className="grant__status">
                    <span>
                      <b>{usdc(remainingAtomic.toString())}</b> left of {usdc(session?.budgetAtomic ?? "0")}
                      <span className="grant__status-dim"> · {usdc(spentAtomic.toString())} spent</span>
                    </span>
                    <button className="dist__split" onClick={() => setReauth(true)}>
                      Change budget
                    </button>
                  </div>
                  <p className="grant__lead">
                    Your agents pay for x402 resources autonomously from the treasury within this budget — settled
                    via the session key, gasless, no fingerprint per deal. When the budget runs low, re-authorize a
                    larger one.
                  </p>
                </div>
              )}
              {notice ? <div className="treasury__notice">{notice}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
