// ---------------------------------------------------------------------------
// NekoC TypeScript Type Definitions
// Matches compiler capabilities exactly. Use native if/while/for for control flow.
// ---------------------------------------------------------------------------

type NekoPrimitive = string | number | boolean;
/**
 * Block values are plain values at the type level, so `getVar("n") + 1` and
 * comparisons type-check like ordinary TS. Kitten N converts at run time.
 */
type NekoExpression<T = any> = T;
type NekoValue = any;

type NekoStatementBody = () => void;
type NekoTestBody = () => void | Promise<void>;

interface NekoExpect<T = any> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(expected: unknown): void;
}

// ---------------------------------------------------------------------------
// Resource options
// ---------------------------------------------------------------------------

interface StageOptions {
  name?: string;
  backdrop?: string | null;
}

interface SpriteOptions {
  /** Image URL of the single costume. Use `costumes` for several. */
  costume?: string | null;
  /** Several costumes, switched with nextStyle()/setStyle(name). The first is shown at start. */
  costumes?: Array<string | CostumeOptions>;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  visible?: boolean;
  draggable?: boolean;
  /** Costume pivot in pixels from the image's top-left corner. */
  centerX?: number;
  centerY?: number;
}

interface CostumeOptions {
  name?: string;
  url: string;
  centerX?: number;
  centerY?: number;
}

interface ScreenOptions {
  backdrop?: string | null;
}

// ---------------------------------------------------------------------------
// Variable & List handles
// ---------------------------------------------------------------------------

type ListItemMode = "any" | "last" | string;

interface NekoVariableHandle<T = any> {
  get(): NekoExpression<T>;
  set(value: NekoValue): void;
  change(delta: NekoValue): void;
  show(): void;
  hide(): void;
}

interface NekoListHandle<T = any> {
  add(value: NekoValue): void;
  append(value: NekoValue): void;
  insert(index: NekoValue, value: NekoValue): void;
  replace(mode: ListItemMode, index: NekoValue, value: NekoValue): void;
  delete(mode: ListItemMode, index: NekoValue): void;
  remove(mode: ListItemMode, index: NekoValue): void;
  copyTo(targetName: string): void;
  show(): void;
  hide(): void;
  get(): NekoExpression<T[]>;
  item(mode: ListItemMode, index: NekoValue): NekoExpression<T>;
  length(): NekoExpression<number>;
  indexOf(value: NekoValue): NekoExpression<number>;
  contains(value: NekoValue): NekoExpression<boolean>;
}

// ---------------------------------------------------------------------------
// Self API (inside sprite body)
// ---------------------------------------------------------------------------

interface NekoSpriteSelf {
  // --- Position (assignable) ---
  x: NekoValue;
  y: NekoValue;
  scale: NekoValue;

  // --- Events ---
  onStart(body: NekoStatementBody): void;
  onClick(body: NekoStatementBody): void;

  // --- Motion ---
  move(steps: NekoValue): void;
  moveSteps(steps: NekoValue): void;
  moveTo(x: NekoValue, y: NekoValue): void;
  glideTo(x: NekoValue, y: NekoValue): void;
  setX(value: NekoValue): void;
  setY(value: NekoValue): void;
  changeX(delta: NekoValue): void;
  changeY(delta: NekoValue): void;
  glideChangeX(delta: NekoValue): void;
  glideChangeY(delta: NekoValue): void;
  turn(degrees: NekoValue): void;
  pointTowards(degrees: NekoValue): void;
  rotateAround(target: string, degrees: NekoValue): void;
  faceTo(target: string): void;
  setFaceTo(target: string): void;
  moveToTarget(target: string): void;
  moveToTargetSprite(target: string): void;
  bounceOffEdge(): void;
  setRotationType(type: string): void;

  // --- Appearance ---
  show(): void;
  hide(): void;
  appearWith(direction: string, animation: string, duration?: string): void;
  fadeVisibility(time: NekoValue, showHide: string): void;
  closeDialog(): void;
  stageDialog(sprite: string, text: NekoValue): void;
  say(text: NekoValue, seconds?: NekoValue): void;
  think(text: NekoValue): void;
  ask(text: NekoValue): void;
  setScale(value: NekoValue): void;
  changeScale(delta: NekoValue): void;
  setSize(type: string, value: NekoValue): void;
  changeSize(type: string, delta: NekoValue): void;

