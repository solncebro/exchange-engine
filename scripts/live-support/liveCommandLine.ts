export function readTextOption(argumentList: string[], name: string): string {
  const prefix = `--${name}=`;
  const argument = argumentList.find((entry) => entry.startsWith(prefix));

  return argument === undefined ? '' : argument.slice(prefix.length);
}

/**
 * Значение переменной окружения по ОДНОМУ имени — имена задаёт соглашение этой библиотеки
 * (`.env.example`), запасных имён соседних проектов у скриптов больше нет. Пустое имя означает
 * «бирже эта величина не нужна» и даёт пустую строку.
 */
export function readEnvironmentValue(name: string): string {
  if (name === '') {
    return '';
  }

  return process.env[name] ?? '';
}
