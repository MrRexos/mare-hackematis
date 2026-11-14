// 04 Decide — Compare: hasta 4 lugares lado a lado.

import { useMemo, useState } from "react";
import { Icon, Btn, Card, CardHead, Tabs, Fidelity, IconBtn, Shape, cx } from "../ui/kit.jsx";
import { MissionChip, ProfileChip } from "../ui/Shell.jsx";
import { FACTORS, PRESETS, presetOf, scoreFromFactors } from "../engine/score.js";
import { goodHoursPerDay } from "../engine/timeline.js";
import { PropGrid } from "./Site.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400e3;

/** Días "buenos" (≥ 12 h con Sol y Tierra) por mes del periodo. */
function goodDaysByMonth(tl) {
  const hours = goodHoursPerDay(tl);
  const out = new Map();
  hours.forEach((h, k) => {
    const d = new Date(tl.startMs + k * DAY);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    out.set(key, (out.get(key) || 0) + (h >= 12 ? 1 : 0));
  });
  return out;
}

export default function Compare({ app }) {
  const { Rail, cmpPlaces, toggleCmp, weights, setWeights, mission, openSettings, go, setSelRef, timelineFor, region } = app;
  const [preset, setPreset] = useState(presetOf(weights) || "Balanced");
  const w = PRESETS[preset];

  const scored = useMemo(
    // Los factores de cada lugar van de 0 a 100; scoreFromFactors espera 0–1.
    () => cmpPlaces.map((p) => ({ ...p, cmpScore: scoreFromFactors(p.factors || {}, w) / 100 })).sort((a, b) => (b.cmpScore || -1) - (a.cmpScore || -1)),
    [cmpPlaces, w],
  );
  const top = scored[0];
  const second = scored[1];

  const months = useMemo(() => {
    const out = [];
    const d = new Date(mission.fromMs);
    for (let y = d.getUTCFullYear(), m = d.getUTCMonth(); Date.UTC(y, m, 1) < mission.toMs && out.length < 24; m++) {
      if (m > 11) { m = 0; y++; }
      out.push({ key: `${y}-${m}`, label: MONTHS[m] });
    }
    return out;
  }, [mission.fromMs, mission.toMs]);
  const good = useMemo(() => scored.map((p) => { const tl = timelineFor(p); return tl ? goodDaysByMonth(tl) : null; }), [scored, timelineFor]);

  const bestOf = (k) => Math.max(...scored.map((p) => (Number.isFinite(p.factors?.[k]) ? p.factors[k] : -1)));

  return (
    <div className="shell">
      {Rail}
      <main className="shell__main">
        <header className="pagehead">
          <div className="pagehead__title">
            <div className="eyebrow-13">04 — {scored.length} of 4 sites · South Pole</div>
            <h1 className="h-page">Compare/</h1>
          </div>
          <div className="grow" />
          <div className="pagehead__chips">
            <ProfileChip weights={weights} onClick={() => go("priorities")} />
            <MissionChip mission={mission} onClick={openSettings} />
          </div>
        </header>

        {!scored.length ? (
          <Card className="emptycard">
            <Icon name="compare" size={20} />
            <h2 className="h-md">Nothing to compare yet</h2>
            <p className="muted-12">Add up to four sites from the ranking or the map with the + button.</p>
            <div className="row-8">
              <Btn variant="primary" icon="plus" onClick={app.addBest3} disabled={!app.canAddBest}>Add best 3</Btn>
              <Btn iconRight="arrow-right" onClick={() => go("explore")}>Explore</Btn>
            </div>
          </Card>
        ) : (
          <div className="grid-rows">
            <div className="cmpcards">
              {scored.map((p, k) => (
                <Card key={p.key} pad="md2" className="cmpcard">
                  <div className="row-8">
                    <span className="cmpcard__rank">{String(k + 1).padStart(2, "0")}</span>
                    {k === 0 ? <span className="pill-sm pill-sm--ink"><Icon name="check" size={12} />Best</span> : null}
                    <div className="grow" />
                    <IconBtn icon="x" label={`Remove ${p.name}`} variant="ghost" size={28} onClick={() => toggleCmp(p)} />
                  </div>
                  <button type="button" className="cmpcard__main" onClick={() => { setSelRef(p.ref); go("site"); }}>
                    <span className="stack-4">
                      <span className="row-6"><Shape kind={p.shape} /><b className="cmpcard__name">{p.name}</b></span>
                      <span className="coords">{p.short} · {p.coords.split(" ")[0]}</span>
                    </span>
                    <span className="cmpcard__score">{Number.isFinite(p.cmpScore) ? Math.round(p.cmpScore) : "–"}</span>
                  </button>
                </Card>
              ))}
              {scored.length < 4 ? (
                <button type="button" className="cmpcard cmpcard--add" onClick={() => go("explore")}>
                  <Icon name="plus" size={16} />Add site
                </button>
              ) : null}
            </div>

            <div className="flexrow">
              <Card className="f1 f1--360">
                <CardHead title={`Why ${top.short}?`}>
                  {second && Number.isFinite(second.cmpScore) && top.cmpScore - second.cmpScore < 5 ? (
                    <span className="pill-sm"><Icon name="info" size={12} />Near tie · {second.short} −{Math.round(top.cmpScore - second.cmpScore)}</span>
                  ) : null}
                </CardHead>
                <div className="row-base mt-12">
                  <span className="big-40">{Number.isFinite(top.cmpScore) ? Math.round(top.cmpScore) : "–"}</span>
                  <span className="muted-11">/100</span>
                </div>
                <div className="mt-16"><PropGrid values={top.factors} /></div>
                <div className="stack-10 mt-20">
                  <div className="row-base">
                    <span className="lbl">Profile</span>
                    <div className="grow" />
                    <button type="button" className="linkbtn linkbtn--12" onClick={() => { setWeights({ ...w }); go("priorities"); }}>Weights<Icon name="chevron-right" size={12} /></button>
                  </div>
                  <div className="chips">
                    {Object.keys(PRESETS).map((k) => (
                      <button key={k} type="button" className={cx("chip", preset === k && "is-on")} aria-pressed={preset === k} onClick={() => setPreset(k)}>{k}</button>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="f2">
                <CardHead title="Side by side"><Fidelity level="computed" /></CardHead>
                <div className="tablewrap mt-12">
                  <table className="ctable">
                    <thead>
                      <tr><th /> {scored.map((p) => <th key={p.key} scope="col">{p.short}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr className="ctable__score">
                        <th scope="row"><span className="row-8">Score</span></th>
                        {scored.map((p) => <td key={p.key}><b>{Number.isFinite(p.cmpScore) ? Math.round(p.cmpScore) : "–"}</b></td>)}
                      </tr>
                      {FACTORS.map((f) => {
                        const b = bestOf(f.key);
                        return (
                          <tr key={f.key} className={f.noData ? "is-off" : ""}>
                            <th scope="row"><span className="row-8"><Icon name={f.icon} size={14} style={{ color: f.noData ? undefined : f.color }} />{f.label}</span></th>
                            {scored.map((p) => {
                              const v = p.factors?.[f.key];
                              const ok = Number.isFinite(v);
                              return (
                                <td key={p.key} className={ok && v === b && scored.length > 1 ? "is-best" : ""}>
                                  <span className="ctable__cell">
                                    <span className="bar bar--sm">{ok ? <span className="bar__fill" style={{ width: `${v}%`, background: f.color }} /> : null}</span>
                                    <span>{ok ? Math.round(v) : "–"}</span>
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <Card>
              <CardHead title="Good days by month"><span className="muted-12">Days with ≥ 12 h of Sun and Earth together</span></CardHead>
              <div className="tablewrap mt-12">
                <table className="ctable ctable--months">
                  <thead>
                    <tr><th />{months.map((m) => <th key={m.key} scope="col">{m.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {scored.map((p, k) => (
                      <tr key={p.key}>
                        <th scope="row">{p.short}</th>
                        {months.map((m) => {
                          const v = good[k]?.get(m.key);
                          return <td key={m.key}><span className="heat" style={{ "--a": v == null ? 0 : v / 31 }}>{v ?? "–"}</span></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
