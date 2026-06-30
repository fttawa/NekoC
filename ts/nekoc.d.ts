// ---------------------------------------------------------------------------
// NekoC TypeScript Type Definitions
// Matches compiler capabilities exactly. Use native if/while/for for control flow.
// ---------------------------------------------------------------------------

type NekoPrimitive = string | number | boolean;
type NekoValue = NekoPrimitive | NekoExpression<unknown>;

interface NekoExpression<T = unknown> {
  readonly __nekocExpression?: T;
}

type NekoStatementBody = () => void;
type NekoTestBody = () => void | Promise<void>;

interface NekoExpect<T = unknown> {
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
  costume?: string | null;
  x?: number;
  y?: number;
  scale?: number;
  visible?: boolean;
}

interface ScreenOptions {
  backdrop?: string | null;
}

// ---------------------------------------------------------------------------
// Variable & List handles
// ---------------------------------------------------------------------------

type ListItemMode = "any" | "last" | string;

interface NekoVariableHandle<T = unknown> {
  get(): NekoExpression<T>;
  set(value: NekoValue): void;
  change(delta: NekoValue): void;
  show(): void;
  hide(): void;
}

interface NekoListHandle<T = unknown> {
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
  rotateAround(degrees: NekoValue, radius: NekoValue, centerX: NekoValue, centerY: NekoValue): void;
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
  setPenColor(color: string): void;
  setLayer(layer: string, target: string): void;

  // --- Drag ---
  setDraggable(value: string): void;

  // --- Style ---
  nextStyle(): void;
  prevStyle(): void;
  setStyle(name: string): void;

  // --- Pen ---
  clearDrawing(): void;
  penDown(): void;
  penUp(): void;
  setPenColor(color: string): void;
  setPenSize(size: NekoValue): void;
  changePenSize(delta: NekoValue): void;
  setPenEffect(scope: string, value: NekoValue): void;
  changePenEffect(scope: string, delta: NekoValue): void;
  stampText(text: NekoValue): void;
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
  stop(): void;
  restart(): void;
  warp(body: NekoStatementBody): void;
  tell(target: string, body: NekoStatementBody): void;
  tellAndWait(target: string, body: NekoStatementBody): void;
  callProc(name: string, ...args: NekoValue[]): void;
  returnValue(value: NekoValue): void;

  // --- Variables ---
  setVar(name: string, value: NekoValue): void;
  changeVar(name: string, delta: NekoValue): void;
  getVar<T = unknown>(name: string): NekoExpression<T>;
  showVariable(name: string): void;
  hideVariable(name: string): void;
  var<T = unknown>(name: string): NekoVariableHandle<T>;
  scriptVars(...names: string[]): void;

  // --- Lists ---
  appendList(name: string, value: NekoValue): void;
  insertList(name: string, index: NekoValue, value: NekoValue): void;
  replaceListItem(name: string, mode: ListItemMode, index: NekoValue, value: NekoValue): void;
  deleteListItem(name: string, mode: ListItemMode, index: NekoValue): void;
  copyList(name: string, targetName: string): void;
  showList(name: string): void;
  hideList(name: string): void;
  list<T = unknown>(name: string): NekoListHandle<T>;

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
declare function onKey(key: string, state?: string, body?: NekoStatementBody): void;
declare function onMessage(message: string, body: NekoStatementBody): void;
declare function when(condition: NekoValue, body: NekoStatementBody): void;
declare function onBumpActor(target: string, body: NekoStatementBody): void;

declare function test(name: string, body: NekoTestBody): void;
declare function expect<T = unknown>(actual: T): NekoExpect<T>;

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
declare function copyList(name: string, targetName: string): void;
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
declare function setStyle(name: string): void;
declare function clearDrawing(): void;
declare function penDown(): void;
declare function penUp(): void;
declare function setPenColor(color: string): void;
declare function setPenSize(size: NekoValue): void;
declare function changePenSize(delta: NekoValue): void;
declare function askChoice(question: NekoValue, ...choices: NekoValue[]): void;
declare function clone(sprite?: string): void;
declare function deleteClone(): void;
declare function timerStart(): void;
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
declare function stop(): void;
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

declare function getVar<T = unknown>(name: string): NekoExpression<T>;
declare function scriptVar<T = unknown>(name: string): NekoExpression<T>;
declare function messageValue<T = unknown>(name: string): NekoExpression<T>;
declare function param<T = unknown>(name: string): NekoExpression<T>;
declare function actorParam<T = unknown>(name: string, attribute: string): NekoExpression<T>;
declare function callReporter<T = unknown>(name: string, ...args: NekoValue[]): NekoExpression<T>;
declare function receivedBroadcast<T = unknown>(message: string): NekoExpression<T>;
declare function bumpActorValue<T = unknown>(sprite: string, attribute: string): NekoExpression<T>;
declare function rangeValue<T = unknown>(name: string): NekoExpression<T>;
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
declare function cloneProperty(sprite: string, attribute: string, index: NekoValue): NekoExpression<number>;
declare function touchingBodyPart(sprite: string, bodyPart: string): NekoExpression<boolean>;
declare function getList<T = unknown>(name: string): NekoExpression<T[]>;
declare function listItem<T = unknown>(name: string, mode: ListItemMode, index: NekoValue): NekoExpression<T>;
declare function listLength(name: string): NekoExpression<number>;
declare function listIndexOf(name: string, value: NekoValue): NekoExpression<number>;
declare function listContains(name: string, value: NekoValue): NekoExpression<boolean>;
declare function tempList(...items: NekoValue[]): NekoExpression<unknown[]>;
