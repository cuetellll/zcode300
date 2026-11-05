import { describe, expect, it } from 'vitest';
import { RADIO_STATIONS, findRadioStation, publicStation, radioBotIdentity } from '../src/config/radio-stations';
import { HttpError } from '../src/lib/errors';
import { RadioWorkerManager } from '../src/workers/radio-worker-manager';

describe('radio station catalog', () => {
  it('ships exactly the four launch stations', () => {
    expect(RADIO_STATIONS.map((s) => s.id).sort()).toEqual(['popular', 'popularfa', 'shooti', 'souls'].sort());
  });

  it('finds stations by id', () => {
    expect(findRadioStation('popularfa')?.title).toBe('بهترین رپ فارسی');
    expect(findRadioStation('nope')).toBeUndefined();
  });

  it('never leaks stream URLs in the public payload', () => {
    for (const station of RADIO_STATIONS) {
      const pub = publicStation(station);
      expect(JSON.stringify(pub)).not.toContain('radiox.pro');
      expect(Object.keys(pub).sort()).toEqual(['description', 'id', 'title']);
    }
  });

  it('builds a stable bot identity per room', () => {
    expect(radioBotIdentity('chan1')).toBe('mahyar-radio-chan1');
  });
});

describe('radio worker manager (no spawn paths)', () => {
  it('rejects unknown station ids with a 404', async () => {
    const manager = new RadioWorkerManager(() => undefined);
    await expect(manager.playOrSwitch('room', 'srv', 'not-a-station')).rejects.toMatchObject({
      status: 404,
      code: 'RADIO_STATION_NOT_FOUND',
    } satisfies Partial<HttpError>);
  });

  it('returns null state for rooms without a session', () => {
    const manager = new RadioWorkerManager(() => undefined);
    expect(manager.getPublicState('room')).toBeNull();
    expect(manager.activeRoomCount()).toBe(0);
  });
});
