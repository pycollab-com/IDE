const VALID_PORT = /^[A-F]$/;
const CODE_VERSION = 1;
const LIVE_CONTROL_KEY_COMMANDS = new Map([
  ["w", "w"],
  ["arrowup", "w"],
  ["a", "a"],
  ["arrowleft", "a"],
  ["s", "s"],
  ["arrowdown", "s"],
  ["d", "d"],
  ["arrowright", "d"],
]);

export const LIVE_CONTROL_HOLD_HEARTBEAT_MS = 100;

export const DEFAULT_LIVE_CONTROL_CONFIG = Object.freeze({
  leftPort: "A",
  rightPort: "B",
  leftReversed: false,
  rightReversed: true,
  speed: 600,
  turnMode: "spot",
  codeVersion: CODE_VERSION,
  customCode: {
    w: "left_motor.run(speed)\nright_motor.run(speed)",
    a: "left_motor.run(-speed)\nright_motor.run(speed)",
    s: "left_motor.run(-speed)\nright_motor.run(-speed)",
    d: "left_motor.run(speed)\nright_motor.run(-speed)",
    stop: "left_motor.brake()\nright_motor.brake()",
  },
});

function clampSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_LIVE_CONTROL_CONFIG.speed;
  return Math.min(1500, Math.max(50, Math.round(speed)));
}

function normalizePort(value, fallback) {
  const port = String(value || "").trim().toUpperCase();
  return VALID_PORT.test(port) ? port : fallback;
}

function indentPython(source) {
  const normalized = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "    pass";
  return normalized
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function defaultActions(config) {
  const innerSpeed = Math.max(0, Math.round(config.speed * 0.28));
  const leftTurn =
    config.turnMode === "spot"
      ? `left_motor.run(-speed)\nright_motor.run(speed)`
      : `left_motor.run(inner_speed)\nright_motor.run(speed)`;
  const rightTurn =
    config.turnMode === "spot"
      ? `left_motor.run(speed)\nright_motor.run(-speed)`
      : `left_motor.run(speed)\nright_motor.run(inner_speed)`;

  return {
    w: "left_motor.run(speed)\nright_motor.run(speed)",
    a: leftTurn,
    s: "left_motor.run(-speed)\nright_motor.run(-speed)",
    d: rightTurn,
    stop: "left_motor.brake()\nright_motor.brake()",
    innerSpeed,
  };
}

export function getDefaultLiveControlCode(config = {}) {
  const normalizedShape = {
    speed: clampSpeed(config.speed),
    turnMode: config.turnMode === "arc" ? "arc" : "spot",
  };
  const { innerSpeed, ...code } = defaultActions(normalizedShape);
  return code;
}

export function getLiveControlCommandForKey(key) {
  return LIVE_CONTROL_KEY_COMMANDS.get(String(key || "").toLowerCase()) || null;
}

export function getActiveLiveControlCommand(pressedKeys) {
  const keys = Array.from(pressedKeys || [])
    .map((key) => getLiveControlCommandForKey(key))
    .filter(Boolean);
  return keys.at(-1) || "x";
}

export function normalizeLiveControlConfig(config = {}) {
  const leftPort = normalizePort(config.leftPort, DEFAULT_LIVE_CONTROL_CONFIG.leftPort);
  let rightPort = normalizePort(config.rightPort, DEFAULT_LIVE_CONTROL_CONFIG.rightPort);
  if (rightPort === leftPort) {
    rightPort = leftPort === "A" ? "B" : "A";
  }

  const normalized = {
    leftPort,
    rightPort,
    leftReversed: Boolean(config.leftReversed),
    rightReversed: Boolean(config.rightReversed),
    speed: clampSpeed(config.speed),
    turnMode: config.turnMode === "arc" ? "arc" : "spot",
    codeVersion: CODE_VERSION,
  };
  const defaults = getDefaultLiveControlCode(normalized);
  const customCode = config.customCode || {};
  const preserveEmptyCode = config.codeVersion === CODE_VERSION;

  return {
    ...normalized,
    customCode: {
      w: preserveEmptyCode && typeof customCode.w === "string" ? customCode.w : String(customCode.w || defaults.w),
      a: preserveEmptyCode && typeof customCode.a === "string" ? customCode.a : String(customCode.a || defaults.a),
      s: preserveEmptyCode && typeof customCode.s === "string" ? customCode.s : String(customCode.s || defaults.s),
      d: preserveEmptyCode && typeof customCode.d === "string" ? customCode.d : String(customCode.d || defaults.d),
      stop:
        preserveEmptyCode && typeof customCode.stop === "string"
          ? customCode.stop
          : String(customCode.stop || defaults.stop),
    },
  };
}

export function createPybricksLiveControlSource(rawConfig = {}) {
  const config = normalizeLiveControlConfig(rawConfig);
  const defaults = defaultActions(config);
  const actions = config.customCode;
  const leftDirection = config.leftReversed ? "COUNTERCLOCKWISE" : "CLOCKWISE";
  const rightDirection = config.rightReversed ? "COUNTERCLOCKWISE" : "CLOCKWISE";

  return `from pybricks.parameters import Direction, Port
from pybricks.pupdevices import Motor
from pybricks.tools import StopWatch, wait
from uselect import poll
from usys import stdin

left_motor = Motor(Port.${config.leftPort}, positive_direction=Direction.${leftDirection})
right_motor = Motor(Port.${config.rightPort}, positive_direction=Direction.${rightDirection})
speed = ${config.speed}
inner_speed = ${defaults.innerSpeed}

def move_forward():
${indentPython(actions.w)}

def turn_left():
${indentPython(actions.a)}

def move_backward():
${indentPython(actions.s)}

def turn_right():
${indentPython(actions.d)}

def stop_motors():
${indentPython(actions.stop)}

handlers = {
    "w": move_forward,
    "a": turn_left,
    "s": move_backward,
    "d": turn_right,
    "x": stop_motors,
}

keyboard = poll()
keyboard.register(stdin)
watchdog = StopWatch()
moving = False
stop_motors()
print("[drive] WASD / arrow-key control ready")

while True:
    if keyboard.poll(20):
        command = stdin.read(1)
        handler = handlers.get(command)
        if handler:
            handler()
            moving = command != "x"
            watchdog.reset()
    elif moving and watchdog.time() > 350:
        stop_motors()
        moving = False
    else:
        wait(5)
`;
}
