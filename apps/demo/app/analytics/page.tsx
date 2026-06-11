"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "../components/EChart";
import { usdc, type ClientAgent, type SpendRecord } from "../components/agentTypes";

type Range = "24h" | "7d" | "30d" | "all";
type Flat = SpendRecord & { agentId: string; agentName: string };

const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
];
const RANGE_MS: Record<Range, number> = {
  "24h": 864e5,
  "7d": 7 * 864e5,
  "30d": 30 * 864e5,
  all: Infinity,
};

const C_BLUE = "#3b8bff";
const C_BLUE_HI = "#7db4ff";
const C_GREEN = "#22c55e";
const C_TEAL = "#2fc8a4";
const TXT = "#8b93a6";
const GRID = "rgba(139,147,166,0.14)";
const AXIS = "rgba(139,147,166,0.24)";
const TIP = {
  backgroundColor: "rgba(13,17,23,0.96)",
  borderColor: "rgba(139,147,166,0.22)",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "#e5e7eb", fontSize: 12 },
};

function statusOf(r: SpendRecord, nowSec: number): "held" | "releasable" | "released" | "direct" {
  if (!r.escrowId) return "direct";
  if (r.released) return "released";
  if (typeof r.deadline === "number") return nowSec >= r.deadline ? "releasable" : "held";
  return "held";
}

function toUsdc(atomic: string): number {
  return Number(atomic) / 1e6;
}

function buildSeries(flats: Flat[], range: Range, now: number) {
  let count: number;
  let sizeMs: number;
  let start: number;
  if (range === "24h") {
    count = 24;
    sizeMs = 3600e3;
    start = now - count * sizeMs;
  } else if (range === "7d") {
    count = 7;
    sizeMs = 864e5;
    start = now - count * sizeMs;
  } else if (range === "30d") {
    count = 30;
    sizeMs = 864e5;
    start = now - count * sizeMs;
  } else {
    const min = flats.length ? Math.min(...flats.map((f) => new Date(f.ts).getTime())) : now;
    const span = Math.max(now - min, 36e5);
    count = 14;
    sizeMs = span / count;
    start = min;
  }
  const points = new Array<number>(count).fill(0);
  for (const f of flats) {
    const t = new Date(f.ts).getTime();
    let idx = Math.floor((t - start) / sizeMs);
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1;
    points[idx] += toUsdc(f.amountAtomic);
  }
  const labels = points.map((_, i) => {
    const d = new Date(start + i * sizeMs);
    if (range === "24h") return `${String(d.getHours()).padStart(2, "0")}:00`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  return { points: points.map((p) => Number(p.toFixed(4))), labels };
}

function lineOption(labels: string[], points: number[]): EChartsOption {
  return {
    grid: { left: 4, right: 14, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      ...TIP,
      valueFormatter: (v) => `${Number(v).toFixed(2)} USDC`,
    },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: TXT, fontSize: 10, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: TXT, fontSize: 10 },
    },
    series: [
      {
        type: "line",
        data: points,
        smooth: true,
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2.5, color: C_BLUE },
        itemStyle: { color: C_BLUE, borderColor: "#fff", borderWidth: 1.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(59,139,255,0.36)" },
              { offset: 1, color: "rgba(59,139,255,0)" },
            ],
          },
        },
        emphasis: { focus: "series" },
      },
    ],
    animationDuration: 800,
    animationEasing: "cubicOut",
  };
}

function barOption(names: string[], values: number[], from: string, to: string): EChartsOption {
  return {
    grid: { left: 4, right: 18, top: 6, bottom: 0, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      ...TIP,
      valueFormatter: (v) => `${Number(v).toFixed(2)} USDC`,
    },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: TXT, fontSize: 10 },
    },
    yAxis: {
      type: "category",
      data: names,
      inverse: true,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: TXT, fontSize: 11 },
    },
    series: [
      {
        type: "bar",
        data: values,
        barWidth: 13,
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: from },
              { offset: 1, color: to },
            ],
          },
        },
      },
    ],
    animationDuration: 800,
    animationEasing: "cubicOut",
  };
}

