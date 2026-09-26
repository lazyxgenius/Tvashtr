/**
 * "How domains work" in three steps (DM-6): the strip at the top of the Domains list, which the
 * account can hide (preference `domains_howto_hidden`), and the same steps in a dialog opened from
 * the empty page's "How domains work" (DM-21).
 */
import type { ReactNode } from "react";
import { MessageSquare, Upload, Workflow, X } from "lucide-react";

import { Button, Dialog, IconButton } from "../../design-system/components";
import { cx } from "../../design-system/components/utils";

const ICON = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Upload {...ICON} />,
    title: "1. Add your files",
    body: "PDF, Markdown, text or HTML. They’re split into pieces and read.",
  },
  {
    icon: <MessageSquare {...ICON} />,
    title: "2. Ask with sources",
    body: "Every answer shows the exact passages it used.",
  },
  {
    icon: <Workflow {...ICON} />,
    title: "3. Use it in a team",
    body: "As a fixed step, or let an agent search when it needs to.",
  },
];

function Steps({ stacked = false, children }: { stacked?: boolean; children?: ReactNode }) {
  return (
    <div className={cx("dm-howto", stacked && "dm-howto--stacked")}>
      {STEPS.map((s) => (
        <div key={s.title} className="dm-howto__step">
          <span className="dm-howto__icon">{s.icon}</span>
          <div>
            <div className="dm-howto__title">{s.title}</div>
            <div className="dm-howto__body">{s.body}</div>
          </div>
        </div>
      ))}
      {children}
    </div>
  );
}

export function HowItWorksStrip({ onHide }: { onHide: () => void }) {
  return (
    <section aria-label="How domains work">
      <Steps>
        <div className="dm-howto__close">
          <IconButton size="sm" aria-label="Hide how domains work" onClick={onHide}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </div>
      </Steps>
    </section>
  );
}

export function HowDomainsWorkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      title="How domains work"
      onClose={onClose}
      footer={
        <Button variant="primary" size="md" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <Steps stacked />
    </Dialog>
  );
}
