// Mission settings (panel lateral) y Share & Export (diálogo).

import { useEffect, useId, useRef, useState } from "react";
import { L } from "../ds.js";
import { Icon, Btn, Toggle, IconBtn, cx } from "../ui/kit.jsx";
import { fmtIso } from "../ui/Shell.jsx";
import { DEFAULT_LIMITS, FACTORS } from "../engine/score.js";
import { changePeriod, resolveMission, validateTiming } from "../engine/missionTiming.js";
import MissionTiming from "../ui/MissionTiming.jsx";
import MissionWeights from "../ui/MissionWeights.jsx";

function useEscape(onClose) {
  useEffect(() => {
    const on = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
}

const SETTINGS_SECTIONS = [
  { id: "dates", label: "Dates", icon: "calendar" },
  { id: "weights", label: "Weights", icon: "sliders" },
  { id: "rules", label: "Rules", icon: "slope" },
];

const differs = (current, original) => Object.keys(original).some((key) => current[key] !== original[key]);

function SettingsTabs({ section, setSection, id }) {
  const onKeyDown = (e) => {
    const current = SETTINGS_SECTIONS.findIndex(({ id }) => id === section);
    const last = SETTINGS_SECTIONS.length - 1;
    const next = { ArrowRight: (current + 1) % (last + 1), ArrowLeft: (current + last) % (last + 1), Home: 0, End: last };
    if (!Object.hasOwn(next, e.key)) return;
    e.preventDefault();
    const index = next[e.key];
    setSection(SETTINGS_SECTIONS[index].id);
    e.currentTarget.querySelectorAll("[role=tab]")[index].focus();
  };

  return (
    <div className="drawer__tabs" role="tablist" aria-label="Mission settings sections" onKeyDown={onKeyDown}>
      {SETTINGS_SECTIONS.map(({ id: key, label, icon }) => (
        <button key={key} id={`${id}-tab-${key}`} type="button" role="tab" tabIndex={section === key ? 0 : -1}
          aria-selected={section === key} aria-controls={`${id}-panel-${key}`} onClick={() => setSection(key)}>
          <Icon name={icon} size={15} />{label}
        </button>
      ))}
    </div>
  );
}

function VisibilityOptions({ label, value, options, onChange }) {
  return (
    <div className="stack-6">
      <span className="lbl">{label}</span>
      <div className="chips" role="group" aria-label={label}>
        {options.map(([key, name]) => (
          <button key={key} type="button" aria-pressed={value === key} className={cx("chip", value === key && "is-on")}
            onClick={() => onChange(key)}>{name}</button>
        ))}
      </div>
    </div>
  );
}

function MissionRules({ mission, updateMission, limits, setLimits, reset, canReset }) {
  const updateLimit = (key, value) => setLimits((current) => ({ ...current, [key]: value }));

  return (
    <>
      <section className="sset" aria-labelledby="mission-visibility">
        <h3 id="mission-visibility" className="h-sm">Visibility</h3>
        <VisibilityOptions label="Sun visible when" value={mission.sunMode}
          options={[["any", "Any part of the disk"], ["centre", "Disk centre"], ["whole", "Whole disk"]]}
          onChange={(sunMode) => updateMission({ sunMode })} />
        <VisibilityOptions label="Earth visible when" value={mission.earthMode}
          options={[["centre", "Disk centre"], ["any", "Any part of the disk"]]}
          onChange={(earthMode) => updateMission({ earthMode })} />
      </section>
      <section className="sset" aria-labelledby="mission-limits">
        <h3 id="mission-limits" className="h-sm">Site limits</h3>
        <L.Slider label="Maximum slope" value={limits.maxSlopeDeg} min={2} max={30} step={1} onChange={(v) => updateLimit("maxSlopeDeg", v)} format={(v) => `${v}°`} description="Pixels steeper than this are left out." />
        <L.Slider label="Modelled ice reach" value={limits.iceReachKm} min={2} max={30} step={1} onChange={(v) => updateLimit("iceReachKm", v)} format={(v) => `${v} km`} description="Distance at which the modelled ice proximity score reaches zero." />
        <Toggle checked={limits.excludePsr} onChange={(v) => updateLimit("excludePsr", v)} label="Leave out permanent shadow" description="Exclude terrain that is mostly in permanent shadow." />
        <Toggle checked={limits.maxNightH != null} onChange={(v) => updateLimit("maxNightH", v ? 72 : null)} label="Limit the longest night" description="Exclude sites if their longest dark stretch exceeds battery autonomy." />
        {limits.maxNightH != null && (
          <L.Slider label="Battery autonomy" value={limits.maxNightH} min={6} max={240} step={6} onChange={(v) => updateLimit("maxNightH", v)} format={(v) => `${v} h`} />
        )}
        <Btn variant="ghost" size="sm" className="drawer__reset" icon="rotate-ccw" onClick={reset} disabled={!canReset}>Reset rules</Btn>
      </section>
    </>
  );
}

export function SettingsDrawer({ initialSection, rulesOnly, region, input, periods, weights, limits, defaultRules, onApply, onClose }) {
  const id = useId();
  const ref = useRef(null);
  const [section, setSection] = useState(initialSection);
  const [draft, setDraft] = useState(input);
  const [draftWeights, setDraftWeights] = useState(weights);
  const [draftLimits, setDraftLimits] = useState(limits);
  const mission = resolveMission(draft, periods);
  const { timingMissing, problem } = validateTiming(mission, periods);
  const invalid = rulesOnly ? null : timingMissing || problem;
  const weightsChanged = Boolean(weights && draftWeights && differs(draftWeights, weights));
  const changed = differs(draft, input) || differs(draftLimits, limits) || weightsChanged;
  const sections = rulesOnly ? SETTINGS_SECTIONS.filter(({ id }) => id === "rules") : SETTINGS_SECTIONS;
  const updateMission = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const reset = () => {
    updateMission(defaultRules);
    setDraftLimits(DEFAULT_LIMITS);
  };
  const dismiss = () => {
    ref.current.close();
    onClose();
  };

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    dialog.querySelector('[aria-selected="true"]')?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return (
    <dialog ref={ref} className="drawer mission-drawer" aria-labelledby={`${id}-title`}
      onCancel={(e) => { e.preventDefault(); dismiss(); }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <form className="drawer__form" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!changed || invalid) return;
        ref.current.close();
        onApply({ input: draft, weights: draftWeights, limits: draftLimits });
      }}>
        <header className="drawer__head">
          <div className="stack-4">
            <h2 id={`${id}-title`} className="h-lg">{rulesOnly ? "Advanced settings" : "Mission settings"}</h2>
            <span className="drawer__region"><Icon name="map-pin" size={13} />{region}</span>
          </div>
          <IconBtn icon="x" label="Close settings" variant="ghost" onClick={dismiss} />
        </header>
        {!rulesOnly && <SettingsTabs section={section} setSection={setSection} id={id} />}
        {sections.map(({ id: key }) => (
          <div key={key} id={`${id}-panel-${key}`} className="drawer__body" hidden={section !== key}
            role={rulesOnly ? undefined : "tabpanel"} aria-labelledby={rulesOnly ? undefined : `${id}-tab-${key}`}>
            {key === "dates" && (
              <MissionTiming mission={mission} periods={periods} problem={problem}
                setPeriod={(value) => setDraft((current) => changePeriod(current, value))} updateMission={updateMission} />
            )}
            {key === "weights" && <MissionWeights weights={draftWeights} setWeights={setDraftWeights} />}
            {key === "rules" && <MissionRules mission={mission} updateMission={updateMission} limits={draftLimits}
              setLimits={setDraftLimits} reset={reset} canReset={differs(draft, defaultRules) || differs(draftLimits, DEFAULT_LIMITS)} />}
          </div>
        ))}
        <footer className="drawer__foot">
          <p className={cx("drawer__status", invalid && "mission-error")} role="status">
            {invalid || (changed ? "Unsaved changes" : "Settings up to date")}
          </p>
          <div className="drawer__actions">
            <Btn variant="ghost" onClick={dismiss}>Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={!changed || !!invalid}>Apply changes</Btn>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportDialog({ app, onClose }) {
  const { selected, tl, exportPlaces, mission, weights, result, data } = app;
  useEscape(onClose);
  const meta = `DE440 · MOON_ME · LOLA 240 m · Lander ${mission.observerM} m · Sun: ${mission.sunMode === "any" ? "any part" : mission.sunMode} · Earth: ${mission.earthMode} ·${new Date(mission.fromMs).toISOString().slice(0, 10)} → ${new Date(mission.toMs).toISOString().slice(0, 10)}`;
  const header = `# ${meta}\n`;
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const timeSeries = () => {
    const rows = ["utc,sun_visible,sun_az_deg,sun_el_deg,earth_visible,earth_az_deg,earth_el_deg"];
    for (let t = 0; t < tl.n; t++) {
      rows.push([fmtIso(tl.startMs + t * 3600e3), tl.sun[t], tl.sunAz[t].toFixed(2), tl.sunEl[t].toFixed(3), tl.earth[t], tl.earthAz[t].toFixed(2), tl.earthEl[t].toFixed(3)].join(","));
    }
    download(`${slug(selected.name)}-time-series.csv`, header + rows.join("\n"));
  };
  const scores = () => {
    const cols = ["name", "kind", "lat", "lon", "score", ...FACTORS.map((f) => f.key), "best_landing_utc"];
    const rows = [cols.join(",")];
    for (const p of exportPlaces) {
      const best = p.metrics && result ? fmtIso(result.startMs + p.metrics.best * result.stepMs) : "";
      rows.push([`"${p.name}"`, p.kindLabel, p.lat.toFixed(4), p.lon.toFixed(4), Number.isFinite(p.score) ? p.score.toFixed(1) : "", ...FACTORS.map((f) => (Number.isFinite(p.factors?.[f.key]) ? p.factors[f.key].toFixed(1) : "")), best].join(","));
    }
    download("scores-and-metrics.csv", header + rows.join("\n"));
  };
  const missionJson = () => {
    download("mission.json", JSON.stringify({
      mission: { from: new Date(mission.fromMs).toISOString(), to: new Date(mission.toMs).toISOString(), durationDays: mission.durationDays, observerM: mission.observerM, sunVisibleWhen: mission.sunMode, earthVisibleWhen: mission.earthMode },
      weightsPercent: weights,
      sources: { ephemeris: data.manifest.ephem?.source, terrain: data.manifest.layers?.elevation?.source, horizons: data.manifest.horizon?.source },
    }, null, 2), "application/json");
  };

  const items = [
    { icon: "file-spreadsheet", name: "Time series", fmt: "CSV", sub: selected ? `${selected.short} · hourly · UTC · deg` : "Pick a site first", run: timeSeries, ok: !!(selected && tl) },
    { icon: "file-spreadsheet", name: "Scores & metrics", fmt: "CSV", sub: `${exportPlaces.length} sites · ${FACTORS.length} properties`, run: scores, ok: exportPlaces.length > 0, pending: !result },
    { icon: "sliders", name: "Mission & weights", fmt: "JSON", sub: "Settings, weights and data sources", run: missionJson, ok: true },
  ];

  return (
    <div className="ovl ovl--center">
      <button type="button" aria-label="Close export" className="ovl__scrim" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Share and export" className="modal">
        <div className="row-12">
          <h2 className="h-lg">Export</h2>
          {selected ? <span className="num-13 muted">{selected.short} · {selected.name}</span> : null}
          <div className="grow" />
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="xlist">
          {items.map((it) => (
            <div key={it.name} className="xrow">
              <span className="xrow__icon"><Icon name={it.icon} size={20} /></span>
              <div className="xrow__text">
                <div className="row-8"><b>{it.name}</b><span className="num-13 muted">{it.fmt}</span></div>
                <span className="xrow__sub">{it.sub}</span>
              </div>
              {it.pending ? <span className="row-6 muted-12"><Icon name="loader" size={14} className="spin" />Computing</span> : null}
              <Btn variant={it.ok && !it.pending ? "primary" : "secondary"} size="sm" icon="download" onClick={it.run} disabled={!it.ok || it.pending}>Download</Btn>
            </div>
          ))}
        </div>
        <div className="stack-10">
          <span className="lbl">Included in every file</span>
          <span className="xrow__sub">{meta}</span>
        </div>
      </div>
    </div>
  );
}