  // --- Effects ---
  setEffect(scope: string, value: NekoValue): void;
  changeEffect(scope: string, delta: NekoValue): void;
  clearEffects(): void;
  setText(text: NekoValue): void;
  setTextSize(size: NekoValue): void;
  setPenColor(color: string | number): void;
  setLayer(layer: string, target: string): void;

  // --- Drag ---
  setDraggable(value: string): void;

  // --- Style ---
  nextStyle(): void;
  prevStyle(): void;
  setStyle(name: NekoValue): void;
  playAudio(audio: NekoValue): void;
  playAudioAndWait(audio: NekoValue): void;
  stopAudio(audio: NekoValue): void;

  // --- Pen ---
  clearDrawing(): void;
  penDown(): void;
  penUp(): void;
  setPenColor(color: string | number): void;
  setPenSize(size: NekoValue): void;
  changePenSize(delta: NekoValue): void;
  setPenEffect(scope: string, value: NekoValue): void;
  changePenEffect(scope: string, delta: NekoValue): void;
  stampText(text: NekoValue, size: NekoValue, align: "left" | "center" | "right"): void;
  imageStamp(): void;
  setPenLayer(layer: string, target: string): void;

  // --- Ask ---
  askChoice(question: NekoValue, ...choices: NekoValue[]): void;

  // --- Clones ---
  clone(sprite?: string): void;
  createClone(): void;
  deleteClone(): void;

  // --- Timer ---
  timerStart(): void;
  showTimer(): void;
  hideTimer(): void;
  timerStop(): void;
  timerReset(): void;
  showTimer(): void;
  hideTimer(): void;

  // --- Screen ---
  switchScreen(name: string): void;
  setScreenTransition(direction: string, type: string): void;

  // --- Broadcast ---
  broadcast(message: string, value?: NekoValue): void;
  broadcastAndWait(message: string): void;

  // --- Control ---
  wait(seconds: NekoValue): void;
  waitUntil(condition: NekoValue): void;
  forever(body: NekoStatementBody): void;
  repeat(times: NekoValue, body: NekoStatementBody): void;
  repeatTimes(times: NekoValue, body: NekoStatementBody): void;
  repeatUntil(condition: NekoValue, body: NekoStatementBody): void;
  forRange(variable: string, from: NekoValue, to: NekoValue, by: NekoValue, body: NekoStatementBody): void;
  breakLoop(): void;
  stop(option?: string): void;
  restart(): void;
  warp(body: NekoStatementBody): void;
  tell(target: string, body: NekoStatementBody): void;
  tellAndWait(target: string, body: NekoStatementBody): void;
  callProc(name: string, ...args: NekoValue[]): void;
  returnValue(value: NekoValue): void;

  // --- Variables ---
  setVar(name: string, value: NekoValue): void;
  changeVar(name: string, delta: NekoValue): void;
  getVar<T = any>(name: string): NekoExpression<T>;
  showVariable(name: string): void;
  hideVariable(name: string): void;
  var<T = any>(name: string): NekoVariableHandle<T>;
  scriptVars(...names: string[]): void;

  // --- Lists ---
  appendList(name: string, value: NekoValue): void;
  insertList(name: string, index: NekoValue, value: NekoValue): void;
  replaceListItem(name: string, mode: ListItemMode, index: NekoValue, value: NekoValue): void;
  deleteListItem(name: string, mode: ListItemMode, index: NekoValue): void;
  copyList(name: NekoValue, targetName: string): void;
  showList(name: string): void;
  hideList(name: string): void;
  list<T = any>(name: string): NekoListHandle<T>;

  // --- Console ---
  consoleLog(value: NekoValue): void;
  "console.log"(value: NekoValue): void;

  // --- Ranking ---
  showRanking(type: string): void;
  hideRanking(type: string): void;
}

