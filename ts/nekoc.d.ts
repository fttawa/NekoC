type NekoPrimitive = string | number | boolean;
type NekoValue = NekoPrimitive | NekoExpression<unknown>;

interface NekoExpression<T = unknown> {
  readonly __nekocExpression?: T;
}

type NekoStatementBody = () => void;

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

interface NekoSpriteSelf {
  x: NekoValue;
  y: NekoValue;
  scale: NekoValue;

  onStart(body: NekoStatementBody): void;
  wait(seconds: NekoValue): void;
  waitUntil(condition: NekoValue): void;
  forever(body: NekoStatementBody): void;
  repeat(times: NekoValue, body: NekoStatementBody): void;
  repeatTimes(times: NekoValue, body: NekoStatementBody): void;
  repeatUntil(condition: NekoValue, body: NekoStatementBody): void;
  broadcast(message: string, value?: NekoValue): void;
  broadcastAndWait(message: string): void;

  move(steps: NekoValue): void;
  turn(degrees: NekoValue): void;
  pointTowards(degrees: NekoValue): void;
  show(): void;
  hide(): void;
  say(text: NekoValue, seconds: NekoValue): void;
  think(text: NekoValue): void;
  ask(text: NekoValue): void;

  setVar(name: string, value: NekoValue): void;
  changeVar(name: string, delta: NekoValue): void;
  getVar<T = unknown>(name: string): NekoExpression<T>;
  showVariable(name: string): void;
  hideVariable(name: string): void;
  var<T = unknown>(name: string): NekoVariableHandle<T>;
  list<T = unknown>(name: string): NekoListHandle<T>;
}

declare function stage(options: StageOptions): void;
declare function screen(name: string, options: ScreenOptions, body: NekoStatementBody): void;
declare function sprite(name: string, options: SpriteOptions, body?: (self: NekoSpriteSelf) => void): void;

declare function onStart(body: NekoStatementBody): void;
declare function onClick(body: NekoStatementBody): void;
declare function onKey(key: string, state: string, body: NekoStatementBody): void;
declare function onMessage(message: string, body: NekoStatementBody): void;
declare function when(condition: NekoValue, body: NekoStatementBody): void;

declare function wait(seconds: NekoValue): void;
declare function waitUntil(condition: NekoValue): void;
declare function forever(body: NekoStatementBody): void;
declare function repeatTimes(times: NekoValue, body: NekoStatementBody): void;
declare function repeatUntil(condition: NekoValue, body: NekoStatementBody): void;
declare function ifThen(condition: NekoValue, body: NekoStatementBody): void;
declare function ifElse(condition: NekoValue, thenBody: NekoStatementBody, elseBody: NekoStatementBody): void;
declare function broadcast(message: string, value?: NekoValue): void;
declare function broadcastAndWait(message: string): void;

declare function setVar(name: string, value: NekoValue): void;
declare function changeVar(name: string, delta: NekoValue): void;
declare function getVar<T = unknown>(name: string): NekoExpression<T>;
declare function showVariable(name: string): void;
declare function hideVariable(name: string): void;

declare function appendList(name: string, value: NekoValue): void;
declare function insertList(name: string, index: NekoValue, value: NekoValue): void;
declare function replaceListItem(name: string, mode: ListItemMode, index: NekoValue, value: NekoValue): void;
declare function deleteListItem(name: string, mode: ListItemMode, index: NekoValue): void;
declare function copyList(name: string, targetName: string): void;
declare function showList(name: string): void;
declare function hideList(name: string): void;
declare function getList<T = unknown>(name: string): NekoExpression<T[]>;
declare function listItem<T = unknown>(name: string, mode: ListItemMode, index: NekoValue): NekoExpression<T>;
declare function listLength(name: string): NekoExpression<number>;
declare function listIndexOf(name: string, value: NekoValue): NekoExpression<number>;
declare function listContains(name: string, value: NekoValue): NekoExpression<boolean>;
declare function tempList(...items: NekoValue[]): NekoExpression<unknown[]>;

declare function moveSteps(steps: NekoValue): void;
declare function setX(value: NekoValue): void;
declare function setY(value: NekoValue): void;
declare function turn(degrees: NekoValue): void;
declare function pointTowards(degrees: NekoValue): void;
declare function show(): void;
declare function hide(): void;
declare function say(text: NekoValue, seconds: NekoValue): void;
declare function think(text: NekoValue): void;
declare function ask(text: NekoValue): void;
