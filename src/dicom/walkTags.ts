/**
 * Utility for iterating all DICOM tags in a JSON Model dataset.
 *
 * Supports VR filtering and bounded recursion into sequences.
 *
 * @module dicom/walkTags
 */

import type { DicomJsonElement, DicomJsonModel } from '../tools/_xmlToJson';

/** Maximum default recursion depth for sequence traversal. */
const DEFAULT_MAX_DEPTH = 16;

/** Information about a visited DICOM tag. */
interface WalkTagEntry {
    /** 8-char hex tag key (e.g., '00100010'). */
    readonly tag: string;
    /** The DICOM JSON element with vr, Value, etc. */
    readonly element: DicomJsonElement;
    /** VR code (e.g., 'PN', 'US', 'SQ'). */
    readonly vr: string;
    /** Nesting depth (0 = top-level). */
    readonly depth: number;
    /** Dot-separated path (e.g., '00081115[0].0020000E'). */
    readonly path: string;
}

/** Options for walkTags. */
interface WalkTagsOptions {
    /** Only visit tags with these VR codes. Omit to visit all. */
    readonly vrFilter?: ReadonlyArray<string> | undefined;
    /** Max recursion depth into sequences. Default: 16. */
    readonly maxDepth?: number | undefined;
}

/** Internal context passed through recursion to avoid excessive parameters. */
interface WalkContext {
    readonly maxDepth: number;
    readonly vrSet: Set<string> | undefined;
    readonly results: WalkTagEntry[];
}

/**
 * Walks all tags in a DICOM JSON Model dataset.
 *
 * Iterates every tag, optionally filtering by VR and recursing into sequences.
 * Sequences are always recursed into (even if SQ is filtered out) so nested
 * tags can match the VR filter.
 *
 * @param data - A DICOM JSON Model object
 * @param options - Optional VR filter and max depth
 * @returns A readonly array of all matching tag entries
 */
function walkTags(data: DicomJsonModel, options?: WalkTagsOptions): ReadonlyArray<WalkTagEntry> {
    const ctx: WalkContext = {
        maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
        vrSet: options?.vrFilter !== undefined ? new Set(options.vrFilter) : undefined,
        results: [],
    };
    walkLevel(data, 0, '', ctx);
    return ctx.results;
}

/** Recursive helper that walks one level of a DICOM JSON Model. */
function walkLevel(data: DicomJsonModel, depth: number, pathPrefix: string, ctx: WalkContext): void {
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
        const tag = keys[i];
        /* v8 ignore next */
        if (tag === undefined) continue;
        const element = data[tag];
        /* v8 ignore next */
        if (element === undefined) continue;
        const vr = element.vr;
        const path = pathPrefix.length > 0 ? `${pathPrefix}.${tag}` : tag;

        if (ctx.vrSet === undefined || ctx.vrSet.has(vr)) {
            ctx.results.push({ tag, element, vr, depth, path });
        }

        if (vr === 'SQ' && element.Value !== undefined && depth < ctx.maxDepth) {
            walkSequenceItems(element.Value, depth, path, ctx);
        }
    }
}

/** Recurses into each item of a sequence Value array. */
function walkSequenceItems(items: ReadonlyArray<unknown>, depth: number, parentPath: string, ctx: WalkContext): void {
    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (typeof item !== 'object' || item === null) continue;
        const itemPath = `${parentPath}[${idx}]`;
        walkLevel(item as DicomJsonModel, depth + 1, itemPath, ctx);
    }
}

export { walkTags };
export type { WalkTagEntry, WalkTagsOptions };