// ---------------------------------------------------------------------------
// Global functions (top-level DSL)
// ---------------------------------------------------------------------------

declare function stage(options: StageOptions): void;
declare function screen(name: string, options: ScreenOptions, body: NekoStatementBody): void;
declare function sprite(name: string, options: SpriteOptions, body?: (self: NekoSpriteSelf) => void): void;

declare function onStart(body: NekoStatementBody): void;
declare function onClick(body: NekoStatementBody): void;
/** Top level only: label and visibility of this key's on-screen button on touch clients. */
declare function keyButton(key: string, label: string, visible?: boolean): void;
declare function onKey(key: string, body: NekoStatementBody): void;
declare function onKey(key: string, state: string, body: NekoStatementBody): void;
declare function onMessage(message: string, body: NekoStatementBody): void;
/** `parameter` names the broadcast value, read with messageValue(parameter). */
declare function onMessage(message: string, parameter: string, body: NekoStatementBody): void;
declare function when(condition: NekoValue, body: NekoStatementBody): void;
declare function onBumpActor(target: string, body: NekoStatementBody): void;
declare function onBumpActor(target: string, self: string, actor: string, body: NekoStatementBody): void;

declare function test(name: string, body: NekoTestBody): void;
declare function expect<T = any>(actual: T): NekoExpect<T>;

declare function defineProc(name: string, params: string[], body: NekoStatementBody): void;
declare function defineReporter(name: string, params: string[], body: NekoStatementBody): void;

// ---------------------------------------------------------------------------
// Global statement functions
// ---------------------------------------------------------------------------

declare function setVar(name: string, value: NekoValue): void;
declare function changeVar(name: string, delta: NekoValue): void;
declare function showVariable(name: string): void;
declare function hideVariable(name: string): void;
declare function appendList(name: string, value: NekoValue): void;
declare function insertList(name: string, index: NekoValue, value: NekoValue): void;
declare function replaceListItem(name: string, mode: ListItemMode, index: NekoValue, value: NekoValue): void;
declare function deleteListItem(name: string, mode: ListItemMode, index: NekoValue): void;
declare function copyList(name: NekoValue, targetName: string): void;
declare function splitText(text: NekoValue, delimiter: NekoValue): NekoExpression<unknown[]>;
declare function selectText(text: NekoValue, start: NekoValue, end?: NekoValue): NekoExpression<string>;
declare function toNumber(value: NekoValue): number;
declare function showList(name: string): void;
declare function hideList(name: string): void;
declare function moveSteps(steps: NekoValue): void;
declare function moveTo(x: NekoValue, y: NekoValue): void;
declare function setX(value: NekoValue): void;
declare function setY(value: NekoValue): void;
declare function changeX(delta: NekoValue): void;
declare function changeY(delta: NekoValue): void;
declare function turn(degrees: NekoValue): void;
declare function pointTowards(degrees: NekoValue): void;
declare function show(): void;
declare function hide(): void;
declare function say(text: NekoValue, seconds?: NekoValue): void;
declare function think(text: NekoValue): void;
declare function ask(text: NekoValue): void;
declare function closeDialog(): void;
declare function setScale(value: NekoValue): void;
declare function changeScale(delta: NekoValue): void;
declare function setEffect(scope: string, value: NekoValue): void;
declare function changeEffect(scope: string, delta: NekoValue): void;
declare function clearEffects(): void;
declare function setDraggable(value: string): void;
declare function nextStyle(): void;
declare function prevStyle(): void;
declare function setStyle(name: NekoValue): void;
declare function playAudio(audio: NekoValue): void;
declare function playAudioAndWait(audio: NekoValue): void;
declare function stopAudio(audio: NekoValue): void;
declare function clearDrawing(): void;
declare function penDown(): void;
declare function penUp(): void;
/** Compile-time string or packed RGB constant; the native block has a color field. */
declare function setPenColor(color: string | number): void;
declare function setPenSize(size: NekoValue): void;
declare function stampText(text: NekoValue, size: NekoValue, align: "left" | "center" | "right"): void;
declare function changePenSize(delta: NekoValue): void;
declare function setPenEffect(scope: string, value: NekoValue): void;
declare function changePenEffect(scope: string, value: NekoValue): void;
declare function floor(value: NekoValue): number;
declare function ceil(value: NekoValue): number;
declare function join(...values: NekoValue[]): NekoExpression<string>;
declare function mathFunc(type: string, value: NekoValue): number;
declare function trig(type: "sin" | "cos" | "tan", degrees: NekoValue): number;
declare function askChoice(question: NekoValue, ...choices: NekoValue[]): void;
declare function clone(sprite?: string): void;
declare function deleteClone(): void;
declare function timerStart(): void;
declare function showTimer(): void;
declare function hideTimer(): void;
declare function timerStop(): void;
declare function timerReset(): void;
declare function switchScreen(name: string): void;
declare function broadcast(message: string, value?: NekoValue): void;
declare function broadcastAndWait(message: string): void;
declare function wait(seconds: NekoValue): void;
declare function waitUntil(condition: NekoValue): void;
declare function forever(body: NekoStatementBody): void;
declare function repeatTimes(times: NekoValue, body: NekoStatementBody): void;
declare function repeatUntil(condition: NekoValue, body: NekoStatementBody): void;
declare function forRange(variable: string, from: NekoValue, to: NekoValue, by: NekoValue, body: NekoStatementBody): void;
declare function breakLoop(): void;
declare function stop(option?: string): void;
declare function restart(): void;
declare function warp(body: NekoStatementBody): void;
declare function tell(target: string, body: NekoStatementBody): void;
declare function tellAndWait(target: string, body: NekoStatementBody): void;
declare function callProc(name: string, ...args: NekoValue[]): void;
declare function returnValue(value: NekoValue): void;
declare function consoleLog(value: NekoValue): void;
declare function scriptVars(...names: string[]): void;

