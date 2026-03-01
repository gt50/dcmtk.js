/**
 * DicomSender barrel export.
 *
 * Re-exports the DicomSender class and all public types from the
 * senders module.
 *
 * @module senders
 */

export { DicomSender } from './DicomSender';
export { SenderMode, SenderHealth } from './types';
export type {
    SenderModeValue,
    SenderHealthValue,
    DicomSenderOptions,
    SendOptions,
    SendResult,
    SenderStatus,
    SenderSendCompleteData,
    SenderSendFailedData,
    SenderHealthChangedData,
    SenderBucketFlushedData,
    SenderErrorData,
    DicomSenderEventMap,
} from './types';
