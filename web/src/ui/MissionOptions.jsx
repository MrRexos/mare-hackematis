import { useId } from "react";
import { Icon, cx } from "./kit.jsx";

export default function MissionOptions({ label, hideLabel = false, value, onChange, options }) {
  const id = useId();

  return (
    <fieldset className="mission-options">
      <legend className={hideLabel ? "sr-only" : "lbl"}>{label}</legend>
      <div className="mission-options__list">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;

          return (
            <label className={cx("mission-option", option.icon && "mission-option--icon")} key={option.value}>
              <input
                type="radio"
                name={id}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                aria-labelledby={optionId}
                aria-describedby={option.note ? `${optionId}-note` : undefined}
                onChange={() => onChange?.(option.value)}
              />
              {/* El icono puede depender del estado de la opción: se le pasa al pintarlo. */}
              {typeof option.icon === "function" ? option.icon({ checked: value === option.value, disabled: !!option.disabled }) : option.icon}
              <span className="mission-option__text">
                <span id={optionId}>{option.label}</span>
                {option.note && <span id={`${optionId}-note`} className="mission-option__note">{option.note}</span>}
              </span>
              <Icon name="check" size={16} className="mission-option__check" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
