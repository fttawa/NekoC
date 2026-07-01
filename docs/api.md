# NekoC API Reference

Complete reference for all functions and APIs available in NekoC TypeScript projects.

## Global Events

### `onStart(body)`

Runs when the project starts.

```ts
onStart(() => {
  console.log("Project started");
});
```

### `onClick(body)`

Runs when the stage is clicked.

```ts
onClick(() => {
  console.log("Clicked!");
});
```

### `onKey(key, state?, body?)`

Runs when a key is pressed or released. State defaults to `"down"`.

```ts
onKey("space", () => {
  console.log("Space pressed");
});

onKey("up", "down", () => {
  console.log("Up arrow pressed");
});

onKey("a", "up", () => {
  console.log("A released");
});
```

### `onMessage(message, body)`

Runs when a broadcast message is received.

```ts
onMessage("game-over", () => {
  console.log("Game over!");
});
```

### `when(condition, body)`

Runs repeatedly while condition is true.

```ts
when(() => getVar("score") > 100, () => {
  console.log("High score!");
});
```

### `onBumpActor(target, body)`

Runs when the actor bumps into another actor.

```ts
onBumpActor("enemy", () => {
  console.log("Hit enemy!");
});
```

## Control Flow

### `wait(seconds)`

Pauses execution for the specified number of seconds.

```ts
wait(1.5);
```

### `waitUntil(condition)`

Pauses until condition becomes true.

```ts
waitUntil(() => getVar("ready") === true);
```

### `forever(body)`

Loops forever.

```ts
forever(() => {
  changeVar("tick", 1);
});
```

### `repeatTimes(times, body)`

Repeats a fixed number of times.

```ts
repeatTimes(10, () => {
  moveSteps(10);
  turn(36);
});
```

### `repeatUntil(condition, body)`

Repeats until condition is true.

```ts
repeatUntil(() => getVar("done"), () => {
  changeVar("x", 1);
});
```

### `forRange(variable, from, to, by, body)`

Iterates over a numeric range.

```ts
forRange("i", 1, 10, 1, () => {
  console.log(rangeValue("i"));
});
```

### `breakLoop()`

Exits the innermost loop.

```ts
forever(() => {
  if (getVar("x") > 100) {
    breakLoop();
  }
  changeVar("x", 1);
});
```

### `stop()`

Stops the current script.

### `restart()`

Restarts the current script.

### `warp(body)`

Runs body without screen refresh (instant mode).

```ts
warp(() => {
  setVar("x", 0);
  setVar("y", 0);
});
```

### `tell(target, body)`

Runs body as if called by another actor.

### `tellAndWait(target, body)`

Runs body as another actor and waits for completion.

## Broadcasting

### `broadcast(message, value?)`

Sends a broadcast message.

```ts
broadcast("reset");
broadcast("score-change", 100);
```

### `broadcastAndWait(message)`

Sends a broadcast and waits for all listeners to finish.

```ts
await broadcastAndWait("save");
```

## Variables

### `setVar(name, value)`

Sets a variable.

```ts
setVar("score", 0);
setVar("name", "player1");
```

### `changeVar(name, delta)`

Changes a variable by a numeric delta.

```ts
changeVar("score", 10);
changeVar("lives", -1);
```

### `getVar<T>(name)`

Gets a variable value.

```ts
const score = getVar("score");
if (getVar("lives") <= 0) { ... }
```

### `showVariable(name)` / `hideVariable(name)`

Shows or hides a variable in the editor.

## Lists

### `appendList(name, value)`

Adds an item to the end of a list.

```ts
appendList("items", "hello");
```

### `insertList(name, index, value)`

Inserts an item at the specified index.

```ts
insertList("items", 1, "first");
```

### `replaceListItem(name, mode, index, value)`

Replaces an item. Mode: `"any"`, `"last"`, or `"first"`.

```ts
replaceListItem("items", "any", 1, "updated");
```

