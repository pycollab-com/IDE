import {
  type Connection,
  Server,
  type WSMessage,
  routePartykitRequest,
} from "partyserver";

import type { RealtimeEnvelope, RealtimeMessage } from "../shared";

interface Env {}

const messageKey = (message: RealtimeMessage) => message.client_message_id || message.id;

const escapeSql = (value: string) => value.replace(/'/g, "''");

const messageTimestamp = (value: string | undefined | null) => {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? 0 : parsed;
};

export class Messages extends Server<Env> {
  static options = { hibernate: true };

  messages = [] as RealtimeMessage[];

  broadcastEnvelope(envelope: RealtimeEnvelope, exclude?: string[]) {
    this.broadcast(JSON.stringify(envelope), exclude);
  }

  onStart() {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (key TEXT PRIMARY KEY, created_at TEXT, payload TEXT)",
    );

    const rows = this.ctx.storage.sql
      .exec("SELECT payload FROM messages ORDER BY created_at ASC")
      .toArray() as { payload: string }[];

    this.messages = rows
      .map((row) => {
        try {
          return JSON.parse(row.payload) as RealtimeMessage;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as RealtimeMessage[];
  }

  saveMessage(message: RealtimeMessage) {
    const key = messageKey(message);
    const createdAt = message.created_at || new Date().toISOString();

    const existingIndex = this.messages.findIndex((m) => messageKey(m) === key);
    if (existingIndex !== -1) {
      this.messages[existingIndex] = message;
    } else {
      this.messages.push(message);
    }
    this.messages.sort(
      (a, b) => messageTimestamp(a.created_at) - messageTimestamp(b.created_at),
    );

    const safeKey = escapeSql(key);
    const safeCreatedAt = escapeSql(createdAt);
    const safePayload = escapeSql(JSON.stringify(message));
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (key, created_at, payload) VALUES ('${safeKey}', '${safeCreatedAt}', '${safePayload}') ON CONFLICT (key) DO UPDATE SET payload='${safePayload}', created_at='${safeCreatedAt}'`,
    );
  }

  saveMessages(messages: RealtimeMessage[]) {
    messages.forEach((message) => {
      if (!message) return;
      this.saveMessage(message);
    });
  }

  onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({
        type: "all",
        messages: this.messages,
      } satisfies RealtimeEnvelope),
    );
  }

  onMessage(connection: Connection, message: WSMessage) {
    let parsed: RealtimeEnvelope;
    try {
      parsed = JSON.parse(message as string) as RealtimeEnvelope;
    } catch {
      return;
    }

    if (parsed.type === "hydrate") {
      this.saveMessages(parsed.messages || []);
      connection.send(
        JSON.stringify({
          type: "all",
          messages: this.messages,
        } satisfies RealtimeEnvelope),
      );
      return;
    }

    if (parsed.type === "add" || parsed.type === "update") {
      if (!parsed.message) return;
      this.saveMessage(parsed.message);
      this.broadcast(message);
    }
  }
}

export default {
  async fetch(request, env) {
    return (
      (await routePartykitRequest(request, { ...env })) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
