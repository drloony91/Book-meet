import { useEffect, useRef, useState } from "react";

export type CustomSelectOption<T extends string | number = string> = {
  value: T;
  label: string;
};

export function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  function move(step: number) {
    if (!options.length) return;
    const nextIndex = (selectedIndex + step + options.length) % options.length;
    onChange(options[nextIndex].value);
  }

  return (
    <div ref={rootRef} className={`custom-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
      <button
        className="custom-select-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            else move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{selected?.label ?? ""}</span>
        <i aria-hidden="true" />
      </button>
      {open && (
        <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              className={option.value === value ? "is-selected" : ""}
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={String(option.value)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
