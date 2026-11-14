export interface Diagnostic {
  severity: "error" | "warning";
  source: string;
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}
export type Project = Record<string, unknown>;
export interface CompileOptions {
  /** Source files by path; the entry and every relative import must be here. */
  files: Record<string, string> | Map<string, string>;
  /** Template work; defaults to the bundled empty Kitten N work. */
  template?: string | Project;
}
export interface CheckOptions extends CompileOptions {
  /** Type check against nekoc.d.ts (default true). */
  types?: boolean;
}
export function compile(entry: string, options: CompileOptions): { bcmkn: Project; report: Record<string, unknown> };
/** Same diagnostics as `nekoc check --json`. */
export function check(entry: string, options: CheckOptions): { ok: boolean; diagnostics: Diagnostic[] };
export function importProject(project: string | Project): { project: Project; report: Record<string, unknown> };
export function validate(project: string | Project): { ok: boolean; issues: unknown[] };
export interface Player {
  ready(): string;
  handle(text: string | Record<string, unknown>): Uint8Array | string;
  free(): void;
}
export function createPlayer(project: string | Project): Player;
