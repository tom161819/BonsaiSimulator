// Kalibrace bez grafiky: vývoj stromu po letech.  npm run calibrate -- [roky] [druh] [nádoba]
import { Timeline } from '../src/sim/timeline';
import { stats, YEAR } from '../src/sim/util';
import { SPECIES, SPECIES_ORDER } from '../src/sim/species';
if (process.env.C && process.argv[3]) (SPECIES as any)[process.argv[3]].growthPerFoliage = Number(process.env.C);
if (process.env.J && process.argv[3]) (SPECIES as any)[process.argv[3]].juvenile = Number(process.env.J);
import type { PotType } from '../src/sim/types';

const years = Number(process.argv[2] || 12);
const only = process.argv[3];
const pots = (process.argv[4] ? [process.argv[4]] : ['ground', 'training', 'bonsai']) as PotType[];
for (const sp of SPECIES_ORDER.filter((x) => (only ? x === only : x === 'pine'))) for (const pot of pots) {
  const tl = new Timeline(7, [], undefined, sp);
  tl.act({ type: 'repot', pot });
  console.log(`\n== ${sp} / ${pot} ==\nrok  výška  ø báze  výhony  pupeny   listů  leader  ms`);
  for (let y = 0; y < years; y++) {
    const t0 = Date.now();
    tl.seek(y * YEAR + 250);
    const st = stats(tl.state);
    const main = tl.state.shoots.filter((s) => s.order === 0 && s.bornYear === y && !s.dead);
    const leader = main.length ? main[main.length - 1].len : 0;
    console.log(
      `${String(y + 1).padStart(3)} ${st.height.toFixed(1).padStart(6)} ${(st.baseDiameter * 10).toFixed(1).padStart(6)}mm ${String(st.shoots).padStart(6)} ${String(st.buds).padStart(6)} ${String(st.needles).padStart(7)} ${leader.toFixed(1).padStart(6)} ${Date.now() - t0}`,
    );
  }
}
