/**
 * Shared file operation helpers for DicomFile and DicomInstance.
 *
 * Extracted to avoid code duplication between the two file I/O classes.
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
export type { FileIOOptions };