// ---------------------------------------------------------------------------
// Global expression functions
// ---------------------------------------------------------------------------

declare function getVar<T = any>(name: string): NekoExpression<T>;
declare function scriptVar<T = any>(name: string): NekoExpression<T>;
declare function messageValue<T = any>(name: string): NekoExpression<T>;
declare function param<T = any>(name: string): NekoExpression<T>;
declare function actorParam<T = any>(name: string, attribute: string): NekoExpression<T>;
declare function callReporter<T = any>(name: string, ...args: NekoValue[]): NekoExpression<T>;
declare function receivedBroadcast<T = any>(message: string): NekoExpression<T>;
declare function bumpActorValue<T = any>(sprite: string, attribute: string): NekoExpression<T>;
declare function rangeValue<T = any>(name: string): NekoExpression<T>;
declare function xOf(sprite: string): NekoExpression<number>;
declare function yOf(sprite: string): NekoExpression<number>;
declare function distanceTo(target: string): NekoExpression<number>;
declare function orientation(target: string): NekoExpression<number>;
declare function styleOf(sprite: string): NekoExpression<string>;
declare function appearanceOf(sprite: string, appearance: string): NekoExpression<number>;
declare function effectOf(sprite: string, effect: string): NekoExpression<number>;
declare function keyPressed(key: string, state?: string): NekoExpression<boolean>;
declare function mouseX(): NekoExpression<number>;
declare function mouseY(): NekoExpression<number>;
declare function answer(): NekoExpression<string>;
declare function choiceValue(type: string): NekoExpression<number>;
declare function timerValue(): NekoExpression<number>;
declare function timeNow(unit: string): NekoExpression<number>;
declare function stageInfo(type: string): NekoExpression<number>;
declare function touching(sprite: string, target: string): NekoExpression<boolean>;
declare function touchingColor(sprite: string, color: string): NekoExpression<boolean>;
declare function outOfBoundary(boundary: string): NekoExpression<boolean>;
declare function cloneCount(sprite: string): NekoExpression<number>;
declare function currentCloneIndex(): NekoExpression<number>;
declare function cloneProperty(sprite: string, index: NekoValue, attribute: string): NekoExpression<number>;
declare function touchingBodyPart(sprite: string, bodyPart: string): NekoExpression<boolean>;
declare function getList<T = any>(name: string): NekoExpression<T[]>;
declare function listItem<T = any>(name: string, mode: ListItemMode, index: NekoValue): NekoExpression<T>;
declare function listLength(name: string): NekoExpression<number>;
declare function listIndexOf(name: string, value: NekoValue): NekoExpression<number>;
declare function listContains(name: string, value: NekoValue): NekoExpression<boolean>;
declare function tempList(...items: NekoValue[]): NekoExpression<unknown[]>;

