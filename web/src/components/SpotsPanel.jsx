import { L } from "../ds.js";
import { FACTORS, explainScore } from "../engine/score.js";
import { formatDuration, formatLatLon, formatUtc } from "../engine/geometry.js";

const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) : 0);

/** Lista ordenada de lugares (puntos calientes o regiones) con SiteRow. */
export function PlaceList({ eyebrow, title, places, selectedKey, onSelect, hasMission, empty, badge }) {
  return (
    <L.Panel eyebrow={eyebrow} title={title} actions={badge}>
      {!hasMission ? (
        <L.StatusBanner tone="empty" layout="center" title="No mission yet">
          Set the mission window and press Find the best landing spots to score these places.
        </L.StatusBanner>
      ) : places.length === 0 ? (
        <L.StatusBanner tone="empty" layout="center" title="Nothing passes the limits">{empty}</L.StatusBanner>
      ) : (
        <div className="spot-list">
          {places.map((s) => (
            <L.SiteRow
              key={s.key}
              rank={s.rank}
              name={s.name}
              meta={s.meta}
              score={Number.isFinite(s.score) ? Math.round(s.score) : "–"}
              sun={pct(s.metrics?.sun)}
              earth={pct(s.metrics?.earth)}
              both={pct(s.metrics?.both)}
              longestNight={s.metrics ? formatDuration(s.metrics.night) : undefined}
              fidelity="approximate"
              selected={selectedKey === s.key}
              onOpen={() => onSelect(s.ref)}
            />
          ))}
        </div>
      )}
    </L.Panel>
  );
}

/** Ficha de un lugar: punto caliente, región Artemis III o punto elegido en el mapa. */
export function PlaceDetail({ place, mission, layers, weights, limits, onClose }) {
  if (!place) return null;
  const m = place.metrics;
  const close = <L.IconButton icon="x" label="Close" size="sm" variant="ghost" onClick={onClose} />;
  const eyebrow = `${place.kindLabel} — ${formatLatLon(place.lat, place.lon)}`;
  const slope = layers.slope?.[place.p];
  const psr = layers.psrDistKm?.[place.p];

  if (!mission || !m) {
    return (
      <L.Panel eyebrow={eyebrow} title={place.name} actions={close}>
        <div className="stack-4">
          <div className="readout-grid">
            <L.Readout label="Long-term sun" kind="sun" value={pct(layers.avgSun?.[place.p])} unit="%" hint="LOLA, 18.6 years" />
            <L.Readout label="Slope" value={Number.isFinite(slope) ? slope.toFixed(1) : "–"} unit="°" />
            <L.Readout label="To permanent shadow" value={Number.isFinite(psr) ? psr.toFixed(1) : "–"} unit="km" approx />
          </div>
          <L.StatusBanner tone="info" title="Not scored yet">Press Find the best landing spots to score this place for your mission dates.</L.StatusBanner>
        </div>
      </L.Panel>
    );
  }

  const bestMs = mission.startMs + m.best * mission.stepMs;
  const why = explainScore(place.p, mission, layers, weights, limits);
  return (
    <L.Panel eyebrow={eyebrow} title={place.name} actions={close}>
      <div className="stack-4">
        <div className="detail-score">
          <L.Readout label="Score" value={Number.isFinite(place.score) ? Math.round(place.score) : "–"} size="xl" />
          {place.type === "pick" ? <L.FidelityBadge level="approximate" detail="Single 1 km pixel with 5° horizon bins.">Approximate</L.FidelityBadge> : null}
        </div>
        {place.note ? <p className="body-sm lh-sec note">{place.note}</p> : null}
        {place.excluded ? (
          <L.StatusBanner tone="info" title="Left out by your limits">{place.excluded}</L.StatusBanner>
        ) : null}
        <L.Readout label="Best landing" value={formatUtc(bestMs)} size="sm" hint={`then ${mission.params.durationDays} d on the surface`} />
        <div className="readout-grid">
          <L.Readout label="Sunlight" kind="sun" value={pct(m.sun)} unit="%" />
          <L.Readout label="Earth view" kind="earth" value={pct(m.earth)} unit="%" />
          <L.Readout label="Both" kind="both" value={pct(m.both)} unit="%" />
          <L.Readout label="Longest night" value={formatDuration(m.night)} />
          <L.Readout label="Slope" value={Number.isFinite(slope) ? slope.toFixed(1) : "–"} unit="°" />
          <L.Readout label="To permanent shadow" value={Number.isFinite(psr) ? psr.toFixed(1) : "–"} unit="km" approx />
        </div>
        {!place.excluded ? (
          <div>
            <span className="label lh-muted">WHY {Math.round(place.score)}?</span>
            <div className="stack-2 why">
              {why.map((w) => {
                const f = FACTORS.find((x) => x.key === w.key);
                const v = Number.isFinite(w.value) ? w.value : 0;
                return (
                  <L.MetricBar
                    key={w.key}
                    kind={f.kind || "neutral"}
                    label={`${f.label} · weight ${Math.round(w.share * 100)}%`}
                    value={Math.max(0, v * 100)}
                    display={`${Math.round(v * 100)}% → +${(Number.isFinite(w.points) ? w.points : 0).toFixed(1)}`}
                    compact
                  />
                );
              })}
            </div>
          </div>
        ) : null}
        <L.ExplainNote title="What this does not say">
          Sunlight is not the same as electrical power. Earth in view does not guarantee a working link.
        </L.ExplainNote>
      </div>
    </L.Panel>
  );
}
