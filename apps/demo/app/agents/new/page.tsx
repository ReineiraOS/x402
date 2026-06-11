"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "../../../ui/Icon";
import { MaturityStatusBadge } from "../../../ui/badges";
import { formatDeadline, type ClientAgent, type PluginManifest } from "../../components/agentTypes";

const STEPS = ["Identity", "Plugins", "Review"] as const;

export default function NewAgentPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [prePrompt, setPrePrompt] = useState("");
  const [pluginIds, setPluginIds] = useState<string[]>(["timelock-resolver"]);
  const [deadlineSeconds, setDeadlineSeconds] = useState(300);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const DEADLINE_PRESETS = [
    { label: "1 min", value: 60 },
    { label: "5 min", value: 300 },
    { label: "15 min", value: 900 },
    { label: "1 hour", value: 3600 },
  ];

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/plugins", { cache: "no-store" });
      const json = (await res.json()) as { plugins?: PluginManifest[] };
      if (active) setPlugins(json.plugins ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  const togglePlugin = (id: string) =>
    setPluginIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const canProceed = useMemo(() => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return pluginIds.length > 0;
    return true;
  }, [step, name, pluginIds]);

  const selectedPlugins = plugins.filter((p) => pluginIds.includes(p.id));

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          prePrompt: prePrompt.trim(),
          pluginIds,
          deadlineSeconds,
        }),
      });
      const json = (await res.json()) as { agent?: ClientAgent; error?: string; detail?: string };
      if (!res.ok || !json.agent) {
        throw new Error(json.detail ?? json.error ?? `create failed (${res.status})`);
      }
      router.push(`/agents/${json.agent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }, [creating, name, prePrompt, pluginIds, router]);

  return (
    <div className="container wizard">
      <div className="wizard__head">
        <Link href="/" className="btn-outline wizard__back">
          <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(180deg)" }} /> Back
        </Link>
        <div className="wizard__progress">
          {STEPS.map((label, i) => (
            <div key={label} className="wizard__progress-item">
              <span
                className={`wizard__dot${i <= step ? " wizard__dot--on" : ""}${
                  i === step ? " wizard__dot--active" : ""
                }`}
              />
              <span className={`wizard__step-label${i === step ? " wizard__step-label--active" : ""}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
        <span className="wizard__counter">
          {step + 1}/{STEPS.length}
        </span>
      </div>

      <div className="wizard__body bw-card">
        {step === 0 ? (
          <div className="wizard__section">
            <h2 className="wizard__title">Agent identity</h2>
            <p className="wizard__hint">Give the agent a name and its standing instructions.</p>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__input"
                placeholder="e.g. Market Scout"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field__label">Pre-prompt</span>
              <textarea
                className="field__textarea"
                placeholder="Personality / standing instructions — e.g. “Only buy data you actually need; stay terse.”"
                value={prePrompt}
                onChange={(e) => setPrePrompt(e.target.value)}
                rows={4}
              />
            </label>
          </div>
        ) : step === 1 ? (
          <div className="wizard__section">
            <h2 className="wizard__title">Plugins</h2>
            <p className="wizard__hint">
              Condition resolvers from the Portal registry gate how the agent&apos;s payments are
              released. The TimeLock resolver is the mandatory anti-stranding default.
            </p>
            <div className="plugin-list">
              {plugins.map((plugin) => {
                const isLive = plugin.status === "live";
                const isActive = pluginIds.includes(plugin.id);
                return (
                  <Fragment key={plugin.id}>
                    <button
                      type="button"
                      className={`plugin-card${isActive ? " plugin-card--active" : ""}${
                        isLive ? "" : " plugin-card--soon"
                      }`}
                      onClick={() => isLive && togglePlugin(plugin.id)}
                      disabled={!isLive}
                    >
                      <div className="plugin-card__head">
                        <span className="plugin-card__check">
                          <Icon name={isActive ? "check" : "plug"} size={14} stroke={2} />
                        </span>
                        <span className="plugin-card__name">{plugin.name}</span>
                        <MaturityStatusBadge status={isLive ? "live" : "spec"} />
                      </div>
                      <p className="plugin-card__desc">{plugin.description}</p>
                      {plugin.tags.length > 0 ? (
                        <div className="plugin-card__tags">
                          {plugin.tags.map((tag) => (
                            <span key={tag} className="plugin-card__tag mono">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>

                    {plugin.id === "timelock-resolver" && isActive ? (
                      <div className="plugin-config">
                        <div className="plugin-config__head">
                          <Icon name="clock" size={14} stroke={2} />
                          <span className="plugin-config__title">Release after</span>
                          <span className="plugin-config__hint mono">resolverData: uint256 deadline</span>
                        </div>
                        <div className="deadline-presets">
                          {DEADLINE_PRESETS.map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              className={`deadline-chip${deadlineSeconds === preset.value ? " deadline-chip--active" : ""}`}
                              onClick={() => setDeadlineSeconds(preset.value)}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <label className="deadline-custom">
                            custom
                            <input
                              type="number"
                              min={10}
                              className="deadline-custom__input"
                              value={deadlineSeconds}
                              onChange={(e) =>
                                setDeadlineSeconds(Math.max(10, Number(e.target.value) || 10))
                              }
                            />
                            s
                          </label>
                        </div>
                        <p className="plugin-config__note">
                          Funds sit in escrow until {formatDeadline(deadlineSeconds)} after the agent
                          pays; then the seller can redeem. Until then the buyer is protected from a
                          no-show.
                        </p>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="wizard__section">
            <h2 className="wizard__title">Review</h2>
            <p className="wizard__hint">
              Creating the agent provisions a dedicated ZeroDev smart wallet (gas sponsored). Fund it
              with testnet USDC, then run deals.
            </p>
            <div className="review">
              <div className="review__row">
                <span className="review__label">Name</span>
                <span className="review__value">{name || "—"}</span>
              </div>
              <div className="review__row">
                <span className="review__label">Pre-prompt</span>
                <span className="review__value review__value--multiline">
                  {prePrompt || <span className="agents__muted">none</span>}
                </span>
              </div>
              <div className="review__row">
                <span className="review__label">Plugins</span>
                <span className="review__value">
                  <div className="review__plugins">
                    {selectedPlugins.map((p) => (
                      <span key={p.id} className="pill review__plugin">
                        {p.name}
                      </span>
                    ))}
                  </div>
                </span>
              </div>
              {pluginIds.includes("timelock-resolver") ? (
                <div className="review__row">
                  <span className="review__label">Release after</span>
                  <span className="review__value">{formatDeadline(deadlineSeconds)}</span>
                </div>
              ) : null}
              <div className="review__row">
                <span className="review__label">Smart wallet</span>
                <span className="review__value agents__muted">
                  a fresh ZeroDev Kernel wallet — created with the agent
                </span>
              </div>
            </div>
            {error ? <div className="agents__notice">{error}</div> : null}
          </div>
        )}
      </div>

      <div className="wizard__foot">
        {step > 0 ? (
          <button className="btn-outline" onClick={() => setStep((s) => s - 1)} disabled={creating}>
            Previous
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <button
            className="btn-cta"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canProceed}
          >
            Continue
          </button>
        ) : (
          <button className="btn-cta" onClick={() => void create()} disabled={creating || !canProceed}>
            {creating ? "Creating wallet…" : "Create agent + smart wallet"}
          </button>
        )}
      </div>
    </div>
  );
}
