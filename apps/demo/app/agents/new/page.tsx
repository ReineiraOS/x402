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
  const [nameTouched, setNameTouched] = useState(false);

  const NAME_MAX = 40;
  const PROMPT_MAX = 300;
  const DEADLINE_MIN = 10;
  const DEADLINE_MAX = 86400;

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length === 0
      ? "Give the agent a name."
      : trimmedName.length > NAME_MAX
        ? `Keep the name under ${NAME_MAX} characters.`
        : null;
  const promptOver = prePrompt.length > PROMPT_MAX;
  const deadlineError =
    deadlineSeconds < DEADLINE_MIN || deadlineSeconds > DEADLINE_MAX
      ? `Pick a release window between ${DEADLINE_MIN}s and ${DEADLINE_MAX / 3600}h.`
      : null;

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
    if (step === 0) return !nameError && !promptOver;
    if (step === 1) return pluginIds.length > 0 && !deadlineError;
    return true;
  }, [step, nameError, promptOver, pluginIds, deadlineError]);

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
          <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(180deg)" }} />{" "}
          Back
        </Link>
        <div className="wizard__progress">
          {STEPS.map((label, i) => (
            <div key={label} className="wizard__progress-item">
              <span
                className={`wizard__dot${i <= step ? " wizard__dot--on" : ""}${
                  i === step ? " wizard__dot--active" : ""
                }`}
              />
              <span
                className={`wizard__step-label${i === step ? " wizard__step-label--active" : ""}`}
              >
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
                onBlur={() => setNameTouched(true)}
                maxLength={NAME_MAX}
                aria-invalid={nameTouched && !!nameError}
                autoFocus
              />
              {nameTouched && nameError ? (
                <span className="field__error">
                  <Icon name="alert" size={13} stroke={2} /> {nameError}
                </span>
              ) : null}
            </label>
            <label className="field">
              <div className="field__row">
                <span className="field__label">
                  Pre-prompt <span className="field__opt">optional</span>
                </span>
                <span className={`field__counter${promptOver ? " field__counter--over" : ""}`}>
                  {prePrompt.length}/{PROMPT_MAX}
                </span>
              </div>
              <textarea
                className="field__textarea"
                placeholder="Personality / standing instructions — e.g. “Only buy data you actually need; stay terse.”"
                value={prePrompt}
                onChange={(e) => setPrePrompt(e.target.value)}
                rows={4}
                aria-invalid={promptOver}
              />
              {promptOver ? (
                <span className="field__error">
                  <Icon name="alert" size={13} stroke={2} /> {prePrompt.length - PROMPT_MAX}{" "}
                  character
                  {prePrompt.length - PROMPT_MAX === 1 ? "" : "s"} over the limit.
                </span>
              ) : (
                <span className="field__hint">
                  Sets the agent’s persona and the voice it reasons in. Leave blank for a neutral
                  agent.
                </span>
              )}
            </label>
          </div>
        ) : step === 1 ? (
          <div className="wizard__section">
            <h2 className="wizard__title">Plugins</h2>
            <p className="wizard__hint">
              The TimeLock Gate is the mandatory anti-stranding default; add Insurance to cover
              bad outcomes.
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
                          <span className="plugin-config__hint mono">
                            resolverData: uint256 deadline
                          </span>
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
                              min={DEADLINE_MIN}
                              max={DEADLINE_MAX}
                              className="deadline-custom__input"
                              value={deadlineSeconds}
                              aria-invalid={!!deadlineError}
                              onChange={(e) =>
                                setDeadlineSeconds(
                                  Math.min(
                                    DEADLINE_MAX,
                                    Math.max(DEADLINE_MIN, Number(e.target.value) || DEADLINE_MIN),
                                  ),
                                )
                              }
                            />
                            s
                          </label>
                        </div>
                        <p className="plugin-config__note">
                          Funds sit in escrow until {formatDeadline(deadlineSeconds)} after the
                          agent pays; then the seller can redeem. Until then the buyer is protected
                          from a no-show.
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
              Creating the agent connects it to your passkey treasury. Authorize a testnet USDC
              spend budget, then run deals.
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
                <span className="review__label">Treasury access</span>
                <span className="review__value agents__muted">
                  pays from your passkey treasury via a session key
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
          <button className="btn-cta" onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>
            Continue
          </button>
        ) : (
          <button className="btn-cta" onClick={() => void create()} disabled={creating || !canProceed}>
            {creating ? "Creating agent…" : "Create agent"}
          </button>
        )}
      </div>
    </div>
  );
}
