#!/usr/bin/env node
// Original diagnostic: CDP pauses the unmodified external kernel, reads scopes,
// then resumes it. No function replacement, capability override or vendor copy.
import { createHash } from "node:crypto";
import { physicsSoftBlockedFixture, physicsSoftFixtures } from "./k4-partial-physics-9-fixtures.mjs";
import { runOracle, saveJson } from "./k4-oracle.mjs";

const variant = process.argv[2] || "rectangle";
const project = variant === "coast" ? physicsSoftFixtures().coast.project : physicsSoftBlockedFixture();
if (!["rectangle", "rectangle-real-clock", "coast"].includes(variant)) throw new Error("Unknown variant");
const report = {
  schema: "nekoc-k4-soft-blocked-debug-v1", variant,
  projectSha256: createHash("sha256").update(JSON.stringify(project, null, 2) + "\n").digest("hex"),
  method: "CDP Debugger.pause; read-only scope/property inspection; resume; no kernel replacement",
  pauses: [],
};
let session, timer, busy = false;
const scripts = new Map();
const primitive = value => value && (value.type === "function" ? "[function]" : "value" in value ? value.value : value.unserializableValue ?? value.description ?? value.type);
async function properties(objectId, cap = 24) {
  if (!objectId) return {};
  const { result } = await session.send("Runtime.getProperties", { objectId, ownProperties: true });
  const values = {};
  for (const prop of result.slice(0, cap)) if (prop.value) values[prop.name] = primitive(prop.value);
  if (result.length > cap) values.$propertyCount = result.length;
  return values;
}
try {
  const trace = await runOracle(project, {
    frames: 2, virtualTime: variant !== "rectangle-real-clock", wallTimeoutMs: 16000,
    beforeStart: async page => {
      report.environment = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        return { userAgent: navigator.userAgent, uniformVectors: gl?.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) };
      });
      session = await page.context().newCDPSession(page);
      session.on("Debugger.scriptParsed", event => scripts.set(event.scriptId, event.url));
      await session.send("Debugger.enable");
      session.on("Debugger.paused", async event => {
        try {
          const pause = { reason: event.reason, stack: [] };
          for (const [index, frame] of event.callFrames.slice(0, 16).entries()) {
            const item = { function: frame.functionName, file: scripts.get(frame.location.scriptId)?.replace(/^http:\/\/127\.0\.0\.1:\d+/, ""),
              line: frame.location.lineNumber + 1, column: frame.location.columnNumber + 1 };
            if (index < 3) {
              item.locals = await properties(frame.scopeChain.find(scope => scope.type === "local")?.object.objectId, 64);
              item.this = await properties(frame.this.objectId);
              if (index === 0 && frame.functionName === "generate_position_data") {
                const result = await session.send("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId,
                  expression: "({outlineLength:c.length,pointCount:h.length,interiorAnchorCount:d.size,boundaryAnchorCount:E.size,increment:x,cachedMaxAnchors:this.constructor._max_anchors,initialPointCount:w,particleStride:_,firstOutlinePoint:{x:c[0].x,y:c[0].y},lastOutlinePoint:{x:c[c.length-1].x,y:c[c.length-1].y}})",
                  returnByValue: true, throwOnSideEffect: true });
                item.samplingState = result.result.value ?? { error: result.exceptionDetails?.text };
              }
            }
            pause.stack.push(item);
          }
          report.pauses.push(pause);
          console.log("pause", report.pauses.length, pause.stack.slice(0, 5).map(frame => `${frame.function}@${frame.column}`).join(" <- "));
        } catch (error) { report.pauseError = error.message; }
        finally { await session.send("Debugger.resume").catch(() => {}); busy = false; }
      });
      timer = setInterval(() => {
        if (busy || report.pauses.length >= 3) return;
        busy = true;
        session.send("Debugger.pause").catch(error => { report.pauseRequestError = error.message; busy = false; });
      }, 2000);
    },
  });
  report.status = "completed";
  report.frames = trace.frames.length;
  report.errors = trace.errors;
  report.assets = trace.diagnostics.assets;
} catch (error) {
  report.status = error.diagnostics?.watchdog ? "watchdog-timeout" : "error";
  report.frames = error.diagnostics?.partialTrace?.frames?.length ?? 0;
  report.error = error.message;
  report.watchdog = error.diagnostics?.watchdog;
  report.assets = error.diagnostics?.assets;
  report.pageErrors = error.diagnostics?.pageErrors;
} finally {
  clearInterval(timer);
}
await saveJson(`docs/kitten4-soft-blocked-${variant}-evidence.json`, report);
console.log(report.status, report.frames);
