import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff as FileDiffIcon, GitBranch, RotateCw, X } from "lucide-react";
import { cx } from "@/lib/cx";
import { errorMessage, type SessionDef } from "@/lib/ipc";
import { IconButton } from "@/design-system/primitives";
import { useSessions } from "@/features/sessions/store";
import {
  changesIpc,
  type ChangesReport,
  type FileChange,
  type FileDiff,
} from "./ipc";
import { kindInfo, parseDiff, splitPath, type DiffLine } from "./diff";
import { useChangesUi } from "./store";

const kindColor: Record<FileChange["kind"], string> = {
  modified: "text-wait",
  added: "text-ok",
  untracked: "text-ok",
  deleted: "text-err",
  conflicted: "text-err",
  renamed: "text-accent",
  copied: "text-accent",
  typeChanged: "text-wait",
};

export function ChangesPanel({ session }: { session: SessionDef }) {
  const id = session.id;
  const close = useChangesUi((s) => s.setOpen);
  const activity = useSessions((s) => s.runtime[id]?.activity);
  const runState = useSessions((s) => s.runtime[id]?.state);
  const [report, setReport] = useState<ChangesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const seq = useRef(0);
  const diffSeq = useRef(0);
  const lastActivity = useRef({ activity, runState });
  const selectedRef = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadDiff = useCallback(
    async (path: string, n: number) => {
      try {
        const d = await changesIpc.diff(id, path);
        if (n !== diffSeq.current) return;
        setDiff(d);
        setDiffError(null);
      } catch (e) {
        if (n !== diffSeq.current) return;
        setDiff(null);
        setDiffError(errorMessage(e));
      }
    },
    [id],
  );

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await changesIpc.status(id);
      if (n !== seq.current) return;
      setReport(r);
      setError(null);
      const sel = selectedRef.current;
      if (sel && r.status === "ok" && r.files.some((f) => f.path === sel)) {
        await loadDiff(sel, ++diffSeq.current);
      } else if (sel) {
        selectedRef.current = null;
        setSelected(null);
        setDiff(null);
        setDiffError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [id, loadDiff]);

  const select = (path: string) => {
    selectedRef.current = path;
    setSelected(path);
    setDiff(null);
    setDiffError(null);
    void loadDiff(path, ++diffSeq.current);
  };

  useEffect(() => {
    selectedRef.current = null;
    setSelected(null);
    setReport(null);
    setDiff(null);
    setError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const prev = lastActivity.current;
    lastActivity.current = { activity, runState };
    if (
      (activity === "done" && prev.activity !== "done") ||
      (runState === "exited" && prev.runState !== "exited")
    )
      void refresh();
  }, [activity, runState, refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const files = report?.status === "ok" ? report.files : [];

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (!files.length) return;
    const i = files.findIndex((f) => f.path === selected);
    const next =
      e.key === "ArrowDown"
        ? Math.min(files.length - 1, i + 1)
        : Math.max(0, i < 0 ? 0 : i - 1);
    const f = files[next]!;
    select(f.path);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)
      ?.focus();
  };

  return (
    <aside
      aria-label="Modifications"
      className="flex h-full w-[420px] max-w-[45%] shrink-0 flex-col border-l border-line bg-surface"
    >
      <header className="flex h-[var(--row)] shrink-0 items-center gap-2 border-b border-line pr-1 pl-3">
        <FileDiffIcon size={13} className="text-fg-3" />
        <h2 className="text-[12.5px] font-medium">Modifications</h2>
        {report?.status === "ok" && report.branch && (
          <span className="flex min-w-0 items-center gap-1 truncate text-[var(--fs-sm)] text-fg-3">
            <GitBranch size={11} />
            <span className="truncate">{report.branch}</span>
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-[var(--fs-sm)] text-fg-3">
          {session.title}
        </span>
        <IconButton
          label="Actualiser"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RotateCw size={13} className={cx(loading && "animate-spin")} />
        </IconButton>
        <IconButton
          label="Fermer les modifications"
          shortcut="Ctrl Maj G"
          size="sm"
          onClick={() => close(false)}
        >
          <X size={14} />
        </IconButton>
      </header>

      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !report ? (
        <Notice>Lecture des modifications…</Notice>
      ) : report.status === "noGit" ? (
        <Notice>
          Git est introuvable sur cette machine. Installez Git pour Windows pour
          voir les modifications.
        </Notice>
      ) : report.status === "noCwd" ? (
        <Notice>Le dossier de travail « {report.cwd} » n'existe pas.</Notice>
      ) : report.status === "notRepo" ? (
        <Notice>
          Le dossier « {report.cwd} » n'est pas un dépôt git : aucune
          modification à suivre.
        </Notice>
      ) : !files.length ? (
        <Notice>Aucune modification dans {report.root}.</Notice>
      ) : (
        <>
          <ul
            ref={listRef}
            aria-label="Fichiers modifiés"
            onKeyDown={onListKey}
            className="max-h-[40%] shrink-0 overflow-auto border-b border-line py-1"
          >
            {files.map((f, i) => (
              <FileRow
                key={f.path}
                file={f}
                index={i}
                active={f.path === selected}
                onSelect={() => select(f.path)}
              />
            ))}
            {report.truncated && (
              <li className="px-3 py-1 text-[var(--fs-sm)] text-fg-3">
                Liste tronquée : trop de fichiers.
              </li>
            )}
          </ul>
          <DiffView path={selected} diff={diff} error={diffError} />
        </>
      )}
    </aside>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "px-4 py-6 text-center text-[var(--fs-sm)]",
        tone === "error" ? "text-err" : "text-fg-3",
      )}
    >
      {children}
    </p>
  );
}

