/**
 * DICOM file I/O combining DicomDataset + ChangeSet + file path.
 *
 * Provides a high-level API for reading, modifying, and saving DICOM files.
 * All mutations are tracked immutably via ChangeSet and applied through dcmodify.
 *
 * @module dicom/DicomFile
 */

import type { DicomFilePath } from '../brands';
import { createDicomFilePath } from '../brands';
import { DEFAULT_TIMEOUT_MS } from '../constants';
import type { Result } from '../types';
import { ok, err } from '../types';
import { ChangeSet } from './ChangeSet';
import { DicomDataset } from './DicomDataset';
import { dcm2json } from '../tools/dcm2json';
import { applyModifications, copyFileSafe, statFileSize, unlinkFile } from './_fileHelpers';
import type { FileIOOptions } from './_fileHelpers';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for DicomFile I/O operations. */
type DicomFileOptions = FileIOOptions;

// ---------------------------------------------------------------------------
// DicomFile class
// ---------------------------------------------------------------------------

/**
 * High-level DICOM file wrapper combining dataset, change tracking, and file I/O.
 *
 * Create via {@link DicomFile.open}. Accumulate changes with {@link withChanges},
 * then apply with {@link applyChanges} or write to a new path with {@link writeAs}.
 *
 * @example
 * ```ts
 * const file = await DicomFile.open('/path/to/study.dcm');
 * if (file.ok) {
 *     const modified = file.value
 *         .withChanges(ChangeSet.empty().setTag(tag, 'Anonymous'));
 *     await modified.applyChanges();
 * }
 * ```
 */
class DicomFile {
    /** The immutable DICOM dataset read from the file. */
    readonly dataset: DicomDataset;
    /** The branded file path. */
    readonly filePath: DicomFilePath;
    /** The accumulated pending changes. */
    readonly changes: ChangeSet;

    private constructor(dataset: DicomDataset, filePath: DicomFilePath, changes: ChangeSet) {
        this.dataset = dataset;
        this.filePath = filePath;
        this.changes = changes;
    }

    /**
     * Opens a DICOM file and reads its dataset.
     *
     * @param path - Filesystem path to the DICOM file
     * @param options - Timeout and abort options
     * @returns A Result containing the DicomFile or an error
     */
    static async open(path: string, options?: DicomFileOptions): Promise<Result<DicomFile>> {
        const filePathResult = createDicomFilePath(path);
        if (!filePathResult.ok) return err(filePathResult.error);

        const jsonResult = await dcm2json(path, {
            timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            signal: options?.signal,
        });
        if (!jsonResult.ok) return err(jsonResult.error);

        const datasetResult = DicomDataset.fromJson(jsonResult.value.data);
        if (!datasetResult.ok) return err(datasetResult.error);

        return ok(new DicomFile(datasetResult.value, filePathResult.value, ChangeSet.empty()));
    }

    /**
     * Returns a new DicomFile with the given changes merged into the pending changes.
     *
     * @param changes - A ChangeSet to merge with existing pending changes
     * @returns A new DicomFile with accumulated changes
     */
    withChanges(changes: ChangeSet): DicomFile {
        return new DicomFile(this.dataset, this.filePath, this.changes.merge(changes));
    }

    /**
     * Returns a new DicomFile with a different file path.
     *
     * Preserves the dataset and pending changes.
     *
     * @param newPath - The new branded file path
     * @returns A new DicomFile pointing to the new path
     */
    withFilePath(newPath: DicomFilePath): DicomFile {
        return new DicomFile(this.dataset, newPath, this.changes);
    }

    /**
     * Applies pending changes to the file in-place using dcmodify.
     *
     * If there are no pending changes, this is a no-op that returns success.
     * After applying, the dataset is NOT refreshed — call {@link DicomFile.open}
     * again if you need fresh data.
     *
     * @param options - Timeout and abort options
     * @returns A Result indicating success or failure
     */
    async applyChanges(options?: DicomFileOptions): Promise<Result<void>> {
        if (this.changes.isEmpty) return ok(undefined);
        return applyModifications(this.filePath, this.changes, options ?? {});
    }

    /**
     * Copies the file to a new path and applies pending changes to the copy.
     *
     * If there are no pending changes, only the copy is performed.
     * On dcmodify failure, the copy is cleaned up.
     *
     * @param outputPath - Destination filesystem path
     * @param options - Timeout and abort options
     * @returns A Result containing the branded output path or an error
     */
    async writeAs(outputPath: string, options?: DicomFileOptions): Promise<Result<DicomFilePath>> {
        const outPathResult = createDicomFilePath(outputPath);
        if (!outPathResult.ok) return err(outPathResult.error);

        const copyResult = await copyFileSafe(this.filePath, outputPath);
        if (!copyResult.ok) return err(copyResult.error);

        if (this.changes.isEmpty) return ok(outPathResult.value);

        const applyResult = await applyModifications(outPathResult.value, this.changes, options ?? {});
        if (!applyResult.ok) {
            await unlinkFile(outputPath);
            return err(applyResult.error);
        }

        return ok(outPathResult.value);
    }

    /**
     * Gets the file size in bytes.
     *
     * @returns A Result containing the size or an error
     */
    async fileSize(): Promise<Result<number>> {
        return statFileSize(this.filePath);
    }

    /**
     * Deletes the file from the filesystem.
     *
     * @returns A Result indicating success or failure
     */
    async unlink(): Promise<Result<void>> {
        return unlinkFile(this.filePath);
    }
}

export { DicomFile };
export type { DicomFileOptions };
