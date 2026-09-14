/** Преобразование значения параметра перед отправкой: биржи кладут их на провод по-разному. */
export type HttpParamValueTransform = (value: string | number | boolean) => string | number | boolean;
