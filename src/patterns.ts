/**
 * Shared validation regex patterns and constants.
 *
 * Centralises all DICOM-related validation patterns so that brands,
 * validation schemas, and server modules reference a single source
 * of truth rather than maintaining duplicated copies.
 *
 * @module patterns
 */

// ---------------------------------------------------------------------------
// DICOM tag and UID patterns
// ---------------------------------------------------------------------------

/** Matches a DICOM tag in `(XXXX,XXXX)` format where X is a hex digit. */
const DICOM_TAG_PATTERN = /^\([0-9A-Fa-f]{4},[0-9A-Fa-f]{4}\)$/;

/** Matches a DICOM AE Title: letters, digits, spaces, and hyphens. */
const AE_TITLE_PATTERN = /^[A-Za-z0-9 -]+$/;

/**
 * Matches a dotted numeric OID (e.g. `1.2.840.10008`).
 *
 * Note: This intentionally accepts any syntactically valid dotted-numeric form.
 * DICOM PS3.5 §9.1 requires UIDs start with a non-zero root (e.g., `0.0.0` is
 * technically invalid), but real-world DICOM datasets contain such UIDs, so we
 * validate syntax only and leave semantic UID validation to the application layer.
 */
const UID_PATTERN = /^[0-9]+(\.[0-9]+)*$/;

/** Matches a single DICOM tag path segment with optional array index. */
const TAG_PATH_SEGMENT = /\([0-9A-Fa-f]{4},[0-9A-Fa-f]{4}\)(\[\d+\])?/;

/** Matches a full dot-separated DICOM tag path (e.g. `(0040,A730)[0].(0010,0010)`). */
const DICOM_TAG_PATH_PATTERN = new RegExp(`^${TAG_PATH_SEGMENT.source}(\\.${TAG_PATH_SEGMENT.source})*$`);

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

/** Minimum length for an AE Title. */
const AE_TITLE_MIN_LENGTH = 1;

/** Maximum length for an AE Title. */
const AE_TITLE_MAX_LENGTH = 16;

/** Maximum length for a DICOM UID. */
const UID_MAX_LENGTH = 64;

/** Minimum valid network port number. */
const PORT_MIN = 1;

/** Maximum valid network port number. */
const PORT_MAX = 65535;

// ---------------------------------------------------------------------------
// DICOM query key patterns
// ---------------------------------------------------------------------------

/**
 * Matches a valid DICOM query key for `-k` arguments.
 *
 * Accepted formats:
 * - `XXXX,XXXX` — bare tag
 * - `XXXX,XXXX=value` — tag with value
 * - `XXXX,XXXX[0].XXXX,XXXX=value` — nested path with value
 * - `XXXX,XXXX.XXXX,XXXX=value` — dotted path with value
 *
 * The tag portion must start with a valid hex tag pair. Value after `=` is unconstrained.
 */
// eslint-disable-next-line no-useless-escape
const DICOM_QUERY_KEY_PATTERN = /^[0-9A-Fa-f]{4},[0-9A-Fa-f]{4}(?:[\[.\]0-9A-Fa-f,]*)?(?:=.*)?$/;

/**
 * Returns true if the string is a valid DICOM query key for `-k` arguments.
 */
function isValidDicomKey(key: string): boolean {
    return DICOM_QUERY_KEY_PATTERN.test(key);
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/** Pattern matching `..` as a path segment (between separators, or at start/end). */
const PATH_TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/**
 * Returns true if the string contains only valid DICOM AE Title characters.
 */
function isValidAETitle(value: string): boolean {
    return AE_TITLE_PATTERN.test(value);
}

/**
 * Returns true if the path does not contain traversal sequences.
 *
 * @param p - The filesystem path to check
 * @returns `true` when the path is safe (no `..` segments)
 */
function isSafePath(p: string): boolean {
    return !PATH_TRAVERSAL_PATTERN.test(p);
}

export {
    DICOM_TAG_PATTERN,
    AE_TITLE_PATTERN,
    UID_PATTERN,
    TAG_PATH_SEGMENT,
    DICOM_TAG_PATH_PATTERN,
    AE_TITLE_MIN_LENGTH,
    AE_TITLE_MAX_LENGTH,
    UID_MAX_LENGTH,
    PORT_MIN,
    PORT_MAX,
    DICOM_QUERY_KEY_PATTERN,
    isValidDicomKey,
    isValidAETitle,
    PATH_TRAVERSAL_PATTERN,
    isSafePath,
};
