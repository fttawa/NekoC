# NekoC Self API Reference

The Self API is available inside sprite callbacks. It provides direct access to the sprite's properties and methods.

## Usage

```ts
sprite("player", {
  costume: "https://example.com/player.png",
  x: 0,
  y: 0,
}, self => {
  self.onStart(() => {
    self.move(10);
    self.say("Hello!");
  });
});
```

## Properties (Assignable)

### `self.x`

Gets or sets the sprite's X coordinate.

```ts
self.x = 100;
const pos = self.x;
```

### `self.y`

Gets or sets the sprite's Y coordinate.

```ts
self.y = 200;
```

### `self.scale`

Gets or sets the sprite's scale.

```ts
self.scale = 150;
```

## Events

### `self.onStart(body)`

Runs when the sprite starts.

```ts
self.onStart(() => {
  console.log("Sprite started");
});
```

## Motion

### `self.move(steps)`

Moves forward.

```ts
self.move(10);
```

### `self.moveSteps(steps)`

Same as `self.move()`.

### `self.moveTo(x, y)`

Moves to position.

```ts
self.moveTo(100, 200);
```

### `self.glideTo(x, y)`

Glides to position.

```ts
self.glideTo(0, 0);
```

### `self.setX(value)` / `self.setY(value)`

Sets X or Y coordinate.

### `self.changeX(delta)` / `self.changeY(delta)`

Changes X or Y by delta.

### `self.glideChangeX(delta)` / `self.glideChangeY(delta)`

Glides by changing X or Y.

### `self.turn(degrees)`

Turns right.

```ts
self.turn(90);
```

### `self.pointTowards(degrees)`

Points towards angle.

### `self.rotateAround(degrees, radius, centerX, centerY)`

Rotates around a point.

### `self.faceTo(target)` / `self.setFaceTo(target)`

Faces towards another sprite.

### `self.moveToTarget(target)` / `self.moveToTargetSprite(target)`

Moves towards another sprite.

### `self.bounceOffEdge()`

Bounces off stage edge.

### `self.setRotationType(type)`

Sets rotation style.

## Appearance

### `self.show()` / `self.hide()`

Shows or hides the sprite.

### `self.appearWith(direction, animation, duration?)`

Shows with animation.

### `self.fadeVisibility(time, showHide)`

Fades in or out.

### `self.say(text, seconds?)` / `self.think(text, seconds?)`

Shows speech or thought bubble.

```ts
self.say("Hello!", 3);
self.think("Hmm...");
```

### `self.ask(text)`

Asks a question.

### `self.closeDialog()`

Closes dialog.

### `self.stageDialog(sprite, text)`

Shows dialog on another sprite.

### `self.setScale(value)` / `self.changeScale(delta)`

Sets or changes scale.

### `self.setSize(type, value)` / `self.changeSize(type, delta)`

Sets or changes width/height.

## Effects

### `self.setEffect(scope, value)`

Sets visual effect.

```ts
self.setEffect("color", 50);
self.setEffect("ghost", 100);
```

### `self.changeEffect(scope, delta)`

Changes visual effect.

### `self.clearEffects()`

Resets all effects.

### `self.setText(text)` / `self.setTextSize(size)` / `self.setTextColor(color)`

Text effect controls.

## Style

### `self.nextStyle()` / `self.prevStyle()`

Switches style.

### `self.setStyle(name)`

Sets style by name.

## Pen

### `self.penDown()` / `self.penUp()`

Starts/stops drawing.

### `self.setPenColor(color)`

Sets pen color.

```ts
self.setPenColor("#ff0000");
```

### `self.setPenSize(size)` / `self.changePenSize(delta)`

Sets or changes pen size.

### `self.clearDrawing()`

Clears all pen strokes.

### `self.stampText(text)` / `self.imageStamp()`

Stamps text or costume.

### `self.setPenLayer(layer, target)`

Sets pen layer.

### `self.setPenEffect(scope, value)` / `self.changePenEffect(scope, delta)`

Pen color property controls.

## Drag

### `self.setDraggable(value)`

Makes draggable.

```ts
self.setDraggable("true");
```

## Clones

### `self.createClone()` / `self.clone(sprite?)`

Creates a clone.

### `self.deleteClone()`

Deletes current clone.

## Screen

### `self.switchScreen(name)`

Switches screen.

### `self.setScreenTransition(direction, type)`

Sets transition effect.

## Timer

### `self.timerStart()` / `self.timerStop()` / `self.timerReset()`

Timer controls.

### `self.showTimer()` / `self.hideTimer()`

Timer display.

## Broadcast

### `self.broadcast(message, value?)`

Sends broadcast.

### `self.broadcastAndWait(message)`

Sends broadcast and waits.

## Control Flow

### `self.wait(seconds)` / `self.waitUntil(condition)`

Wait controls.

### `self.forever(body)` / `self.repeat(times, body)` / `self.repeatTimes(times, body)`

Loop controls.

### `self.repeatUntil(condition, body)`

Repeat until condition.

### `self.forRange(variable, from, to, by, body)`

Range loop.

### `self.breakLoop()`

Exits loop.

### `self.stop()` / `self.restart()`

Script controls.

### `self.warp(body)` / `self.tell(target, body)` / `self.tellAndWait(target, body)`

Execution context.

### `self.callProc(name, ...args)`

Calls a procedure.

### `self.returnValue(value)`

Returns a value from reporter.

## Variables

### `self.setVar(name, value)` / `self.changeVar(name, delta)`

Variable controls.

### `self.getVar<T>(name)`

Gets variable.

### `self.showVariable(name)` / `self.hideVariable(name)`

Variable display.

### `self.var<T>(name)`

Returns a variable handle.

```ts
self.var("score").set(0);
self.var("score").change(1);
const val = self.var("score").get();
```

### `self.scriptVars(...names)`

Declares script-local variables.

## Lists

### `self.appendList(name, value)` / `self.insertList(name, index, value)`

List add/insert.

### `self.replaceListItem(name, mode, index, value)` / `self.deleteListItem(name, mode, index)`

List modify.

### `self.copyList(name, targetName)`

Copies list.

### `self.showList(name)` / `self.hideList(name)`

List display.

### `self.list<T>(name)`

Returns a list handle.

```ts
self.list("items").add("hello");
self.list("items").insert(1, "first");
self.list("items").replace("any", 1, "updated");
self.list("items").delete("any", 1);
self.list("items").copyTo("backup");
const val = self.list("items").item("any", 1);
const len = self.list("items").length();
const has = self.list("items").contains("hello");
```

## Console

### `self.consoleLog(value)`

Logs a value.

### `self["console.log"](value)`

Same as `self.consoleLog()`.
