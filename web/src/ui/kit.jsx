// Piezas de interfaz del diseño "Mare Hackematis" (canvas de diseño del equipo).
// Colores, radios y tipografía salen de los tokens del design system Lunar
// Horizon (public/design-system/tokens.css); las clases están en styles.css.

import { L } from "../ds.js";
import { ICONS } from "./icons.js";
import { FACTORS } from "../engine/score.js";

export function Icon({ name, size = 16, stroke = 1.75, className = "", style }) {
  const inner = ICONS[name];
  if (!inner) return L.Icon ? <L.Icon name={name} size={size} className={className} /> : null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`ic ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

export const cx = (...a) => a.filter(Boolean).join(" ");

export function Card({ as: Tag = "section", pad = "lg", className, children, ...rest }) {
  return <Tag className={cx("card", `card--${pad}`, className)} {...rest}>{children}</Tag>;
}

export function Label({ children, className }) {
  return <span className={cx("lbl", className)}>{children}</span>;
}

export function CardHead({ title, size = "md", children }) {
  return (
    <div className="card-head">
      <h2 className={`h-${size}`}>{title}</h2>
      <div className="grow" />
      {children}
    </div>
  );
}

/** Pestañas tipo píldora sobre carril hundido (role=tablist). */
export function Tabs({ label, value, onChange, options, className, small }) {
  return (
    <div role="tablist" aria-label={label} className={cx("tabs", small && "tabs--sm", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          title={o.title}
          className={cx("tabs__tab", value === o.value && "is-on")}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} size={14} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Btn({ variant = "secondary", size = "md", icon, iconRight, children, className, as: Tag = "button", ...rest }) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <Tag type={Tag === "button" ? "button" : undefined} className={cx("btn", `btn--${variant}`, `btn--${size}`, className)} {...rest}>
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children != null ? <span>{children}</span> : null}
      {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </Tag>
  );
}

export function IconBtn({ icon, label, variant = "raised", size = 40, iconSize, className, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("ibtn", `ibtn--${variant}`, className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={iconSize || (size >= 44 ? 20 : size >= 40 ? 18 : 16)} />
    </button>
  );
}

const FIDELITY = {
  validated: ["badge", "Validated"],
  computed: ["circle-dot", "Computed"],
  approx: ["circle-dashed", "Approx."],
  low: ["alert", "Low fidelity"],
  processing: ["loader", "Processing"],
};
export function Fidelity({ level = "computed", title }) {
  const [icon, text] = FIDELITY[level];
  return (
    <span className={cx("fid", `fid--${level}`)} title={title}>
      <Icon name={icon} size={13} className={level === "processing" ? "spin" : ""} />
      {text}
    </span>
  );
}

/** Rejilla de factores: icono, barra y valor (0–100 o null = sin datos). */
export function FactorGrid({ values, dense }) {
  return (
    <div className={cx("fgrid", dense && "fgrid--dense")}>
      {FACTORS.map((f) => {
        const v = values?.[f.key];
        const ok = Number.isFinite(v);
        return (
          <div key={f.key} className={cx("fgrid__item", !ok && "is-off")} title={ok ? f.label : `${f.label}: ${f.noData ? "no data yet" : "not scored"}`}>
            <Icon name={f.icon} size={14} style={{ color: ok ? f.color : undefined }} />
            <div className="bar" role="img" aria-label={`${f.label}: ${ok ? Math.round(v) : "no data"} of 100`}>
              {ok ? <div className="bar__fill" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: f.color }} /> : null}
            </div>
            <span className="fgrid__v">{ok ? Math.round(v) : "–"}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Mini histograma de factores (filas del ranking). */
export function FactorSpark({ values }) {
  return (
    <span className="spark" aria-hidden="true">
      {FACTORS.map((f) => {
        const v = values?.[f.key];
        const ok = Number.isFinite(v);
        return <span key={f.key} title={f.label} style={{ height: ok ? `${Math.max(2, (v / 100) * 16)}px` : "2px", background: ok ? f.color : "var(--line)" }} />;
      })}
    </span>
  );
}

/** Interruptor accesible (role=switch) con el aspecto del diseño. */
export function Toggle({ checked, onChange, label, description, disabled, children }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} disabled={disabled} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {description ? <span className="toggle__desc">{description}</span> : null}
        {children}
      </span>
      <span className={cx("toggle__track", checked && "is-on")}><span className="toggle__thumb" /></span>
    </button>
  );
}

/** Tarjeta de opción (tipo radio) del diseño: borde de tinta cuando está activa. */
export function Choice({ on, onClick, title, sub, icon, disabled, className }) {
  return (
    <button type="button" aria-pressed={!!on} disabled={disabled} className={cx("choice", on && "is-on", className)} onClick={onClick}>
      {icon ? <Icon name={icon} size={20} /> : <span className="choice__dot" />}
      <span className="choice__title">{title}</span>
      {sub ? <span className="choice__sub">{sub}</span> : null}
    </button>
  );
}

/** Forma del marcador según el tipo de lugar (círculo = región Artemis III, cuadrado = punto caliente). */
export function Shape({ kind = "circle", selected, size = 12 }) {
  const fill = selected ? "var(--ink)" : "var(--canvas)";
  const common = { fill, stroke: "var(--ink)", strokeWidth: 1.5 };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shape">
      {kind === "square" ? <rect x="3" y="3" width="10" height="10" rx="1.5" {...common} />
        : kind === "diamond" ? <path d="M8 1.8 14.2 8 8 14.2 1.8 8Z" {...common} />
        : kind === "triangle" ? <path d="M8 2.2 14 13.4H2Z" {...common} />
        : <circle cx="8" cy="8" r="5.5" {...common} />}
    </svg>
  );
}
