// Repository-owned synthetic KN workspaces, compiled with our native block
// generator. No HateNeko work, runtime, or external corpus is embedded.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const compile = promisify(execFile);
const increment = 'setVar("log", getVar("log") + 1);';
// Match the per-iteration work and batch sizes in fixtures.mjs. The outer
// forever yields between batches; only the individual batch runs in warp.
const sources = {
  numeric: 'repeatTimes(4000, () => { setVar("log", (getVar("log") + 1) * 0.999); });',
  list: `deleteListItem("result", "all", 1);
    repeatTimes(1000, () => {
      appendList("result", getVar("log"));
      setVar("log", listIndexOf("result", -1));
      ${increment}
    });`,
  string: 'setVar("log", ""); repeatTimes(2000, () => { setVar("log", join(getVar("log"), "abcdefgh")); });',
  clones: 'repeatTimes(200, () => { clone(); });',
  broadcast: 'repeatTimes(100, () => { broadcast("bench"); });',
  recursion: 'setVar("depth", 0); repeatTimes(40, () => { callProc("recur"); });',
  pen: `penDown(); repeatTimes(4000, () => { moveTo(getVar("log"), 0); ${increment} });`,
};

// Same graph-to-tree representation used by src/bcmkn_compiler.rs. Keep all
// generator metadata (mutations, shadows, output flags, and stable param ids).
function blocksFromWorkspace({ blocks, connections }) {
  const childIds = new Set(Object.values(connections).flatMap(children => Object.keys(children)));
  function nest(id, parent = "") {
    const block = { ...blocks[id], parent_id: parent, shield: false };
    for (const [child, edge] of Object.entries(connections[id] ?? {})) {
      if (edge.type === "next") block.next = nest(child, id);
      else {
        const slot = edge.input_type === "statement" ? "statements" : "inputs";
        (block[slot] ??= {})[edge.input_name] = nest(child, id);
      }
    }
    return block;
  }
  return Object.keys(blocks).filter(id => !childIds.has(id) && !blocks[id].parent_id).sort().map(id => nest(id));
}

function source(name, body) {
  let code = `onStart(() => { forever(() => { warp(() => { ${body} }); }); });\n`;
  if (name === "clones") {
    // The generator exposes clone/deleteClone but not the clone event. Compile
    // the handler body normally, then change only its event hat when assembling.
    code += 'onStart(() => { deleteClone(); });\n';
  }
  if (name === "broadcast") code += `onMessage("bench", () => { ${increment} });\n`.repeat(12);
  if (name === "recursion") code += `defineProc("recur", [], () => {
    setVar("depth", getVar("depth") + 1);
    ${increment}
    if (getVar("depth") < 20) callProc("recur");
    setVar("depth", getVar("depth") - 1);
  });\n`;
  return code;
}

export async function fixtures() {
  const template = JSON.parse(await readFile(new URL("../../samples/kitten-n-0.27.4.bcmkn", import.meta.url), "utf8"));
  const scratchParent = path.join(root, "dist", "bench");
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchParent, "kn-fixtures-"));
  try {
    const projects = {};
    for (const [name, body] of Object.entries(sources)) {
      const input = path.join(scratch, `${name}.ts`), output = path.join(scratch, `${name}.json`);
      await writeFile(input, source(name, body));
      await compile(process.execPath, [path.join(root, "ts", "compile-ts.mjs"), input, output], { cwd: root });
      const report = JSON.parse(await readFile(output, "utf8"));
      const project = structuredClone(template);
      const scene = project.scenes.currentSceneId;
      const actor = Object.values(project.actors.actorsDict)[0];
      const roots = blocksFromWorkspace(report.workspaceData);
      if (name === "clones") {
        const handler = roots.find(block => block.next?.type === "dispose_clone");
        handler.type = "start_as_a_mirror";
        handler.statements = { DO: handler.next };
        delete handler.next;
      }
      roots.forEach((block, i) => { block.location = [80 + i * 320, 120]; });
      project.projectName = `NekoC performance KN ${name}`;
      actor.sceneId = scene;
      actor.nekoBlockJsonList = roots;
      project.variables.variablesDict = Object.fromEntries(Object.entries({ log: 0, result: [], depth: 0 }).map(([id, value]) => [id, {
        id, name: id, value, type: Array.isArray(value) ? "list" : "any", isGlobal: true,
        currentEntityId: actor.id, visible: false, position: { x: 0, y: 0 },
      }]));
      project.broadcasts.broadcastsDict[scene] = name === "broadcast" ? ["bench"] : [];
      project.procedures.proceduresDict = Object.fromEntries(report.procedures.map(procedure => [procedure.id, {
        id: procedure.id, name: procedure.name, type: procedure.type, params: procedure.params,
        nekoBlockJsonList: blocksFromWorkspace(procedure.workspaceData),
        workspaceScrollXy: { x: 100, y: 50 }, comments: {},
      }]));
      projects[name] = project;
    }
    return projects;
  } finally {
    // This is our own mkdtemp directory, never the caller's output directory.
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function writeKnFixtures(directory) {
  await mkdir(directory, { recursive: true });
  const paths = [];
  for (const [name, project] of Object.entries(await fixtures())) {
    const file = path.join(directory, `${name}.bcmkn`);
    await writeFile(file, JSON.stringify(project, null, 2) + "\n");
    paths.push(file);
  }
  return paths;
}
