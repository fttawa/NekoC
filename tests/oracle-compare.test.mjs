import test from "node:test";
import assert from "node:assert/strict";
import {
  compareEditorOracleToRuntime,
  parseEditorVariables,
} from "../tools/oracle-compare.mjs";

test("parseEditorVariables extracts variable panel values", () => {
  const text = [
    "作品",
    "变量",
    "列表",
    "phaseA",
    "：",
    "174",
    "phaseB",
    "：",
    "0",
    "phaseC",
    "：",
    "ready",
    "作品无列表数据",
  ].join("\n");

  assert.deepEqual(parseEditorVariables(text), {
    phaseA: 174,
    phaseB: 0,
    phaseC: "ready",
  });
});

test("compareEditorOracleToRuntime matches editor variables through runtime names", () => {
  const oracle = {
    state: {
      textExcerpt: [
        "控制台",
        "变量",
        "列表",
        "phaseA",
        "：",
        "174",
        "phaseB",
        "：",
        "0",
        "phaseC",
        "：",
        "ready",
        "作品无列表数据",
      ].join("\n"),
    },
  };
  const runtime = {
    variable_names: {
      "var-a": "phaseA",
      "var-b": "phaseB",
      "var-c": "phaseC",
    },
    variables: {
      "var-a": 174,
      "var-b": 0,
      "var-c": "ready",
    },
  };

  assert.deepEqual(compareEditorOracleToRuntime({ oracle, runtime }), {
    ok: true,
    editorVariables: {
      phaseA: 174,
      phaseB: 0,
      phaseC: "ready",
    },
    runtimeVariables: {
      phaseA: 174,
      phaseB: 0,
      phaseC: "ready",
    },
    differences: [],
  });
});

test("compareEditorOracleToRuntime reports changed and missing values", () => {
  const oracle = {
    state: {
      textExcerpt: ["变量", "列表", "score", "：", "7", "作品无列表数据"].join("\n"),
    },
  };
  const runtime = {
    variable_names: {
      "var-score": "score",
      "var-hidden": "hidden",
    },
    variables: {
      "var-score": 8,
      "var-hidden": 1,
    },
  };

  assert.deepEqual(compareEditorOracleToRuntime({ oracle, runtime }), {
    ok: false,
    editorVariables: {
      score: 7,
    },
    runtimeVariables: {
      hidden: 1,
      score: 8,
    },
    differences: [
      { name: "hidden", kind: "missing_in_editor", runtime: 1 },
      { name: "score", kind: "changed", editor: 7, runtime: 8 },
    ],
  });
});
