import path from 'node:path';

export function isIntegerInRange(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function normalizePath(value) {
    return path.win32.normalize(value).toLocaleLowerCase('en-US');
}
