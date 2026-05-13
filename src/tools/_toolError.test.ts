import { describe, it, expect } from 'vitest';
import { ToolExecutionError, createToolError, MAX_ARGS_LENGTH, MAX_STDERR_LENGTH } from './_toolError';

describe('createToolError()', () => {
    it('creates error with tool name and exit code', () => {
        const error = createToolError('dcm2xml', [], 1, '');

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('dcm2xml failed (exit code 1)');
    });

    it('includes args in the message', () => {
        const error = createToolError('dcm2xml', ['+Xn', 'input.dcm'], 1, '');

        expect(error.message).toBe('dcm2xml failed (exit code 1) | args: +Xn input.dcm');
    });

    it('includes stderr excerpt in the message', () => {
        const error = createToolError('dcmdump', ['+L', 'file.dcm'], 2, 'E: cannot open file');

        expect(error.message).toBe('dcmdump failed (exit code 2) | args: +L file.dcm | stderr: E: cannot open file');
    });

    it('truncates long args', () => {
        const longArgs = Array.from({ length: 50 }, (_, i) => `--option-${String(i)}`);
        const error = createToolError('dcmodify', longArgs, 1, '');

        const argsSection = error.message.split(' | ')[1];
        expect(argsSection).toBeDefined();
        // args: prefix (6) + truncated content + "..."
        expect(argsSection!.length).toBeLessThanOrEqual(6 + MAX_ARGS_LENGTH + 3);
        expect(argsSection).toContain('...');
    });

    it('truncates long stderr', () => {
        const longStderr = 'E: '.padEnd(MAX_STDERR_LENGTH + 100, 'x');
        const error = createToolError('dcm2json', ['file.dcm'], 1, longStderr);

        const stderrSection = error.message.split(' | ')[2];
        expect(stderrSection).toBeDefined();
        expect(stderrSection).toContain('...');
    });

    it('trims whitespace from stderr', () => {
        const error = createToolError('echoscu', ['--help'], 0, '  some warning  \n');

        expect(error.message).toMatch(/stderr: some warning/);
    });

    it('returns a ToolExecutionError carrying stdout/stderr/exitCode', () => {
        const error = createToolError('storescu', ['+r'], 7, 'F: nope', 'I: progress');

        expect(error).toBeInstanceOf(ToolExecutionError);
        expect(error.stdout).toBe('I: progress');
        expect(error.stderr).toBe('F: nope');
        expect(error.exitCode).toBe(7);
        expect(error.name).toBe('ToolExecutionError');
    });

    it('defaults stdout to empty string when not provided', () => {
        const error = createToolError('dcm2xml', [], 1, 'fail');

        expect(error).toBeInstanceOf(ToolExecutionError);
        expect(error.stdout).toBe('');
        expect(error.stderr).toBe('fail');
        expect(error.exitCode).toBe(1);
    });
});
