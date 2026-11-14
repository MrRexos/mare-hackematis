import { useRef } from "react";
import { createPortal } from "react-dom";
import { LAYERS, layerReading } from "../data/mapLayers.js";
import iceDetections from "../data/iceDetections.json";
import { formatLatLon, pixelXY, xyToLatLon } from "../engine/geometry.js";
import { Icon, IconBtn, Shape, cx } from "../ui/kit.jsx";

function SourceLink({ href, children }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<Icon name="external-link" size={12} /></a>;
}

const MISSION_RAMPS = ["score", "sun", "earth"];

export function MapPointReadout({ data, layer, values, pending, hoveredPixel, selected, onEnter, datesFor, fixedDates, children }) {
  const pixel = hoveredPixel ?? selected?.p;
  if (pixel == null) return null;
  const { grid } = data.manifest;
  const coords = hoveredPixel == null
    ? selected.coords
    : formatLatLon(...xyToLatLon(grid, ...pixelXY(grid, Math.floor(pixel / grid.n), pixel % grid.n)));
  const reading = pending ? "Calculating…" : layerReading(layer, values, data.layers, pixel);
  return (
    <section className="overlay map-readout" aria-label={hoveredPixel == null ? "Selected point" : "Point under cursor"} onPointerEnter={selected ? onEnter : undefined}>
      <div className="row-8">
        <span className="num-13 grow ellipsis">{hoveredPixel == null ? selected.name : "Point under cursor"}</span>
        <span className="coords">{coords}</span>
      </div>
      <div className="row-8">
        <span className="muted-12 grow">{layer.label}</span>
        <strong className="num-15">{reading}</strong>
      </div>
      {/* Las capas de misión dependen de fechas: en modo búsqueda cada celda tiene las suyas. */}
      {!pending && MISSION_RAMPS.includes(layer.ramp) && datesFor?.(pixel) ? (
        <div className="row-8">
          <span className="muted-12 grow">{fixedDates ? "Your dates" : "Best days here"}</span>
          <span className="num-13">{datesFor(pixel)}</span>
        </div>
      ) : null}
      {hoveredPixel == null && layer.ramp === "score" && selected.excluded && (
        <div className="note-12"><Icon name="info" size={12} />{selected.excluded}</div>
      )}
      {children}
    </section>
  );
}

export default function MapControls({ activeLayer, onLayer, layerKeys, legendEnds, showIceEvidence, onIceEvidence, children }) {
  const sources = useRef(null);
  const layer = LAYERS[activeLayer];
  return (
    <>
      <div className="map-controls">
        <div className="map-controls__row">
          <div className="overlay layerbar" role="group" aria-label="Map layer">
            <Icon name="layers" size={16} />
            {layerKeys.map((key) => (
              <button key={key} type="button" className={cx("layerbar__b", activeLayer === key && "is-on")}
                aria-label={LAYERS[key].label} title={LAYERS[key].label} aria-pressed={activeLayer === key} onClick={() => onLayer(key)}>
                <span className="layerbar__check">{activeLayer === key && <Icon name="check" size={12} />}</span>
                {LAYERS[key].short}
              </button>
            ))}
          </div>
          <div className="overlay map-controls__extras">
            <IconBtn icon="droplet" label="Ice observations" variant="ghost" size={32} aria-pressed={showIceEvidence} onClick={() => onIceEvidence(!showIceEvidence)} />
            <IconBtn icon="info" label="Layer sources and meaning" variant="ghost" size={32} onClick={() => sources.current.showModal()} />
          </div>
        </div>
        {children}
      </div>
      <details className="overlay map-legend">
        <summary aria-label="Map legend" title="Map legend"><Icon name="layers" size={17} /></summary>
        <div className="overlay legend__pop">
          <div className="legend__row"><Shape kind="circle" />Artemis region</div>
          <div className="legend__row"><Shape kind="square" />Hotspot</div>
          <div className="legend__row"><Icon name="crosshair" size={12} />Selected point</div>
          <div className="legend__ramp">
            <span className="legend__name">{layer.label}</span>
            <div className={cx("ramp", `ramp--${layer.ramp}`)} />
            <div className="legend__ends"><span>{legendEnds[0]}</span><span>{legendEnds[1]}</span></div>
          </div>
          {layer.ramp === "shadow" && <div className="legend__row"><i className="legend__hatch" />Over 50% permanent shadow</div>}
          {showIceEvidence && (
            <>
              <div className="legend__row"><i className="ice-detection-key" />M³ surface ice detection</div>
              <div className="legend__row"><i className="ice-region-key" />Shadow region with M³ detections</div>
              <div className="legend__row"><i className="ice-impact-key" />LCROSS impact</div>
            </>
          )}
        </div>
      </details>
      {createPortal(<dialog className="layer-info" ref={sources} aria-labelledby="map-layer-info-title">
        <div className="layer-info__head">
          <h2 id="map-layer-info-title" className="h-lg">Map layers and sources</h2>
          <IconBtn icon="x" label="Close layer sources" variant="ghost" onClick={() => sources.current.close()} />
        </div>
        <div className="layer-info__body">
          {layerKeys.map((key) => {
            const { label, description, sources: links } = LAYERS[key];
            return (
              <section key={key} className={cx("layer-info__item", activeLayer === key && "layer-info__item--current")}>
                <h3>{label}</h3>
                <p>{description}</p>
                {links.length > 0 && (
                  <div className="layer-info__links">
                    {links.map(([name, url]) => <SourceLink key={url} href={url}>{name}</SourceLink>)}
                  </div>
                )}
              </section>
            );
          })}
          <section className="layer-info__item">
            <h3>Ice observations</h3>
            <p>Blue dots mark published Chandrayaan-1 M³ spectral detections of exposed water ice. Each detection represents an approximately 280 × 280 m observation. Blue outlines trace permanent-shadow regions associated with detections. Ice extent, depth and abundance remain uncertain.</p>
            <p>The diamond marks the Centaur impact in Cabeus, where LCROSS detected water in the excavated material. Mare shows the straight-line map distance from the cell centre to the nearest published M³ point.</p>
            <div className="layer-info__links">
              <SourceLink href={iceDetections.regionSource.url}>Lemelin et al. · region boundaries</SourceLink>
              <SourceLink href={iceDetections.source.url}>NASA Moon Trek · M³ coordinates</SourceLink>
              <SourceLink href={iceDetections.source.studyUrl}>Li et al. · orbital detections</SourceLink>
              <SourceLink href={iceDetections.impact.studyUrl}>LCROSS · water detection</SourceLink>
              <SourceLink href={iceDetections.impact.locationUrl}>NASA · impact coordinates</SourceLink>
              <SourceLink href={iceDetections.regionSource.licenseUrl}>{iceDetections.regionSource.license}</SourceLink>
            </div>
          </section>
        </div>
      </dialog>, document.body)}
    </>
  );
}
