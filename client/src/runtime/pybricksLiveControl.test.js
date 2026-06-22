import assert from "node:assert/strict";
import test from "node:test";

import {
  createPybricksLiveControlSource,
  getActiveLiveControlCommand,
  getDefaultLiveControlCode,
  getLiveControlCommandForKey,
  normalizeLiveControlConfig,
} from "./pybricksLiveControl.js";

test("normalizes ports, speed, and turn mode", () => {
  assert.deepEqual(
    normalizeLiveControlConfig({
      leftPort: "c",
      rightPort: "c",
      speed: 9000,
      turnMode: "unknown",
    }),
    {
      leftPort: "C",
      rightPort: "A",
      leftReversed: false,
      rightReversed: false,
      speed: 1500,
      turnMode: "spot",
      codeVersion: 1,
      customCode: {
        w: "left_motor.run(speed)\nright_motor.run(speed)",
        a: "left_motor.run(-speed)\nright_motor.run(speed)",
        s: "left_motor.run(-speed)\nright_motor.run(-speed)",
        d: "left_motor.run(speed)\nright_motor.run(-speed)",
        stop: "left_motor.brake()\nright_motor.brake()",
      },
    },
  );
});

test("exposes the actual default code for spot and arc turns", () => {
  assert.equal(
    getDefaultLiveControlCode({ speed: 600, turnMode: "spot" }).a,
    "left_motor.run(-speed)\nright_motor.run(speed)",
  );
  assert.equal(
    getDefaultLiveControlCode({ speed: 600, turnMode: "arc" }).a,
    "left_motor.run(inner_speed)\nright_motor.run(speed)",
  );
});

test("held-key ordering returns to the previous key before stopping", () => {
  const held = new Set();
  held.add("w");
  assert.equal(getActiveLiveControlCommand(held), "w");

  held.add("a");
  assert.equal(getActiveLiveControlCommand(held), "a");

  held.delete("a");
  assert.equal(getActiveLiveControlCommand(held), "w");

  held.delete("w");
  assert.equal(getActiveLiveControlCommand(held), "x");
});

test("arrow keys map to the same commands without breaking holds", () => {
  assert.equal(getLiveControlCommandForKey("ArrowUp"), "w");
  assert.equal(getLiveControlCommandForKey("ArrowLeft"), "a");
  assert.equal(getLiveControlCommandForKey("ArrowDown"), "s");
  assert.equal(getLiveControlCommandForKey("ArrowRight"), "d");
  assert.equal(getLiveControlCommandForKey("Q"), null);
  assert.equal(getLiveControlCommandForKey("e"), null);
  assert.equal(getLiveControlCommandForKey(" "), null);

  const held = new Set();
  held.add("w");
  held.add("arrowup");
  assert.equal(getActiveLiveControlCommand(held), "w");

  held.delete("arrowup");
  assert.equal(getActiveLiveControlCommand(held), "w");

  held.add("arrowleft");
  assert.equal(getActiveLiveControlCommand(held), "a");

  held.delete("arrowleft");
  assert.equal(getActiveLiveControlCommand(held), "w");
});

test("generates default spot-turn controller source", () => {
  const source = createPybricksLiveControlSource({
    leftPort: "C",
    rightPort: "D",
    leftReversed: true,
    rightReversed: false,
    speed: 700,
    turnMode: "spot",
  });

  assert.match(source, /Motor\(Port\.C, positive_direction=Direction\.COUNTERCLOCKWISE\)/);
  assert.match(source, /Motor\(Port\.D, positive_direction=Direction\.CLOCKWISE\)/);
  assert.match(source, /speed = 700/);
  assert.match(source, /def turn_left\(\):\n    left_motor\.run\(-speed\)\n    right_motor\.run\(speed\)/);
  assert.match(source, /"x": stop_motors/);
  assert.match(source, /watchdog = StopWatch\(\)/);
  assert.match(source, /elif moving and watchdog\.time\(\) > 350:/);
});

test("embeds custom per-key code and keeps empty actions on defaults", () => {
  const source = createPybricksLiveControlSource({
    codeVersion: 1,
    customCode: {
      w: "left_motor.run(123)\nright_motor.run(456)",
      a: "left_motor.run(-speed)\nright_motor.run(speed)",
      s: "left_motor.run(-speed)\nright_motor.run(-speed)",
      d: "left_motor.run(speed)\nright_motor.run(-speed)",
      stop: "left_motor.stop()\nright_motor.stop()",
    },
  });

  assert.match(source, /def move_forward\(\):\n    left_motor\.run\(123\)\n    right_motor\.run\(456\)/);
  assert.match(source, /def turn_left\(\):\n    left_motor\.run\(-speed\)/);
  assert.match(source, /def stop_motors\(\):\n    left_motor\.stop\(\)\n    right_motor\.stop\(\)/);
});

test("an explicitly empty key mapping compiles as a no-op", () => {
  const source = createPybricksLiveControlSource({
    codeVersion: 1,
    customCode: {
      ...getDefaultLiveControlCode({ turnMode: "spot" }),
      a: "",
    },
  });

  assert.match(source, /def turn_left\(\):\n    pass/);
});
