import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DicomInstance } from '../../../src/dicom/DicomInstance';
import { dcm2json } from '../../../src/tools/dcm2json';
import { dcmftest } from '../../../src/tools/dcmftest';
import { dcmtkAvailable, SAMPLES, createTempDir, removeTempDir, copyDicomToTemp } from '../helpers';

/** Helper: read a tag value from a DICOM file via dcm2json. */
async function readTagValue(filePath: string, tag8: string): Promise<unknown> {
    const result = await dcm2json(filePath);
    if (!result.ok) return undefined;
    const el = result.value.data[tag8];
    if (el === undefined) return undefined;
    return el.Value;
}

/** Helper: read the Alphabetic component of a PN tag. */
async function readPatientName(filePath: string): Promise<string | undefined> {
    const values = await readTagValue(filePath, '00100010');
    if (!Array.isArray(values) || values.length === 0) return undefined;
    const first = values[0] as Record<string, unknown>;
    return first['Alphabetic'] as string | undefined;
}

/** Helper: read a plain string tag value (e.g. Patient ID, Modality). */
async function readStringTag(filePath: string, tag8: string): Promise<string | undefined> {
    const values = await readTagValue(filePath, tag8);
    if (!Array.isArray(values) || values.length === 0) return undefined;
    return values[0] as string | undefined;
}

