"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GovernanceApiError } from "../../../../src/api-client";
import { describeError } from "../_lib/presentation";

/** Badge for any controlled-vocabulary value. The text is always shown; color only supplements it (§57, §59). */
export function StatusBadge({ value, kind = "status" }: { value: string; kind?: string }) {
  return (
    <span className={`gov-badge gov-badge--${value.toLowerCase().replace(/_/g, "-")}`} data-kind={kind} data-testid={`badge-${kind}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="gov-loading" role="status" aria-live="polite">
      {label}
    </p>
  );
}

/** Renders an API/domain error with readable copy AND its domain code (§42, §52). */
export function ErrorPanel({ error, onRetry, title = "Request failed" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const code = error instanceof GovernanceApiError ? error.code : "UNEXPECTED_ERROR";
  const message = error instanceof GovernanceApiError ? describeError(error.code, error.message) : "Something unexpected happened.";
  return (
    <div className="gov-error" role="alert" data-testid="error-panel" data-error-code={code}>
      <strong>{title}</strong>
      <p>{message}</p>
      <p className="gov-muted">
        Code: <code data-testid="error-code">{code}</code>
        {error instanceof GovernanceApiError && error.field ? (
          <>
            {" "}
            · Field: <code>{error.field}</code>
          </>
        ) : null}
      </p>
      {onRetry ? (
        <button type="button" className="gov-button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * A loaded resource with retry. State lives in the URL-addressed page; this only fetches (§46, §52). Loading is
 * DERIVED (the settled result belongs to an older request key) rather than set synchronously in an effect.
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [nonce, setNonce] = useState(0);
  const requestKey = `${key}#${nonce}`;
  const [settled, setSettled] = useState<{ key: string; data?: T; error?: unknown }>({ key: "" });
  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setSettled({ key: requestKey, data });
      },
      (error: unknown) => {
        if (!cancelled) setSettled((prev) => ({ key: requestKey, data: prev.data, error }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey]);
  const loading = settled.key !== requestKey;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: settled.data, error: loading ? undefined : settled.error, loading, reload };
}

/** Renders loading / error / content for a resource. */
export function Resource<T>({ state, children }: { state: { data?: T; error?: unknown; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (state.error !== undefined) return <ErrorPanel error={state.error} onRetry={state.reload} />;
  if (state.loading && state.data === undefined) return <Loading />;
  return <>{children(state.data as T)}</>;
}

/** Secondary, copyable UUID metadata (§49). */
export function IdLine({ label = "ID", id }: { label?: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="gov-id">
      {label}: <code>{id}</code>{" "}
      <button
        type="button"
        className="gov-link-button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(id).then(() => setCopied(true), () => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** Communicates that a record is history, not an editable form (§61). */
export function ImmutableNote({ children = "Immutable snapshot — this historical record cannot be edited." }: { children?: ReactNode }) {
  return <p className="gov-immutable">{children}</p>;
}

export function EmptyNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="gov-empty">
      <p className="gov-empty__title">{title}</p>
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="gov-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? (
        <p className="gov-muted" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="gov-field__error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Accessible confirmation dialog (§11, §41, §57): native <dialog> (focus trap + Escape), focus moves to the
 * confirm button on open and back to the trigger on close.
 */
export function ConfirmButton({
  label,
  confirm,
  details,
  tone = "primary",
  onConfirm,
  confirmLabel,
}: {
  label: string;
  confirm: string;
  details?: ReactNode;
  tone?: "primary" | "consequential";
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  return (
    <>
      <button ref={trigger} type="button" className={`gov-button gov-button--${tone}`} onClick={() => {
        dialog.current?.showModal();
        confirmRef.current?.focus();
      }}>
        {label}
      </button>
      <dialog ref={dialog} className="gov-dialog" aria-label={label} onClose={() => trigger.current?.focus()}>
        <h2>{label}</h2>
        <p>{confirm}</p>
        {details}
        <div className="gov-actions">
          <button type="button" className="gov-button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`gov-button gov-button--${tone}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
                close();
              }
            }}
          >
            {confirmLabel ?? `Confirm: ${label}`}
          </button>
        </div>
      </dialog>
    </>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="gov-crumbs">
      <ol>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`}>
            {item.href && i < items.length - 1 ? <Link href={item.href}>{item.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Warns before leaving a page with meaningful unsaved form state (§54). */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
