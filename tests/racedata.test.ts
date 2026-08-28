import { describe, expect, it } from 'vitest';
import {
  dayOfWeek,
  isSaturdayMetro,
  lastRaces,
  parseAcceptances,
  parseCalendar,
  parseMeetingKey,
  splitRaceTitle,
} from '@/lib/racedata';

describe('parseMeetingKey', () => {
  it('parses a full key', () => {
    expect(parseMeetingKey('2026Aug29,NSW,Rosehill Gardens')).toEqual({
      date: '2026-08-29',
      state: 'NSW',
      track: 'Rosehill Gardens',
    });
  });

  it('parses single-digit days and Sep', () => {
    expect(parseMeetingKey('2026Sep5,NSW,Royal Randwick')).toEqual({
      date: '2026-09-05',
      state: 'NSW',
      track: 'Royal Randwick',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseMeetingKey('garbage')).toBeNull();
    expect(parseMeetingKey('2026Foo29,NSW,Randwick')).toBeNull();
  });
});

describe('splitRaceTitle', () => {
  it('splits name, time and distance', () => {
    expect(splitRaceTitle('MIDWAY HANDICAP 11:45 AM (1800m)')).toEqual({
      name: 'MIDWAY HANDICAP',
      time: '11:45 AM',
      distance: '1800',
    });
  });

  it('handles group brackets and no time', () => {
    expect(splitRaceTitle('THEO MARKS STAKES [GROUP 2]  (1300m)')).toEqual({
      name: 'THEO MARKS STAKES [GROUP 2]',
      time: '',
      distance: '1300',
    });
  });

  it('handles "METRES" spelling', () => {
    expect(splitRaceTitle('CLUBSNSW HANDICAP 5:05PM (1200 METRES)')).toEqual({
      name: 'CLUBSNSW HANDICAP',
      time: '5:05PM',
      distance: '1200',
    });
  });
});

describe('dayOfWeek', () => {
  it('reports Saturday as 6', () => {
    expect(dayOfWeek('2026-08-29')).toBe(6);
  });
});

const CALENDAR = `
<div id="outer" onmouseout="hideRaces('2026Aug29,NSW,Rosehill Gardens')" onmouseover="showRaces(event, '2026Aug29,NSW,Rosehill Gardens', 6, 1)">
  <div id="2026Aug29,NSW,Rosehill Gardens_Meeting">
    <a notranslate href="StageMeeting.aspx?Key=2026Aug29,NSW,Rosehill Gardens" class="Metro"><span>Rosehill Gardens</span>&nbsp;<span class="FinalFields">A</span></a>
  </div>
  <table>
    <tr><td notranslate><b>R1</b> : <a href="StageMeeting.aspx?Key=2026Aug29,NSW,Rosehill Gardens&racenumber=1" >MIDWAY HANDICAP 11:45 AM (1800m)</a></td></tr>
    <tr><td notranslate><b>R2</b> : <a href="StageMeeting.aspx?Key=2026Aug29,NSW,Rosehill Gardens&racenumber=2" >HIGHWAY HANDICAP 12:20 PM (1400m)</a></td></tr>
  </table>
</div>
<div id="outer" onmouseover="showRaces(event, '2026Aug29,NSW,Grafton', 1, 1)">
  <a notranslate href="StageMeeting.aspx?Key=2026Aug29,NSW,Grafton" class="Country"><span>Grafton</span></a>
  <table>
    <tr><td notranslate><b>R1</b> : <a href="StageMeeting.aspx?Key=2026Aug29,NSW,Grafton&racenumber=1" >MAIDEN  (900m)</a></td></tr>
  </table>
</div>
<div id="outer" onmouseover="showRaces(event, '2026Aug30,NSW,Rosehill Gardens,Trial', 1, 1)">
  <a notranslate href="StageMeeting.aspx?Key=2026Aug30,NSW,Rosehill Gardens,Trial" class="Trial"><span>Rosehill Gardens</span></a>
</div>`;

describe('parseCalendar', () => {
  const meetings = parseCalendar(CALENDAR);

  it('extracts meetings with key, track and class', () => {
    expect(meetings).toHaveLength(2); // the trial is skipped
    const rosehill = meetings.find((m) => m.track === 'Rosehill Gardens');
    expect(rosehill).toBeDefined();
    expect(rosehill!.key).toBe('2026Aug29,NSW,Rosehill Gardens');
    expect(rosehill!.cls).toBe('Metro');
    expect(rosehill!.date).toBe('2026-08-29');
  });

  it('parses each race with name, time and distance', () => {
    const rosehill = meetings.find((m) => m.track === 'Rosehill Gardens')!;
    expect(rosehill.races).toEqual([
      { number: 1, name: 'MIDWAY HANDICAP', time: '11:45 AM', distance: '1800' },
      { number: 2, name: 'HIGHWAY HANDICAP', time: '12:20 PM', distance: '1400' },
    ]);
  });

  it('keeps country meetings (filtering is a separate concern)', () => {
    expect(meetings.some((m) => m.track === 'Grafton')).toBe(true);
  });
});

describe('isSaturdayMetro', () => {
  it('accepts a Saturday metro meeting in the future', () => {
    expect(isSaturdayMetro({ key: 'k', state: 'NSW', track: 'Rosehill Gardens', cls: 'Metro', date: '2026-08-29', races: [] }, '2026-08-28')).toBe(true);
  });

  it('rejects a country Saturday meeting', () => {
    expect(isSaturdayMetro({ key: 'k', state: 'NSW', track: 'Grafton', cls: 'Country', date: '2026-08-29', races: [] }, '2026-08-28')).toBe(false);
  });

  it('rejects a midweek metro meeting', () => {
    expect(isSaturdayMetro({ key: 'k', state: 'NSW', track: 'Warwick Farm', cls: 'Metro', date: '2026-09-02', races: [] }, '2026-08-28')).toBe(false);
  });

  it('rejects a meeting already in the past', () => {
    expect(isSaturdayMetro({ key: 'k', state: 'NSW', track: 'Rosehill Gardens', cls: 'Metro', date: '2026-08-29', races: [] }, '2026-08-30')).toBe(false);
  });
});

const ACCEPTANCES = `
<a class="race-title-anchor" name="Race7">Race 7 - 3:15PM UP AND COMING STAKES (1300 METRES)</a>
<table>
<tr class='OddRow'>
  <td>1</td>
  <td class='last'>5x34813x</td>
  <td class='horse'><a class='GreenLink' href="#">DIAMETER</a> <span></span></td>
  <td class='trainer'><a href="#">T Trainer</a></td>
  <td class='jockey'><a href="#"><span class='Hilite'>Tommy Berry</span></a></td>
  <td class='barrier'>2</td>
  <td class='weight'>61</td>
  <td style="color:red" class='weight'></td>
  <td class='penalty'></td>
  <td class='hcp'>87</td>
</tr>
<tr class='EvenRow Scratched'>
  <td>2</td>
  <td class='last'>1415x</td>
  <td class='horse'><a class='GreenLink' href="#">BERZELIUS</a> <span></span></td>
  <td class='trainer'><a href="#">U Coach</a></td>
  <td class='jockey'><a href="#">Jason Collett</a></td>
  <td class='barrier'>11</td>
  <td class='weight'>61</td>
  <td style="color:red" class='weight'></td>
  <td class='penalty'></td>
  <td class='hcp'>86</td>
</tr>
<tr class='OddRow'>
  <td>18e</td>
  <td class='last'>187x35</td>
  <td class='horse'><a class='GreenLink' href="#">EMERGENCY RUNNER</a> <span></span></td>
  <td class='trainer'><a href="#">V Vet</a></td>
  <td class='jockey'><a href="#">Reece Jones</a></td>
  <td class='barrier'>1</td>
  <td class='weight'>54</td>
  <td style="color:red" class='weight'></td>
  <td class='penalty'></td>
  <td class='hcp'>58</td>
</tr>
</table>
<a class="race-title-anchor" name="Race8">Race 8 - 3:50PM SAN DOMENICO STAKES (1100 METRES)</a>
<table>
<tr class='OddRow'>
  <td>4</td>
  <td class='last'>11</td>
  <td class='horse'><a class='GreenLink' href="#">OUTSPAN</a> <span></span></td>
  <td class='trainer'><a href="#">W W</a></td>
  <td class='jockey'><a href="#">Chad Schofield</a></td>
  <td class='barrier'>4</td>
  <td class='weight'>56</td>
  <td style="color:red" class='weight'></td>
  <td class='penalty'></td>
  <td class='hcp'>74</td>
</tr>
</table>`;

describe('parseAcceptances', () => {
  const fields = parseAcceptances(ACCEPTANCES);

  it('extracts one field per race', () => {
    expect(fields.map((f) => f.number)).toEqual([7, 8]);
    expect(fields[0]!.name).toBe('UP AND COMING STAKES');
    expect(fields[0]!.time).toBe('3:15PM');
  });

  it('parses the full form guide for each runner', () => {
    const r7 = fields[0]!;
    expect(r7.runners).toHaveLength(3);
    expect(r7.runners[0]).toMatchObject({
      number: 1,
      name: 'DIAMETER',
      jockey: 'Tommy Berry',
      trainer: 'T Trainer',
      barrier: '2',
      weight: '61',
      benchmark: '87',
      form: '5x34813x',
      scratched: false,
    });
  });

  it('flags scratched runners', () => {
    expect(fields[0]!.runners[1]!.scratched).toBe(true);
    expect(fields[0]!.runners[1]!.name).toBe('BERZELIUS');
  });

  it('keeps the numeric part of an emergency runner number', () => {
    expect(fields[0]!.runners[2]!.number).toBe(18);
  });
});

describe('lastRaces', () => {
  const races = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((number) => ({ number, name: '', time: '', distance: '' }));
  it('returns the last four in card order', () => {
    expect(lastRaces(races, 4).map((r) => r.number)).toEqual([7, 8, 9, 10]);
  });
  it('returns everything when the card is short', () => {
    expect(lastRaces(races.slice(0, 2), 4).map((r) => r.number)).toEqual([1, 2]);
  });
});
