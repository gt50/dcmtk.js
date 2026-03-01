/**
 * Example 01: Inspect DICOM Files
 *
 * Demonstrates reading DICOM metadata using dcmdump, dcm2xml, dcm2json,
 * and the high-level DicomDataset API with convenience getters.
 *
 * Run: pnpm tsx examples/01-inspect-dicom/index.ts
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dcmdump, dcm2xml, dcm2json, DicomDataset } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg/IM-0001-0001.dcm');

async function main() {
    console.log('=== Example 01: Inspect DICOM Files ===\n');

    // -----------------------------------------------------------------------
    // 1. dcmdump — dump DICOM headers as human-readable text
    // -----------------------------------------------------------------------
    console.log('--- dcmdump output (first 20 lines) ---');
    const dumpResult = await dcmdump(SAMPLE);
    if (!dumpResult.ok) {
        console.error(dumpResult.error.message);
        return;
    }
    const lines = dumpResult.value.text.split('\n').slice(0, 20);
    console.log(lines.join('\n'));

    // -----------------------------------------------------------------------
    // 2. dcm2xml — convert to XML representation
    // -----------------------------------------------------------------------
    console.log('\n--- dcm2xml output (first 500 chars) ---');
    const xmlResult = await dcm2xml(SAMPLE);
    if (!xmlResult.ok) {
        console.error(xmlResult.error.message);
        return;
    }
    console.log(xmlResult.value.xml.slice(0, 500));
    console.log('...\n');

    // -----------------------------------------------------------------------
    // 3. dcm2json + DicomDataset — structured access via JSON model
    // -----------------------------------------------------------------------
    console.log('--- DicomDataset convenience getters ---');
    const jsonResult = await dcm2json(SAMPLE);
    if (!jsonResult.ok) {
        console.error(jsonResult.error.message);
        return;
    }
    const dsResult = DicomDataset.fromJson(jsonResult.value.data);
    if (!dsResult.ok) {
        console.error(dsResult.error.message);
        return;
    }
    const ds = dsResult.value;

    console.log(`  Patient Name:       ${ds.patientName ?? '(not set)'}`);
    console.log(`  Patient ID:         ${ds.patientID ?? '(not set)'}`);
    console.log(`  Study Date:         ${ds.studyDate ?? '(not set)'}`);
    console.log(`  Modality:           ${ds.modality ?? '(not set)'}`);
    console.log(`  Study Instance UID: ${ds.studyInstanceUID ?? '(not set)'}`);

    // -----------------------------------------------------------------------
    // 4. getString() and hasTag() — lower-level access
    // -----------------------------------------------------------------------
    console.log('\n--- getString() and hasTag() ---');
    console.log(`  Patient Age (00101010):     ${ds.getString('00101010') ?? '(not present)'}`);
    console.log(`  Has PatientName (00100010):  ${ds.hasTag('00100010')}`);
    console.log(`  Has Allergies (00102110):    ${ds.hasTag('00102110')}`);

    console.log('\nDone.');
}

main().catch(console.error);
