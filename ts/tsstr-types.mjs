import ts from "typescript";
import { portablePath } from "./portable-path.mjs";

// Reuse the exact ASTs compiled by the frontend, including imported functions.
// A small ambient library keeps this usable in the browser and memory hosts;
// it supplies only type information, never runtime implementations.
const ambient = `
interface Array<T> {
  [n: number]: T; length: number;
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
  concat(...items: (T | T[])[]): T[];
  reverse(): T[]; sort(compare?: (a: T, b: T) => number): T[];
  map<U>(fn: (value: T, index: number, array: T[]) => U): U[];
  filter(fn: (value: T, index: number, array: T[]) => any): T[];
  reduce<U>(fn: (acc: U, value: T, index: number) => U, initial: U): U;
  find(fn: (value: T, index: number) => any): T | undefined;
  findIndex(fn: (value: T, index: number) => any): number;
  indexOf(value: T): number; includes(value: T): boolean;
  some(fn: (value: T, index: number) => any): boolean;
  every(fn: (value: T, index: number) => any): boolean;
  pop(): T | undefined; shift(): T | undefined;
  push(...values: T[]): number; unshift(...values: T[]): number;
  splice(start: number, count?: number, ...values: T[]): T[];
  fill(value: T): T[];
}
interface ReadonlyArray<T> { readonly [n: number]: T; readonly length: number; }
interface String {
  readonly length: number; [n: number]: string;
  replace(search: string, replacement: string): string;
  replaceAll(search: string, replacement: string): string;
  trim(): string; trimStart(): string; trimEnd(): string;
  toUpperCase(): string; toLowerCase(): string;
  padStart(length: number, fill?: string): string;
  padEnd(length: number, fill?: string): string; repeat(count: number): string;
  charAt(index: number): string;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  split(separator: string): string[]; indexOf(search: string): number;
  includes(search: string): boolean; startsWith(search: string): boolean;
  endsWith(search: string): boolean;
}
declare namespace Math {
  const PI: number, E: number, SQRT2: number, SQRT1_2: number;
  const LN2: number, LN10: number, LOG2E: number, LOG10E: number;
  function floor(n: number): number; function ceil(n: number): number;
  function round(n: number): number; function trunc(n: number): number;
  function abs(n: number): number; function sqrt(n: number): number;
  function exp(n: number): number; function log(n: number): number;
  function log10(n: number): number; function log2(n: number): number;
  function sin(n: number): number; function cos(n: number): number;
  function tan(n: number): number; function asin(n: number): number;
  function acos(n: number): number; function atan(n: number): number;
  function sign(n: number): number; function cbrt(n: number): number;
  function pow(a: number, b: number): number; function atan2(y: number, x: number): number;
  function max(...n: number[]): number; function min(...n: number[]): number;
  function hypot(...n: number[]): number; function random(): number;
}
declare function Array<T = any>(length: number): T[];
declare namespace Array {
  function from<T>(value: { length: number }, fn: (value: any, index: number) => T): T[];
}
declare function String(value?: any): string;
declare function Number(value?: any): number;
declare function parseInt(value: any, radix?: number): number;
declare function parseFloat(value: any): number;
`;

