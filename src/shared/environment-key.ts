export function findEnvironmentKey(
    environment: Readonly<Record<string, string | undefined>>,
    name: string,
    windows = false,
): string | undefined {
    return windows
        ? Object.keys(environment).findLast((key) => key.toLowerCase() === name.toLowerCase())
        : name in environment
          ? name
          : undefined;
}
