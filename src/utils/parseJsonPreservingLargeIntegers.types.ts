export interface JsonSourceContext {
  source: string;
}

export interface JsonParseWithSource {
  (text: string, reviver: (key: string, value: unknown, context: JsonSourceContext) => unknown): unknown;
}
