export function validateYamlFilename(file: string): string[] {
    if (!/\.ya?ml$/i.test(file) || file.endsWith('.yaml') || file === '.github/ISSUE_TEMPLATE/config.yml') return [];
    return [`${file}: maintained YAML filenames must use lowercase .yaml.`];
}

export function validateTextStyle(file: string, source: string) {
    const errors = [];
    if (source.includes('\r')) errors.push(`${file}: use LF, not CRLF.`);
    if (source.includes('\t')) errors.push(`${file}: tabs are prohibited.`);
    if (source && !source.endsWith('\n')) errors.push(`${file}: add a final newline.`);
    if (
        !['pnpm-lock.yaml', 'tooling/security/upstream-pnpm-lock.yaml'].includes(file) &&
        /\.(?:json|yaml|yml|ps1|toml|sh)$/.test(file)
    ) {
        source.split('\n').forEach((line, index) => {
            if (/^ +\S/.test(line) && (line.match(/^ */)?.[0].length ?? 0) % 4)
                errors.push(`${file}:${index + 1}: indentation must be a multiple of four.`);
        });
    }
    return errors;
}
