"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "../../../../ui/Icon";
import { MaturityStatusBadge } from "../../../../ui/badges";
import {
  formatDeadline,
  type ClientAgent,
  type PluginManifest,
} from "../../../components/agentTypes";

const DEADLINE_PRESETS = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
];

export default function EditAgentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [prePrompt, setPrePrompt] = useState("");
  const [pluginIds, setPluginIds] = useState<string[]>([]);
  const [deadlineSeconds, setDeadlineSeconds] = useState(300);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [agentRes, pluginsRes] = await Promise.all([
          fetch(`/api/agents/${id}`, { cache: "no-store" }),
          fetch("/api/plugins", { cache: "no-store" }),
        ]);
        if (!active) return;
        if (agentRes.status === 404) {
          setNotFound(true);
          return;
        }
        const agentJson = (await agentRes.json()) as { agent?: ClientAgent };
        const pluginsJson = (await pluginsRes.json()) as { plugins?: PluginManifest[] };
        if (!active) return;
        if (agentJson.agent) {
          setName(agentJson.agent.name);
          setPrePrompt(agentJson.agent.prePrompt);
          setPluginIds(agentJson.agent.pluginIds);
          setDeadlineSeconds(agentJson.agent.deadlineSeconds);
          setIsDefault(!!agentJson.agent.isDefault);
        } else {
          setNotFound(true);
        }
        setPlugins(pluginsJson.plugins ?? []);
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const togglePlugin = (pluginId: string) =>
    setPluginIds((prev) =>
      prev.includes(pluginId) ? prev.filter((p) => p !== pluginId) : [...prev, pluginId],
    );

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
  const canSave = !nameError && !promptOver && !deadlineError && pluginIds.length > 0;

  const save = useCallback(async () => {
    if (saving || nameError || promptOver || deadlineError || pluginIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          prePrompt: prePrompt.trim(),
          pluginIds,
          deadlineSeconds,
        }),
      });
      const json = (await res.json()) as { agent?: ClientAgent; error?: string };
      if (!res.ok || !json.agent) {
        throw new Error(json.error ?? `update failed (${res.status})`);
      }
      router.push(`/agents/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }, [saving, name, prePrompt, pluginIds, deadlineSeconds, id, router]);

  const remove = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    } else {
      setDeleting(false);
      setConfirmOpen(false);
      setError("Delete failed — this agent cannot be deleted.");
    }
  }, [deleting, id, router]);

  if (loading) {
    return (
      <div className="container wizard">
        <div className="page__empty">
          <span className="spin" aria-hidden>
            ◠
          </span>
          loading agent…
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="container wizard">
        <div className="page__empty bw-card">
          <p>Agent not found.</p>
          <Link href="/" className="btn-cta">
            Back to agents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container wizard">
      <div className="wizard__head">
        <Link href={`/agents/${id}`} className="btn-outline wizard__back">
          <Icon name="arrowRight" size={14} stroke={2} style={{ transform: "rotate(180deg)" }} />{" "}
          Back
        </Link>
        <h1 className="edit__title">Edit agent</h1>
        <span className="wizard__counter">treasury access locked</span>
      </div>

      <div className="wizard__body bw-card">
        <div className="wizard__section">
          <h2 className="wizard__title">Identity</h2>
          <p className="wizard__hint">
            Change the name and standing instructions. The agent keeps its treasury access, existing
            deals, and spend history.
          </p>
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
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
              placeholder="Personality / standing instructions"
              value={prePrompt}
              onChange={(e) => setPrePrompt(e.target.value)}
              rows={4}
              aria-invalid={promptOver}
            />
            {promptOver ? (
              <span className="field__error">
                <Icon name="alert" size={13} stroke={2} /> {prePrompt.length - PROMPT_MAX} character
                {prePrompt.length - PROMPT_MAX === 1 ? "" : "s"} over the limit.
              </span>
            ) : null}
          </label>
        </div>

        <div className="wizard__section edit__section">
          <h2 className="wizard__title">Plugins</h2>
          <p className="wizard__hint">
            TimeLock is the mandatory anti-stranding default for this agent; add Insurance to cover
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
                        New deals hold funds in escrow until {formatDeadline(deadlineSeconds)} after
                        the agent pays. Deals already in flight keep their original window.
                      </p>
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </div>

        {!isDefault ? (
          <div className="wizard__section edit__section edit__danger">
            <h2 className="wizard__title">Delete agent</h2>
            <p className="wizard__hint">
              Removes this agent and its purchase history. The treasury and its funds are
              unaffected.
            </p>
            <button
              className="btn-outline edit__delete"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
            >
              <Icon name="x" size={14} stroke={2} /> {deleting ? "Deleting…" : "Delete this agent"}
            </button>
          </div>
        ) : null}

        {error ? <div className="agents__notice">{error}</div> : null}
      </div>

      <div className="wizard__foot">
        <Link href={`/agents/${id}`} className="btn-outline">
          Cancel
        </Link>
        <button className="btn-cta" onClick={() => void save()} disabled={saving || !canSave}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {confirmOpen ? (
        <div
          className="pd-overlay"
          onClick={() => !deleting && setConfirmOpen(false)}
          role="presentation"
        >
          <div
            className="pd pd--confirm bw-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
          >
            <div className="confirm">
              <span className="confirm__icon" aria-hidden>
                <Icon name="alert" size={26} stroke={2.2} />
              </span>
              <h2 className="confirm__title">Delete {name.trim() || "this agent"}?</h2>
              <p className="confirm__lead">
                This removes the agent and its purchase history. The treasury and its funds are
                unaffected. This action cannot be undone.
              </p>
              <div className="confirm__actions">
                <button
                  className="btn-outline"
                  onClick={() => setConfirmOpen(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  className="btn-cta confirm__delete"
                  onClick={() => void remove()}
                  disabled={deleting}
                >
                  <Icon name="x" size={15} stroke={2} /> {deleting ? "Deleting…" : "Delete agent"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
