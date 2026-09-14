/** Ответ биржи по ОДНОЙ записи пачки: объявленные поля приезжают с провода и могут не приехать. */
export interface BatchEntryStatusRaw {
  code: number;
  msg: string;
}
