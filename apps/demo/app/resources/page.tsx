"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";
import { usdc } from "../components/agentTypes";

type ResourceDef = {
  id: string;
  name: string;
  description: string;
  priceAtomic: string;
  task: string;
  mode: "escrow" | "direct";
  url?: string;
};

export default function ResourcesPage() {
  const [resources, setResources] = useState<ResourceDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/resources", { cache: "no-store" });
        const json = (await res.json()) as { resources?: ResourceDef[] };
        if (active) setResources(json.resources ?? []);
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
          <span className="eyebrow">Catalog</span>
          <h1 className="page__title">Resources</h1>
          <p className="page__lead">
            What an agent can buy over x402. Every purchase can settle into Escrow — funds stay
            held until a Gate verifies the release condition, not sent straight to the seller.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="page__empty">
          <span className="spin" aria-hidden>◠</span>
          loading resources…
        </div>
      ) : (
        <div className="cat-grid">
          {resources.map((r) => (
            <div key={r.id} className="cat-card bw-card">
              <div className="cat-card__head">
                <span className="cat-card__icon">
                  <Icon name="feed" size={16} stroke={2} />
                </span>
                <span className="cat-card__name">{r.name}</span>
                <span className="cat-card__price">{usdc(r.priceAtomic)}</span>
              </div>
              <p className="cat-card__desc">{r.description}</p>
              <p className="cat-card__task">{r.task}</p>
              <div className="cat-card__tags">
                <span className={`cat-card__mode cat-card__mode--${r.mode}`}>
                  <Icon name={r.mode === "escrow" ? "lock" : "bolt"} size={11} stroke={2} />
                  {r.mode === "escrow" ? "Escrow + Gate" : "direct"}
                </span>
                <span className="plugin-card__tag mono">{r.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
