import net from "node:net";
import type { ServerStatus } from "@assetown/shared";

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let current = value;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (current !== 0);
  return Buffer.from(bytes);
}

function writeString(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([writeVarInt(data.length), data]);
}

function packet(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function readVarIntFromBuffer(buffer: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  let position = 0;
  let size = 0;
  while (true) {
    if (offset + size >= buffer.length) return null;
    const byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * position);
    size += 1;
    position += 1;
    if ((byte & 0x80) === 0) break;
    if (size > 5) return null;
  }
  return { value, size };
}

function describeMotd(description: unknown): string {
  if (typeof description === "string") return description;
  if (description && typeof description === "object") {
    const node = description as { text?: string; extra?: unknown[] };
    let text = node.text ?? "";
    if (Array.isArray(node.extra)) {
      text += node.extra.map((part) => (typeof part === "string" ? part : describeMotd(part))).join("");
    }
    return text;
  }
  return "";
}

export function offlineStatus(): ServerStatus {
  return { online: false, players: null, version: null, latency: null, motd: null, checkedAt: new Date().toISOString() };
}

export function pingServer(host: string, port: number, timeoutMs = 2500): Promise<ServerStatus> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let buffer = Buffer.alloc(0);

    // Minuterie dure : la résolution DNS n'est pas couverte par socket.setTimeout
    const hardTimer = setTimeout(() => finish(offlineStatus()), timeoutMs);
    if (typeof hardTimer.unref === "function") hardTimer.unref();

    const finish = (status: ServerStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(offlineStatus()));
    socket.on("error", () => finish(offlineStatus()));
    socket.connect(port, host, () => {
      const handshake = packet(
        0x00,
        Buffer.concat([writeVarInt(765), writeString(host), Buffer.from([(port >> 8) & 0xff, port & 0xff]), writeVarInt(1)]),
      );
      socket.write(Buffer.concat([handshake, packet(0x00, Buffer.alloc(0))]));
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const lengthInfo = readVarIntFromBuffer(buffer, 0);
      if (!lengthInfo) return;
      if (buffer.length < lengthInfo.size + lengthInfo.value) return;
      const body = buffer.subarray(lengthInfo.size, lengthInfo.size + lengthInfo.value);
      const idInfo = readVarIntFromBuffer(body, 0);
      if (!idInfo || idInfo.value !== 0x00) {
        finish(offlineStatus());
        return;
      }
      const stringLength = readVarIntFromBuffer(body, idInfo.size);
      if (!stringLength) {
        finish(offlineStatus());
        return;
      }
      const start = idInfo.size + stringLength.size;
      const json = body.subarray(start, start + stringLength.value).toString("utf8");
      try {
        const status = JSON.parse(json) as {
          version?: { name?: string };
          players?: { online?: number; max?: number };
          description?: unknown;
        };
        finish({
          online: true,
          players: {
            online: status.players?.online ?? 0,
            max: status.players?.max ?? 0,
          },
          version: status.version?.name ?? null,
          latency: Date.now() - started,
          motd: describeMotd(status.description).slice(0, 200),
          checkedAt: new Date().toISOString(),
        });
      } catch {
        finish(offlineStatus());
      }
    });
  });
}

/** Cache court pour ne pas marteler les serveurs Minecraft. */
const cache = new Map<string, { at: number; status: ServerStatus }>();

export async function cachedPing(host: string, port: number, ttlMs = 20_000): Promise<ServerStatus> {
  const key = `${host}:${port}`;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < ttlMs) return entry.status;
  const status = await pingServer(host, port);
  cache.set(key, { at: Date.now(), status });
  return status;
}