### `deleteListItem(name, mode, index)`

Deletes an item.

```ts
deleteListItem("items", "any", 1);
deleteListItem("items", "all"); // Clear all
```

### `copyList(name, targetName)`

Copies a list to another list.

```ts
copyList("source", "backup");
```

### `showList(name)` / `hideList(name)`

Shows or hides a list in the editor.

### `getList<T>(name)`

Gets the entire list as an array expression.

### `listItem<T>(name, mode, index)`

Gets a specific item from the list.

### `listLength(name)`

Gets the length of a list.

### `listIndexOf(name, value)`

Gets the index of a value in the list (1-based).

### `listContains(name, value)`

Checks if the list contains a value.

## Motion

### `moveSteps(steps)`

Moves forward by the specified number of steps.

```ts
moveSteps(10);
```

### `moveTo(x, y)` / `glideTo(x, y)`

Moves or glides to the specified position.

```ts
moveTo(100, 200);
glideTo(0, 0);
```

### `setX(value)` / `setY(value)`

Sets the X or Y coordinate.

### `changeX(delta)` / `changeY(delta)`

Changes the X or Y coordinate by delta.

### `glideChangeX(delta)` / `glideChangeY(delta)`

Glides by changing X or Y coordinate.

### `turn(degrees)`

Turns right by the specified degrees.

```ts
turn(90);
```

### `pointTowards(degrees)`

Points towards the specified angle.

```ts
pointTowards(0); // Face right
```

### `rotateAround(degrees, radius, centerX, centerY)`

Rotates around a center point.

### `faceTo(target)` / `setFaceTo(target)`

Faces towards another actor.

### `moveToTarget(target)` / `moveToTargetSprite(target)`

Moves towards another actor.

### `bounceOffEdge()`

Bounces off the stage edge.

### `setRotationType(type)`

Sets rotation style (`"all around"`, `"left-right"`, `"don't rotate"`).

## Appearance

### `show()` / `hide()`

Shows or hides the actor.

```ts
show();
hide();
```

### `setScale(value)`

Sets the actor's scale.

```ts
setScale(150);
```

### `changeScale(delta)`

Changes the scale by delta.

### `setSize(type, value)`

Sets width or height.

### `changeSize(type, delta)`

Changes width or height.

### `say(text, seconds?)` / `think(text, seconds?)`

Shows a speech or thought bubble. Seconds defaults to 2.

```ts
say("Hello!");
think("Hmm...", 3);
```

### `ask(text)`

Asks a question.

```ts
ask("What is your name?");
```

### `closeDialog()`

Closes the current dialog.

### `stageDialog(sprite, text)`

Shows a dialog on another sprite.

## Style

### `nextStyle()` / `prevStyle()`

Switches to the next or previous style.

```ts
nextStyle();
prevStyle();
```

### `setStyle(name)`

Sets the current style by name.

```ts
setStyle("costume2");
```

## Effects

### `setEffect(scope, value)`

Sets a visual effect.

```ts
setEffect("color", 50);
setEffect("ghost", 100);
```

### `changeEffect(scope, delta)`

Changes a visual effect.

### `clearEffects()`

Resets all visual effects.

## Pen

### `penDown()` / `penUp()`

Starts or stops drawing.

```ts
penDown();
moveSteps(100);
penUp();
```

### `setPenColor(color)`

Sets the pen color.

```ts
setPenColor("#ff0000");
```

### `setPenSize(size)` / `changePenSize(delta)`

Sets or changes the pen size.

### `setPenEffect(scope, value)` / `changePenEffect(scope, delta)`

Sets or changes pen color properties.

### `clearDrawing()`

Clears all pen strokes and stamps.

### `stampText(text)` / `imageStamp()`

Stamps text or the current costume.

### `setPenLayer(layer, target)`

Sets pen layer.

## Drag

### `setDraggable(value)`

Makes the actor draggable.

```ts
setDraggable("true");
```

