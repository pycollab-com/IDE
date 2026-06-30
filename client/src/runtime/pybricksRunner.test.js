import assert from "node:assert/strict";
import test from "node:test";

import { parseHubMonitorPayload } from "./pybricksHubMonitor.js";
import { PybricksRunner } from "./pybricksRunner.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function stdoutEvent(text) {
  return new DataView(Uint8Array.from([1, ...encoder.encode(text)]).buffer);
}

function createConnectedRunner(overrides = {}) {
  const states = [];
  const runner = new PybricksRunner({
    onConnectionChange: (state) => states.push({ ...state }),
  });

  runner.connectionState = {
    ...runner.connectionState,
    connected: true,
    status: "connected",
    hubType: "Prime Hub",
    featureFlags: 1,
    maxWriteSize: 20,
    protocolVersion: "1.5.0",
    ...overrides,
  };
  return { runner, states };
}

function attachSuccessfulMonitorTransport(runner, { legacy = false, rejectModern = false } = {}) {
  const commands = [];
  let stdinLine = "";
  runner.transport = {
    async sendCommand(command) {
      commands.push([...command]);
      const modernStart = command[0] === 1 && command[1] === 0x80;
      const legacyStart = command[0] === 2;
      if (modernStart && rejectModern) {
        throw new Error("not supported");
      }
      if ((legacy && legacyStart) || (!legacy && modernStart) || (rejectModern && legacyStart)) {
        queueMicrotask(() => runner._handleHubEvent(stdoutEvent("Pybricks MicroPython\r\n>>> ")));
        return;
      }
      if (command[0] !== 6) return;

      const payload = command.slice(1);
      const text = decoder.decode(payload);
      stdinLine += text;
      if (!stdinLine.endsWith("\r")) return;
      const line = stdinLine;
      stdinLine = "";
      if (line.includes("hub.battery.voltage")) {
        queueMicrotask(() =>
          runner._handleHubEvent(
            stdoutEvent("\x1ePYCOLLAB_HUB:B|7420\r\n>>> "),
          ),
        );
        return;
      }
      if (line.startsWith("__pc_src")) {
        queueMicrotask(() => runner._handleHubEvent(stdoutEvent(`${line}\r\n>>> `)));
        return;
      }
      if (line === "exec(__pc_src)\r") {
        queueMicrotask(() =>
          runner._handleHubEvent(
            stdoutEvent(
              "\x1ePYCOLLAB_HUB:H|7418|A,M,48,91,0;B,C,61,RED,0,95,80,62,-1;C,E;D,E;E,E;F,E\r\n",
            ),
          ),
        );
      }
    },
  };
  return commands;
}

test("hub monitor waits for modern REPL and publishes battery and port readings", async () => {
  const { runner, states } = createConnectedRunner();
  const commands = attachSuccessfulMonitorTransport(runner);

  await runner._startHubMonitor();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const final = states.at(-1);
  assert.equal(final.telemetryAvailable, true);
  assert.equal(final.batteryVoltage, 7418);
  assert.equal(final.batteryPercent, 59);
  assert.equal(final.ports[0].port, "A");
  assert.equal(final.ports[0].angle, 91);
  assert.equal(final.ports[1].color, "RED");
  assert.deepEqual(final.ports[1].hsv, [0, 95, 80]);
  assert.deepEqual(commands[0], [0]);
  assert.ok(commands.some((command) => command[0] === 1 && command[1] === 0x80));
  assert.ok(commands.every((command) => command.length <= 21));
});

test("hub monitor uses legacy REPL command for Profile 1.3", async () => {
  const { runner, states } = createConnectedRunner({ protocolVersion: "1.3.0" });
  const commands = attachSuccessfulMonitorTransport(runner, { legacy: true });

  await runner._startHubMonitor();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(states.at(-1).telemetryAvailable, true);
  assert.ok(commands.some((command) => command[0] === 2));
  assert.equal(commands.some((command) => command[0] === 1 && command[1] === 0x80), false);
});

test("hub monitor retries legacy REPL when an unversioned hub rejects modern start", async () => {
  const { runner, states } = createConnectedRunner({ protocolVersion: "" });
  const commands = attachSuccessfulMonitorTransport(runner, { rejectModern: true });

  await runner._startHubMonitor();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(states.at(-1).telemetryAvailable, true);
  assert.ok(commands.some((command) => command[0] === 1 && command[1] === 0x80));
  assert.ok(commands.some((command) => command[0] === 2));
});

test("typed monitor payload preserves ordered battery and port information", () => {
  const payload = parseHubMonitorPayload(
    "H|7260|A,M,48,-123,20;B,C,61,BLUE,220,90,72,44,-1,8;C,D,62,315;D,F,63,4.5,1;E,G,64;F,E|I,TOP,3,-2,142,10,-5,980,1,0,-1,1;BTN,CENTER+LEFT",
    "Prime Hub",
  );

  assert.equal(payload.batteryVoltage, 7260);
  assert.deepEqual(payload.ports.map((port) => port.port), ["A", "B", "C", "D", "E", "F"]);
  assert.equal(payload.ports[0].angle, -123);
  assert.equal(payload.ports[1].color, "BLUE");
  assert.equal(payload.ports[1].ambient, 8);
  assert.equal(payload.motion.up, "TOP");
  assert.deepEqual(payload.motion.tilt, [3, -2]);
  assert.equal(payload.motion.heading, 142);
  assert.equal(payload.motion.stationary, true);
  assert.deepEqual(payload.buttons, ["CENTER", "LEFT"]);
  assert.equal(payload.ports[2].distance, 315);
  assert.equal(payload.ports[3].force, 4.5);
  assert.equal(payload.ports[3].pressed, true);
  assert.equal(payload.ports[4].device, "Color Light Matrix");
  assert.equal(payload.ports[5].kind, "empty");
});

test("hub sentinel lines never reach the terminal when the monitor is off", () => {
  const outputs = [];
  const runner = new PybricksRunner({ onStdout: (text) => outputs.push(text) });

  runner._handleHubEvent(
    stdoutEvent("hello\n\x1ePYCOLLAB_HUB:H|7268|A,M,49,-135,0\nworld\n"),
  );

  assert.equal(outputs.join(""), "hello\nworld\n");
});

test("a hub sentinel split across stdout chunks is fully suppressed", () => {
  const outputs = [];
  const runner = new PybricksRunner({ onStdout: (text) => outputs.push(text) });

  runner._handleHubEvent(stdoutEvent("ok\n\x1ePYCOLLAB_HUB:H|72"));
  runner._handleHubEvent(stdoutEvent("68|A,M,49,-135,0\nmore"));

  assert.equal(outputs.join(""), "ok\nmore");
});

test("a sentinel split across the monitor-stop boundary does not leak", () => {
  const outputs = [];
  const runner = new PybricksRunner({ onStdout: (text) => outputs.push(text) });

  runner.monitorRunning = true;
  runner._handleHubEvent(stdoutEvent("\x1ePYCOLLAB_HUB:H|7268|A,M,49"));
  runner.monitorRunning = false;
  runner._carryMonitorSentinelToProgram();
  runner._handleHubEvent(stdoutEvent(",-135,0\ndone\n"));

  assert.equal(outputs.join(""), "done\n");
});

test("missing color sensor distance stays unavailable", () => {
  const payload = parseHubMonitorPayload(
    "H|7260|A,C,61,GREEN,120,85,70,38,;B,E;C,E;D,E;E,E;F,E",
    "Prime Hub",
  );

  assert.equal(payload.ports[0].distance, null);
});
