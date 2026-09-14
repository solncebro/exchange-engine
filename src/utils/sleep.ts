export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timerId = setTimeout(resolve, milliseconds);
    timerId.unref?.();
  });
}
