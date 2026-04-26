const CONTROL_READ = 0;
const CONTROL_WRITE = 1;
const CONTROL_CLOSED = 2;
const CONTROL_SIZE = 4;
const DEFAULT_BUFFER_SIZE = 64 * 1024;

const encoder = new TextEncoder();

export function createStdinRingBuffer(size = DEFAULT_BUFFER_SIZE) {
  const normalizedSize = Math.max(1024, Number(size) || DEFAULT_BUFFER_SIZE);
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * CONTROL_SIZE);
  const dataBuffer = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * normalizedSize);
  const control = new Int32Array(controlBuffer);
  const data = new Uint8Array(dataBuffer);
  Atomics.store(control, CONTROL_READ, 0);
  Atomics.store(control, CONTROL_WRITE, 0);
  Atomics.store(control, CONTROL_CLOSED, 0);
  return {
    size: normalizedSize,
    control,
    data,
    controlBuffer,
    dataBuffer,
  };
}

export function resetStdinRingBuffer(ring) {
  if (!ring) return;
  Atomics.store(ring.control, CONTROL_READ, 0);
  Atomics.store(ring.control, CONTROL_WRITE, 0);
  Atomics.store(ring.control, CONTROL_CLOSED, 0);
  Atomics.notify(ring.control, CONTROL_WRITE, 1);
}

export function closeStdinRingBuffer(ring) {
  if (!ring) return;
  Atomics.store(ring.control, CONTROL_CLOSED, 1);
  Atomics.notify(ring.control, CONTROL_WRITE, 1);
}

export function writeStdinRingBuffer(ring, value) {
  if (!ring || typeof value !== "string") {
    return false;
  }

  if (Atomics.load(ring.control, CONTROL_CLOSED) === 1) {
    return false;
  }

  const bytes = encoder.encode(value);
  const size = ring.size;
  const data = ring.data;
  const control = ring.control;

  for (let i = 0; i < bytes.length; i += 1) {
    const read = Atomics.load(control, CONTROL_READ);
    const write = Atomics.load(control, CONTROL_WRITE);
    const nextWrite = (write + 1) % size;
    if (nextWrite === read) {
      return false;
    }
    data[write] = bytes[i];
    Atomics.store(control, CONTROL_WRITE, nextWrite);
  }

  Atomics.notify(control, CONTROL_WRITE, 1);
  return true;
}
