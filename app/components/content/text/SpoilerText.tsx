import { Fragment, useRef, useState } from "react";

function SpoilerChunk({ children }: { children: string }) {
  const [revealed, setRevealed] = useState(false);
  const reveal = () => setRevealed(true);

  return (
    <span
      className={`spoiler ${revealed ? "is-revealed" : ""}`}
      role="button"
      tabIndex={0}
      title="Открыть спойлер"
      onClick={reveal}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") reveal();
      }}
    >
      {children}
    </span>
  );
}

export function SpoilerText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\|\|[\s\S]*?\|\|)/g).map((part, index) =>
        part.startsWith("||") && part.endsWith("||") ? (
          <SpoilerChunk key={index}>{part.slice(2, -2)}</SpoilerChunk>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function SpoilerTextarea({
  value,
  onChange,
  rows = 4,
  required = false,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  required?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState(false);

  function toggleSpoiler() {
    const input = ref.current;
    if (!input || input.selectionStart === input.selectionEnd) {
      setHint(true);
      window.setTimeout(() => setHint(false), 1_800);
      return;
    }

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = value.slice(start, end);
    const alreadyWrapped = value.slice(Math.max(0, start - 2), start) === "||" && value.slice(end, end + 2) === "||";
    const next = alreadyWrapped
      ? value.slice(0, start - 2) + selected + value.slice(end + 2)
      : value.slice(0, start) + `||${selected}||` + value.slice(end);

    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(alreadyWrapped ? start - 2 : start + 2, alreadyWrapped ? end - 2 : end + 2);
    });
  }

  return (
    <div className="spoiler-textarea">
      <div className="comment-format-toolbar">
        <button type="button" onClick={toggleSpoiler} title="Скрыть под спойлер">
          ▦ Скрыть под спойлер
        </button>
        {hint && <span>Выделите текст для скрытия под спойлер</span>}
      </div>
      <textarea
        ref={ref}
        required={required}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
