import type { WebSocketConnectionInfo } from '../types/common';

interface FormatWebSocketConnectionsReportArgs {
  connectionInfoList: WebSocketConnectionInfo[];
  formatTimestamp?: (epochMs: number) => string;
  nowTimestamp?: number;
  headerLine?: string;
  maxSymbolListSize?: number;
}

const DEFAULT_MAX_SYMBOL_LIST_SIZE = 10;

interface SubscriptionGroup {
  typeName: string;
  symbolList: string[];
  isPlainTopic: boolean;
}

const defaultFormatTimestamp = (epochMs: number): string =>
  new Date(epochMs).toISOString().replace('T', ' ').slice(0, 19);

const buildSubscriptionGroupList = (
  subscriptionList: string[],
): SubscriptionGroup[] => {
  const symbolSetByType = new Map<string, Set<string>>();
  const isPlainByType = new Map<string, boolean>();
  const typeOrderList: string[] = [];

  for (const item of subscriptionList) {
    const partList = item.split(' ');
    const typeName = partList[0];

    if (typeName.length === 0) {
      continue;
    }

    if (!symbolSetByType.has(typeName)) {
      symbolSetByType.set(typeName, new Set());
      isPlainByType.set(typeName, true);
      typeOrderList.push(typeName);
    }

    const symbolSet = symbolSetByType.get(typeName);

    if (symbolSet && partList.length > 1 && partList[1] !== undefined) {
      symbolSet.add(partList[1]);
      isPlainByType.set(typeName, false);
    }
  }

  return typeOrderList.map((typeName) => ({
    typeName,
    symbolList: [...(symbolSetByType.get(typeName) ?? new Set())].sort(),
    isPlainTopic: isPlainByType.get(typeName) ?? false,
  }));
};

const calcCommonLabelPrefix = (labelList: string[]): string => {
  if (labelList.length === 0) {
    return '';
  }

  const firstLabel = labelList[0];
  const lastSpaceIndex = firstLabel.lastIndexOf(' ');

  if (lastSpaceIndex === -1) {
    return '';
  }

  const candidatePrefix = `${firstLabel.slice(0, lastSpaceIndex)} `;

  for (const label of labelList) {
    if (!label.startsWith(candidatePrefix)) {
      return '';
    }
  }

  return candidatePrefix;
};

export function formatWebSocketConnectionsReport(
  args: FormatWebSocketConnectionsReportArgs,
): string {
  const {
    connectionInfoList,
    formatTimestamp = defaultFormatTimestamp,
    nowTimestamp = Date.now(),
    headerLine = '🌐 WebSocket Connections',
    maxSymbolListSize = DEFAULT_MAX_SYMBOL_LIST_SIZE,
  } = args;

  const lineList: string[] = [];
  const labelList = connectionInfoList.map((info) => info.label);
  const commonPrefix = calcCommonLabelPrefix(labelList);

  lineList.push(headerLine);
  lineList.push(`now: ${formatTimestamp(nowTimestamp)}`);

  const summaryLine =
    commonPrefix.length > 0
      ? `total: ${connectionInfoList.length} | source: ${commonPrefix.trimEnd()}`
      : `total: ${connectionInfoList.length}`;

  lineList.push(summaryLine);
  lineList.push('');

  for (const info of connectionInfoList) {
    const connectedMark = info.isConnected ? '✅' : '❌';
    const messageCount = info.messageCount ?? 0;
    const lastMessageTimestamp = info.lastMessageTimestamp ?? 0;
    const ageMs =
      lastMessageTimestamp > 0 ? nowTimestamp - lastMessageTimestamp : 0;
    const ageSeconds = Math.floor(ageMs / 1000);
    const ageDisplay =
      lastMessageTimestamp > 0 ? `${ageSeconds}s ago` : 'never';

    const shortLabel =
      commonPrefix.length > 0
        ? info.label.slice(commonPrefix.length)
        : info.label;
    const streamCount = info.subscriptionList.length;

    lineList.push(
      `${connectedMark} ${shortLabel} | ${streamCount} streams | ${messageCount} msgs | ${ageDisplay}`,
    );

    const groupList = buildSubscriptionGroupList(info.subscriptionList);
    const plainTopicNameList: string[] = [];

    for (const group of groupList) {
      if (group.isPlainTopic) {
        plainTopicNameList.push(group.typeName);

        continue;
      }

      const symbolCount = group.symbolList.length;
      const summary =
        symbolCount > maxSymbolListSize
          ? `${group.typeName}: ${symbolCount} symbols`
          : `${group.typeName}: ${group.symbolList.join(', ')}`;

      lineList.push(`   ${summary}`);
    }

    if (plainTopicNameList.length > 0) {
      lineList.push(`   ${plainTopicNameList.join(', ')}`);
    }

    lineList.push('');
  }

  return lineList.join('\n');
}

export type { FormatWebSocketConnectionsReportArgs };
