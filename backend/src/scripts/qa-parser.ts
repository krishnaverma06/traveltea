import { DeterministicCommandParser as P } from '../utils/deterministicParser.js';

const cases: Array<[string, string | null]> = [
  ['remove Osho Ashram from day 2', 'osho ashram'],
  ['delete Parvati Hill on day 3', 'parvati hill'],
  ['remove Amby Valley from the itinerary', 'amby valley'],
  ['delete Sinhagad Fort from my trip', 'sinhagad fort'],
  ['remove Lohagad Fort', 'lohagad fort'],
  ['delete Rock Sport India in day 1', 'rock sport india'],
  ['remove day trip to Lonavala', 'day trip to lonavala'],
  ['delete Museum of Trip History', 'museum of trip history'],
];

let fail = 0;
for (const [input, want] of cases) {
  const out = P.parse(input);
  const got = out?.[0]?.activityName ?? null;
  const ok = got === want;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(input).padEnd(42)} -> ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
}
console.log(fail === 0 ? '\nALL PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
