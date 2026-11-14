import { compileFile, checkFile } from "./dist/frontend/compile-ts.mjs";
import resources from "./dist/resources.mjs";
import { portablePath as path } from "./dist/frontend/portable-path.mjs";

const json = value => (typeof value === "string" ? value : JSON.stringify(value));
const projectName = entry => entry.replaceAll("\\", "/").split("/").pop().replace(/\.[^.]+$/, "").replace(/\.nk$/, "");

// In-memory files keyed by POSIX path. Declaration files the type checker
// asks for come from the bundled resources.
function memoryHost(files) {
  const entries = files instanceof Map ? files.entries() : Object.entries(files ?? {});
  const memory = new Map(Array.from(entries, ([name, text]) => [path.resolve(name), text]));
  return {
    readFile(name) {
      const normalized = path.resolve(name.replace(/^[A-Za-z]:/, ""));
      if (memory.has(normalized)) return memory.get(normalized);
      const base = normalized.slice(normalized.lastIndexOf("/") + 1);
      return base === "nekoc.d.ts" || /^lib\..*\.d\.ts$/.test(base) ? resources[base] : undefined;
    },
  };
}

export function api(wasm) {
  const assemble = (report, entry, template) =>
    wasm.assembleBcmkn(JSON.stringify(report), projectName(entry), template === undefined ? undefined : json(template));
  return {
    /** Compiles `entry` (and its relative imports from `files`) to a .bcmkn project. */
    compile(entry, { files, template } = {}) {
      const report = compileFile(path.resolve(entry), memoryHost(files));
      return { bcmkn: JSON.parse(assemble(report, entry, template)), report };
    },
    /** Same diagnostics as `nekoc check --json`: types, compat and project checks. */
    check(entry, { files, template, types = true } = {}) {
      const file = path.resolve(entry);
      const { diagnostics, report } = checkFile(file, { types, host: memoryHost(files) });
      if (report) diagnostics.push(...JSON.parse(wasm.projectDiagnostics(assemble(report, entry, template), file)));
      return { ok: !diagnostics.some(d => d.severity === "error"), diagnostics };
    },
    importProject: project => JSON.parse(wasm.importProject(json(project))),
    validate: project => JSON.parse(wasm.validate(json(project))),
    /** Player backend: `handle()` takes the same frame requests as the WebSocket player. */
    createPlayer(project) {
      const player = new wasm.Player(json(project));
      let freed = false;
      const alive = () => { if (freed) throw new Error("Player has been freed"); };
      return {
        ready: () => { alive(); return player.ready(); },
        handle: request => { alive(); return player.handle(json(request)); },
        free: () => { if (!freed) { freed = true; player.free(); } },
      };
    },
  };
}
