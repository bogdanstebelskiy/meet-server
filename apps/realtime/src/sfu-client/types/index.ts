export interface HttpExceptionBody {
  statusCode?: number;
  message?: string;
}

export interface ReachableSfuNode {
  nodeUrl: string;
  roomCount: number;
}
