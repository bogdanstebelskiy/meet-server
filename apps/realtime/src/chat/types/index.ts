export interface ChatMessage {
  id: string;
  peerId: string;
  displayName: string;
  body: string;
  ts: number;
}
