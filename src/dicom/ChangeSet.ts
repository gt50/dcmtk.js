/**
 * Immutable mutation tracking for DICOM datasets.
 *
 * Every mutation method returns a new ChangeSet instance, preserving immutability.
 * Bridge methods produce dcmodify-compatible arguments for applying changes to files.
 *
 * @module dicom/ChangeSet
 */

import type { TagModification } from '../tools/dcmodify';
import { MAX_CHANGESET_OPERATIONS } from '../constants';
import type { DicomTagPath } from '../brands';
import { tagPathToSegments } from './tagPath';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel value in the erasures set to indicate erasing all private tags. */
const ERASE_PRIVATE_SENTINEL = '__ERASE_PRIVATE__';

// ---------------------------------------------------------------------------
// Helpers (extracted for complexity/line limits)
// ---------------------------------------------------------------------------

/**
 * Returns true if a char code is a control character to strip.
 * Strips 0x00-0x09, 0x0B, 0x0C, 0x0E-0x1F, 0x7F.
 * Preserves LF (0x0A), CR (0x0D), and backslash.
 */
function isControlChar(code: number): boolean {
    if (code <= 0x09) return true;
    if (code === 0x0b || code === 0x0c) return true;
    if (code >= 0x0e && code <= 0x1f) return true;
    return code === 0x7f;
}

/** Strips control characters from a value while preserving LF, CR, and backslash. */
function sanitizeValue(value: string): string {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (!isControlChar(code)) {
            result += value[i];
        }
    }
    return result;
}

/** Merges two modification maps, with `other` winning conflicts. Removes keys present in erasures. */
function buildMergedModifications(
    base: ReadonlyMap<string, string>,
    other: ReadonlyMap<string, string>,
    erasures: ReadonlySet<string>
): ReadonlyMap<string, string> {
    const merged = new Map<string, string>(base);
    for (const [key, value] of other) {
        merged.set(key, value);
    }
    for (const key of erasures) {
        merged.delete(key);
    }
    return merged;
}

/** Iteratively applies all entries to a ChangeSet, returning the final result. */
function applyBatchEntries(initial: ChangeSet, entries: Readonly<Record<string, string>>): ChangeSet {
    const keys = Object.keys(entries);
    let cs = initial;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        /* v8 ignore next */
        if (key === undefined) continue;
        const value = entries[key];
        /* v8 ignore next */
        if (value === undefined) continue;
        cs = cs.setTag(key, value);
    }
    return cs;
}

// ---------------------------------------------------------------------------
// ChangeSet class
// ---------------------------------------------------------------------------

/**
 * Immutable mutation tracker for DICOM datasets.
 *
 * Every mutation method returns a **new** ChangeSet — the original is never modified.
 * Use {@link ChangeSet.toModifications} and {@link ChangeSet.toErasureArgs} to bridge
 * to the dcmodify tool wrapper.
 *
 * @example
 * ```ts
 * const cs = ChangeSet.empty()
 *     .setTag('(0010,0010)' as DicomTagPath, 'Anonymous')
 *     .eraseTag('(0010,0020)' as DicomTagPath)
 *     .erasePrivateTags();
 * ```
 */
class ChangeSet {
    private readonly mods: ReadonlyMap<string, string>;
    private readonly erased: ReadonlySet<string>;

    private constructor(mods: ReadonlyMap<string, string>, erasures: ReadonlySet<string>) {
        this.mods = mods;
        this.erased = erasures;
    }

    /** Creates an empty ChangeSet with no modifications or erasures. */
    static empty(): ChangeSet {
        return new ChangeSet(new Map(), new Set());
    }

    /**
     * Sets a tag value, returning a new ChangeSet.
     *
     * Control characters (except LF/CR) are stripped from the value.
     * If the tag was previously erased, it is removed from the erasure set.
     *
     * @param path - The DICOM tag path to set (e.g. `'(0010,0010)'`)
     * @param value - The new value for the tag
     * @returns A new ChangeSet with the modification applied
     * @throws Error if operation count would exceed MAX_CHANGESET_OPERATIONS
     */
    setTag(path: string, value: string): ChangeSet {
        const totalOps = this.mods.size + this.erased.size;
        if (totalOps >= MAX_CHANGESET_OPERATIONS) {
            throw new Error(`ChangeSet operation limit (${MAX_CHANGESET_OPERATIONS}) exceeded`);
        }
        tagPathToSegments(path as DicomTagPath);
        const sanitized = sanitizeValue(value);
        const newMods = new Map(this.mods);
        newMods.set(path, sanitized);
        const newErasures = new Set(this.erased);
        newErasures.delete(path);
        return new ChangeSet(newMods, newErasures);
    }

    /**
     * Marks a tag for erasure, returning a new ChangeSet.
     *
     * If the tag was previously set, the modification is removed.
     *
     * @param path - The DICOM tag path to erase (e.g. `'(0010,0010)'`)
     * @returns A new ChangeSet with the erasure applied
     * @throws Error if operation count would exceed MAX_CHANGESET_OPERATIONS
     */
    eraseTag(path: string): ChangeSet {
        const totalOps = this.mods.size + this.erased.size;
        if (totalOps >= MAX_CHANGESET_OPERATIONS) {
            throw new Error(`ChangeSet operation limit (${MAX_CHANGESET_OPERATIONS}) exceeded`);
        }
        tagPathToSegments(path as DicomTagPath);
        const newMods = new Map(this.mods);
        newMods.delete(path);
        const newErasures = new Set(this.erased);
        newErasures.add(path);
        return new ChangeSet(newMods, newErasures);
    }

