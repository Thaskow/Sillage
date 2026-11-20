import { invoke } from "@tauri-apps/api/core";

export type ChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "untracked"
  | "conflicted";

export interface FileChange {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  staged: boolean;
  unstaged: boolean;
}

export type ChangesReport =
  | {
      status: "ok";
      root: string;
      branch: string | null;
      files: FileChange[];
      truncated: boolean;
    }
  | { status: "notRepo"; cwd: string }
  | { status: "noGit" }
  | { status: "noCwd"; cwd: string };

export interface FileDiff {
  path: string;
  text: string;
  truncated: boolean;
  binary: boolean;
}

export const changesIpc = {
  status: (id: string) => invoke<ChangesReport>("session_changes", { id }),
  diff: (id: string, path: string) =>
    invoke<FileDiff>("session_diff", { id, path }),
};