function donutOption(held: number, releasable: number, released: number): EChartsOption {
  return {
    tooltip: { trigger: "item", ...TIP, formatter: "{b}: {c} ({d}%)" },
    series: [
      {
        type: "pie",
        radius: ["62%", "86%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        padAngle: 3,
        itemStyle: { borderRadius: 5 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 4 },
        data: [
          { value: held, name: "held", itemStyle: { color: C_BLUE } },
          { value: releasable, name: "releasable", itemStyle: { color: C_GREEN } },
          { value: released, name: "released", itemStyle: { color: C_TEAL } },
        ],
      },
    ],
    animationDuration: 800,
    animationEasing: "cubicOut",
  };
}

export default function AnalyticsPage() {
  const [agents, setAgents] = useState<ClientAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [range, setRange] = useState<Range>("7d");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        const json = (await res.json()) as { agents?: ClientAgent[] };
        if (active) setAgents(json.agents ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const view = useMemo(() => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const selected = agentFilter === "all" ? agents : agents.filter((a) => a.id === agentFilter);
    const flats: Flat[] = selected
      .flatMap((a) => a.ledger.map((r) => ({ ...r, agentId: a.id, agentName: a.name })))
      .filter((f) => range === "all" || now - new Date(f.ts).getTime() <= RANGE_MS[range]);

    const totalSpent = flats.reduce((s, f) => s + BigInt(f.amountAtomic), 0n);
    const balance = selected.reduce((s, a) => s + BigInt(a.usdcBalanceAtomic ?? "0"), 0n);

    let held = 0;
    let releasable = 0;
    let released = 0;
    let heldAmt = 0n;
    let releasedAmt = 0n;
    for (const f of flats) {
      const st = statusOf(f, nowSec);
      if (st === "held") {
        held += 1;
        heldAmt += BigInt(f.amountAtomic);
      } else if (st === "releasable") releasable += 1;
      else if (st === "released") {
        released += 1;
        releasedAmt += BigInt(f.amountAtomic);
      }
    }

    const resMap = new Map<string, { name: string; amount: bigint; count: number }>();
    for (const f of flats) {
      const name = f.resourceName ?? f.description ?? "resource";
      const cur = resMap.get(name) ?? { name, amount: 0n, count: 0 };
      cur.amount += BigInt(f.amountAtomic);
      cur.count += 1;
      resMap.set(name, cur);
    }
    const byResource = [...resMap.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1));

    const agMap = new Map<string, { name: string; amount: bigint; count: number }>();
    for (const f of flats) {
      const cur = agMap.get(f.agentId) ?? { name: f.agentName, amount: 0n, count: 0 };
      cur.amount += BigInt(f.amountAtomic);
      cur.count += 1;
      agMap.set(f.agentId, cur);
    }
    const byAgent = [...agMap.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1));

    return {
      flats,
      totalSpent,
      balance,
      held,
      releasable,
      released,
      heldAmt,
      releasedAmt,
      byResource,
      byAgent,
      series: buildSeries(flats, range, now),
    };
  }, [agents, agentFilter, range]);

  const escrowTotal = view.held + view.releasable + view.released;
  const showAgents = agentFilter === "all" && view.byAgent.length > 1;

  return (
    <div className="container page an">
      <div className="page__head an__head">
        <div>
          <span className="eyebrow">Usage</span>
          <h1 className="page__title">Analytics</h1>
          <p className="page__lead">
            Autonomous spend across your agents — where the money went and what is still held in escrow.
          </p>
        </div>
        <div className="an-filters">
          <select className="an-select" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="an-range" role="tablist">
            {RANGES.map((r) => (
              <button
                key={r.id}
                className={`an-range__btn${range === r.id ? " an-range__btn--active" : ""}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page__empty">
          <span className="spin" aria-hidden>◠</span>
          loading analytics…
        </div>
      ) : (
        <>
          <div className="an-kpis">
            <div className="an-kpi bw-card">
              <span className="an-kpi__v">{usdc(view.totalSpent.toString())}</span>
              <span className="an-kpi__l">total spent</span>
            </div>
            <div className="an-kpi bw-card">
              <span className="an-kpi__v">{view.flats.length}</span>
              <span className="an-kpi__l">purchases</span>
            </div>
            <div className="an-kpi bw-card">
              <span className="an-kpi__v an-kpi__v--held">{usdc(view.heldAmt.toString())}</span>
              <span className="an-kpi__l">held in escrow · {view.held}</span>
            </div>
            <div className="an-kpi bw-card">
              <span className="an-kpi__v an-kpi__v--done">{usdc(view.releasedAmt.toString())}</span>
              <span className="an-kpi__l">released · {view.released}</span>
            </div>
            <div className="an-kpi bw-card">
              <span className="an-kpi__v">{usdc(view.balance.toString())}</span>
              <span className="an-kpi__l">wallet balance</span>
            </div>
          </div>

          {view.flats.length === 0 ? (
            <div className="page__empty bw-card">
              <p>No purchases in this range.</p>
              <span className="agents__muted">Widen the time range or run a deal to populate analytics.</span>
            </div>
          ) : (
            <div className="an-grid">
              <div className="an-card bw-card an-card--wide">
                <div className="an-card__head">
                  <span className="an-card__title">Spend over time</span>
                  <span className="an-card__sub mono">USDC · {range}</span>
                </div>
                <EChart option={lineOption(view.series.labels, view.series.points)} height={250} />
              </div>

              <div className="an-card bw-card">
                <div className="an-card__head">
                  <span className="an-card__title">Spend by resource</span>
                </div>
                <EChart
                  option={barOption(
                    view.byResource.map((b) => b.name),
                    view.byResource.map((b) => toUsdc(b.amount.toString())),
                    C_BLUE,
                    C_BLUE_HI,
                  )}
                  height={Math.max(120, view.byResource.length * 42 + 16)}
                />
              </div>

              <div className="an-card bw-card an-card--donut">
                <div className="an-card__head">
                  <span className="an-card__title">Escrow status</span>
                </div>
                <div className="an-donut">
                  <div className="an-donut__chart">
                    <EChart option={donutOption(view.held, view.releasable, view.released)} height={190} />
                    <div className="an-donut__center">
                      <span className="an-donut__num">{escrowTotal}</span>
                      <span className="an-donut__lab">escrowed</span>
                    </div>
                  </div>
                  <div className="an-legend">
                    <span className="an-legend__row">
                      <span className="an-legend__dot" style={{ background: C_BLUE }} /> held <b>{view.held}</b>
                    </span>
                    <span className="an-legend__row">
                      <span className="an-legend__dot" style={{ background: C_GREEN }} /> releasable <b>{view.releasable}</b>
                    </span>
                    <span className="an-legend__row">
                      <span className="an-legend__dot" style={{ background: C_TEAL }} /> released <b>{view.released}</b>
                    </span>
                  </div>
                </div>
              </div>

              {showAgents ? (
                <div className="an-card bw-card an-card--wide">
                  <div className="an-card__head">
                    <span className="an-card__title">Spend by agent</span>
                  </div>
                  <EChart
                    option={barOption(
                      view.byAgent.map((b) => b.name),
                      view.byAgent.map((b) => toUsdc(b.amount.toString())),
                      C_TEAL,
                      C_GREEN,
                    )}
                    height={Math.max(120, view.byAgent.length * 42 + 16)}
                  />
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