// ---------------------------------------------------------------------------
// Block-style operators (same blocks the native operators compile to)
// ---------------------------------------------------------------------------

declare function add(a: NekoValue, b: NekoValue): number;
declare function sub(a: NekoValue, b: NekoValue): number;
declare function mul(a: NekoValue, b: NekoValue): number;
declare function div(a: NekoValue, b: NekoValue): number;
declare function mod(a: NekoValue, b: NekoValue): number;
declare function pow(a: NekoValue, b: NekoValue): number;
declare function eq(a: NekoValue, b: NekoValue): boolean;
declare function neq(a: NekoValue, b: NekoValue): boolean;
declare function lt(a: NekoValue, b: NekoValue): boolean;
declare function lte(a: NekoValue, b: NekoValue): boolean;
declare function gt(a: NekoValue, b: NekoValue): boolean;
declare function gte(a: NekoValue, b: NekoValue): boolean;
declare function and(a: NekoValue, b: NekoValue): boolean;
declare function or(a: NekoValue, b: NekoValue): boolean;
declare function not(a: NekoValue): boolean;
declare function bool(value: boolean): boolean;
declare function toBoolean(value: NekoValue): boolean;
declare function toString(value: NekoValue): string;
declare function randInt(min: NekoValue, max: NekoValue): number;
declare function divisibleBy(a: NekoValue, b: NekoValue): boolean;
declare function numberProperty(value: NekoValue, property: string): boolean;
declare function ifThen(condition: NekoValue, body: NekoStatementBody): void;
declare function ifElse(condition: NekoValue, then: NekoStatementBody, otherwise: NekoStatementBody): void;

// ---------------------------------------------------------------------------
// More statements (also available as self.<name> inside sprite bodies)
// ---------------------------------------------------------------------------

declare function move(steps: NekoValue): void;
declare function glideTo(x: NekoValue, y: NekoValue, seconds?: NekoValue): void;
declare function glideChangeX(delta: NekoValue, seconds?: NekoValue): void;
declare function glideChangeY(delta: NekoValue, seconds?: NekoValue): void;
declare function rotateAround(target: string, degrees: NekoValue): void;
declare function contains(text: NekoValue, part: NekoValue): boolean;
declare function length(text: NekoValue): number;
declare function faceTo(target: string): void;
declare function setFaceTo(target: string): void;
declare function moveToTarget(target: string): void;
declare function moveToTargetSprite(target: string): void;
declare function bounceOffEdge(): void;
declare function setRotationType(type: string): void;
declare function appearWith(direction: string, animation: string, duration?: string): void;
declare function fadeVisibility(time: NekoValue, showHide: string): void;
declare function stageDialog(sprite: string, text: NekoValue): void;
declare function setSize(type: string, value: NekoValue): void;
declare function changeSize(type: string, delta: NekoValue): void;
declare function setText(text: NekoValue): void;
declare function setTextSize(size: NekoValue): void;
declare function setTextColor(color: string): void;
declare function setLayer(layer: string, target?: string): void;
declare function setCamp(camp: string): void;
declare function stressAnimation(animation: string): void;
declare function globalAnimation(animation: string): void;
declare function createClone(sprite?: string): void;
declare function imageStamp(): void;
declare function setPenLayer(layer: string, target?: string): void;
declare function setScreenTransition(direction: string, type: string): void;
declare function showRanking(type: string): void;
declare function hideRanking(type: string): void;
declare function faceToBodyPart(bodyPart: string): void;
declare function mouseTrigger(...args: string[]): boolean;
declare function faceTiltAngle(...args: string[]): number;
declare function bodyPartAppearance(...args: string[]): number;

declare const console: { log(...values: NekoValue[]): void };
