export interface LiveLogRecord {
  level: string;
  text: string;
}

export interface LiveLoggerArgs {
  isVerbose: boolean;
  recordList: LiveLogRecord[];
}
