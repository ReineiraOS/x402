"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "../../ui/Icon";
import styles from "./TwoKeyTheater.module.css";

type Zone = "vault" | "sentinel" | "guardian" | "system";
type VaultState = "idle" | "healthy" | "bonded" | "draining" | "paused" | "safe";
type Verdict = "VALID" | "FALSE";
type HonestLabel = "staged" | "scripted" | "ledger";
type StageState = "pending" | "active" | "done" | "alert";

type RunEvent = {
  zone?: Zone;
  kind?: string;
  level?: "error";
  state?: VaultState;
  totalAssets?: string;
  recordedFloor?: string;
  msg?: string;
  tx?: string;
  arbiscan?: string;
  escrowId?: string;
  status?: Verdict;
  label?: HonestLabel;
  done?: boolean;
};

type LogLine = {
  id: number;
  zone: Zone;
  msg: string;
  tx?: string;
  arbiscan?: string;
  label?: "staged" | "scripted";
  ledger?: boolean;
  error?: boolean;
};

type VaultView = {
  state: VaultState;
  totalAssets: string | null;
  recordedFloor: string | null;
};

type Milestones = { bonded: boolean; alarm: boolean; frozen: boolean; settled: boolean };
type Addrs = { sentinel: string; guardian: string; vault: string };

const EMPTY_MILESTONES: Milestones = { bonded: false, alarm: false, frozen: false, settled: false };

const VAULT_COPY: Record<VaultState, { state: string; banner?: string; icon: string }> = {
  idle: { state: "awaiting run", icon: "lock" },
  healthy: { state: "above floor", icon: "shield" },
  bonded: {
    state: "alarm raised",
    banner: "a bond was staked to raise this alarm",
    icon: "bolt",
  },
  draining: {
    state: "below floor",
    banner: "balance dropped below the floor",
    icon: "alert",
  },
  paused: { state: "frozen · drain stopped", icon: "lock" },
  safe: { state: "frozen · rest secured", icon: "check" },
};

function formatUsdc(atomic: string | null): string {
  if (atomic === null) return "—";
  try {
    const n = Number(BigInt(atomic)) / 1e6;
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return "—";
  }
}

