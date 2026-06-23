"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "../../ui/Icon";
import { INCIDENT_REPORTS, DEFAULT_REPORT_ID } from "../../lib/incidentReports";
import styles from "./IncidentResponseTheater.module.css";

type Zone = "incident" | "vault" | "system";
type VaultState = "idle" | "healthy" | "breached" | "frozen" | "settled";
type Decision = "halt" | "monitor";
type StageState = "pending" | "active" | "done" | "alert";

type RunEvent = Record<string, unknown>;

type LogLine = {
  id: number;
  zone: Zone;
  msg: string;
  tx?: string;
  arbiscan?: string;
  label?: "staged" | "scripted";
  ledger?: boolean;
  error?: boolean;
  thinking?: boolean;
  streaming?: boolean;
};

type Milestones = {
  reported: boolean;
  triaged: boolean;
  acted: boolean;
  settled: boolean;
};

const EMPTY_MILESTONES: Milestones = {
  reported: false,
  triaged: false,
  acted: false,
  settled: false,
};

type VerdictView = { severity: string; decision: Decision } | null;
type SettlementView = {
  outcome: "returned" | "slashed" | "payout" | "none";
  tx?: string;
  arbiscan?: string;
} | null;

const VAULT_COPY: Record<VaultState, { state: string; icon: string }> = {
  idle: { state: "awaiting run", icon: "lock" },
  healthy: { state: "operational", icon: "shield" },
  breached: { state: "breach detected", icon: "alert" },
  frozen: { state: "frozen by halt", icon: "lock" },
  settled: { state: "settled", icon: "check" },
};

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/_([^_]*)_/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>*-]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shortTx(tx: string): string {
  return tx.length > 14 ? `${tx.slice(0, 8)}…${tx.slice(-7)}` : tx;
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

function buildStages(
  running: boolean,
  ms: Milestones,
  verdict: VerdictView,
  settlement: SettlementView,
  isStreaming: boolean,
): Stage[] {
  const done = [ms.reported, ms.triaged, ms.acted, ms.settled];
  const activeIdx = running ? done.findIndex((d) => !d) : -1;
  const at = (i: number, doneState: StageState = "done"): StageState =>
    done[i] ? doneState : i === activeIdx ? "active" : "pending";

  const isFalsePos = verdict?.decision === "halt" && settlement?.outcome === "slashed";
  const isFalseNeg = verdict?.decision === "monitor" && settlement?.outcome === "payout";

  const triagedSub = ms.triaged
    ? verdict
      ? `${verdict.severity} · ${verdict.decision}`
      : "verdict issued"
    : activeIdx === 1
      ? isStreaming
        ? "reasoning…"
        : "classifying…"
      : "agent classifies";

  return [
    {
      key: "reported",
      icon: "doc",
      label: "Reported",
      sub: ms.reported ? "report ingested" : activeIdx === 0 ? "ingesting…" : "ingest report",
      state: at(0),
    },
    {
      key: "triaged",
      icon: "shield",
      label: "Triaged",
      sub: triagedSub,
      state: at(1),
    },
    {
      key: "acted",
      icon: verdict?.decision === "halt" ? "lock" : "bolt",
      label: "Acted",
      sub: ms.acted
        ? verdict?.decision === "halt"
          ? "vault frozen"
          : "monitoring"
        : activeIdx === 2
          ? "executing…"
          : "on-chain action",
      state: at(2, isFalsePos ? "alert" : "done"),
    },
    {
      key: "settled",
      icon: isFalsePos || isFalseNeg ? "alert" : "check",
      label: "Settled",
      sub: ms.settled
        ? settlement?.outcome === "returned"
          ? "bond returned"
          : settlement?.outcome === "slashed"
            ? "bond slashed"
            : settlement?.outcome === "payout"
              ? "pool paid out"
              : "no action"
        : activeIdx === 3
          ? "settling…"
          : "settle stake",
      state: ms.settled ? (isFalsePos ? "alert" : "done") : activeIdx === 3 ? "active" : "pending",
    },
  ];
}

export function IncidentResponseTheater() {
  const [reportId, setReportId] = useState(DEFAULT_REPORT_ID);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [milestones, setMilestones] = useState<Milestones>(EMPTY_MILESTONES);
  const [vaultState, setVaultState] = useState<VaultState>("idle");
  const [verdict, setVerdict] = useState<VerdictView>(null);
  const [settlement, setSettlement] = useState<SettlementView>(null);
  const [lastZone, setLastZone] = useState<Zone | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  const streamThinking = useCallback((delta: string) => {
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last?.thinking && last.streaming) {
        return [...prev.slice(0, -1), { ...last, msg: last.msg + stripMarkdown(delta) }];
      }
      const id = (idRef.current += 1);
      return [
        ...prev,
        {
          id,
          zone: "incident" as Zone,
          msg: stripMarkdown(delta),
          thinking: true,
          streaming: true,
        },
      ];
    });
    setIsStreaming(true);
  }, []);

  const endThinking = useCallback(() => {
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (!last?.thinking || !last.streaming) return prev;
      return [...prev.slice(0, -1), { ...last, streaming: false }];
    });
    setIsStreaming(false);
  }, []);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      if (event.done) {
        setRunning(false);
        return;
      }
      if (event.level === "error") {
        pushLog({ zone: "system", msg: String(event.msg ?? "error"), error: true });
        setRunning(false);
        return;
      }

      const zone = event.zone as Zone | undefined;
      if (zone !== "incident" && zone !== "vault" && zone !== "system") return;
      setLastZone(zone);

      if (zone === "incident") {
        const kind = event.kind as string | undefined;

        if (kind === "thinking") {
          if (event.streamEnd) {
            endThinking();
            return;
          }
          if (event.stream) {
            streamThinking(String(event.msg ?? ""));
            return;
          }
          if (event.msg) streamThinking(String(event.msg));
          return;
        }

        if (kind === "report") {
          setMilestones((m) => ({ ...m, reported: true }));
        } else if (kind === "verdict") {
          const sev = String(event.severity ?? "");
          const dec = String(event.decision ?? "") as Decision;
          setVerdict({ severity: sev, decision: dec });
          setMilestones((m) => ({ ...m, triaged: true }));
        } else if (kind === "bond" || kind === "halt" || kind === "breach") {
          setMilestones((m) => ({ ...m, acted: true }));
          if (kind === "breach") {
            setVaultState("breached");
          } else if (kind === "halt") {
            setVaultState("frozen");
          }
        } else if (kind === "settle") {
          setMilestones((m) => ({ ...m, settled: true }));
          const isHalt = verdict?.decision === "halt";
          setSettlement(
            isHalt
              ? {
                  outcome: "returned",
                  tx: event.tx !== undefined ? String(event.tx) : undefined,
                  arbiscan: event.arbiscan !== undefined ? String(event.arbiscan) : undefined,
                }
              : { outcome: "none" },
          );
          setVaultState("settled");
        } else if (kind === "slash") {
          setMilestones((m) => ({ ...m, settled: true }));
          setSettlement({ outcome: "slashed" });
        } else if (kind === "payout") {
          setMilestones((m) => ({ ...m, acted: true, settled: true }));
          setSettlement({
            outcome: "payout",
            tx: event.tx !== undefined ? String(event.tx) : undefined,
            arbiscan: event.arbiscan !== undefined ? String(event.arbiscan) : undefined,
          });
        }
      }

      if (zone === "vault") {
        const vstate = event.state as string | undefined;
        if (vstate === "healthy") setVaultState("healthy");
      }

      if (event.msg) {
        const inlineLabel =
          event.label === "staged" || event.label === "scripted"
            ? (event.label as "staged" | "scripted")
            : undefined;
        pushLog({
          zone,
          msg: String(event.msg),
          tx: event.tx !== undefined ? String(event.tx) : undefined,
          arbiscan: event.arbiscan !== undefined ? String(event.arbiscan) : undefined,
          label: inlineLabel,
          ledger: event.label === "ledger",
        });
      }
    },
    [pushLog, streamThinking, endThinking, verdict],
  );

  const run = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setLog([]);
    setVerdict(null);
    setSettlement(null);
    setMilestones(EMPTY_MILESTONES);
    setVaultState("healthy");
    setLastZone(null);
    setIsStreaming(false);

    try {
      const res = await fetch(`/api/run?mode=incident&report=${encodeURIComponent(reportId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
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
  }, [running, reportId, handleEvent, pushLog]);

  const incidentActive = lastZone === "incident";
  const vaultActive = lastZone === "vault";
  const stages = buildStages(running, milestones, verdict, settlement, isStreaming);
  const beatsDone = stages.filter((s) => s.state === "done" || s.state === "alert").length;
  const beatPct = (beatsDone / stages.length) * 100;

  const selectedReport = INCIDENT_REPORTS.find((r) => r.id === reportId) ?? INCIDENT_REPORTS[0]!;

  return (
    <div className="ws__layout">
      <aside className="agside thin-scroll">
        <Link href="/" className="agside__back">
          <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(180deg)" }} />
          Showcase
        </Link>
        <div className={styles.railHead}>
          <span className="eyebrow">Insurance primitive</span>
          <span className={styles.railTitle}>Incident Response</span>
        </div>

        <div className="agside__card">
          <span className="agside__card-cap">Run</span>
          <button className={styles.controls__run} onClick={() => void run()} disabled={running}>
            {running ? (
              <>
                <span className="spin" aria-hidden>
                  ◠
                </span>
                Triaging incident…
              </>
            ) : (
              <>
                <Icon name="shield" size={16} stroke={2} /> Run incident response
              </>
            )}
          </button>
          <div className={styles.scenario} role="group" aria-label="Pick incident report">
            {INCIDENT_REPORTS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`${styles.scenario__seg}${
                  reportId === r.id
                    ? ` ${
                        (styles[
                          `scenario__seg--${r.expectedBranch.toLowerCase()}` as keyof typeof styles
                        ] as string | undefined) ?? styles["scenario__seg--tp"]
                      }`
                    : ""
                }`}
                onClick={() => setReportId(r.id)}
                disabled={running}
                aria-pressed={reportId === r.id}
              >
                <span className={styles.scenario__top}>{r.source}</span>
                <span className={styles.scenario__sub}>{r.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.theater}>
          <ActorCard
            side="agent"
            active={incidentActive}
            name="Incident Agent"
            role="classifies · bonds · decides"
            icon="shield"
            line={lastZoneLine(log, "incident")}
            idle="Idle — awaiting an incident report to triage."
            badge={
              verdict ? (
                <span className={styles.verdictRow}>
                  <span
                    className={`${styles.badge} ${
                      (styles[`badge--${verdict.severity}` as keyof typeof styles] as
                        | string
                        | undefined) ?? ""
                    }`}
                  >
                    {verdict.severity}
                  </span>
                  <span
                    className={`${styles.badge} ${
                      (styles[`badge--${verdict.decision}` as keyof typeof styles] as
                        | string
                        | undefined) ?? ""
                    }`}
                  >
                    {verdict.decision}
                  </span>
                </span>
              ) : null
            }
          />

          <ActorCard
            side="vault"
            active={vaultActive}
            name="Protected Vault"
            role="monitored · can be frozen"
            icon={VAULT_COPY[vaultState].icon}
            line={lastZoneLine(log, "vault")}
            idle="Healthy — vault is operational."
            badge={
              <span
                className={`${styles.vaultState} ${
                  (styles[`vaultState--${vaultState}` as keyof typeof styles] as
                    | string
                    | undefined) ?? ""
                }`}
              >
                {VAULT_COPY[vaultState].state}
              </span>
            }
          />
        </div>

        <div className={`agside__card ${styles.honestyCard}`}>
          <span className="agside__card-cap">Honesty</span>
          <span className={`${styles.honest} ${styles["honest--live"]}`}>
            <span className={styles.honest__dot} aria-hidden /> LIVE
            <em>bond · verdict · halt · settle</em>
          </span>
          <span className={`${styles.honest} ${styles["honest--staged"]}`}>
            <span className={styles.honest__dot} aria-hidden /> STAGED
            <em>breach · coverage check</em>
          </span>
          <span className={`${styles.honest} ${styles["honest--deferred"]}`}>
            <span className={styles.honest__dot} aria-hidden /> DEFERRED
            <em>funded insurance pool</em>
          </span>
        </div>
      </aside>

      <div className={`ws__stage ${styles.stageCol}`}>
        <div className="flow bw-card" role="list" aria-label="Incident Response choreography">
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
                {running
                  ? "triaging incident…"
                  : beatsDone > 0
                    ? "triage complete"
                    : "awaiting run"}
              </span>
              <span className="flow__bar" aria-hidden>
                <span style={{ width: `${beatPct}%` }} />
              </span>
            </div>
          </div>
        </div>

        {/* Terminal log — thinking streams inline as // lines */}
        <div className={`${styles.log} bw-card`}>
          <div className={styles.log__bar}>
            <span className={styles.log__dots} aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className={styles.log__title}>
              incident-response@reineira
              <span className={styles["log__title-dim"]}> · on-chain choreography</span>
            </span>
            {running ? (
              <span className={styles.log__running}>
                <span className="spin" aria-hidden>
                  ◠
                </span>
                {isStreaming ? "reasoning…" : "streaming…"}
              </span>
            ) : null}
          </div>
          <div
            className={`${styles.log__body} thin-scroll${log.length === 0 ? ` ${styles["log__body--empty"]}` : ""}`}
            ref={bodyRef}
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {log.length === 0 ? (
              <span className={styles.log__empty}>
                <span className={styles.log__caret}>❯</span> awaiting run — press{" "}
                <strong>Run incident response</strong>.
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

function ActorCard({
  side,
  active,
  name,
  role,
  icon,
  line,
  idle,
  badge,
}: {
  side: "agent" | "vault";
  active: boolean;
  name: string;
  role: string;
  icon: string;
  line: LogLine | null;
  idle: string;
  badge?: ReactNode;
}) {
  return (
    <div
      className={[
        styles.actor,
        styles[`actor--${side}` as keyof typeof styles] as string,
        active ? styles["actor--active"] : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.actor__head}>
        <span className={styles.actor__chip}>
          <Icon name={icon} size={18} stroke={2.4} />
        </span>
        <div className={styles.actor__id}>
          <span className={styles.actor__name}>{name}</span>
        </div>
      </div>
      <div className={styles["actor__badge-slot"]}>{badge ?? <Standby active={active} />}</div>
      <div className={styles.actor__body}>
        <ZoneLine active={active} line={line} idle={idle} />
      </div>
      <span className={styles.actor__sub}>{role}</span>
    </div>
  );
}

function Standby({ active }: { active: boolean }) {
  return (
    <span className={`${styles.standby}${active ? ` ${styles["standby--active"]}` : ""}`}>
      <span className={styles.standby__dot} aria-hidden />
      {active ? "active" : "standby"}
    </span>
  );
}

function LogRow({ line }: { line: LogLine }) {
  if (line.thinking) {
    return (
      <div className={styles["row--thinking"]}>
        <span className={styles["row__gutter--thinking"]}>//</span>
        <span className={styles.row__body}>
          {line.msg}
          {line.streaming ? (
            <span className={styles.row__cursor} aria-hidden>
              ▍
            </span>
          ) : null}
        </span>
      </div>
    );
  }
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
      <span
        className={`${styles.row__gutter} ${
          (styles[`row__gutter--${line.zone}` as keyof typeof styles] as string | undefined) ?? ""
        }`}
      >
        {line.zone}
      </span>
      <span className={styles.row__body}>
        {line.msg}
        {line.label ? (
          <span
            className={`${styles["inline-chip"]} ${
              (styles[`inline-chip--${line.label}` as keyof typeof styles] as string | undefined) ??
              ""
            }`}
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
  const displayLine = line?.thinking ? null : line;
  if (!displayLine) {
    return <p className={`${styles.actor__line} ${styles["actor__line--idle"]}`}>{idle}</p>;
  }
  return (
    <p className={styles.actor__line} style={active ? undefined : { opacity: 0.85 }}>
      {displayLine.msg}
      {displayLine.tx ? <TxLink tx={displayLine.tx} arbiscan={displayLine.arbiscan} /> : null}
    </p>
  );
}

function lastZoneLine(log: LogLine[], zone: Zone): LogLine | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const l = log[i]!;
    if (l.zone === zone && !l.thinking) return l;
  }
  return null;
}
