// Mission settings (panel lateral) y Share & Export (diálogo).

import { useEffect, useRef } from "react";
import { L } from "../ds.js";
import { Icon, Btn, Tabs, Toggle, Choice, IconBtn, cx } from "../ui/kit.jsx";
import { fmtIso } from "../ui/Shell.jsx";
import { FACTORS } from "../engine/score.js";

const toInput = (ms) => new Date(ms).toISOString().slice(0, 10);
const fromInput = (s) => Date.parse(`${s}T00:00:00Z`);

function useEscape(onClose) {
  useEffect(() => {
    const on = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
}

function Section({ title, children, note }) {
  return (
    <section className="sset">
      <div className="row-base"><span className="lbl">{title}</span><div className="grow" />{note}</div>
      {children}
    </section>
  );
}

export function SettingsDrawer({ app, onClose }) {
  const { mission, setPeriod, setCustom, setMissionOpts, periods, running, progress, restoreDefaults, dirty, limits, setLimits, problem } = app;
  const ref = useRef(null);
  useEscape(onClose);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="ovl">
      <button type="button" aria-label="Close settings" className="ovl__scrim" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Mission settings" className="drawer" ref={ref} tabIndex={-1}>
        <div className="drawer__head">
          <h2 className="h-lg">Mission settings</h2>
          <div className="grow" />
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="drawer__body">
          <Section title="Period">
            <Tabs
              label="Period"
              value={mission.period === "custom" ? "custom" : mission.period}
              onChange={(v) => setPeriod(v)}
              options={[{ value: "next12", label: "Next 12 months" }, { value: "nofixed", label: "No fixed date" }, { value: "custom", label: "Custom" }]}
              className="tabs--block"
            />
            <div className={cx("dates", mission.period !== "custom" && "is-dim")}>
              <label><span className="lbl">From</span><input type="date" aria-label="From" value={toInput(mission.fromMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setCustom(fromInput(e.target.value), mission.toMs)} /></label>
              <label><span className="lbl">To</span><input type="date" aria-label="To" value={toInput(mission.toMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setCustom(mission.fromMs, fromInput(e.target.value))} /></label>
            </div>
            {problem ? <p className="note-12"><Icon name="alert" size={12} />{problem}</p> : null}
          </Section>

          <Section title="Observer">
            <div className="row-10">
              <Choice on title="Lander" sub={`${mission.observerM} m`} />
              <Choice disabled title="Mast" sub="10 m · needs new horizons" />
            </div>
          </Section>

          <Section title="Sun visible when">
            <div className="row-10 wrap">
              {[["any", "Any part of the disk"], ["centre", "Disk centre"], ["whole", "Whole disk"]].map(([v, t]) => (
                <Choice key={v} on={mission.sunMode === v} title={t} onClick={() => setMissionOpts({ sunMode: v })} />
              ))}
            </div>
          </Section>

          <Section title="Earth visible when">
            <div className="row-10">
              {[["centre", "Centre"], ["any", "Any part"]].map(([v, t]) => (
                <Choice key={v} on={mission.earthMode === v} title={t} onClick={() => setMissionOpts({ earthMode: v })} />
              ))}
            </div>
          </Section>

          <Section title="Deep Space Network" note={<span className="pill-sm">Not modelled yet</span>}>
            <Toggle checked={false} disabled onChange={() => {}} label="Require a DSN station" description="Earth in view does not guarantee a link: a ground station must also see the Moon.">
              <span className="stations">
                {["Goldstone", "Madrid", "Canberra"].map((s) => <span key={s}><Icon name="satellite-dish" size={14} />{s}</span>)}
                <span>≥ 10°</span>
              </span>
            </Toggle>
          </Section>

          <Section title="Limits">
            <div className="stack-16">
              <L.Slider label="Maximum slope" value={limits.maxSlopeDeg} min={2} max={30} step={1} onChange={(v) => setLimits({ ...limits, maxSlopeDeg: v })} format={(v) => `${v}°`} description="Pixels steeper than this are left out." />
              <L.Slider label="Ice reach" value={limits.iceReachKm} min={2} max={30} step={1} onChange={(v) => setLimits({ ...limits, iceReachKm: v })} format={(v) => `${v} km`} description="Distance to ground where ice is stable within 0.5 m (LRO Diviner) at which the water-ice factor drops to zero." />
              <Toggle checked={limits.excludePsr} onChange={(v) => setLimits({ ...limits, excludePsr: v })} label="Leave out permanent shadow" description="A solar-powered lander cannot work inside permanently shadowed regions." />
              <Toggle checked={limits.maxNightH != null} onChange={(v) => setLimits({ ...limits, maxNightH: v ? 72 : null })} label="Limit the longest night" description="Leave out spots whose longest dark stretch exceeds the battery autonomy." />
              {limits.maxNightH != null ? (
                <L.Slider label="Battery autonomy" value={limits.maxNightH} min={6} max={240} step={6} onChange={(v) => setLimits({ ...limits, maxNightH: v })} format={(v) => `${v} h`} />
              ) : null}
            </div>
          </Section>
        </div>
        <div className="drawer__foot">
          {running ? (
            <span className="row-8 muted-12"><Icon name="loader" size={14} className="spin" />Recomputing<b className="num-13">{Math.round(progress * 100)}%</b></span>
          ) : (
            <span className="row-8 muted-12"><Icon name="check" size={14} />Up to date</span>
          )}
          <div className="grow" />
          <Btn variant="ghost" icon="rotate-ccw" onClick={restoreDefaults} disabled={!dirty}>Restore defaults</Btn>
          <Btn variant="primary" onClick={onClose}>Done</Btn>
        </div>
      </div>
    </div>
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
  const meta = `DE440 · MOON_ME · LOLA 240 m · Lander ${mission.observerM} m · Sun: ${mission.sunMode === "any" ? "any part" : mission.sunMode} · Earth: ${mission.earthMode} · DSN off · ${new Date(mission.fromMs).toISOString().slice(0, 10)} → ${new Date(mission.toMs).toISOString().slice(0, 10)}`;
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
