/**
 * File operation helpers for DicomInstance.
 *
 * Extracted to keep DicomInstance methods under line-count limits.
 *
 * @module dicom/_fileHelpers
 */

import { copyFile, stat, unlink } from 'node:fs/promises';
import { tryCatch } from 'stderr-lib';
import type { DicomFilePath } from '../brands';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import type { Result } from '../types';
import { ok, err } from '../types';
import type { ChangeSet } from './ChangeSet';
import { dcmodify } from '../tools/dcmodify';

/** Options for file I/O operations. */
interface FileIOOptions {
    /** Timeout in milliseconds. Defaults to DEFAULT_TIMEOUT_MS. */
    readonly timeoutMs?: number | undefined;
    /** AbortSignal for external cancellation. */
    readonly signal?: AbortSignal | undefined;
}

/** Options for opening a DICOM file. Extends FileIOOptions with read-specific settings. */
interface DicomOpenOptions extends FileIOOptions {
    /** Assume the specified character set when SpecificCharacterSet (0008,0005) is absent. Maps to dcm2xml `+Ca`. */
    readonly charsetAssume?: string | undefined;
    /** Fallback charset to retry with when UTF-8 conversion fails due to illegal byte sequences. Maps to dcm2xml `+Ca`. When set, a charset conversion failure triggers an automatic retry with this charset assumed. `'Latin1'` is recommended — it maps every byte 0x00-0xFF to a valid character, so conversion never fails. */
    readonly charsetFallback?: string | undefined;
}

/** Bridges a ChangeSet to a dcmodify call on the given file. */
async function applyModifications(filePath: DicomFilePath, changeset: ChangeSet, options: FileIOOptions): Promise<Result<void>> {
    const modifications = changeset.toModifications();
    const erasures = changeset.toErasureArgs();

    const hasErasures = erasures.length > 0 || changeset.erasePrivate;

    const result = await dcmodify(filePath, {
        modifications: modifications.length > 0 ? modifications : undefined,
        erasures: erasures.length > 0 ? erasures : undefined,
        erasePrivateTags: changeset.erasePrivate || undefined,
        insertIfMissing: true,
        ignoreMissingTags: hasErasures || undefined,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
    });

    if (!result.ok) return err(result.error);
    return ok(undefined);
}

/** Wraps fs.copyFile in a Result. */
async function copyFileSafe(source: string, dest: string): Promise<Result<void>> {
    return tryCatch(
        () => copyFile(source, dest),
        e => new Error(`Failed to copy file: ${e.message}`)
    );
}

/** Wraps fs.stat in a Result, returning file size. */
async function statFileSize(path: string): Promise<Result<number>> {
    return tryCatch(
        async () => (await stat(path)).size,
        e => new Error(`Failed to stat file: ${e.message}`)
    );
}

/** Wraps fs.unlink in a Result. */
async function unlinkFile(path: string): Promise<Result<void>> {
    return tryCatch(
        () => unlink(path),
        e => new Error(`Failed to delete file: ${e.message}`)
    );
}

export { applyModifications, copyFileSafe, statFileSize, unlinkFile };
export type { FileIOOptions, DicomOpenOptions };
