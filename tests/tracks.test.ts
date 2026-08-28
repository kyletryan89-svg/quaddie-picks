import { describe, expect, it } from 'vitest';
import {
  canonicalTrackName,
  isMetroTrack,
  normaliseTrackName,
} from '@/lib/racing/tracks';

describe('tracks whitelist', () => {
  it('normalises names', () => {
    expect(normaliseTrackName('Moonee Valley')).toBe('mooneevalley');
    expect(normaliseTrackName('Rosehill Gardens')).toBe('rosehillgardens');
  });

  it('accepts VIC metro tracks for VIC only', () => {
    for (const t of ['Flemington', 'Caulfield', 'Moonee Valley', 'Sandown']) {
      expect(isMetroTrack(t, 'VIC')).toBe(true);
      expect(isMetroTrack(t, 'NSW')).toBe(false);
    }
  });

  it('accepts NSW metro tracks for NSW only', () => {
    for (const t of ['Randwick', 'Rosehill Gardens', 'Warwick Farm', 'Canterbury Park']) {
      expect(isMetroTrack(t, 'NSW')).toBe(true);
      expect(isMetroTrack(t, 'VIC')).toBe(false);
    }
  });

  it('resolves provider aliases', () => {
    expect(isMetroTrack('Rosehill', 'NSW')).toBe(true);
    expect(isMetroTrack('Royal Randwick', 'NSW')).toBe(true);
    expect(isMetroTrack('Canterbury', 'NSW')).toBe(true);
  });

  it('canonicalises aliases to the whitelist spelling', () => {
    expect(canonicalTrackName('Rosehill')).toBe('Rosehill Gardens');
    expect(canonicalTrackName('Royal Randwick')).toBe('Randwick');
    expect(canonicalTrackName('Canterbury')).toBe('Canterbury Park');
  });

  it('rejects non-metro tracks and unknown states', () => {
    expect(isMetroTrack('Eagle Farm', 'QLD')).toBe(false);
    expect(isMetroTrack('Kembla Grange', 'NSW')).toBe(false);
    expect(isMetroTrack('Caulfield', 'QLD')).toBe(false);
    expect(canonicalTrackName('Grafton')).toBeNull();
  });
});
