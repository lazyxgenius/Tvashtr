/**
 * The connect sheet (CnF-Sign-2..4, CnF-Key-2..3, CnF-Desk-1, CnF-Prob-1..2).
 *
 * Connecting a catalog entry: choose what agents may do → the provider's page opens (a popup on
 * the web, the system browser on Desktop) and the sheet waits, polling the connection → pick a
 * project where the connector has them → done. An entry that takes an API key shows the key form
 * instead ("Check and connect").
 *
 * The same sheet serves a connection you already have: "Sign in again" opens on the wait step
 * (the click that opened the sheet also opened the window), a key connection gets "Replace key",
 * and "Change project" opens on the project step.
 */
import { ArrowLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Button, Input, Sheet } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import {
  type CatalogEntry,
  type Connection,
  type ConnectorAccess,
  type ConnectorRefusal,
  type KeyField,
  type ScopeOptions,
  checkConnection,
  connectorRefusal,
  createConnection,
  getScopeOptions,
  updateConnection,
} from "../../lib/api/connectors";
import { navigate } from "../../lib/nav";
import {
  AccessAllows,
  AccessChoice,
  Note,
  OwnSignInNote,
  Problem,
  SignInStaysNote,
  SignInWait,
} from "./connectParts";
import { ConnectorTile } from "./ConnectorTile";
import { firstSentence, readOnlyHint, usesKey } from "./connectorFormat";
import { type SignInOutcome, useAlive, useConnectSignIn } from "./useConnectSignIn";

export type ConnectTarget =
  /** Connect a catalog entry (Browse). */
  | { entry: CatalogEntry }
  /** Sign in again (or replace the key); `prepared` is the popup the click opened. */
  | { connection: Connection; mode: "signin"; prepared: Window | null }
  | { connection: Connection; mode: "project" };

/** What the sheet finished: a new connection, a renewed sign-in, or another project. */
export type ConnectDone = "connected" | "signed_in" | "project";

type Step = "access" | "key" | "wait" | "project" | "problem";

interface ProblemState {
  title: string;
  body: string;
  /** Trying again can help (the provider or the user said no). */
  retry: boolean;
  /** A server with no sign-in goes in Tools. */
  tools: boolean;
}

const CANCELLED = "Sign-in cancelled. Nothing was connected.";
const TIMED_OUT = "The sign-in wasn’t finished in time. Try again.";
const COULDNT_OPEN = "Tvashtr couldn’t open the sign-in page. Try again.";
const DEFAULT_KEY: KeyField = {
  id: "Authorization",
  label: "API key",
  hint: "",
  secret: true,
  required: true,
};

/** The server's words for a refusal or another 4xx, else null. */
function serverWords(e: unknown, refusal: ConnectorRefusal | null): string | null {
  if (refusal) return refusal.message;
  return e instanceof ApiDetailError && e.status >= 400 && e.status < 500 && e.message
    ? e.message
    : null;
}

