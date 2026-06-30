const HUB_MONITOR_PREFIX = "\x1ePYCOLLAB_HUB:";

const HUB_PROFILES = {
  "Prime Hub": { hubClass: "PrimeHub", ports: ["A", "B", "C", "D", "E", "F"], batteryMinMv: 6000, batteryMaxMv: 8400, genericPorts: true },
  "Inventor Hub": { hubClass: "InventorHub", ports: ["A", "B", "C", "D", "E", "F"], batteryMinMv: 6000, batteryMaxMv: 8400, genericPorts: true },
  "Essential Hub": { hubClass: "EssentialHub", ports: ["A", "B"], batteryMinMv: 6000, batteryMaxMv: 8400, genericPorts: true },
  "Technic Hub": { hubClass: "TechnicHub", ports: ["A", "B", "C", "D"], batteryMinMv: 5400, batteryMaxMv: 9000, genericPorts: true },
  "City Hub": { hubClass: "CityHub", ports: ["A", "B"], batteryMinMv: 3600, batteryMaxMv: 6000, genericPorts: true },
  "Move Hub": { hubClass: "MoveHub", ports: ["A", "B", "C", "D"], batteryMinMv: 5400, batteryMaxMv: 9000, genericPorts: false },
};

const DEFAULT_PROFILE = HUB_PROFILES["Prime Hub"];

export const HUB_DEVICE_NAMES = {
  1: "Medium Motor",
  2: "Train Motor",
  5: "Touch Sensor",
  6: "Large Motor",
  7: "XL Motor",
  8: "Lights",
  37: "Color & Distance Sensor",
  38: "Interactive Motor",
  46: "Technic L Motor",
  47: "Technic XL Motor",
  48: "SPIKE M Motor",
  49: "SPIKE L Motor",
  61: "Color Sensor",
  62: "Ultrasonic Sensor",
  63: "Force Sensor",
  64: "Color Light Matrix",
  65: "SPIKE S Motor",
  75: "Technic M Angular Motor",
  76: "Technic L Angular Motor",
};

