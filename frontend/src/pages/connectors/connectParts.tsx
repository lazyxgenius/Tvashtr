/**
 * The pieces the two connect sheets share (CnF-Sign-*, CnF-Desk-1, CnF-Prob-*): the "What agents
 * may do" choice, the boxed notes, the wait-for-the-window panel and the "it went wrong" panel.
 */
import {
  CircleCheck,
  ExternalLink,
  Info,
  LoaderCircle,
  Lock,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useId } from "react";

import { Button } from "../../design-system/components";
import { cx } from "../../design-system/components/utils";
import type { ConnectorAccess } from "../../lib/api/connectors";
import { isDesktopApp } from "../../lib/desktopRepos";
import type { ConnectSignIn } from "./useConnectSignIn";

const NOTE_ICONS = { lock: Lock, info: Info, warn: TriangleAlert, ok: CircleCheck };

/** A boxed note: plain (a lock or an info mark), amber (a warning) or sage (it worked). */
export function Note({
  kind,
  children,
  role,
}: {
  kind: keyof typeof NOTE_ICONS;
  children: ReactNode;
  role?: "alert";
}) {
  const Glyph = NOTE_ICONS[kind];
  return (
    <div
      className={cx("cn-note", kind === "warn" && "cn-note--warn", kind === "ok" && "cn-note--ok")}
      role={role}
    >
      <span className="cn-note__icon">
        <Glyph size={14} strokeWidth={1.6} aria-hidden />
      </span>
      <span className="cn-note__text">{children}</span>
    </div>
  );
}

/** Where a sign-in is kept, under every sheet that starts one. */
export function SignInStaysNote() {
  return (
    <Note kind="lock">
      Your sign-in stays on Tvashtr’s servers, encrypted. Agents never get it: their calls go
      through Tvashtr, which adds the sign-in and enforces read only.
    </Note>
  );
}

/**
 * Before a sign-in to a server Tvashtr hasn't reviewed (the registry's, a custom address). Such a
 * server's sign-in page can send the browser on to another service's, and an Allow there would
 * hand that service's data to this server (the contract's "mix-up by redirect"). Only the person
 * looking at the page can tell.
 */
export function OwnSignInNote({ name }: { name: string }) {
  return (
    <Note kind="warn">
      The sign-in page that opens should be {name}’s own. If it asks for access to a different
      service, close it.
    </Note>
  );
}

/** "What agents may do": Read only | Read & write, with the line that says what read only means. */
export function AccessChoice({
  value,
  onChange,
  hint,
  disabled,
}: {
  value: ConnectorAccess;
  onChange: (access: ConnectorAccess) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const seg = (access: ConnectorAccess, label: string) => (
    <button
      type="button"
      className={cx("tv-seg__btn", value === access && "tv-seg__btn--active")}
      aria-pressed={value === access}
      disabled={disabled}
      onClick={() => onChange(access)}
    >
      {label}
    </button>
  );
  return (
    <div className="tk-wiz__field">
      <span id={id} className="tk-wiz__label">
        What agents may do
      </span>
      <div className="tv-seg tk-wiz__seg" role="group" aria-labelledby={id}>
        {seg("read", "Read only")}
        {seg("write", "Read & write")}
      </div>
      {hint && <span className="cn-hint">{hint}</span>}
    </div>
  );
}

/**
 * Step 2: the provider's page is open somewhere else (a popup on the web, the system browser on
 * Desktop) and this sheet waits. When the browser blocked the popup it says so and offers to open
 * it again.
 */
export function SignInWait({ name, signIn }: { name: string; signIn: ConnectSignIn }) {
  const desktop = isDesktopApp();
  if (signIn.phase === "blocked") {
    return (
      <div className="cn-wait cn-wait--warn" role="alert">
        <span className="cn-wait__icon">
          <TriangleAlert size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <div className="cn-wait__title">Your browser blocked the sign-in window</div>
        <div className="cn-wait__body">
          Allow pop-ups for Tvashtr, or open the window yourself. This sheet moves on when you
          finish there.
        </div>
        <Button
          size="sm"
          iconLeft={<ExternalLink size={14} strokeWidth={1.6} aria-hidden />}
          onClick={signIn.reopen}
        >
          Open the window again
        </Button>
      </div>
    );
  }
  return (
    <>
      <div className="cn-wait" role="status">
        <span className="cn-wait__icon cn-wait__icon--spin">
          <LoaderCircle size={26} strokeWidth={2} aria-hidden />
        </span>
        <div className="cn-wait__title">
          {desktop
            ? `Finish signing in to ${name} in your browser`
            : `Waiting for you to finish in the ${name} window`}
        </div>
        <div className="cn-wait__body">
          {desktop
            ? `We opened ${name} in your default browser. When you allow access there, this window moves on by itself.`
            : "Sign in there and allow access for Tvashtr. This sheet moves on by itself."}
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<ExternalLink size={14} strokeWidth={1.6} aria-hidden />}
          disabled={signIn.phase !== "waiting"}
          onClick={signIn.reopen}
        >
          {desktop ? "Open the browser again" : "Open the window again"}
        </Button>
      </div>
      {desktop && <SignInStaysNote />}
    </>
  );
}

/** A sign-in that didn't work, or a server Tvashtr can't sign in to: what happened and why. */
export function Problem({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: ReactNode;
  /** "Try again", where trying again can help. */
  onRetry?: () => void;
}) {
  return (
    <div className="cn-wait cn-wait--warn" role="alert">
      <span className="cn-wait__icon">
        <X size={26} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="cn-wait__title">{title}</div>
      <div className="cn-wait__body">{children}</div>
      {onRetry && (
        <Button
          size="sm"
          iconLeft={<RefreshCw size={14} strokeWidth={1.6} aria-hidden />}
          onClick={onRetry}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
