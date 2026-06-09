"use client";

import { useCallback, useRef, useState } from "react";

type RunEvent = {
  zone?: "buyer" | "system" | "provider";
  level?: "error" | "info";
  kind?: "deal";
  deal?: string;
  price?: string;
  network?: string;
  msg?: string;
  detail?: string;
  tx?: string;
  arbiscan?: string;
  artifact?: unknown;
  done?: boolean;
  stream?: boolean;
  streamEnd?: boolean;
  final?: boolean;
};

type LogLevel = "info" | "error" | "muted";

type LineVariant = "thinking" | "action" | "verdict";

type LogLine = {
  id: number;
  level: LogLevel;
  msg: string;
  detail?: string;
  final?: boolean;
  streaming?: boolean;
  variant?: LineVariant;
};

type DealStatus = "idle" | "awaiting payment" | "signing" | "settling" | "settled" | "failed";

type DealInfo = { deal: string; price: string; network: string };

const STATUS_LABEL: Record<DealStatus, string> = {
  idle: "awaiting payment",
  "awaiting payment": "awaiting payment",
  signing: "signing",
  settling: "settling",
  settled: "settled",
  failed: "failed",
};

function statusModifier(status: DealStatus): string {
  if (status === "settled") return "deal-card__value--settled";
  if (status === "failed") return "deal-card__value--error";
  return "deal-card__value--pending";
}

function stripMd(text: string): string {
  return text.replace(/\*\*/g, "");
}

function LogLineView({ line }: { line: LogLine }) {
  if (line.variant === "thinking") {
    return (
      <li className={`think${line.streaming ? " think--active" : ""}`}>
        <span className="think__tag">
          <span className="think__pulse" aria-hidden />
          thinking
        </span>
        <span className="think__text">
          {stripMd(line.msg)}
          {line.streaming ? (
            <span className="caret" aria-hidden>
              ▍
            </span>
          ) : null}
        </span>
      </li>
    );
  }

  if (line.variant === "verdict") {
    return (
      <li className="verdict">
        <span className="verdict__tag">✓ market read</span>
        <span className="verdict__text">
          {stripMd(line.msg)}
          {line.streaming ? (
            <span className="caret" aria-hidden>
              ▍
            </span>
          ) : null}
        </span>
      </li>
    );
  }

  if (line.variant === "action") {
    return (
      <li className="action">
        <span className="action__marker" aria-hidden>
          ▸
        </span>
        <span className="action__text">{line.msg}</span>
      </li>
    );
  }

  return (
    <li className={`zone__log-line zone__log-line--${line.level}`}>
      {line.msg}
      {line.detail ? <span className="zone__log-detail"> {line.detail}</span> : null}
    </li>
  );
}

function LogZone({
  title,
  side,
  lines,
}: {
  title: string;
  side: "buyer" | "provider";
  lines: LogLine[];
}) {
  return (
    <section className={`zone zone--${side}`} aria-label={title}>
      <header className="zone__header">{title}</header>
      <ol className="zone__log">
        {lines.length === 0 ? (
          <li className="zone__log-line zone__log-line--muted">waiting for events…</li>
        ) : (
          lines.map((line) => <LogLineView key={line.id} line={line} />)
        )}
      </ol>
    </section>
  );
}

