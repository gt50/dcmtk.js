import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 120_000,
        hookTimeout: 60_000,
        include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'json-summary'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.ts',
                'src/index.ts',
                'src/parsers/EventPattern.ts',
                'src/tools/_toolTypes.ts',
                'src/tools/index.ts',
                'src/servers/index.ts',
                'src/dicom/index.ts',
                'src/dicom/xmlToJson.ts',
                'src/utils/index.ts',
                'src/events/index.ts',
                'src/pacs/index.ts',
            ],
            thresholds: {
                branches: 70,
                functions: 75,
                lines: 80,
                statements: 80,
            },
        },
    },
});