export function estimateBatteryPercent(voltageMv, hubType) {
  if (!Number.isFinite(voltageMv) || voltageMv <= 0) return null;
  const profile = HUB_PROFILES[hubType] || DEFAULT_PROFILE;
  const ratio = (voltageMv - profile.batteryMinMv) / (profile.batteryMaxMv - profile.batteryMinMv);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

export function getHubMonitorPrefix() {
  return HUB_MONITOR_PREFIX;
}

export function getHubPortNames(hubType) {
  return [...(HUB_PROFILES[hubType] || DEFAULT_PROFILE).ports];
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseHubMonitorPayload(payload, hubType) {
  const parts = String(payload || "").trim().split("|");
  const batteryVoltage = numberOrNull(parts[1]);
  if (!batteryVoltage || (parts[0] !== "B" && parts[0] !== "H")) return null;

  const portsByName = new Map();
  if (parts[0] === "H" && parts[2]) {
    parts[2].split(";").forEach((record) => {
      const fields = record.split(",");
      const [port, kind, deviceIdText] = fields;
      const deviceId = numberOrNull(deviceIdText);
      if (!port || !kind) return;

      const base = {
        port,
        kind: "device",
        deviceId,
        device: HUB_DEVICE_NAMES[deviceId] || (deviceId ? `Device ${deviceId}` : "Connected device"),
      };
      if (kind === "E") {
        portsByName.set(port, { port, kind: "empty", device: "" });
      } else if (kind === "M") {
        portsByName.set(port, {
          ...base,
          kind: "motor",
          device: HUB_DEVICE_NAMES[deviceId] || "Motor",
          angle: numberOrNull(fields[3]),
          speed: numberOrNull(fields[4]),
        });
      } else if (kind === "C") {
        const distance = numberOrNull(fields[8]);
        portsByName.set(port, {
          ...base,
          kind: "color",
          device: HUB_DEVICE_NAMES[deviceId] || "Color Sensor",
          color: fields[3] || "NONE",
          hsv: [numberOrNull(fields[4]), numberOrNull(fields[5]), numberOrNull(fields[6])],
          reflection: numberOrNull(fields[7]),
          distance: distance !== null && distance >= 0 ? distance : null,
          ambient: numberOrNull(fields[9]),
        });
      } else if (kind === "D") {
        portsByName.set(port, {
          ...base,
          kind: "distance",
          device: HUB_DEVICE_NAMES[deviceId] || "Distance Sensor",
          distance: numberOrNull(fields[3]),
        });
      } else if (kind === "F") {
        portsByName.set(port, {
          ...base,
          kind: "force",
          device: HUB_DEVICE_NAMES[deviceId] || "Force Sensor",
          force: numberOrNull(fields[3]),
          pressed: fields[4] === "1",
        });
      } else {
        portsByName.set(port, base);
      }
    });
  }

  const ports = getHubPortNames(hubType).map(
    (port) => portsByName.get(port) || { port, kind: "empty", device: "" },
  );
  const { motion, buttons } = parseHubSensors(parts[3]);
  return { batteryVoltage, ports, motion, buttons };
}

function parseHubSensors(section) {
  let motion = null;
  let buttons = [];
  if (!section) return { motion, buttons };
  section.split(";").forEach((record) => {
    const fields = record.split(",");
    if (fields[0] === "I") {
      motion = {
        up: fields[1] || null,
        tilt: [numberOrNull(fields[2]), numberOrNull(fields[3])],
        heading: numberOrNull(fields[4]),
        acceleration: [numberOrNull(fields[5]), numberOrNull(fields[6]), numberOrNull(fields[7])],
        angularVelocity: [numberOrNull(fields[8]), numberOrNull(fields[9]), numberOrNull(fields[10])],
        stationary: fields[11] === "1",
      };
    } else if (fields[0] === "BTN") {
      buttons = fields[1] ? fields[1].split("+").filter(Boolean) : [];
    }
  });
  return { motion, buttons };
}

export function createHubMonitorBootstrap(hubType) {
  const profile = HUB_PROFILES[hubType] || DEFAULT_PROFILE;
  return `from pybricks.hubs import ${profile.hubClass};hub=${profile.hubClass}();print(${JSON.stringify(`${HUB_MONITOR_PREFIX}B|`)}+str(hub.battery.voltage()))\r`;
}

// Reads hub-level sensors (IMU + buttons) appended to every telemetry line.
// Each block is independently guarded so a hub without an IMU still reports
// buttons, and a transient read error never drops the whole frame.
function createSensorReaderSource() {
  return `
def read_hub_sensors():
    out = []
    try:
        up = str(hub.imu.up()).rsplit(".", 1)[-1]
        pitch, roll = hub.imu.tilt()
        ax, ay, az = hub.imu.acceleration()
        gx, gy, gz = hub.imu.angular_velocity()
        out.append("I," + up + "," + str(pitch) + "," + str(roll) + "," + str(round(hub.imu.heading())) + "," + str(round(ax)) + "," + str(round(ay)) + "," + str(round(az)) + "," + str(round(gx)) + "," + str(round(gy)) + "," + str(round(gz)) + "," + ("1" if hub.imu.stationary() else "0"))
    except Exception:
        pass
    try:
        pressed = hub.buttons.pressed()
        out.append("BTN," + "+".join(str(b).rsplit(".", 1)[-1] for b in pressed))
    except Exception:
        pass
    return ";".join(out)`.trim();
}

// Action commands arrive on stdin as plain lines while the telemetry loop runs.
// read_input_byte is non-blocking; the guard keeps older firmware printing
// readings instead of crashing on the missing import. Motor lookup goes through
// the shared devices dict via duck typing so it works for both port profiles.
function createCommandHandlerSource() {
  return `
try:
    from pybricks.tools import read_input_byte
    can_interrupt = True
except ImportError:
    read_input_byte = lambda: None
    can_interrupt = False

command_colors = {"RED": Color.RED, "ORANGE": Color.ORANGE, "YELLOW": Color.YELLOW, "GREEN": Color.GREEN, "CYAN": Color.CYAN, "BLUE": Color.BLUE, "VIOLET": Color.VIOLET, "MAGENTA": Color.MAGENTA, "WHITE": Color.WHITE}
command_tunes = {"up": ["C4/8", "E4/8", "G4/8", "C5/8"], "down": ["C5/8", "G4/8", "E4/8", "C4/8"], "tada": ["G4/8", "G4/8", "G4/8", "C5/4"]}
command_buffer = ""

def command_motor(name):
    entry = devices.get(name)
    if entry and hasattr(entry[1], "run"):
        return entry[1]
    return None

def run_light(parts):
    if len(parts) >= 2 and parts[1] == "off":
        hub.light.off()
    elif len(parts) >= 3 and parts[1] == "blink" and parts[2].upper() in command_colors:
        hub.light.blink(command_colors[parts[2].upper()], [400, 400])
    elif len(parts) >= 5 and parts[1] == "hsv":
        hub.light.on(Color(int(parts[2]), int(parts[3]), int(parts[4])))
    elif len(parts) >= 2 and parts[1].upper() in command_colors:
        hub.light.on(command_colors[parts[1].upper()])

def run_motor(parts):
    motor = command_motor(parts[1]) if len(parts) >= 3 else None
    if not motor:
        return
    verb = parts[2]
    if verb == "run" and len(parts) >= 4:
        motor.run(int(parts[3]))
    elif verb == "stop":
        motor.stop()
    elif verb == "brake":
        motor.brake()
    elif verb == "hold":
        motor.hold()
    elif verb == "zero":
        motor.reset_angle(0)
    elif verb == "angle" and len(parts) >= 5:
        motor.run_angle(int(parts[3]), int(parts[4]), wait=False)

def run_display(parts):
    if len(parts) >= 2 and parts[1] == "off":
        hub.display.off()
    elif len(parts) >= 3 and parts[1] == "icon" and hasattr(Icon, parts[2].upper()):
        hub.display.icon(getattr(Icon, parts[2].upper()))
    elif len(parts) >= 3 and parts[1] == "number":
        hub.display.number(int(parts[2]))
    elif len(parts) >= 3 and parts[1] == "char":
        hub.display.char(parts[2][:1])
    elif len(parts) >= 3 and parts[1] == "draw" and len(parts[2]) >= 25:
        data = parts[2]
        hub.display.icon([[int(data[r * 5 + c]) * 11 for c in range(5)] for r in range(5)])
    elif len(parts) >= 3 and parts[1] == "scroll" and parts[2]:
        delay = min(200, max(15, int(parts[3]))) if len(parts) >= 4 else 60
        loop = len(parts) >= 5 and parts[4] == "1" and can_interrupt
        seq = [0, 0, 0, 0, 0] + [ord(ch) - 48 for ch in parts[2][:240]] + [0, 0, 0, 0, 0]
        stop = False
        while not stop:
            i = 0
            while i + 5 <= len(seq):
                hub.display.icon([[99 if (seq[i + c] >> r) & 1 else 0 for c in range(5)] for r in range(5)])
                wait(delay)
                i += 1
                if read_input_byte() is not None:
                    stop = True
                    break
            if not loop:
                break
        hub.display.off()

def run_command(line):
    parts = line.split()
    if not parts:
        return
    if parts[0] == "light":
        run_light(parts)
    elif parts[0] == "motor":
        run_motor(parts)
    elif parts[0] == "display" and hasattr(hub, "display"):
        run_display(parts)
    elif parts[0] == "beep" and hasattr(hub, "speaker"):
        hub.speaker.beep(int(parts[1]), int(parts[2])) if len(parts) >= 3 else hub.speaker.beep()
    elif parts[0] == "volume" and hasattr(hub, "speaker") and len(parts) >= 2:
        hub.speaker.volume(int(parts[1]))
    elif parts[0] == "tune" and hasattr(hub, "speaker") and len(parts) >= 2 and parts[1] in command_tunes:
        hub.speaker.play_notes(command_tunes[parts[1]])
    elif parts[0] == "heading" and len(parts) >= 2 and parts[1] == "reset" and hasattr(hub, "imu"):
        hub.imu.reset_heading(0)
    elif parts[0] == "shutdown":
        hub.system.shutdown()

def poll_commands():
    global command_buffer
    while True:
        byte = read_input_byte()
        if byte is None:
            break
        if byte == 10 or byte == 13:
            if command_buffer:
                try:
                    run_command(command_buffer)
                except Exception:
                    pass
                command_buffer = ""
        else:
            command_buffer += chr(byte)`.trim();
}

function createGenericMonitorSource(ports) {
  return `
from pybricks.iodevices import PUPDevice
from pybricks.parameters import Color, Icon, Port
from pybricks.pupdevices import ColorDistanceSensor, ColorSensor, ForceSensor, Motor, UltrasonicSensor
from pybricks.tools import wait

ports = (${ports},)
devices = {}
motor_ids = (38, 46, 47, 48, 49, 65, 75, 76)

def color_name(value):
    return str(value).rsplit(".", 1)[-1]

def connect_device(port):
    generic = PUPDevice(port)
    device_id = generic.info().get("id", 0)
    if device_id in motor_ids:
        return device_id, Motor(port)
    if device_id == 61:
        return device_id, ColorSensor(port)
    if device_id == 37:
        return device_id, ColorDistanceSensor(port)
    if device_id == 62:
        return device_id, UltrasonicSensor(port)
    if device_id == 63:
        return device_id, ForceSensor(port)
    return device_id, generic

def read_device(name, port):
    try:
        device_id, device = devices.get(name) or connect_device(port)
        devices[name] = (device_id, device)
        if device_id in motor_ids:
            return name + ",M," + str(device_id) + "," + str(device.angle()) + "," + str(device.speed())
        if device_id in (37, 61):
            hsv = device.hsv()
            distance = device.distance() if device_id == 37 else -1
            return name + ",C," + str(device_id) + "," + color_name(device.color()) + "," + str(hsv.h) + "," + str(hsv.s) + "," + str(hsv.v) + "," + str(device.reflection()) + "," + str(distance) + "," + str(device.ambient())
        if device_id == 62:
            return name + ",D," + str(device_id) + "," + str(device.distance())
        if device_id == 63:
            return name + ",F," + str(device_id) + "," + str(device.force()) + "," + ("1" if device.pressed() else "0")
        return name + ",G," + str(device_id)
    except Exception:
        devices.pop(name, None)
        return name + ",E"

${createSensorReaderSource()}

${createCommandHandlerSource()}

while True:
    poll_commands()
    readings = [read_device(name, port) for name, port in ports]
    print(${JSON.stringify(`${HUB_MONITOR_PREFIX}H|`)} + str(hub.battery.voltage()) + "|" + ";".join(readings) + "|" + read_hub_sensors())
    wait(250)
`.trim();
}

function createMoveHubMonitorSource(ports) {
  return `
from pybricks.parameters import Color, Icon, Port
from pybricks.pupdevices import ColorDistanceSensor, ColorSensor, ForceSensor, Motor, UltrasonicSensor
from pybricks.tools import wait

ports = (${ports},)
devices = {}

def color_name(value):
    return str(value).rsplit(".", 1)[-1]

def connect_device(name, port):
    if name in ("A", "D"):
        return "M", Motor(port)
    for kind, device_type in (("M", Motor), ("C", ColorSensor), ("C", ColorDistanceSensor), ("D", UltrasonicSensor), ("F", ForceSensor)):
        try:
            return kind, device_type(port)
        except Exception:
            pass
    return "E", None

def read_device(name, port):
    try:
        kind, device = devices.get(name) or connect_device(name, port)
        devices[name] = (kind, device)
        if kind == "M":
            return name + ",M,0," + str(device.angle()) + "," + str(device.speed())
        if kind == "C":
            hsv = device.hsv()
            distance = device.distance() if hasattr(device, "distance") else -1
            return name + ",C,0," + color_name(device.color()) + "," + str(hsv.h) + "," + str(hsv.s) + "," + str(hsv.v) + "," + str(device.reflection()) + "," + str(distance) + "," + str(device.ambient())
        if kind == "D":
            return name + ",D,0," + str(device.distance())
        if kind == "F":
            return name + ",F,0," + str(device.force()) + "," + ("1" if device.pressed() else "0")
    except Exception:
        devices.pop(name, None)
    return name + ",E"

${createSensorReaderSource()}

${createCommandHandlerSource()}

while True:
    poll_commands()
    readings = [read_device(name, port) for name, port in ports]
    print(${JSON.stringify(`${HUB_MONITOR_PREFIX}H|`)} + str(hub.battery.voltage()) + "|" + ";".join(readings) + "|" + read_hub_sensors())
    wait(250)
`.trim();
}

export function createHubMonitorSource(hubType) {
  const profile = HUB_PROFILES[hubType] || DEFAULT_PROFILE;
  const ports = profile.ports.map((name) => `("${name}", Port.${name})`).join(", ");
  return profile.genericPorts ? createGenericMonitorSource(ports) : createMoveHubMonitorSource(ports);
}
