"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";
import { MaturityStatusBadge } from "../../ui/badges";
import type { PluginManifest } from "../components/agentTypes";

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/plugins", { cache: "no-store" });
        const json = (await res.json()) as { plugins?: PluginManifest[] };
        if (active) setPlugins(json.plugins ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="container page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Portal registry</span>
          <h1 className="page__title">Plugins</h1>
          <p className="page__lead">
            Escrow holds funds, Gates verify release conditions, and Insurance covers bad outcomes.
            Attach Gates and Insurance policies when you create or edit an agent.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="page__empty">
          <span className="spin" aria-hidden>
            ◠
          </span>
          loading plugins…
        </div>
      ) : (
        <div className="cat-grid">
          {plugins.map((p) => {
            const live = p.status === "live";
            return (
              <div key={p.id} className={`cat-card bw-card${live ? "" : " cat-card--soon"}`}>
                <div className="cat-card__head">
                  <span
                    className={`cat-card__icon${p.kind === "underwriter-policy" ? " cat-card__icon--protect" : ""}`}
                  >
                    <Icon
                      name={p.kind === "underwriter-policy" ? "umbrella" : "plug"}
                      size={24}
                      stroke={2}
                    />
                  </span>
                  <span className="cat-card__name">{p.name}</span>
                  <MaturityStatusBadge status={live ? "live" : "spec"} />
                </div>
                <p className="cat-card__desc">{p.description}</p>
                <div className="cat-card__meta">
                  <span className="cat-card__kind mono">{p.interface}</span>
                  {p.resolverData ? (
                    <span className="cat-card__abi mono">{p.resolverData.abi}</span>
                  ) : null}
                </div>
                {p.tags.length > 0 ? (
                  <div className="cat-card__tags">
                    {p.tags.map((t) => (
                      <span key={t} className="plugin-card__tag mono">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
