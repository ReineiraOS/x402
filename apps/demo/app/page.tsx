const PROGRESS_CELLS = 12;

function LogZone({ title, side }: { title: string; side: "buyer" | "provider" }) {
  return (
    <section className={`zone zone--${side}`} aria-label={title}>
      <header className="zone__header">{title}</header>
      <ol className="zone__log">
        <li className="zone__log-line zone__log-line--muted">
          {/* STUB: live log entries land in B (DEV-194) */}
          waiting for events…
        </li>
      </ol>
    </section>
  );
}

function SettlementTheater() {
  return (
    <section className="zone zone--theater" aria-label="Settlement Theater">
      <header className="zone__header">Settlement Theater</header>

      <article className="deal-card">
        <div className="deal-card__row">
          <span className="deal-card__label">Deal</span>
          <span className="deal-card__value">batch-inference (mock)</span>
        </div>

        <div className="deal-card__row">
          <span className="deal-card__label">Status</span>
          <span className="deal-card__value deal-card__value--pending">awaiting payment</span>
        </div>

        <div className="deal-card__countdown" aria-label="Settlement countdown">
          {/* STUB: live countdown wired in B (DEV-194) */}
          <span className="deal-card__countdown-value">--:--</span>
          <span className="deal-card__countdown-label">until deadline</span>
        </div>

        <div
          className="deal-card__progress"
          role="img"
          aria-label="Delivery progress grid (placeholder)"
        >
          {Array.from({ length: PROGRESS_CELLS }, (_, i) => (
            <span key={i} className="deal-card__cell" />
          ))}
        </div>
      </article>
    </section>
  );
}

export default function Home() {
  return (
    <main className="theater">
      <LogZone title="Buyer" side="buyer" />
      <SettlementTheater />
      <LogZone title="Provider" side="provider" />
    </main>
  );
}
