export interface SendChatMessagePayload {
  body: string;
}

export interface GetChatHistoryPayload {
  afterId?: string;
}