export function createExpressionTypes(files, declarations = "", path = portablePath, readLibrary = () => undefined) {
  const ambientPath = path.resolve("__nekoc_tsstr_types.d.ts");
  const sources = new Map(files);
  const options = {
    strictNullChecks: true, target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2020.d.ts"],
  };
  const libPath = ts.sys ? ts.getDefaultLibFilePath(options) : path.resolve("/lib.es2020.d.ts");
  const hasLibrary = typeof readLibrary(libPath) === "string";
  if (!hasLibrary) options.noLib = true;
  sources.set(ambientPath, ts.createSourceFile(ambientPath, (hasLibrary ? "" : ambient) + declarations, ts.ScriptTarget.Latest, true));
  const source = name => {
    const key = path.resolve(name);
    if (sources.has(key)) return sources.get(key);
    if (!/^lib\..*\.d\.ts$/.test(key.replaceAll("\\", "/").split("/").pop())) return undefined;
    const text = readLibrary(name);
    if (typeof text !== "string") return undefined;
    const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    sources.set(key, file);
    return file;
  };
  const host = {
    getSourceFile: source,
    readFile: name => source(name)?.text,
    fileExists: name => !!source(name),
    getDefaultLibFileName: () => libPath,
    writeFile() {}, getCurrentDirectory: () => path.resolve("."),
    getDirectories: () => [], getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  // createProgram rewrites fileName on the shared compiler ASTs (for example
  // "/main.ts" -> "E:/main.ts" on Windows); diagnostics must keep the host name.
  const originalNames = [...files.values()].map(file => [file, file.fileName]);
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  for (const [file, name] of originalNames) file.fileName = name;
  const classify = type => {
    if (type.isUnion()) {
      const kinds = new Set(type.types.map(classify));
      return kinds.size === 1 ? [...kinds][0] : "unknown";
    }
    if (type.flags & ts.TypeFlags.StringLike) return "string";
    if (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.EnumLike)) return "number";
    if (type.flags & ts.TypeFlags.BooleanLike) return "boolean";
    return "unknown";
  };
  const declaredReadType = node => {
    let symbol;
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
    } else if (ts.isElementAccessExpression(node)) {
      const target = checker.getTypeAtLocation(node.expression);
      const key = node.argumentExpression;
      if (ts.isStringLiteral(key) || ts.isNumericLiteral(key)) symbol = checker.getPropertyOfType(target, key.text);
      if (!symbol) {
        const index = checker.getTypeAtLocation(key);
        return checker.getIndexTypeOfType(target, index.flags & ts.TypeFlags.NumberLike ? ts.IndexKind.Number : ts.IndexKind.String);
      }
    }
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : null;
  };
  const expressionKind = node => {
    // Factory nodes and generated helpers have no bound symbols. Their existing
    // lowering rules remain in charge; do not ask TS to bind synthetic nodes.
    // Transformed nodes map back to the parsed file the checker knows.
    node = node && ts.getOriginalNode(node);
    const file = node?.getSourceFile?.();
    if (!file || sources.get(path.resolve(file.fileName)) !== file || node.pos < 0) return null;
    // These wrappers do not convert the value. In particular satisfies must
    // not fall back to TS's potentially stale flow type for its operand.
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression(node)) return expressionKind(node.expression);
    const commonKind = (left, right) => {
      const a = expressionKind(left), b = expressionKind(right);
      return a === b ? a : "unknown";
    };
    // Preserve declared-type uncertainty through value-selecting expressions,
    // rather than accepting their narrowed result type from the checker.
    if (ts.isConditionalExpression(node)) return commonKind(node.whenTrue, node.whenFalse);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken].includes(operator)) return commonKind(node.left, node.right);
      if (operator === ts.SyntaxKind.PlusToken) {
        const a = expressionKind(node.left), b = expressionKind(node.right);
        if (a === "string" || b === "string") return "string";
        if (a === "unknown" || b === "unknown") return "unknown";
      }
    }
    // TS flow narrowing does not track callback/alias writes. A read of a
    // declared mixed union must not become a promise of string concatenation.
    return classify(declaredReadType(node) ?? checker.getTypeAtLocation(node));
  };
  // tsfeat transforms share unchanged nodes with these parsed files and
  // re-parent them onto the lowered tree, where the checker would crash.
  // Classify every parsed expression once, under its parsed parents.
  const kinds = new WeakMap();
  withParsedParents(files.values(), () => {
    const visit = node => {
      if (ts.isExpression(node)) kinds.set(node, expressionKind(node));
      ts.forEachChild(node, visit);
    };
    for (const file of files.values()) visit(file);
  });
  return node => {
    const original = node && ts.getOriginalNode(node);
    return kinds.has(original) ? kinds.get(original) : null;
  };
}

// Temporarily give parsed files their own parent links back, then restore
// whatever links the lowered trees had set on the shared nodes.
export function withParsedParents(files, fn) {
  const saved = [];
  const visit = (node, parent) => {
    if (node.parent !== parent) {
      saved.push([node, node.parent]);
      node.parent = parent;
    }
    ts.forEachChild(node, child => visit(child, node));
  };
  for (const file of files) visit(file, undefined);
  try {
    return fn();
  } finally {
    for (let i = saved.length - 1; i >= 0; i--) saved[i][0].parent = saved[i][1];
  }
}
