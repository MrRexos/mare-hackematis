import { L } from "../ds.js";
import { FACTORS } from "../engine/score.js";

export const PRESETS = {
  balanced: { sun: 4, earth: 3, terrain: 2, ice: 1 },
  power: { sun: 5, earth: 1, terrain: 2, ice: 0 },
  earth: { sun: 2, earth: 5, terrain: 2, ice: 0 },
  ice: { sun: 3, earth: 2, terrain: 1, ice: 4 },
};

function presetOf(w) {
  return Object.keys(PRESETS).find((k) => FACTORS.every((f) => PRESETS[k][f.key] === w[f.key])) || "custom";
}

export default function PrioritiesPanel({ weights, setWeights, limits, setLimits }) {
  const total = FACTORS.reduce((a, f) => a + weights[f.key], 0) || 1;
  const preset = presetOf(weights);
  return (
    <L.Panel eyebrow="02 — Priorities" title="What matters most">
      <div className="stack-4">
        <L.SegmentedControl
          label="Priority preset"
          block
          size="sm"
          value={preset}
          onChange={(v) => PRESETS[v] && setWeights({ ...PRESETS[v] })}
          options={[
            { value: "balanced", label: "Balanced" },
            { value: "power", label: "Power" },
            { value: "earth", label: "Earth" },
            { value: "ice", label: "Ice" },
          ]}
        />
        {FACTORS.map((f) => (
          <L.Slider
            key={f.key}
            label={f.label}
            value={weights[f.key]}
            min={0}
            max={5}
            step={1}
            onChange={(v) => setWeights({ ...weights, [f.key]: v })}
            format={(v) => `${v} · ${Math.round((100 * v) / total)}%`}
            description={f.hint}
          />
        ))}
        <p className="code lh-sec note">score = 100 · Σ weight × factor / Σ weight</p>
      </div>
      <div className="divider" />
      <div className="stack-4">
        <span className="label lh-muted">LIMITS</span>
        <L.Slider
          label="Maximum slope"
          value={limits.maxSlopeDeg}
          min={2}
          max={30}
          step={1}
          onChange={(v) => setLimits({ ...limits, maxSlopeDeg: v })}
          format={(v) => `${v}°`}
          description="Pixels steeper than this are left out. Slope is the median of 240 m LOLA samples in each 1 km pixel."
        />
        <L.Slider
          label="Ice reach"
          value={limits.iceReachKm}
          min={2}
          max={30}
          step={1}
          onChange={(v) => setLimits({ ...limits, iceReachKm: v })}
          format={(v) => `${v} km`}
          description="Distance to permanent shadow at which the ice factor drops to zero."
        />
        <L.Switch
          label="Leave out permanent shadow"
          description="A solar-powered lander cannot work inside permanently shadowed regions."
          checked={limits.excludePsr}
          onChange={(v) => setLimits({ ...limits, excludePsr: v })}
        />
        <L.Switch
          label="Limit the longest night"
          description="Leave out spots whose longest dark stretch exceeds the battery autonomy."
          checked={limits.maxNightH != null}
          onChange={(v) => setLimits({ ...limits, maxNightH: v ? 72 : null })}
        />
        {limits.maxNightH != null ? (
          <L.Slider
            label="Battery autonomy"
            value={limits.maxNightH}
            min={6}
            max={240}
            step={6}
            onChange={(v) => setLimits({ ...limits, maxNightH: v })}
            format={(v) => `${v} h`}
          />
        ) : null}
      </div>
    </L.Panel>
  );
}
