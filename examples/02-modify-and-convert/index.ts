/**
 * Example 02: Modify and Convert DICOM Files
 *
 * Demonstrates modifying DICOM tags with dcmodify, converting transfer
 * syntax with dcmconv, and using the high-level ChangeSet + DicomInstance APIs.
 *
 * Run: pnpm tsx examples/02-modify-and-convert/index.ts
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dcmodify, dcmconv, dcm2json, unwrap, DicomDataset, DicomInstance } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/other/0002d.DCM');

async function main() {
    console.log('=== Example 02: Modify and Convert DICOM ===\n');

    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex02-'));

    try {
        // 1. Copy sample to temp dir (never modify originals)
        const workFile = join(tempDir, 'work.dcm');
        await copyFile(SAMPLE, workFile);
        console.log(`Working copy: ${workFile}`);

        // -------------------------------------------------------------------
        // 2. dcmodify — modify PatientName and PatientID
        // -------------------------------------------------------------------
        console.log('\n--- dcmodify: changing PatientName and PatientID ---');
        unwrap(
            await dcmodify(workFile, {
                modifications: [
                    { tag: '(0010,0010)', value: 'EXAMPLE^PATIENT' },
                    { tag: '(0010,0020)', value: 'EX-12345' },
                ],
                noBackup: true,
            })
        );
        console.log('  Tags modified successfully.');

        // 3. Verify changes with dcm2json + DicomDataset
        console.log('\n--- Verifying modifications ---');
        const jsonResult = unwrap(await dcm2json(workFile));
        const ds = unwrap(DicomDataset.fromJson(jsonResult.data));
        console.log(`  Patient Name: ${ds.patientName}`);
        console.log(`  Patient ID:   ${ds.patientID}`);

        // -------------------------------------------------------------------
        // 4. dcmconv — convert transfer syntax to Explicit VR Little Endian
        // -------------------------------------------------------------------
        console.log('\n--- dcmconv: converting to Explicit VR Little Endian ---');
        const convertedFile = join(tempDir, 'converted.dcm');
        unwrap(await dcmconv(workFile, convertedFile, { transferSyntax: '+te' }));
        console.log(`  Converted file: ${convertedFile}`);

        // Verify the converted file
        const convertedJson = unwrap(await dcm2json(convertedFile));
        const convertedDs = unwrap(DicomDataset.fromJson(convertedJson.data));
        console.log(`  Transfer Syntax UID: ${convertedDs.transferSyntaxUID ?? '(not set)'}`);

        // -------------------------------------------------------------------
        // 5. DicomInstance — fluent high-level modification API
        // -------------------------------------------------------------------
        console.log('\n--- DicomInstance fluent API ---');
        const inst = unwrap(await DicomInstance.open(convertedFile));
        console.log(`  Opened: ${inst.filePath}`);
        console.log(`  Current Patient Name: ${inst.patientName}`);

        // Fluent chaining — every setter returns a new immutable instance
        const modified = inst.setPatientName('FLUENT^DEMO').setPatientID('FL-99999').setInstitutionName('Example Hospital');

        console.log(`  Pending changes: ${modified.changes.modifications.size} modification(s)`);
        console.log(`  Has unsaved changes: ${modified.hasUnsavedChanges}`);

        // Apply changes in-place
        await modified.applyChanges();
        console.log('  Changes applied.');

        // Re-read to verify
        const verifyInst = unwrap(await DicomInstance.open(convertedFile));
        console.log(`  Patient Name:     ${verifyInst.patientName}`);
        console.log(`  Patient ID:       ${verifyInst.patientID}`);
        console.log(`  Institution Name: ${verifyInst.getString('00080080')}`);

        console.log('\nDone.');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
        console.log('Temp files cleaned up.');
    }
}

main().catch(console.error);