    /**
     * Marks all private tags for erasure, returning a new ChangeSet.
     *
     * @returns A new ChangeSet with the erase-private flag set
     * @throws Error if operation count would exceed MAX_CHANGESET_OPERATIONS
     */
    erasePrivateTags(): ChangeSet {
        const totalOps = this.mods.size + this.erased.size;
        if (totalOps >= MAX_CHANGESET_OPERATIONS) {
            throw new Error(`ChangeSet operation limit (${MAX_CHANGESET_OPERATIONS}) exceeded`);
        }
        const newErasures = new Set(this.erased);
        newErasures.add(ERASE_PRIVATE_SENTINEL);
        return new ChangeSet(new Map(this.mods), newErasures);
    }

    // -----------------------------------------------------------------------
    // Convenience setters for common DICOM tags
    // -----------------------------------------------------------------------

    /** Sets Patient's Name (0010,0010). */
    setPatientName(value: string): ChangeSet {
        return this.setTag('(0010,0010)', value);
    }

    /** Sets Patient ID (0010,0020). */
    setPatientID(value: string): ChangeSet {
        return this.setTag('(0010,0020)', value);
    }

    /** Sets Study Date (0008,0020). */
    setStudyDate(value: string): ChangeSet {
        return this.setTag('(0008,0020)', value);
    }

    /** Sets Modality (0008,0060). */
    setModality(value: string): ChangeSet {
        return this.setTag('(0008,0060)', value);
    }

    /** Sets Accession Number (0008,0050). */
    setAccessionNumber(value: string): ChangeSet {
        return this.setTag('(0008,0050)', value);
    }

    /** Sets Study Description (0008,1030). */
    setStudyDescription(value: string): ChangeSet {
        return this.setTag('(0008,1030)', value);
    }

    /** Sets Series Description (0008,103E). */
    setSeriesDescription(value: string): ChangeSet {
        return this.setTag('(0008,103E)', value);
    }

    /** Sets Institution Name (0008,0080). */
    setInstitutionName(value: string): ChangeSet {
        return this.setTag('(0008,0080)', value);
    }

    /**
     * Sets multiple tags at once, returning a new ChangeSet.
     *
     * @param entries - A record of tag path → value pairs
     * @returns A new ChangeSet with all modifications applied
     */
    setBatch(entries: Readonly<Record<string, string>>): ChangeSet {
        return applyBatchEntries(this, entries);
    }

    /** All pending tag modifications as a readonly map of path → value. */
    get modifications(): ReadonlyMap<string, string> {
        return this.mods;
    }

    /** All pending tag erasures as a readonly set of paths. */
    get erasures(): ReadonlySet<string> {
        return this.erased;
    }

    /** Total number of operations (modifications + erasures) in this ChangeSet. */
    get operationCount(): number {
        return this.mods.size + this.erased.size;
    }

    /** Whether the ChangeSet has no modifications and no erasures. */
    get isEmpty(): boolean {
        return this.mods.size === 0 && this.erased.size === 0;
    }

    /** Whether the erase-all-private-tags flag is set. */
    get erasePrivate(): boolean {
        return this.erased.has(ERASE_PRIVATE_SENTINEL);
    }

    /**
     * Merges another ChangeSet into this one, returning a new ChangeSet.
     *
     * The `other` ChangeSet wins on conflicts: if the same tag is modified in both,
     * `other`'s value is used. Erasures from both sets are unioned. An erasure in
     * `other` removes a modification from `base`.
     *
     * @param other - The ChangeSet to merge in
     * @returns A new ChangeSet with merged modifications and erasures
     */
    merge(other: ChangeSet): ChangeSet {
        const mergedErasures = new Set([...this.erased, ...other.erased]);
        const mergedMods = buildMergedModifications(this.mods, other.mods, mergedErasures);
        return new ChangeSet(mergedMods, mergedErasures);
    }

    /**
     * Converts modifications to dcmodify-compatible TagModification array.
     *
     * @returns A readonly array of TagModification objects
     */
    toModifications(): ReadonlyArray<TagModification> {
        const result: TagModification[] = [];
        for (const [tag, value] of this.mods) {
            result.push({ tag, value });
        }
        return result;
    }

    /**
     * Converts erasures to dcmodify-compatible argument strings.
     *
     * The erase-private sentinel is excluded — use {@link erasePrivate} to check
     * whether `-ep` should be passed.
     *
     * @returns A readonly array of tag path strings for `-e` arguments
     */
    toErasureArgs(): ReadonlyArray<string> {
        const result: string[] = [];
        for (const path of this.erased) {
            if (path !== ERASE_PRIVATE_SENTINEL) {
                result.push(path);
            }
        }
        return result;
    }
}

export { ChangeSet };
