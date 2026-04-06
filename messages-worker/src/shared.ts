export type RealtimeMessage = {
  id: string;
  conversation_id: string;
  sender_id: number;
  body: string;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  client_message_id?: string | null;
};

export type RealtimeEnvelope =
  | {
      type: "all";
      messages: RealtimeMessage[];
    }
  | {
      type: "add";
      message: RealtimeMessage;
    }
  | {
      type: "update";
      message: RealtimeMessage;
    }
  | {
      type: "hydrate";
      messages: RealtimeMessage[];
    };
