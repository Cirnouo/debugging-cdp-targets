/** Independent canonical npm tarball evidence. Never derive these hashes from installed or copied output. */
export const RUNTIME_LICENSE_INPUTS = [
    {
        name: 'yaml',
        version: '2.9.1',
        license: 'ISC',
        licenseSha256: '5bba27375d93e9119f76c1015f7672cf9ad5f70952296e0842fb2243d6376869',
    },
    {
        name: 'semver',
        version: '7.8.5',
        license: 'ISC',
        tarball: 'https://registry.npmjs.org/semver/-/semver-7.8.5.tgz',
        integrity: 'sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==',
        licenseSha256: '4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b',
    },
    {
        name: 'smol-toml',
        version: '1.9.1',
        license: 'BSD-3-Clause',
        tarball: 'https://registry.npmjs.org/smol-toml/-/smol-toml-1.9.1.tgz',
        integrity: 'sha512-j7WyPdf0CJoutMzMoPLF/bVXHtKZIT9Rb4eGeEbWw8X2t5oirjPgpL+OpaENZrILYaXqYwnVH+qgUwVbl+pUJQ==',
        licenseSha256: 'fa5659948374d4f555594f47f6da073b40dc503e921aeeece30df4362b3051a5',
    },
] as const;
