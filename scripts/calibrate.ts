// Kalibrace bez grafiky: vypíše vývoj stromu po letech pro jednotlivé nádoby.
import { Timeline } from '../src/sim/timeline';
import { stats, YEAR } from '../src/sim/util';
import type { PotType } from '../src/sim/types';

const years = Number(process.argv[2] || 12);
for (const pot of ['ground', 'training', 'bonsai'] as PotType[]) {
  const tl = new Timeline(7);
  tl.act({ type: 'repot', pot });
  console.log(`\n== ${pot} ==\nrok  výška  ø báze  výhony  pupeny  jehlic  leader  ms`);
  for (let y = 0; y < years; y++) {
    const t0 = Date.now();
    tl.seek(y * YEAR + 300);
    const st = stats(tl.state);
    const main = tl.state.shoots.filter((s) => s.order === 0 && s.bornYear === y && !s.dead);
    const leader = main.length ? main[main.length - 1].len : 0;
    console.log(
      `${String(y + 1).padStart(3)} ${st.height.toFixed(1).padStart(6)} ${(st.baseDiameter * 10).toFixed(1).padStart(6)}mm ${String(st.shoots).padStart(6)} ${String(st.buds).padStart(6)} ${String(st.needles).padStart(7)} ${leader.toFixed(1).padStart(6)} ${Date.now() - t0}`,
    );
  }
}
