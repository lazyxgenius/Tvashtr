import type { ReactNode, Ref } from "react";

import { ChangedDot } from "../ChangedDot";
import { InfoTip } from "../InfoTip";

/**
 * One Setup row: a 104px label column (with its ⓘ), the control, and an optional hint under it.
 * `changed` puts the coral "Changed" dot in the row's left gutter. `overlay` (a picker or a confirm
 * that opens from the row) is placed against the label/control grid (`gridRef`).
 */
export function SettingRow({
  label,
  tip,
  labelId,
  hint,
  changed = false,
  overlay,
  gridRef,
  children,
}: {
  label: string;
  tip?: string;
  labelId?: string;
  hint?: ReactNode;
  changed?: boolean;
  overlay?: ReactNode;
  gridRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="nd-row">
      <div className="nd-row__grid" ref={gridRef}>
        {changed && <ChangedDot />}
        <span className="nd-row__label" id={labelId}>
          {label}
          {tip && <InfoTip text={tip} />}
        </span>
        <div className="nd-row__control">{children}</div>
        {overlay}
      </div>
      {hint && <div className="nd-hint">{hint}</div>}
    </div>
  );
}

/** A Setup section: the small uppercase title and its rows. */
export function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nd-section" aria-label={title}>
      <div className="nd-section__head">
        <h3 className="nd-section__title">{title}</h3>
      </div>
      {children}
    </section>
  );
}
