#!/usr/bin/env node
// Compact, hash-bound observations only; official source stays in dist.
import fs from "node:fs/promises";
const read = async name => JSON.parse(await fs.readFile(name, "utf8"));
const report = await read("dist/kn-project-progress/report.json");
const settled = await read("dist/kn-project-progress/settled-report.json");
const compat = await read("dist/kn-project-progress/editor-compat.json");
const source = await read("dist/kn-project-progress/source-locations.json");
const timers = await read("dist/kn-async-services/report.json");
const diagnostic = await read("dist/kn-project-progress/short-world-report.json");
const diagnosticCompat = await read("dist/kn-project-progress/short-world-editor-compat.json");
if (![report, compat, timers, diagnostic, diagnosticCompat].every(r => r.ok === true)) throw new Error("Missing successful official run");
if (settled.cases.fangjie.failure && !settled.cases.fangjie.failure.includes("Timeout 300000ms")) throw new Error("Unexpected original fangjie failure");
const compactSample = sample => ({ label: sample.label, at: sample.at, running: sample.running,
  variables: Object.fromEntries(Object.entries(sample.variables).filter(([id]) => !/logits/.test(id))),
  actors: sample.actors.map(({ id, logicalPosition, position, visible }) => ({ id, logicalPosition, position, visible })) });
const evidence = { schema: "nekoc-kn-project-progress-official-v1", checkedAt: settled.checkedAt,
  editorUrl: report.editorUrl, browserVersion: report.browserVersion, method: report.method,
  bundles: report.cases.fangjie.bundles.filter(b => /^(main\.|crc_libs\.)/.test(b.name)),
  sourceLocations: source.sources.map(({ excerpt, charOffset: _, ...entry }) => ({ ...entry, excerptCharacters: excerpt.length })),
  editorCompat: compat, cases: {},
  timers: { checkedAt: timers.checkedAt, fixture: timers.fixture, checks: timers.checks,
    workspaceImport: timers.editor.workspaceImport, variables: timers.projectTimer.variables,
    domainCalls: timers.projectTimer.domainCalls, nativeCalls: timers.projectTimer.nativeCalls.map(({ callbackSource, ...entry }) => ({ ...entry, isEmptyFunction: /^function\s*\(\)\s*\{\}$/.test(callbackSource) })),
    pageErrors: timers.pageErrors },
  limitations: ["Wall-clock samples are not frame counts or equal-work comparisons.", "No local engine execution, cargo, build or benchmark.", "Official default warp config is source evidence, not proof of final config in every editor mode.", "Only original unmodified native projects, no synthesized input; no full pixel/task/input parity claim."] };
for (const [name, result] of Object.entries(report.cases)) {
  const final = settled.cases[name];
  if (result.sha256 !== final.sha256 || !compat.projects.some(p => p.sha256 === result.sha256 && p.ok && !p.issues.length && !p.pageErrors.length)) throw new Error(`Unpaired editor check: ${name}`);
  evidence.cases[name] = { fixture: result.fixture, sha256: result.sha256, pageErrors: result.pageErrors,
    samples: result.samples.map(compactSample),
    ...(final.failure ? { settleFailure: final.failure, lastSettleSample: compactSample(final.samples.at(-1)) } : { settled: compactSample(final.samples.at(-1)) }),
    settledPageErrors: final.pageErrors };
}
const short = diagnostic.cases.fangjie;
if (!diagnosticCompat.projects.some(p => p.sha256 === short.sha256 && p.ok)) throw new Error("Diagnostic editor check missing");
evidence.diagnostic = { fixture: short.fixture, sha256: short.sha256, originalFixture: short.originalFixture,
  originalSha256: short.originalSha256, diagnosticChange: short.diagnosticChange, editorCompat: diagnosticCompat,
  pageErrors: short.pageErrors, settled: compactSample(short.samples.at(-1)), runtimeConfig: short.runtimeInspection.config };
await fs.writeFile("docs/kn-project-progress-official.json", JSON.stringify(evidence, null, 2) + "\n");
console.log("Archived successful, hash-bound official observations");