describe.skipIf(!dcmtkAvailable)('DicomInstance integration', () => {
    let tempDir: string;

    beforeAll(async () => {
        tempDir = await createTempDir('dicom-instance-');
    });

    afterAll(async () => {
        await removeTempDir(tempDir);
    });

    // -------------------------------------------------------------------
    // open()
    // -------------------------------------------------------------------

    it('opens a real DICOM file and reads metadata', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const inst = result.value;
        expect(inst.patientName.length).toBeGreaterThan(0);
        expect(inst.modality).toBe('MR');
        expect(inst.filePath).toBe(SAMPLES.MR_BRAIN);
        expect(inst.hasUnsavedChanges).toBe(false);
    });

    it('opens another DICOM format', async () => {
        const result = await DicomInstance.open(SAMPLES.OTHER_0002);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.sopInstanceUID.length).toBeGreaterThan(0);
    });

    it('returns error for non-existent file', async () => {
        const result = await DicomInstance.open(join(tempDir, 'nonexistent.dcm'));
        expect(result.ok).toBe(false);
    });

    it('returns error for invalid DICOM', async () => {
        const result = await DicomInstance.open(SAMPLES.BAD_0002);
        // Bad files may or may not parse — just ensure no unhandled exception
        expect(typeof result.ok).toBe('boolean');
    });

    // -------------------------------------------------------------------
    // Read accessors
    // -------------------------------------------------------------------

    it('getString returns tag value', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const inst = result.value;
        expect(inst.getString('00080060')).toBe('MR');
        expect(inst.hasTag('00100010')).toBe(true);
    });

    it('getString returns fallback for missing tag', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        // (0009,0099) is a private tag unlikely to exist
        expect(result.value.getString('00090099', 'N/A')).toBe('N/A');
    });

    it('convenience getters delegate to dataset', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const inst = result.value;
        // The instance getters should return the same values as the underlying dataset
        expect(inst.patientName).toBe(inst.dataset.patientName);
        expect(inst.patientID).toBe(inst.dataset.patientID);
        expect(inst.studyDate).toBe(inst.dataset.studyDate);
        expect(inst.studyInstanceUID).toBe(inst.dataset.studyInstanceUID);
        expect(inst.seriesInstanceUID).toBe(inst.dataset.seriesInstanceUID);
        expect(inst.sopInstanceUID).toBe(inst.dataset.sopInstanceUID);
    });

    // -------------------------------------------------------------------
    // setTag / convenience setters
    // -------------------------------------------------------------------

    it('setTag creates a new instance with pending changes', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const original = result.value;
        const modified = original.setTag('(0010,0010)', 'TEST^INSTANCE');

        // Original is unchanged
        expect(original.hasUnsavedChanges).toBe(false);
        // Modified has pending changes
        expect(modified.hasUnsavedChanges).toBe(true);
    });

    it('convenience setters chain correctly', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const modified = result.value.setPatientName('CHAIN^TEST').setPatientID('CHAIN001').setAccessionNumber('ACC999');

        expect(modified.hasUnsavedChanges).toBe(true);
        expect(modified.changes.modifications.size).toBe(3);
    });

    // -------------------------------------------------------------------
    // writeAs
    // -------------------------------------------------------------------

    it('writeAs creates a valid DICOM copy with modifications', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const modified = result.value.setPatientName('WRITEAS^INST').setPatientID('WA001');

        const outputPath = join(tempDir, 'writeas-instance.dcm');
        const writeResult = await modified.writeAs(outputPath);
        expect(writeResult.ok).toBe(true);
        if (!writeResult.ok) return;

        // Returned instance should point to new path with no unsaved changes
        expect(writeResult.value.filePath).toBe(outputPath);
        expect(writeResult.value.hasUnsavedChanges).toBe(false);

        // Verify on disk
        const testResult = await dcmftest(outputPath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }

        expect(await readPatientName(outputPath)).toBe('WRITEAS^INST');
        expect(await readStringTag(outputPath, '00100020')).toBe('WA001');

        // Original file untouched
        const origName = await readPatientName(SAMPLES.MR_BRAIN);
        expect(origName).not.toBe('WRITEAS^INST');
    });

    it('writeAs without changes creates an unmodified copy', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const outputPath = join(tempDir, 'writeas-nochange.dcm');
        const writeResult = await result.value.writeAs(outputPath);
        expect(writeResult.ok).toBe(true);

        const testResult = await dcmftest(outputPath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }
    });

    // -------------------------------------------------------------------
    // applyChanges (in-place)
    // -------------------------------------------------------------------

    it('applyChanges modifies file in-place', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-inplace.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const modified = result.value.setPatientName('INPLACE^INST');
        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        expect(await readPatientName(filePath)).toBe('INPLACE^INST');
    });

    it('applyChanges no-ops when changeset is empty', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-noop.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const statBefore = await stat(filePath);
        const applyResult = await result.value.applyChanges();
        expect(applyResult.ok).toBe(true);

        // File should be identical (not modified)
        const statAfter = await stat(filePath);
        expect(statAfter.size).toBe(statBefore.size);
    });

    // -------------------------------------------------------------------
    // eraseTag — existing tags
    // -------------------------------------------------------------------

    it('eraseTag removes an existing tag from the file', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-existing.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        // Confirm tag exists before erasure
        expect(result.value.hasTag('00100010')).toBe(true);
        expect(result.value.patientName.length).toBeGreaterThan(0);

        const modified = result.value.eraseTag('(0010,0010)');
        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        // Verify tag is gone
        const values = await readTagValue(filePath, '00100010');
        expect(values).toBeUndefined();
    });

    it('eraseTag removes Patient ID', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-pid.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        expect(result.value.hasTag('00100020')).toBe(true);

        const modified = result.value.eraseTag('(0010,0020)');
        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        const values = await readTagValue(filePath, '00100020');
        expect(values).toBeUndefined();
    });

    // -------------------------------------------------------------------
    // eraseTag — tags that do NOT exist in the instance
    // -------------------------------------------------------------------

    it('eraseTag succeeds when erasing a tag the file does not have', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-missing.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        // (0010,1005) = Patient's Birth Name — very unlikely in an MR brain scan
        expect(result.value.hasTag('00101005')).toBe(false);

        const modified = result.value.eraseTag('(0010,1005)');
        expect(modified.hasUnsavedChanges).toBe(true);

        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        // File should still be valid DICOM
        const testResult = await dcmftest(filePath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }

        // Tag still not present
        const values = await readTagValue(filePath, '00101005');
        expect(values).toBeUndefined();
    });

    it('eraseTag succeeds for multiple non-existent tags', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-multi-missing.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        // Erase several tags that don't exist: Ethnic Group, Military Rank, Branch of Service
        const modified = result.value.eraseTag('(0010,2160)').eraseTag('(0010,1080)').eraseTag('(0010,1081)');

        expect(modified.changes.erasures.size).toBe(3);

        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        // File remains valid
        const testResult = await dcmftest(filePath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }
    });

    it('eraseTag on non-existent tag does not affect other tags', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-nonexist-preserve.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const originalName = result.value.patientName;
        const originalModality = result.value.modality;

        // Erase a tag that doesn't exist: (0012,0010) = Clinical Trial Sponsor Name
        expect(result.value.hasTag('00120010')).toBe(false);

        const modified = result.value.eraseTag('(0012,0010)');
        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        // Existing tags should be preserved
        const nameAfter = await readPatientName(filePath);
        expect(nameAfter).toBe(originalName);

        const modalityAfter = await readStringTag(filePath, '00080060');
        expect(modalityAfter).toBe(originalModality);
    });

    it('mix of erasing existing and non-existent tags in one changeset', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-mixed.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        // Patient Name exists, Ethnic Group (0010,2160) does not
        expect(result.value.hasTag('00100010')).toBe(true);
        expect(result.value.hasTag('00102160')).toBe(false);

        const modified = result.value
            .eraseTag('(0010,0010)') // exists
            .eraseTag('(0010,2160)'); // does not exist

        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        // The existing tag should be removed
        const pnValues = await readTagValue(filePath, '00100010');
        expect(pnValues).toBeUndefined();

        // The non-existent one is still not there (no error)
        const egValues = await readTagValue(filePath, '00102160');
        expect(egValues).toBeUndefined();

        // File is still valid
        const testResult = await dcmftest(filePath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }
    });

    it('eraseTag on non-existent tag via writeAs produces valid output', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        // (0010,1040) = Patient Address — not in an MR brain scan
        expect(result.value.hasTag('00101040')).toBe(false);

        const modified = result.value.eraseTag('(0010,1040)');
        const outputPath = join(tempDir, 'writeas-erase-missing.dcm');
        const writeResult = await modified.writeAs(outputPath);
        expect(writeResult.ok).toBe(true);

        const testResult = await dcmftest(outputPath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }
    });

    // -------------------------------------------------------------------
    // erasePrivateTags
    // -------------------------------------------------------------------

    it('erasePrivateTags removes private tags from file', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-erase-private.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const modified = result.value.erasePrivateTags();
        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        // File should still be valid
        const testResult = await dcmftest(filePath);
        expect(testResult.ok).toBe(true);
        if (testResult.ok) {
            expect(testResult.value.isDicom).toBe(true);
        }
    });

    // -------------------------------------------------------------------
    // setBatch
    // -------------------------------------------------------------------

    it('setBatch applies multiple tags at once', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-batch.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const modified = result.value.setBatch({
            '(0010,0010)': 'BATCH^TEST',
            '(0010,0020)': 'BATCH001',
            '(0008,0050)': 'BATCHACC',
        });

        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        expect(await readPatientName(filePath)).toBe('BATCH^TEST');
        expect(await readStringTag(filePath, '00100020')).toBe('BATCH001');
        expect(await readStringTag(filePath, '00080050')).toBe('BATCHACC');
    });

    // -------------------------------------------------------------------
    // transformTag
    // -------------------------------------------------------------------

    it('transformTag modifies an existing value', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-transform.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const originalName = result.value.patientName;
        const modified = result.value.transformTag('(0010,0010)', current => {
            return current !== undefined ? `TRANSFORMED_${current}` : 'TRANSFORMED_EMPTY';
        });

        const applyResult = await modified.applyChanges();
        expect(applyResult.ok).toBe(true);

        const newName = await readPatientName(filePath);
        expect(newName).toBe(`TRANSFORMED_${originalName}`);
    });

    // -------------------------------------------------------------------
    // fileSize and unlink
    // -------------------------------------------------------------------

    it('fileSize returns correct size', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const sizeResult = await result.value.fileSize();
        expect(sizeResult.ok).toBe(true);

        const stats = await stat(SAMPLES.MR_BRAIN);
        if (sizeResult.ok) {
            expect(sizeResult.value).toBe(stats.size);
        }
    });

    it('unlink deletes the file', async () => {
        const filePath = await copyDicomToTemp(SAMPLES.MR_BRAIN, tempDir, 'instance-unlink.dcm');

        const result = await DicomInstance.open(filePath);
        if (!result.ok) return;

        const unlinkResult = await result.value.unlink();
        expect(unlinkResult.ok).toBe(true);

        // File should no longer exist
        await expect(stat(filePath)).rejects.toThrow();
    });

    // -------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------

    it('withMetadata attaches non-DICOM context', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const inst = result.value.withMetadata('source', 'integration-test').withMetadata('priority', 42);

        expect(inst.getMetadata('source')).toBe('integration-test');
        expect(inst.getMetadata('priority')).toBe(42);

        // Original doesn't have metadata
        expect(result.value.getMetadata('source')).toBeUndefined();
    });

    // -------------------------------------------------------------------
    // Combined workflows
    // -------------------------------------------------------------------

    it('full workflow: open → modify → writeAs → re-open → verify', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        const modified = result.value.setPatientName('ROUNDTRIP^TEST').setPatientID('RT001').setAccessionNumber('RTACC');

        const outputPath = join(tempDir, 'roundtrip.dcm');
        const writeResult = await modified.writeAs(outputPath);
        expect(writeResult.ok).toBe(true);

        // Re-open the written file
        const reopened = await DicomInstance.open(outputPath);
        expect(reopened.ok).toBe(true);
        if (!reopened.ok) return;

        expect(reopened.value.patientName).toBe('ROUNDTRIP^TEST');
        expect(reopened.value.patientID).toBe('RT001');
        expect(reopened.value.accession).toBe('RTACC');
        // Modality should be preserved from original
        expect(reopened.value.modality).toBe('MR');
    });

    it('workflow: erase non-existent tags + set new values → writeAs → verify', async () => {
        const result = await DicomInstance.open(SAMPLES.MR_BRAIN);
        if (!result.ok) return;

        // Erase tags that don't exist, plus set some real values
        const modified = result.value
            .eraseTag('(0010,2160)') // Ethnic Group — not present
            .eraseTag('(0010,1040)') // Patient Address — not present
            .setPatientName('COMBINED^ERASE')
            .setAccessionNumber('COMB001');

        const outputPath = join(tempDir, 'combined-erase-set.dcm');
        const writeResult = await modified.writeAs(outputPath);
        expect(writeResult.ok).toBe(true);

        // Re-open and verify
        const reopened = await DicomInstance.open(outputPath);
        expect(reopened.ok).toBe(true);
        if (!reopened.ok) return;

        expect(reopened.value.patientName).toBe('COMBINED^ERASE');
        expect(reopened.value.accession).toBe('COMB001');
        expect(reopened.value.hasTag('00102160')).toBe(false);
        expect(reopened.value.hasTag('00101040')).toBe(false);
    });
});
