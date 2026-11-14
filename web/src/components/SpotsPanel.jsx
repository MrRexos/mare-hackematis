import { L } from "../ds.js";
import { FACTORS, explainScore } from "../engine/score.js";
import { formatDuration, formatLatLon, formatUtc } from "../engine/geometry.js";

const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) : 0);

export function SpotsPanel({ spots, selected, onSelect, hasMission }) {
  return (
    <L.Panel
      eyebrow="03 — Best spots"
      title="Hotspots for this mission"
      actions={<L.FidelityBadge level="approximate" detail="1 km grid and 5° horizon bins: regional screening, not a certified landing site.">Approximate</L.FidelityBadge>}
    >
      {!hasMission ? (
        <L.StatusBanner tone="empty" layout="center" title="No mission yet">
          Set the mission window and press Find the best landing spots. The map already shows the terrain and long-term light.
        </L.StatusBanner>
      ) : spots.length === 0 ? (
        <L.StatusBanner tone="empty" layout="center" title="No spot passes the limits">
          Raise the maximum slope or turn off the night limit to see candidates.
        </L.StatusBanner>
      ) : (
        <div className="spot-list">
          {spots.map((s) => (
            <L.SiteRow
              key={s.rank}
              rank={s.rank}
              name={s.name}
              meta={s.meta}
              score={Math.round(s.peakScore)}
              sun={pct(s.metrics.sun)}
              earth={pct(s.metrics.earth)}
              both={pct(s.metrics.both)}
              longestNight={formatDuration(s.metrics.night)}
              fidelity="approximate"
              selected={selected?.rank === s.rank}
              onOpen={() => onSelect(s)}
            />
          ))}
        </div>
      )}
    </L.Panel>
  );
}

export function SpotDetail({ spot, mission, layers, weights, limits }) {
  if (!spot) return null;
  const m = spot.metrics;
  const bestMs = mission.startMs + m.best * mission.stepMs;
  const why = explainScore(spot.peak, mission, layers, weights, limits);
  return (
    <L.Panel eyebrow={`${String(spot.rank).padStart(2, "0")} — ${formatLatLon(spot.lat, spot.lon)}`} title={spot.name}>
      <div className="stack-4">
        <L.Readout label="Best landing" value={formatUtc(bestMs)} size="sm" hint={`then ${mission.params.durationDays} d on the surface`} />
        <div className="readout-grid">
          <L.Readout label="Sunlight" kind="sun" value={pct(m.sun)} unit="%" />
          <L.Readout label="Earth view" kind="earth" value={pct(m.earth)} unit="%" />
          <L.Readout label="Both" kind="both" value={pct(m.both)} unit="%" />
          <L.Readout label="Longest night" value={formatDuration(m.night)} />
          <L.Readout label="Slope" value={m.slope.toFixed(1)} unit="°" />
          <L.Readout label="To permanent shadow" value={m.psrDistKm.toFixed(1)} unit="km" approx />
        </div>
        <div>
          <span className="label lh-muted">WHY {Math.round(spot.peakScore)}?</span>
          <div className="stack-2 why">
            {why.map((w) => {
              const f = FACTORS.find((x) => x.key === w.key);
              return (
                <L.MetricBar
                  key={w.key}
                  kind={f.kind || "neutral"}
                  label={`${f.label} · weight ${Math.round(w.share * 100)}%`}
                  value={Math.max(0, w.value * 100)}
                  display={`${Math.round(w.value * 100)}% → +${w.points.toFixed(1)}`}
                  compact
                />
              );
            })}
          </div>
        </div>
        <L.ExplainNote title="What this does not say">
          Sunlight is not the same as electrical power. Earth in view does not guarantee a working link.
        </L.ExplainNote>
      </div>
    </L.Panel>
  );
}
