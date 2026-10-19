export function isPortablePayloadRelativePath(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value
            .split('/')
            .every(
                (part) =>
                    part.length > 0 &&
                    part !== '.' &&
                    part !== '..' &&
                    !/[\\:\x00-\x1f\x7f<>"|?*]/.test(part) &&
                    !/[. ]$/.test(part) &&
                    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
            )
    );
}
