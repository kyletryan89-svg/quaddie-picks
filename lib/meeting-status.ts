import type { MeetingStatus } from '@/lib/types';

/**
 * Picks stay editable until results are in. A stored status of `locked` is a
 * leftover and is treated as still open — both for picking and for settling.
 */
export function isUnsettled(status: MeetingStatus): boolean {
  return status !== 'settled';
}

/** Label shown in the UI. `locked` is never presented as its own state. */
export function displayStatus(status: MeetingStatus): MeetingStatus {
  return status === 'locked' ? 'open' : status;
}