export function ConnectSheet({
  target,
  onClose,
  onDone,
}: {
  target: ConnectTarget;
  /** Closed before it finished. A sign-in may still have gone through: reload the list. */
  onClose: () => void;
  onDone: (connection: Connection, what: ConnectDone) => void;
}) {
  const formId = useId(); // one step's form at a time; its button is in the sheet's footer
  const entry = "entry" in target ? target.entry : null;
  const existing = "connection" in target ? target.connection : null;
  const mode = "mode" in target ? target.mode : "new";
  const name = entry?.name ?? existing?.name ?? "";
  const host = entry?.host ?? existing?.host ?? "";
  const reviewed = entry?.reviewed ?? existing?.reviewed ?? false;
  const picker = entry?.scope_picker ?? existing?.scope_picker ?? null;
  const accessModes = entry?.access_modes ?? existing?.access_modes ?? ["read"];
  const readOnlyBy = entry?.read_only_by ?? existing?.read_only_by ?? "annotations";
  const keyed = entry ? entry.auth === "api_key" : existing !== null && usesKey(existing);

  const [step, setStep] = useState<Step>(
    mode === "project" ? "project" : keyed ? "key" : mode === "signin" ? "wait" : "access",
  );
  const [conn, setConn] = useState<Connection | null>(existing);
  const [access, setAccess] = useState<ConnectorAccess>(existing?.access ?? "read");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemState | null>(null);
  // The sign-in is on another site than the server: shown once, before the window opens.
  const [otherSite, setOtherSite] = useState<string | null>(null);
  // "Replace key" asks for the fields the connection names; one that names none takes the usual
  // header.
  const [keyFields, setKeyFields] = useState<KeyField[]>(
    entry
      ? entry.key_fields
      : existing && keyed && existing.key_fields.length === 0
        ? [DEFAULT_KEY]
        : (existing?.key_fields ?? []),
  );
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [keyError, setKeyError] = useState<string | null>(null);
  const [options, setOptions] = useState<ScopeOptions | null>(null);
  const [picked, setPicked] = useState(existing?.scope?.value ?? "");

  // A sheet that is gone reports nothing: the page that opened it may be gone too.
  const alive = useAlive();
  const done: typeof onDone = (connection, what) => {
    if (alive.current) onDone(connection, what);
  };
  const finish = (connection: Connection) =>
    done(connection, mode === "signin" ? "signed_in" : "connected");
  // Connected: a new connection with projects asks which one; anything else is done.
  const afterConnected = (connection: Connection) => {
    setConn(connection);
    setAccess(connection.access);
    if (mode === "new" && picker) setStep("project");
    else finish(connection);
  };

  const cannotSignIn = (refusal: ConnectorRefusal) =>
    setProblem({
      title: `Tvashtr can’t sign in to ${name} yet`,
      body: refusal.message,
      retry: false,
      tools: refusal.code === "no_signin",
    });

  const onOutcome = (outcome: SignInOutcome) => {
    if (outcome.kind === "connected") return afterConnected(outcome.connection);
    if (outcome.kind === "moved") {
      // Not where the sheet said (or, for "Sign in again", where it was): shown before it opens.
      setConn(outcome.connection);
      setOtherSite(outcome.connection.signin_host ?? outcome.connection.host);
      return setStep("access");
    }
    if (outcome.kind === "failed") {
      setProblem({
        title: firstSentence(outcome.message),
        body: `${mode === "new" ? "Nothing was connected" : "Nothing changed"}. Try again when you’re ready; you can pick a different ${name} account in the window.`,
        retry: true,
        tools: false,
      });
      return setStep("problem");
    }
    if (outcome.kind === "refused" && outcome.refusal?.code === "cannot_register") {
      cannotSignIn(outcome.refusal);
      return setStep("problem");
    }
    setNotice(
      outcome.kind === "timeout"
        ? TIMED_OUT
        : outcome.kind === "gone"
          ? `${name} was disconnected before the sign-in finished.`
          : (outcome.refusal?.message ?? COULDNT_OPEN),
    );
    setStep("access");
  };
  const signIn = useConnectSignIn(onOutcome);

  // "Sign in again": the click that opened this sheet opened the window too. Start once (the
  // effect runs twice under StrictMode).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !("mode" in target) || target.mode !== "signin" || keyed) return;
    autoStarted.current = true;
    void signIn.start(target.connection, target.prepared);
  }, [target, keyed, signIn]);

  // The project step lists the provider's projects; a list that can't be read asks for the id.
  const connId = conn?.id;
  useEffect(() => {
    if (step !== "project" || !connId || options) return;
    let live = true;
    const manual = { param: picker?.param ?? "", label: picker?.label ?? "Project", manual: true };
    getScopeOptions(connId).then(
      (next) => {
        if (!live) return;
        setOptions(next.options.length === 0 ? { ...next, manual: true } : next);
        setPicked((p) => p || (next.manual ? "" : (next.options[0]?.value ?? "")));
      },
      () => live && setOptions({ ...manual, options: [] }),
    );
    return () => {
      live = false;
    };
  }, [step, connId, options, picker]);

  const refused = (e: unknown) => {
    const refusal = connectorRefusal(e);
    if (refusal?.code === "key_required") {
      setKeyFields(refusal.fields.length > 0 ? refusal.fields : [DEFAULT_KEY]);
      return setStep("key");
    }
    if (refusal?.code === "key_rejected" || refusal?.code === "invalid_key") {
      return setKeyError(refusal.message);
    }
    if (refusal?.code === "cannot_register" || refusal?.code === "no_signin") {
      cannotSignIn(refusal);
      return setStep("problem");
    }
    setNotice(serverWords(e, refusal) ?? `Couldn’t connect ${name}. Try again.`);
  };

  /** "Continue to <provider>": in the click, so the popup isn't blocked. */
  const toProvider = async () => {
    // Back from the project step: the sign-in is done.
    if (mode === "new" && conn?.status === "connected") return setStep("project");
    // A server the catalog knows needs no sign-in gets no window.
    if (entry?.auth !== "none") signIn.prepare();
    setNotice(null);
    setBusy(true);
    try {
      // A pending connection is made again: the server reuses the row and takes the access.
      const made = entry ? await createConnection({ key: entry.key, access }) : conn;
      if (!made) return;
      setConn(made);
      if (made.status === "connected" && entry) {
        signIn.cancel();
        return afterConnected(made);
      }
      // A new connection says where its sign-in is before it opens it (once per site).
      if (entry && made.signin_host_differs && made.signin_host !== otherSite) {
        signIn.cancel();
        return setOtherSite(made.signin_host ?? made.host);
      }
      setStep("wait");
      await signIn.start(made);
    } catch (e) {
      signIn.cancel();
      refused(e);
    } finally {
      setBusy(false);
    }
  };

  const retrySignIn = () => {
    if (!conn) return;
    signIn.prepare();
    setProblem(null);
    setStep("wait");
    void signIn.start(conn);
  };

  const cancelWait = () => {
    signIn.cancel();
    setNotice(CANCELLED);
    setStep("access");
  };

  const fields = keyFields;
  // The server's rule (`connectors._key_headers`): every required key, and at least one key.
  // Only what is filled in is sent: an optional field left empty is no header at all.
  const filled = fields.flatMap((f) => {
    const value = (keys[f.id] ?? "").trim();
    return value === "" ? [] : [[f.id, value] as const];
  });
  const keysFilled =
    filled.length > 0 && fields.every((f) => !f.required || filled.some(([id]) => id === f.id));
  const submitKey = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!keysFilled || busy) return;
    const credentials = Object.fromEntries(filled);
    setBusy(true);
    setKeyError(null);
    setNotice(null);
    try {
      const made = existing
        ? await updateConnection(existing.id, { credentials })
        : await createConnection({ key: entry?.key ?? "", access, credentials });
      afterConnected(made);
    } catch (err) {
      refused(err);
    } finally {
      setBusy(false);
    }
  };

  const manual = options?.manual ?? false;
  const scopeValue = picked.trim();
  const saveProject = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!conn || !options || scopeValue === "" || busy) return;
    const option = options.options.find((o) => o.value === scopeValue);
    const label = option
      ? `${option.label}${option.detail ? ` · ${option.detail}` : ""}`
      : scopeValue;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await updateConnection(conn.id, {
        scope: { value: scopeValue, label },
        ...(access !== conn.access ? { access } : {}),
      });
      // The PATCH keeps the stored tool list, and what a provider lists depends on the project
      // (and the access): list them again. The change stands if that fails.
      const listed = await checkConnection(saved.id).catch(() => saved);
      done(listed, mode === "project" ? "project" : "connected");
    } catch (err) {
      setNotice(serverWords(err, connectorRefusal(err)) ?? "Couldn’t save the project. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    // A request that is going would carry on behind a closed sheet: it closes once that answers.
    if (busy) return;
    signIn.cancel();
    // Left on the project step: the sign-in went through, so it is connected (to the whole
    // account). The page says so rather than quietly flipping a card.
    if (mode === "new" && conn?.status === "connected") return done(conn, "connected");
    onClose();
  };

  const canWrite = accessModes.includes("write");
  const choice = (hint: boolean) =>
    canWrite ? (
      <AccessChoice
        value={access}
        onChange={setAccess}
        hint={hint ? readOnlyHint(readOnlyBy) : undefined}
        disabled={busy}
      />
    ) : (
      <span className="cn-hint">{`${name} can only be connected read only.`}</span>
    );
  const unreviewed = !reviewed && (
    <Note kind="warn">
      From the MCP Registry, listed by its maker. Tvashtr hasn’t reviewed this server: check that{" "}
      <b>{host}</b> is the address you expect.
    </Note>
  );
  const alert = notice && (
    <div className="cn-error" role="alert">
      {notice}
    </div>
  );
  const cancelButton = (label: string, onClick: () => void) => (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={busy}>
      {label}
    </Button>
  );
  const steps = picker ? 3 : 2;

  // "By Supabase · signs in with your Supabase account"; a registry server leads with its name.
  const publisher = entry?.publisher ?? existing?.publisher;
  const maker =
    (entry?.featured ?? existing?.featured)
      ? publisher && `By ${publisher}`
      : (entry?.key ?? existing?.connector_key);
  const how = keyed ? "connects with an API key" : `signs in with your ${name} account`;
  let title = `Connect ${name}`;
  let subtitle = maker ? `${maker} · ${how}` : how;
  let body: ReactNode;
  let left: ReactNode = cancelButton("Cancel", close);
  let right: ReactNode;

  if (step === "problem" && problem) {
    body = (
      <Problem title={problem.title} onRetry={problem.retry ? retrySignIn : undefined}>
        {problem.body}
      </Problem>
    );
    left = cancelButton("Close", close);
    right = problem.tools && (
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<ChevronRight size={14} strokeWidth={1.6} aria-hidden />}
        onClick={() => {
          close();
          navigate({ page: "tools", view: "installed" });
        }}
      >
        Add it in Tools
      </Button>
    );
  } else if (step === "wait") {
    body = <SignInWait name={name} signIn={signIn} />;
    left = cancelButton("Cancel", mode === "new" ? cancelWait : close);
    right = mode === "new" && <span className="ds-sheet__foot-note">{`Step 2 of ${steps}`}</span>;
  } else if (step === "project") {
    const what = (options?.label ?? picker?.label ?? "Project").toLowerCase();
    body = (
      <form id={formId} className="cn-form" onSubmit={(e) => void saveProject(e)} noValidate>
        {mode === "new" && <Note kind="ok">{`Signed in to ${name}.`}</Note>}
        <div className="cn-ask">
          <span className="cn-ask__title">{`Which ${what} can agents use?`}</span>
          <span className="cn-ask__sub">
            {`Agents only see this one ${what}. You can change it later.`}
          </span>
        </div>
        {options === null ? (
          <p className="cn-hint" role="status">
            {`Loading your ${what}s…`}
          </p>
        ) : manual ? (
          <Input
            label={`${options.label} id`}
            autoComplete="off"
            spellCheck={false}
            mono
            value={picked}
            helper={`We couldn’t list your ${what}s. Enter the ${what}’s id from ${name}.`}
            onChange={(e) => setPicked(e.target.value)}
          />
        ) : (
          <fieldset className="cn-picks" aria-label={options.label}>
            {options.options.map((o) => (
              <label key={o.value} className="cn-pick">
                <input
                  type="radio"
                  name="cn-scope"
                  checked={picked === o.value}
                  onChange={() => setPicked(o.value)}
                />
                <span className="cn-pick__text">
                  <span className="cn-pick__name">{o.label}</span>
                  {o.detail && <span className="cn-pick__detail">{o.detail}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {mode === "new" && choice(false)}
        {alert}
      </form>
    );
    if (mode === "new") {
      left = (
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<ArrowLeft size={14} strokeWidth={1.6} aria-hidden />}
          disabled={busy}
          onClick={() => setStep("access")}
        >
          Back
        </Button>
      );
      subtitle = `Step ${steps} of ${steps} · pick a ${what}`;
    } else {
      title = `Change ${what}`;
      subtitle = `${name} · pick a ${what}`;
    }
    right = (
      <Button
        type="submit"
        form={formId}
        size="sm"
        disabled={options === null || scopeValue === ""}
        loading={busy}
      >
        {mode === "new" ? "Finish" : "Save"}
      </Button>
    );
  } else if (step === "key") {
    body = (
      <form id={formId} className="cn-form" onSubmit={(e) => void submitKey(e)} noValidate>
        {unreviewed}
        {fields.map((f, i) => (
          <Fragment key={f.id}>
            <Input
              label={f.label}
              type={f.secret ? "password" : "text"}
              autoComplete={f.secret ? "new-password" : "off"}
              spellCheck={false}
              value={keys[f.id] ?? ""}
              error={i === 0 ? (keyError ?? undefined) : undefined}
              onChange={(e) => {
                setKeys({ ...keys, [f.id]: e.target.value });
                setKeyError(null);
              }}
            />
            <span className="cn-hint cn-hint--field">
              {`${f.hint ? `${f.hint.replace(/\.$/, "")}. ` : ""}Sent to ${host} as its ${f.id} header.`}
            </span>
          </Fragment>
        ))}
        {!existing && choice(true)}
        <Note kind="lock">
          The key stays on Tvashtr’s servers, encrypted with this connector. Replace it from the
          connector’s page; it doesn’t show in Secrets.
        </Note>
        {alert}
      </form>
    );
    if (existing) title = `Replace ${name}’s key`;
    right = (
      // The form's submit button, from the footer: Enter in a field submits it too.
      <Button type="submit" form={formId} size="sm" disabled={!keysFilled} loading={busy}>
        {existing ? "Check and replace" : "Check and connect"}
      </Button>
    );
  } else {
    const signedIn = mode === "new" && conn?.status === "connected";
    // Same site as the connector (a sign-in that moved within it): said plainly, no warning.
    const whereNote =
      otherSite &&
      (conn && !conn.signin_host_differs ? (
        <Note kind="info">
          You’ll sign in at <b>{otherSite}</b>.
        </Note>
      ) : (
        <Note kind="warn">
          You’ll sign in at <b>{otherSite}</b>, a different site from {host}. Only continue if you
          know it.
        </Note>
      ));
    body = (
      <>
        {mode === "new" ? (
          <>
            {unreviewed}
            {entry && (
              <AccessAllows
                connectorKey={entry.key}
                fallback={entry.description && <p className="cn-lead">{entry.description}</p>}
              />
            )}
            {whereNote}
            {!reviewed && entry?.auth !== "none" && <OwnSignInNote name={name} />}
            {choice(true)}
          </>
        ) : (
          <>
            <p className="cn-lead">
              {`Sign in to ${name} again. The agents that use it keep their access.`}
            </p>
            {whereNote}
          </>
        )}
        <SignInStaysNote />
        {alert}
      </>
    );
    right = (
      <Button
        size="sm"
        iconLeft={signedIn ? undefined : <ExternalLink size={14} strokeWidth={1.6} aria-hidden />}
        loading={busy}
        onClick={() => void toProvider()}
      >
        {signedIn ? "Continue" : `Continue to ${otherSite ?? name}`}
      </Button>
    );
  }
  if (mode === "signin" && !keyed) title = `Sign in to ${name}`;

  return (
    <Sheet
      open
      title={title}
      subtitle={subtitle}
      icon={
        <ConnectorTile
          connectorKey={entry?.key ?? existing?.connector_key ?? ""}
          name={name}
          size="md"
        />
      }
      onClose={close}
      width={540}
      footerNote={left}
      footer={right || undefined}
    >
      {body}
    </Sheet>
  );
}