function shortTx(tx: string): string {
  return tx.length > 14 ? `${tx.slice(0, 8)}…${tx.slice(-7)}` : tx;
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function TxLink({ tx, arbiscan }: { tx: string; arbiscan?: string }) {
  return (
    <a
      className={styles.tx}
      href={arbiscan ?? `https://sepolia.arbiscan.io/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
    >
      {shortTx(tx)} ↗
    </a>
  );
}

type Stage = { key: string; icon: string; label: string; sub: string; state: StageState };

// Derive the five-beat choreography spine purely from the live run state. Each milestone is set
// by a real emitted event (bond/alert/pause/verdict/settle), so the spine lights up in lockstep
// with the on-chain transactions rather than on a timer.
function buildStages(
  running: boolean,
  ms: Milestones,
  verdict: Verdict | null,
  falseAlarm: boolean,
): Stage[] {
  const done = [ms.bonded, ms.alarm, ms.frozen, verdict !== null, ms.settled];
  const activeIdx = running ? done.findIndex((d) => !d) : -1;
  const at = (i: number, doneState: StageState = "done"): StageState =>
    done[i] ? doneState : i === activeIdx ? "active" : "pending";
  const isFalse = verdict === "FALSE";
  return [
    {
      key: "stake",
      icon: "fingerprint",
      label: "Stake",
      sub: ms.bonded ? "bond staked" : activeIdx === 0 ? "staking bond…" : "stake to speak",
      state: at(0),
    },
    {
      key: "alarm",
      icon: "bolt",
      label: "Alarm",
      sub: ms.alarm ? (isFalse || falseAlarm ? "false positive" : "breach committed") : "raise the alarm",
      state: at(1),
    },
    {
      key: "freeze",
      icon: "lock",
      label: "Freeze",
      sub: ms.frozen ? "vault paused" : "Guardian freezes",
      state: at(2),
    },
    {
      key: "verdict",
      icon: isFalse ? "alert" : "shield",
      label: "Verdict",
      sub: verdict ?? "reads the floor",
      state: verdict ? (isFalse ? "alert" : "done") : activeIdx === 3 ? "active" : "pending",
    },
    {
      key: "settle",
      icon: isFalse ? "alert" : "check",
      label: "Settle",
      sub: ms.settled ? (verdict === "VALID" ? "bond returned" : "bond slashed") : "settle the stake",
      state: ms.settled ? (verdict === "VALID" ? "done" : "alert") : activeIdx === 4 ? "active" : "pending",
    },
  ];
}

export function TwoKeyTheater() {
  const [running, setRunning] = useState(false);
  const [falseAlarm, setFalseAlarm] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [vault, setVault] = useState<VaultView>({
    state: "idle",
    totalAssets: null,
    recordedFloor: null,
  });
  const [lastZone, setLastZone] = useState<Zone | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [milestones, setMilestones] = useState<Milestones>(EMPTY_MILESTONES);
  const [addrs, setAddrs] = useState<Addrs | null>(null);
  const [bootDone, setBootDone] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<{ totalAssets: string; recordedFloor: string } | null>(null);

  // Read the live vault on mount so the hero shows real on-chain numbers before the first run.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/twokey/state", { cache: "no-store" });
        const j = (await res.json()) as {
          configured?: boolean;
          totalAssets?: string;
          recordedFloor?: string;
          healthy?: boolean;
          paused?: boolean;
          sentinel?: string;
          guardian?: string;
          vault?: string;
        };
        if (!active) return;
        if (j.configured && j.totalAssets && j.recordedFloor) {
          snapRef.current = { totalAssets: j.totalAssets, recordedFloor: j.recordedFloor };
          setAddrs({ sentinel: j.sentinel!, guardian: j.guardian!, vault: j.vault! });
          setVault((prev) =>
            prev.totalAssets === null
              ? {
                  state: j.paused ? "paused" : j.healthy ? "healthy" : "draining",
                  totalAssets: j.totalAssets!,
                  recordedFloor: j.recordedFloor!,
                }
              : prev,
          );
        }
      } catch {
        /* leave the hero in its idle state */
      } finally {
        if (active) setBootDone(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [log, running]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const pushLog = useCallback((line: Omit<LogLine, "id">) => {
    const id = (idRef.current += 1);
    setLog((prev) => [...prev, { id, ...line }]);
  }, []);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      if (event.done) {
        setRunning(false);
        return;
      }
      if (event.level === "error") {
        pushLog({ zone: "system", msg: event.msg ?? "error", error: true });
        setRunning(false);
        return;
      }

      const zone = event.zone;
      if (!zone) return;
      setLastZone(zone);

      // milestones drive the choreography spine — set off real emitted beats
      if (zone === "sentinel" && event.kind === "bond") {
        setMilestones((m) => ({ ...m, bonded: true }));
      } else if (zone === "sentinel" && event.kind === "alert") {
        setMilestones((m) => ({ ...m, alarm: true }));
      } else if (zone === "guardian" && event.kind === "paused") {
        setMilestones((m) => ({ ...m, frozen: true }));
      } else if (zone === "sentinel" && event.kind === "settle") {
        setMilestones((m) => ({ ...m, settled: true }));
      }

      if (zone === "vault") {
        setVault((prev) => ({
          state: event.state ?? prev.state,
          totalAssets: event.totalAssets ?? prev.totalAssets,
          recordedFloor: event.recordedFloor ?? prev.recordedFloor,
        }));
        if (event.msg) {
          pushLog({ zone, msg: event.msg, tx: event.tx, arbiscan: event.arbiscan });
        }
        return;
      }

      if (zone === "guardian" && event.kind === "verdict" && event.status) {
        setVerdict(event.status);
      }

      const inlineLabel =
        event.label === "staged" || event.label === "scripted" ? event.label : undefined;
      pushLog({
        zone,
        msg: event.msg ?? "",
        tx: event.tx,
        arbiscan: event.arbiscan,
        label: inlineLabel,
        ledger: event.label === "ledger",
      });
    },
    [pushLog],
  );

  const run = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setLog([]);
    setVerdict(null);
    setLastZone(null);
    setMilestones(EMPTY_MILESTONES);
    // reset to the known on-chain snapshot (not a blank dash) so the hero never flashes empty
    setVault(
      snapRef.current
        ? { state: "healthy", totalAssets: snapRef.current.totalAssets, recordedFloor: snapRef.current.recordedFloor }
        : { state: "idle", totalAssets: null, recordedFloor: null },
    );

    const url = `/api/run?mode=twokey${falseAlarm ? "&falseAlarm=1" : ""}`;
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
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
            /* ignore malformed frame */
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      pushLog({
        zone: "system",
        msg: error instanceof Error ? error.message : String(error),
        error: true,
      });
    } finally {
      setRunning(false);
    }
  }, [running, falseAlarm, handleEvent, pushLog]);

  const sentinelActive = lastZone === "sentinel";
  const guardianActive = lastZone === "guardian";
  const stages = buildStages(running, milestones, verdict, falseAlarm);
  const beatsDone = stages.filter((s) => s.state === "done" || s.state === "alert").length;
  const beatPct = (beatsDone / stages.length) * 100;

  return (
    <div className="ws__layout">
      {/* ── Left rail: identity · run · the three actors · honesty ── */}
      <aside className="agside thin-scroll">
        <Link href="/" className="agside__back">
          <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(180deg)" }} />
          Showcase
        </Link>
        <div className={styles.railHead}>
          <span className="eyebrow">Security primitive</span>
          <span className={styles.railTitle}>Two-Key Halt</span>
        </div>

        {/* Run controls */}
        <div className="agside__card">
          <span className="agside__card-cap">Run</span>
          <button className={styles.controls__run} onClick={() => void run()} disabled={running}>
            {running ? (
              <>
                <span className="spin" aria-hidden>
                  ◠
                </span>
                Running the halt…
              </>
            ) : (
              <>
                <Icon name="play" size={16} stroke={2} /> Run the Two-Key Halt
              </>
            )}
          </button>
          <div className={styles.scenario} role="group" aria-label="Run scenario">
            <button
              type="button"
              className={`${styles.scenario__seg}${!falseAlarm ? ` ${styles["scenario__seg--genuine"]}` : ""}`}
              onClick={() => setFalseAlarm(false)}
              disabled={running}
              aria-pressed={!falseAlarm}
            >
              <span className={styles.scenario__top}>
                <Icon name="bolt" size={13} stroke={2.2} /> Genuine alarm
              </span>
            </button>
            <button
              type="button"
              className={`${styles.scenario__seg}${falseAlarm ? ` ${styles["scenario__seg--false"]}` : ""}`}
              onClick={() => setFalseAlarm(true)}
              disabled={running}
              aria-pressed={falseAlarm}
            >
              <span className={styles.scenario__top}>
                <Icon name="alert" size={13} stroke={2.2} /> False alarm
              </span>
            </button>
          </div>
        </div>

        {/* The three actors, stacked */}
        <div className={styles.theater}>
          <KeyCard
            side="sentinel"
            active={sentinelActive}
            name="Sentinel"
            role="stakes a bond to speak"
            icon="fingerprint"
            addr={addrs?.sentinel}
            line={lastZoneLine(log, "sentinel")}
            idle="Idle — to speak, it must stake a bond over x402."
          />

          <KeyCard
            side="guardian"
            active={guardianActive}
            name="Guardian"
            role="pauses · cannot move funds"
            icon={verdict === "VALID" ? "check" : "shield"}
            addr={addrs?.guardian}
            line={lastZoneLine(log, "guardian")}
            idle="Trusts the bond — never talks to the Sentinel."
            badge={
              verdict ? (
                <span
                  className={`${styles.verdict} ${verdict === "VALID" ? styles["verdict--valid"] : styles["verdict--false"]}`}
                >
                  <Icon name={verdict === "VALID" ? "check" : "alert"} size={15} stroke={2.4} />
                  {verdict}
                </span>
              ) : null
            }
          />
        </div>

        {/* Honesty key */}
        <div className={`agside__card ${styles.honestyCard}`}>
          <span className="agside__card-cap">Honesty</span>
          <span className={`${styles.honest} ${styles["honest--live"]}`}>
            <span className={styles.honest__dot} aria-hidden /> LIVE
            <em>bond · pause · verdict · settle</em>
          </span>
          <span className={`${styles.honest} ${styles["honest--staged"]}`}>
            <span className={styles.honest__dot} aria-hidden /> STAGED
            <em>attacker drain · detection</em>
          </span>
          <span className={`${styles.honest} ${styles["honest--deferred"]}`}>
            <span className={styles.honest__dot} aria-hidden /> DEFERRED
            <em>funded bounty pool</em>
          </span>
        </div>
      </aside>

      {/* ── Right stage: choreography spine + the console ── */}
      <div className={`ws__stage ${styles.stageCol}`}>
        {/* Choreography progress bar — the SAME `.flow` stepper as the agent deal pipeline */}
        <div className="flow bw-card" role="list" aria-label="Two-Key Halt choreography">
          <div className="flow__steps">
            {stages.map((s, i) => (
              <Fragment key={s.key}>
                {i > 0 ? (
                  <span
                    className={`flow__link${
                      stages[i - 1]!.state === "done" || stages[i - 1]!.state === "alert"
                        ? " flow__link--on"
                        : ""
                    }`}
                    aria-hidden
                  />
                ) : null}
                <div
                  className={`flow__step flow__step--${s.state === "alert" ? "breach" : s.state}`}
                  role="listitem"
                >
                  <span className="flow__chip">
                    <Icon name={s.icon} size={15} stroke={2} />
                  </span>
                  <span className="flow__label">{s.label}</span>
                  <span className="flow__sub">{s.sub}</span>
                </div>
              </Fragment>
            ))}
          </div>
          <div className="flow__status">
            <div className={`flow__count${running || beatsDone > 0 ? "" : " flow__count--idle"}`}>
              <Icon name={running ? "shield" : "play"} size={13} stroke={2} />
              <span className="mono">
                {running ? "running the halt…" : beatsDone > 0 ? "halt complete" : "awaiting run"}
              </span>
              <span className="flow__bar" aria-hidden>
                <span style={{ width: `${beatPct}%` }} />
              </span>
            </div>
          </div>
        </div>

        {/* Event log — terminal, fills the rest of the stage */}
        <div className={`${styles.log} bw-card`}>
          <div className={styles.log__bar}>
            <span className={styles.log__dots} aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className={styles.log__title}>
              two-key-halt@reineira
              <span className={styles["log__title-dim"]}> · on-chain choreography</span>
            </span>
            {running ? (
              <span className={styles.log__running}>
                <span className="spin" aria-hidden>
                  ◠
                </span>
                streaming…
              </span>
            ) : null}
          </div>
          <div
            className={`${styles.log__body} thin-scroll${log.length === 0 ? ` ${styles["log__body--empty"]}` : ""}`}
            ref={bodyRef}
          >
            {log.length === 0 ? (
              <span className={styles.log__empty}>
                <span className={styles.log__caret}>❯</span> awaiting run — press{" "}
                <strong>Run the Two-Key Halt</strong>.
              </span>
            ) : (
              log.map((line) => <LogRow key={line.id} line={line} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyCard({
  side,
  active,
  name,
  role,
  icon,
  addr,
  line,
  idle,
  badge,
}: {
  side: "sentinel" | "guardian";
  active: boolean;
  name: string;
  role: string;
  icon: string;
  addr?: string;
  line: LogLine | null;
  idle: string;
  badge?: ReactNode;
}) {
  return (
    <div
      className={`${styles.actor} ${styles[`actor--${side}`]}${active ? ` ${styles["actor--active"]}` : ""}`}
    >
      <div className={styles.actor__head}>
        <span className={styles.actor__chip}>
          <Icon name={icon} size={18} stroke={2.4} />
        </span>
        <div className={styles.actor__id}>
          <span className={styles.actor__name}>{name}</span>
          {addr ? (
            <a
              className={styles.actor__addr}
              href={`https://sepolia.arbiscan.io/address/${addr}`}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(addr)} ↗
            </a>
          ) : (
            <span className={styles.actor__addr}>—</span>
          )}
        </div>
      </div>
      <div className={styles["actor__badge-slot"]}>
        {badge ?? (
          <span className={`${styles.standby}${active ? ` ${styles["standby--active"]}` : ""}`}>
            <span className={styles.standby__dot} aria-hidden />
            {active ? "active" : "standby"}
          </span>
        )}
      </div>
      <div className={styles.actor__body}>
        <ZoneLine active={active} line={line} idle={idle} />
      </div>
      <span className={styles.actor__sub}>{role}</span>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  if (line.ledger) {
    return (
      <div className={`${styles.row} ${styles["row--ledger"]}`}>
        <span className={styles.row__gutter}>Honesty ledger</span>
        <span className={styles.row__body}>{line.msg}</span>
      </div>
    );
  }
  return (
    <div className={`${styles.row}${line.error ? ` ${styles["row--error"]}` : ""}`}>
      <span className={`${styles.row__gutter} ${styles[`row__gutter--${line.zone}`] ?? ""}`}>
        {line.zone}
      </span>
      <span className={styles.row__body}>
        {line.msg}
        {line.label ? (
          <span
            className={`${styles["inline-chip"]} ${styles[`inline-chip--${line.label}`] ?? ""}`}
          >
            {line.label.toUpperCase()}
          </span>
        ) : null}
        {line.tx ? <TxLink tx={line.tx} arbiscan={line.arbiscan} /> : null}
      </span>
    </div>
  );
}

function ZoneLine({ active, line, idle }: { active: boolean; line: LogLine | null; idle: string }) {
  if (!line) {
    return <p className={`${styles.actor__line} ${styles["actor__line--idle"]}`}>{idle}</p>;
  }
  return (
    <p className={styles.actor__line} style={active ? undefined : { opacity: 0.85 }}>
      {line.msg}
      {line.tx ? <TxLink tx={line.tx} arbiscan={line.arbiscan} /> : null}
    </p>
  );
}

function lastZoneLine(log: LogLine[], zone: Zone): LogLine | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i]!.zone === zone) return log[i]!;
  }
  return null;
}