## Clones

### `createClone(sprite?)`

Creates a clone of the specified sprite (or self).

```ts
createClone();
createClone("enemy");
```

### `deleteClone()`

Deletes the current clone.

### `cloneCount(sprite)`

Gets the number of clones.

### `currentCloneIndex()`

Gets the current clone's index.

### `cloneProperty(sprite, attribute, index)`

Gets a property of a specific clone.

## Screen

### `switchScreen(name)`

Switches to another screen.

```ts
switchScreen("game");
```

### `setScreenTransition(direction, type)`

Sets screen transition effect.

## Timer

### `timerStart()` / `timerStop()` / `timerReset()`

Controls the timer.

### `showTimer()` / `hideTimer()`

Shows or hides the timer display.

## Sensing

### `keyPressed(key, state?)`

Checks if a key is pressed.

```ts
if (keyPressed("space", "down")) { ... }
```

### `mouseX()` / `mouseY()`

Gets mouse position.

### `answer()`

Gets the answer to an ask block.

### `choiceValue(type)`

Gets the choice value or index from askChoice.

### `timerValue()`

Gets the timer value.

### `timeNow(unit)`

Gets the current time.

```ts
timeNow("hour");
timeNow("minute");
```

### `stageInfo(type)`

Gets stage width or height.

```ts
stageInfo("width"); // 562
stageInfo("height"); // 900
```

### `touching(sprite, target)`

Checks if an actor is touching another.

```ts
if (touching("--self", "enemy")) { ... }
```

### `touchingColor(sprite, color)`

Checks if an actor is touching a color.

### `outOfBoundary(boundary)`

Checks if an actor is out of bounds.

### `distanceTo(target)`

Gets distance to another actor.

### `xOf(sprite)` / `yOf(sprite)`

Gets the position of another actor.

### `orientation(target)`

Gets the orientation of another actor.

### `styleOf(sprite)`

Gets the current style of another actor.

### `appearanceOf(sprite, appearance)`

Gets appearance property of another actor.

### `effectOf(sprite, effect)`

Gets effect value of another actor.

### `bumpActorValue(sprite, attribute)`

Gets attribute of bumped actor.

## Data Expressions

### `scriptVar<T>(name)`

Gets a script-local variable.

### `messageValue<T>(name)`

Gets the value passed with a broadcast message.

### `param<T>(name)`

Gets a procedure parameter.

### `actorParam<T>(name, attribute)`

Gets an actor parameter.

### `callReporter<T>(name, ...args)`

Calls a reporter procedure.

### `receivedBroadcast(message)`

Checks if a broadcast was received.

## Procedures

### `defineProc(name, params, body)`

Defines a statement procedure.

```ts
defineProc("moveAndSay", ["steps", "msg"], (steps, msg) => {
  moveSteps(steps);
  say(msg);
});
```

### `defineReporter(name, params, body)`

Defines a reporter procedure.

```ts
defineReporter("double", ["n"], (n) => {
  return n * 2;
});
```

## Resources

### `stage(options)`

Declares stage settings.

```ts
stage({
  name: "main",
  backdrop: "https://example.com/bg.png",
});
```

### `sprite(name, options, body?)`

Declares a sprite.

```ts
sprite("player", {
  costume: "https://example.com/player.png",
  x: 0,
  y: 0,
  scale: 100,
  visible: true,
}, () => {
  onStart(() => { ... });
});
```

### `screen(name, options, body)`

Declares a screen.

```ts
screen("menu", { backdrop: "https://example.com/menu.png" }, () => {
  sprite("start", { ... }, () => { ... });
});
```

## Testing

### `test(name, body)`

Defines a compile-time unit test.

```ts
test("double", () => {
  expect(double(21)).toBe(42);
});
```

### `expect<T>(actual)`

Creates an assertion.

```ts
expect(value).toBe(42);
expect(value).toBeTruthy();
expect(value).toContain("hello");
```
