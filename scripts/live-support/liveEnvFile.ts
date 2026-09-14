import { existsSync, readFileSync } from 'node:fs';
import type { LoadEnvFileResult } from './liveEnvFile.types';
import { printNote } from './liveOutput';

const COMMENT_PREFIX = '#';
const EXPORT_PREFIX = 'export ';
const NAME_VALUE_SEPARATOR = '=';
const QUOTE_CHARACTER_LIST = ['"', "'"];
const MIN_QUOTED_VALUE_LENGTH = 2;

function stripSurroundingQuotes(value: string): string {
  if (value.length < MIN_QUOTED_VALUE_LENGTH) {
    return value;
  }

  const firstCharacter = value[0];

  if (!QUOTE_CHARACTER_LIST.includes(firstCharacter)) {
    return value;
  }

  if (value[value.length - 1] !== firstCharacter) {
    return value;
  }

  return value.slice(1, -1);
}

/**
 * Читает файл вида `.env` собственным разборщиком: пакета `dotenv` в зависимостях нет и ставить его
 * нельзя. Понимает строки `KEY=VALUE` и `export KEY=VALUE`, срезает пробелы по краям, снимает
 * кавычки по краям значения, пропускает пустые строки и строки с `#` в начале.
 *
 * Переменная оболочки СИЛЬНЕЕ файла: уже заданное имя не перезаписывается, оно уходит в
 * `skippedNameList`. Наружу выходят только ИМЕНА — значение ключа не должно попасть ни в печать,
 * ни в отчёт.
 */
export function loadEnvFile(filePath: string): LoadEnvFileResult {
  if (!existsSync(filePath)) {
    return { isFound: false, loadedNameList: [], skippedNameList: [] };
  }

  const loadedNameList: string[] = [];
  const skippedNameList: string[] = [];

  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith(COMMENT_PREFIX)) {
      continue;
    }

    const statement = line.startsWith(EXPORT_PREFIX) ? line.slice(EXPORT_PREFIX.length).trim() : line;
    const separatorIndex = statement.indexOf(NAME_VALUE_SEPARATOR);

    if (separatorIndex <= 0) {
      continue;
    }

    const name = statement.slice(0, separatorIndex).trim();

    if (name === '') {
      continue;
    }

    if (process.env[name] !== undefined) {
      skippedNameList.push(name);

      continue;
    }

    process.env[name] = stripSurroundingQuotes(statement.slice(separatorIndex + 1).trim());
    loadedNameList.push(name);
  }

  return { isFound: true, loadedNameList, skippedNameList };
}

function buildEnvFileNote(filePath: string, result: LoadEnvFileResult): string {
  if (!result.isFound) {
    return `${filePath}: файла нет — ключи берутся только из окружения оболочки`;
  }

  const loadedText = result.loadedNameList.length === 0 ? 'ни одного' : result.loadedNameList.join(', ');
  const skippedText =
    result.skippedNameList.length === 0
      ? 'оболочка своих имён не задавала'
      : `оболочка сильнее файла для: ${result.skippedNameList.join(', ')}`;

  return `${filePath}: файл найден, взято имён ${result.loadedNameList.length} (${loadedText}); ${skippedText}`;
}

/**
 * Загружает файл и печатает ОДНУ строку о том, что вышло: только имена переменных, никаких значений.
 * Зовётся первым действием обоих живых скриптов — до того, как читаются ключи и вооружается замена
 * ключей звёздочками, поэтому в этой строке секрету взяться неоткуда.
 */
export function announceEnvFile(filePath: string): LoadEnvFileResult {
  const result = loadEnvFile(filePath);

  printNote(buildEnvFileNote(filePath, result));

  return result;
}
