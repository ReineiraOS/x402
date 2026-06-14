"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/Icon";
import styles from "./TwoKeyTheater.module.css";

type Zone = "vault" | "sentinel" | "guardian" | "system";
type VaultState = "idle" | "healthy" | "bonded" | "draining" | "paused" | "safe";
type Verdict = "VALID" | "FALSE";
type HonestLabel = "staged" | "scripted" | "ledger";

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

const VAULT_COPY: Record<VaultState, { state: string; banner?: string; icon: string }> = {
  idle: { state: "awaiting run", icon: "lock" },
  healthy: { state: "healthy · floor held", icon: "shield" },
  bonded: {
    state: "ALERT · bonded",
    banner: "ALERT · bonded — a stake bought the right to speak",
    icon: "bolt",
  },
  draining: {
    state: "invariant broken",
    banner: "invariant broken — totalAssets < floor",
    icon: "alert",
  },
  paused: { state: "PAUSED · funds safe", icon: "lock" },
  safe: { state: "PAUSED · funds safe · exploit averted", icon: "check" },
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
    // Capture the id synchronously per call: reading idRef inside the deferred setState
    // updater makes every batched updater see the final value → duplicate keys.
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

      if (zone === "vault") {
        setVault((prev) => ({
          state: event.state ?? prev.state,
          // the "safe" frame carries no numbers — freeze the prior reading.
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
    setVault({ state: "idle", totalAssets: null, recordedFloor: null });

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

  const vaultActive = lastZone === "vault";
  const sentinelActive = lastZone === "sentinel";
  const guardianActive = lastZone === "guardian";
  const copy = VAULT_COPY[vault.state];
  const vaultClass = `${styles.actor} ${styles.vault} ${styles[`vault--${vault.state}`] ?? ""}${
    vaultActive ? ` ${styles["actor--active"]}` : ""
  }`;

  return (
    <div className={styles.root}>
      {/* Honesty legend — always visible */}
      <div className={`${styles.legend} bw-card`}>
        <span className={styles.legend__cap}>Honesty</span>
        <div className={styles.legend__chips}>
          <span className={`${styles.honest} ${styles["honest--live"]}`}>
            <span className={styles.honest__dot} aria-hidden /> LIVE
          </span>
          <span className={`${styles.honest} ${styles["honest--staged"]}`}>
            <span className={styles.honest__dot} aria-hidden /> STAGED
          </span>
          <span className={`${styles.honest} ${styles["honest--scripted"]}`}>
            <span className={styles.honest__dot} aria-hidden /> SCRIPTED
          </span>
          <span className={`${styles.honest} ${styles["honest--deferred"]}`}>
            <span className={styles.honest__dot} aria-hidden /> DEFERRED
          </span>
        </div>
      </div>

      {/* Run controls */}
      <div className={`${styles.controls} bw-card`}>
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
        <label
          className={styles.controls__check}
          title="Raise an alarm on a healthy vault — the verdict comes back FALSE and the bond is slashed."
        >
          <input
            type="checkbox"
            checked={falseAlarm}
            onChange={(e) => setFalseAlarm(e.target.checked)}
            disabled={running}
          />
          False alarm
        </label>
        <span className={styles.controls__hint}>
          Two keys, neither acts alone — a Sentinel stakes to speak, a Guardian freezes the vault.
        </span>
      </div>

      {/* Theater: Sentinel · Vault · Guardian */}
      <div className={styles.theater}>
        {/* Sentinel */}
        <div
          className={`${styles.actor} ${styles["actor--sentinel"]}${sentinelActive ? ` ${styles["actor--active"]}` : ""}`}
        >
          <div className={styles.actor__head}>
            <span className={styles.actor__chip}>
              <Icon name="fingerprint" size={19} stroke={2.4} />
            </span>
            <div className={styles.actor__id}>
              <span className={styles.actor__name}>Sentinel</span>
              <span className={styles.actor__role}>
                watches the vault · stakes a bond to raise an alarm
              </span>
            </div>
          </div>
          <div className={styles.actor__body}>
            <ZoneLine
              active={sentinelActive}
              line={lastSentinelLine(log)}
              idle="Idle — to speak, it must stake a bond over x402."
            />
          </div>
          <span className={styles.actor__sub}>stakes to speak</span>
        </div>

        {/* Vault — hero */}
        <div className={vaultClass}>
          <div className={`${styles.actor__head} ${styles.vault__head}`}>
            <span className={styles.actor__chip}>
              <Icon name={copy.icon} size={19} stroke={2.4} />
            </span>
            <div className={styles.actor__id}>
              <span className={styles.actor__name}>Vault</span>
              <span className={styles.actor__role}>protected object · totalAssets ≥ floor</span>
            </div>
          </div>
          <div className={styles.actor__body} style={{ alignItems: "center", gap: 12 }}>
            <span className={styles.vault__bignum}>{formatUsdc(vault.totalAssets)}</span>
            <span className={styles.vault__floor}>
              <span className={styles["vault__floor-marker"]} aria-hidden /> floor{" "}
              {formatUsdc(vault.recordedFloor)}
            </span>
            <span className={styles.vault__state}>{copy.state}</span>
            {copy.banner ? <span className={styles.vault__banner}>{copy.banner}</span> : null}
          </div>
        </div>

        {/* Guardian */}
        <div
          className={`${styles.actor} ${styles["actor--guardian"]}${guardianActive ? ` ${styles["actor--active"]}` : ""}`}
        >
          <div className={styles.actor__head}>
            <span className={styles.actor__chip}>
              <Icon name={verdict === "VALID" ? "check" : "shield"} size={19} stroke={2.4} />
            </span>
            <div className={styles.actor__id}>
              <span className={styles.actor__name}>Guardian</span>
              <span className={styles.actor__role}>can pause the vault · cannot move funds</span>
            </div>
          </div>
          <div className={styles.actor__body}>
            {verdict ? (
              <span
                className={`${styles.verdict} ${verdict === "VALID" ? styles["verdict--valid"] : styles["verdict--false"]}`}
              >
                <Icon name={verdict === "VALID" ? "check" : "alert"} size={16} stroke={2.4} />
                {verdict === "VALID" ? "VALID" : "FALSE"}
              </span>
            ) : null}
            <ZoneLine
              active={guardianActive}
              line={lastGuardianLine(log)}
              idle="Trusts the bond — never talks to the Sentinel."
            />
          </div>
          <span className={styles.actor__sub}>can pause, cannot move funds</span>
        </div>
      </div>

      {/* Event log — terminal */}
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
        <div className={`${styles.log__body} thin-scroll`} ref={bodyRef}>
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

function lastSentinelLine(log: LogLine[]): LogLine | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i]!.zone === "sentinel") return log[i]!;
  }
  return null;
}

function lastGuardianLine(log: LogLine[]): LogLine | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i]!.zone === "guardian") return log[i]!;
  }
  return null;
}
