/**
 * "Custom connector" (CnF-Custom-1..3, CnF-Prob-3): any remote MCP server that signs in with
 * OAuth. A name and an address → "Check the server" (the server runs sign-in discovery) → the
 * site you'll sign in at, flagged when it isn't the server's own → the provider's window, as in
 * the connect sheet. A server with no sign-in, or one Tvashtr can't register with, is sent to
 * Tools.
 */
import { ChevronRight, ExternalLink } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button, Input, Sheet, useToast } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import {
  type Connection,
  type ConnectorAccess,
  connectorRefusal,
  createConnection,
  updateConnection,
} from "../../lib/api/connectors";
import { navigate } from "../../lib/nav";
import {
  AccessChoice,
  Note,
  OwnSignInNote,
  Problem,
  SignInStaysNote,
  SignInWait,
} from "./connectParts";
import { firstSentence } from "./connectorFormat";
import { type SignInOutcome, useAlive, useConnectSignIn } from "./useConnectSignIn";

/** Why the server can't be connected here, or the provider's refusal (`failed`). */
type Trouble =
  | { kind: "no_signin"; message: string }
  | { kind: "cannot_register" }
  | { kind: "failed"; message: string };

export function CustomConnectorSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (connection: Connection) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  // The checked server: a pending connection that knows where its sign-in is.
  const [conn, setConn] = useState<Connection | null>(null);
  const [access, setAccess] = useState<ConnectorAccess>("read");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const label = name.trim();
  const toast = useToast();
  // A sheet that is gone reports nothing: the page that opened it may be gone too.
  const alive = useAlive();
  const done = (connection: Connection) => {
    if (alive.current) onDone(connection);
  };

  const onOutcome = async (outcome: SignInOutcome) => {
    // Connected: the wait panel stays up while the name and the access are saved.
    if (outcome.kind !== "connected") setWaiting(false);
    if (outcome.kind === "connected") {
      let made: Connection = outcome.connection;
      // The row was made at the check, before the access was chosen (and the name, if it
      // couldn't be saved before the sign-in).
      if (made.name !== label) {
        // A refused name keeps the one it was checked with.
        made = await updateConnection(made.id, { name: label }).catch(() => made);
      }
      if (access === "write") {
        try {
          made = await updateConnection(made.id, { access });
        } catch {
          toast({
            message: `${made.name} is connected read only. Tvashtr couldn’t switch it to read & write: change that on its page.`,
            tone: "error",
          });
        }
      }
      return done(made);
    }
    // The sign-in isn't where the check found it: the form shows the site it is at now, and the
    // next click opens it.
    if (outcome.kind === "moved") return setConn(outcome.connection);
    if (outcome.kind === "failed") return setTrouble({ kind: "failed", message: outcome.message });
    if (outcome.kind === "refused" && outcome.refusal?.code === "cannot_register") {
      return setTrouble({ kind: "cannot_register" });
    }
    if (outcome.kind === "gone") {
      // The row this sheet made is no more: back to the first step, which makes it again.
      setConn(null);
      return setUrlError(
        `${label} was removed before the sign-in finished. Check the server again.`,
      );
    }
    setNotice(
      outcome.kind === "timeout"
        ? "The sign-in wasn’t finished in time. Try again."
        : (outcome.refusal?.message ?? "Tvashtr couldn’t open the sign-in page. Try again."),
    );
  };
  const signIn = useConnectSignIn((outcome) => void onOutcome(outcome));

  const editUrl = (value: string) => {
    setUrl(value);
    // Another address is another server: check it again. (The name is only a name.)
    setConn(null);
    setUrlError(null);
    setNotice(null);
    setTrouble(null);
  };

  const check = async (e?: FormEvent) => {
    e?.preventDefault();
    // A checked server isn't checked again by Enter in a field.
    if (!label || !url.trim() || busy || conn) return;
    setBusy(true);
    setUrlError(null);
    setNotice(null);
    setTrouble(null);
    try {
      const made = await createConnection({ url: url.trim(), name: label, access: "read" });
      if (made.status === "connected") return done(made);
      setConn(made);
    } catch (err) {
      const refusal = connectorRefusal(err);
      if (refusal?.code === "no_signin")
        setTrouble({ kind: "no_signin", message: refusal.message });
      else if (refusal?.code === "cannot_register") setTrouble({ kind: "cannot_register" });
      else if (refusal) setUrlError(refusal.message);
      else {
        const words = err instanceof ApiDetailError && err.status < 500 ? err.message : "";
        setUrlError(words || "Couldn’t check the server. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  /** "Continue to <site>" and "Try again": in the click, so the popup isn't blocked. */
  const toProvider = async () => {
    if (!conn || !label || busy) return;
    signIn.prepare();
    setNotice(null);
    setTrouble(null);
    setWaiting(true);
    let named = conn;
    if (conn.name !== label) {
      // The row was made at the check, before the name was final. Until it is connected the
      // server takes its slug (the prefix of its tools' names) from its name, so the last name
      // goes in now. One that can't be saved is sent again after the sign-in.
      setBusy(true);
      named = await updateConnection(conn.id, { name: label }).catch(() => conn);
      setBusy(false);
      setConn(named);
    }
    void signIn.start(named);
  };

  const close = () => {
    // The check would carry on behind a closed sheet: it closes once that answers.
    if (busy) return;
    signIn.cancel();
    onClose();
  };
  const toTools = () => {
    close();
    navigate({ page: "tools", view: "installed" });
  };
  const addInTools = (variant: "primary" | "secondary") => (
    <Button
      variant={variant}
      size="sm"
      iconLeft={<ChevronRight size={14} strokeWidth={1.6} aria-hidden />}
      onClick={toTools}
    >
      Add it in Tools
    </Button>
  );

  const fields = (
    <>
      <Input
        label="Name"
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        label="Server address"
        type="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://mcp.example.com/mcp"
        value={url}
        error={urlError ?? undefined}
        // The check's answer is about the address that was sent.
        disabled={busy}
        onChange={(e) => editUrl(e.target.value)}
      />
    </>
  );

  let body: ReactNode;
  let primary: ReactNode;
  let onCancel = close;
  if (waiting) {
    body = <SignInWait name={label} signIn={signIn} />;
    primary = null;
    onCancel = () => {
      signIn.cancel();
      setWaiting(false);
      setNotice("Sign-in cancelled. Nothing was connected.");
    };
  } else if (trouble?.kind === "failed") {
    body = (
      <Problem title={firstSentence(trouble.message)} onRetry={() => void toProvider()}>
        {`Nothing was connected. Try again when you’re ready; you can pick a different ${label} account in the window.`}
      </Problem>
    );
    primary = null;
  } else {
    const site = conn ? (conn.signin_host ?? conn.host) : "";
    body = (
      // One form in every state: the field being typed in is never remounted (and keeps focus).
      <form className="cn-form" onSubmit={(e) => void check(e)} noValidate>
        {fields}
        {trouble ? (
          <Note kind="warn" role="alert">
            {trouble.kind === "no_signin" ? (
              `${trouble.message} Its tools then work the same way.`
            ) : (
              <>
                <b>{label}</b> needs an app registered with it before Tvashtr can sign in, and it
                doesn’t let Tvashtr register by itself. Ask its maker, or add it in Tools if it also
                takes a key.
              </>
            )}
          </Note>
        ) : conn ? (
          <>
            {conn.signin_host_differs ? (
              <Note kind="warn">
                You’ll sign in at <b>{site}</b>, a different site from {conn.host}. Only continue if
                you know it.
              </Note>
            ) : (
              <Note kind="info">
                You’ll sign in at <b>{site}</b>.
              </Note>
            )}
            <OwnSignInNote name={label || "this server"} />
            <AccessChoice
              value={access}
              onChange={setAccess}
              hint="Read only lets agents call only the tools the server marks as read-only. A tool the server doesn’t mark counts as a write."
            />
            <SignInStaysNote />
            {notice && (
              <div className="cn-error" role="alert">
                {notice}
              </div>
            )}
          </>
        ) : (
          <Note kind="info">
            For remote MCP servers that sign in with OAuth, like everything in Browse. A server that
            takes a key in a header, or runs as a local command, goes in <b>Tools</b>.
          </Note>
        )}
      </form>
    );
    primary = trouble ? (
      addInTools(trouble.kind === "no_signin" ? "primary" : "secondary")
    ) : conn ? (
      <Button
        size="sm"
        iconLeft={<ExternalLink size={14} strokeWidth={1.6} aria-hidden />}
        disabled={!label}
        onClick={() => void toProvider()}
      >
        {`Continue to ${site}`}
      </Button>
    ) : (
      <Button
        size="sm"
        disabled={!label || !url.trim()}
        loading={busy}
        onClick={() => void check()}
      >
        Check the server
      </Button>
    );
  }

  return (
    <Sheet
      open
      title="Custom connector"
      subtitle="Any remote MCP server that signs in"
      onClose={close}
      width={540}
      footerNote={
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {trouble?.kind === "failed" ? "Close" : "Cancel"}
        </Button>
      }
      footer={primary || undefined}
    >
      {body}
    </Sheet>
  );
}