function FileRow({
  file,
  index,
  active,
  onSelect,
}: {
  file: FileChange;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { dir, name } = splitPath(file.path);
  const info = kindInfo[file.kind];
  return (
    <li>
      <button
        data-index={index}
        aria-current={active || undefined}
        onClick={onSelect}
        title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        className={cx(
          "transition-quick flex w-full items-center gap-2 px-3 py-[3px] text-left text-[12.5px] hover:bg-hover",
          active && "bg-active",
        )}
      >
        <span
          aria-label={info.label}
          title={info.label}
          className={cx(
            "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
            kindColor[file.kind],
          )}
        >
          {info.letter}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className={cx(file.kind === "deleted" && "line-through")}>
            {name}
          </span>
          {dir && <span className="ml-1.5 text-fg-3">{dir}</span>}
        </span>
      </button>
    </li>
  );
}

const lineClass: Record<DiffLine["kind"], string> = {
  add: "bg-ok/12 text-fg",
  del: "bg-err/12 text-fg",
  ctx: "text-fg-2",
  hunk: "bg-sunken text-accent",
  meta: "text-fg-3",
};

const sign: Record<DiffLine["kind"], string> = {
  add: "+",
  del: "-",
  ctx: " ",
  hunk: "",
  meta: "",
};

function DiffView({
  path,
  diff,
  error,
}: {
  path: string | null;
  diff: FileDiff | null;
  error: string | null;
}) {
  const parsed = useMemo(() => (diff ? parseDiff(diff.text) : null), [diff]);
  if (!path)
    return (
      <Notice>Sélectionnez un fichier pour afficher ses changements.</Notice>
    );
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!diff || !parsed) return <Notice>Chargement du diff…</Notice>;
  return (
    <section
      aria-label={`Diff de ${path}`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-3 text-[var(--fs-sm)]">
        <span className="min-w-0 flex-1 truncate text-fg-2">{path}</span>
        <span className="text-ok">+{parsed.added}</span>
        <span className="text-err">−{parsed.removed}</span>
      </div>
      {diff.binary ? (
        <Notice>Fichier binaire : aperçu indisponible.</Notice>
      ) : !parsed.lines.length ? (
        <Notice>Aucune différence de contenu.</Notice>
      ) : (
        <div
          tabIndex={0}
          aria-label="Contenu du diff"
          className="min-h-0 flex-1 overflow-auto bg-[var(--terminal-bg)] py-1 font-mono text-[11.5px] leading-[1.55]"
        >
          <table className="w-max min-w-full border-collapse">
            <tbody>
              {parsed.lines.map((l, i) => (
                <tr key={i} className={lineClass[l.kind]}>
                  <td className="w-9 pr-1 pl-2 text-right text-fg-3 select-none">
                    {l.oldNo ?? ""}
                  </td>
                  <td className="w-9 pr-2 text-right text-fg-3 select-none">
                    {l.newNo ?? ""}
                  </td>
                  <td className="pr-3 whitespace-pre">
                    <span className="select-none text-fg-3">
                      {sign[l.kind]}
                    </span>
                    {l.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {diff.truncated && (
            <p className="px-3 py-2 font-sans text-[var(--fs-sm)] text-fg-3">
              Diff tronqué : fichier trop volumineux.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
