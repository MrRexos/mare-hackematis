import { useId, useState } from "react";
import { Icon, IconBtn, cx } from "../ui/kit.jsx";

export default function MapLayerBar({ layers, layerKeys, activeLayer, onLayer }) {
  const [expanded, setExpanded] = useState(true);
  const optionsId = useId();

  return (
    <div className="overlay layerbar" role="group" aria-label="Map layer">
      <IconBtn icon="layers" label={expanded ? "Collapse map layers" : "Expand map layers"} variant="ghost" size={30} iconSize={16}
        aria-expanded={expanded} aria-controls={optionsId} onClick={() => setExpanded((open) => !open)} />
      <div id={optionsId} className="layerbar__options">
        {layerKeys.filter((key) => expanded || key === activeLayer).map((key) => (
          <button key={key} type="button" className={cx("layerbar__b", activeLayer === key && "is-on")}
            aria-label={layers[key].label} title={layers[key].label} aria-pressed={activeLayer === key} onClick={() => onLayer(key)}>
            <span className="layerbar__check">{activeLayer === key && <Icon name="check" size={12} />}</span>
            {layers[key].short}
          </button>
        ))}
      </div>
    </div>
  );
}