export default function Home() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<DealStatus>("idle");
  const [deal, setDeal] = useState<DealInfo | null>(null);
  const [buyerLines, setBuyerLines] = useState<LogLine[]>([]);
  const [systemLines, setSystemLines] = useState<LogLine[]>([]);
  const [providerLines, setProviderLines] = useState<LogLine[]>([]);
  const [tx, setTx] = useState<string | null>(null);
  const [arbiscan, setArbiscan] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const append = useCallback(
    (
      setter: typeof setBuyerLines,
      level: LogLevel,
      msg: string,
      detail?: string,
      variant?: LineVariant,
    ) => {
      const id = nextId();
      setter((prev) => [...prev, { id, level, msg, detail, variant }]);
    },
    [],
  );

  const appendBuyerStream = useCallback((delta: string, final: boolean) => {
    const id = nextId();
    const variant: LineVariant = final ? "verdict" : "thinking";
    setBuyerLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.streaming) {
        return [...prev.slice(0, -1), { ...last, msg: last.msg + delta, final, variant }];
      }
      return [
        ...prev,
        { id, level: "info" as LogLevel, msg: delta, final, streaming: true, variant },
      ];
    });
  }, []);

  const endBuyerStream = useCallback(() => {
    setBuyerLines((prev) => {
      const last = prev[prev.length - 1];
      if (!last || !last.streaming) return prev;
      return [...prev.slice(0, -1), { ...last, streaming: false }];
    });
  }, []);

  const advanceStatus = useCallback((msg: string) => {
    const text = msg.toLowerCase();
    if (text.includes("sign")) {
      setStatus((s) => (s === "settled" || s === "failed" ? s : "signing"));
    } else if (text.includes("verif") || text.includes("settle")) {
      setStatus((s) => (s === "settled" || s === "failed" ? s : "settling"));
    }
  }, []);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      if (event.level === "error") {
        setStatus("failed");
        append(setSystemLines, "error", event.msg ?? "error");
        setRunning(false);
        return;
      }

      if (event.done) {
        setStatus((s) => (s === "failed" ? s : "settled"));
        setRunning(false);
        return;
      }

      if (event.kind === "deal") {
        setDeal({
          deal: event.deal ?? "—",
          price: event.price ?? "—",
          network: event.network ?? "—",
        });
        return;
      }

      if (event.zone === "buyer" && event.streamEnd) {
        endBuyerStream();
        return;
      }

      if (event.zone === "buyer" && event.stream) {
        appendBuyerStream(event.msg ?? "", event.final ?? false);
        return;
      }

      const msg = event.msg ?? "";

      switch (event.zone) {
        case "buyer":
          append(setBuyerLines, "info", msg, undefined, "action");
          advanceStatus(msg);
          break;
        case "provider":
          append(setProviderLines, "info", msg, event.detail);
          break;
        case "system":
        default:
          append(setSystemLines, "info", msg, event.detail);
          advanceStatus(msg);
          if (event.tx) {
            setTx(event.tx);
            setStatus("settled");
          }
          if (event.arbiscan) {
            setArbiscan(event.arbiscan);
          }
          break;
      }
    },
    [append, appendBuyerStream, endBuyerStream, advanceStatus],
  );

  const runDeal = useCallback(async () => {
    if (running) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setStatus("awaiting payment");
    setDeal(null);
    setBuyerLines([]);
    setSystemLines([]);
    setProviderLines([]);
    setTx(null);
    setArbiscan(null);

    try {
      const response = await fetch("/api/run", {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.body) throw new Error("no response body");

      const reader = response.body.getReader();
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
            const event = JSON.parse(dataLine.slice(6)) as RunEvent;
            handleEvent(event);
          } catch {
            // ignore malformed SSE chunks
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const msg = error instanceof Error ? error.message : String(error);
      append(setSystemLines, "error", msg);
      setStatus("failed");
      setRunning(false);
    }
  }, [running, handleEvent, append]);

  return (
    <>
      <header className="topbar">
        <span className="topbar__mark">ReineiraOS</span>
        <span className="topbar__app">Settlement Theater</span>
        <span className="topbar__tagline">
          encrypted flows · underwritten outcomes · x402 · Arbitrum Sepolia
        </span>
      </header>
      <main className="theater">
        <LogZone title="Buyer agent" side="buyer" lines={buyerLines} />

        <section className="zone zone--theater" aria-label="Settlement Theater">
          <header className="zone__header">Settlement Theater</header>

          <article className="deal-card">
            <div className="deal-card__row">
              <span className="deal-card__label">Deal</span>
              <span className="deal-card__value">{deal?.deal ?? "—"}</span>
            </div>

            <div className="deal-card__row">
              <span className="deal-card__label">Price</span>
              <span className="deal-card__value">{deal?.price ?? "—"}</span>
            </div>

            <div className="deal-card__row">
              <span className="deal-card__label">Network</span>
              <span className="deal-card__value">{deal?.network ?? "—"}</span>
            </div>

            <div className="deal-card__row">
              <span className="deal-card__label">Status</span>
              <span className={`deal-card__value ${statusModifier(status)}`}>
                {STATUS_LABEL[status]}
              </span>
            </div>

            <div className="deal-card__tx-panel" aria-label="Settlement transaction">
              {tx ? (
                <>
                  <span className="deal-card__tx-label">on-chain settlement</span>
                  <code className="deal-card__tx-hash">{tx}</code>
                  {arbiscan ? (
                    <a
                      className="deal-card__arbiscan"
                      href={arbiscan}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Arbiscan ↗
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="deal-card__tx-placeholder">
                  {running
                    ? "settling on Arbitrum Sepolia…"
                    : "press Run deal to settle a live payment"}
                </span>
              )}
            </div>

            <button className="deal-card__run" onClick={() => void runDeal()} disabled={running}>
              {running ? "Running…" : "Run deal"}
            </button>
          </article>

          <ol className="zone__log zone__log--system" aria-label="System log">
            {systemLines.length === 0 ? (
              <li className="zone__log-line zone__log-line--muted">waiting for events…</li>
            ) : (
              systemLines.map((line) => (
                <li key={line.id} className={`zone__log-line zone__log-line--${line.level}`}>
                  {line.msg}
                  {line.detail ? <span className="zone__log-detail"> {line.detail}</span> : null}
                </li>
              ))
            )}
          </ol>
        </section>

        <LogZone title="Provider agent" side="provider" lines={providerLines} />
      </main>
    </>
  );
}
