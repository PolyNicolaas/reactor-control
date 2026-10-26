import type { CautionList } from '../core/types';
import { plateCutoff } from './retInterlock';

// Autoignition temperatures of common lab solvents, for the hotplate caution list (DESIGN.md §15).
// A hot surface at or above this temperature can ignite the vapour with no flame or spark.
// Value = the LOWEST found across the sources below; sources differ by tens of degrees (acetonitrile:
// 220 vs 524 °C). Checked 2026-10-26:
//   ETB  = Engineering ToolBox, "Fuels and Chemicals - Autoignition Temperatures"
//   ABB  = ABB Hazlux, "Ignition temperatures and group classification"
//   WIKI = Wikipedia, "Autoignition temperature"
//   MCM  = McMaster University chemistry safety, Appendix 2
// This list is a reminder, not a substitute for the SDS of what is actually in the hood.
export const SOLVENT_AIT: { name: string; value: number; note?: string }[] = [
  { name: 'Carbon disulfide', value: 90, note: 'ETB, ABB, WIKI 90; MCM 100' },
  { name: 'Diethyl ether', value: 160, note: 'ABB, WIKI 160; ETB, MCM 180' },
  { name: 'Acetaldehyde', value: 175, note: 'ETB, ABB' },
  { name: '1,4-Dioxane', value: 180, note: 'ABB' },
  { name: 'n-Heptane', value: 204, note: 'ETB 204–215; ABB 204' },
  { name: 'Dimethyl sulfoxide (DMSO)', value: 215, note: 'ETB' },
  { name: 'Acetonitrile', value: 220, note: 'ETB 220; ABB 524 — sources disagree, check the SDS' },
  { name: 'n-Octane', value: 220, note: 'ETB' },
  { name: 'n-Hexane', value: 223, note: 'ETB 223–225; ABB 225' },
  { name: 'Petroleum ether / hexanes', value: 223, note: 'Mixture; ETB 288. Treated as hexane' },
  { name: 'n-Pentane', value: 243, note: 'ABB 243; ETB 260' },
  { name: 'Cyclohexane', value: 245, note: 'ETB, ABB' },
  { name: 'Triethylamine', value: 249, note: 'ETB' },
  { name: 'Tetrahydrofuran (THF)', value: 321, note: 'ETB, ABB' },
  { name: '1-Butanol', value: 343, note: 'ETB' },
  { name: 'Ethanol', value: 363, note: 'ETB, ABB 363; WIKI 365' },
  { name: 'Glycerol', value: 370, note: 'ETB' },
  { name: 'Methanol', value: 385, note: 'ABB 385; ETB 464' },
  { name: 'Isopropanol', value: 399, note: 'ETB, ABB' },
  { name: 'Methyl ethyl ketone', value: 404, note: 'ABB' },
  { name: 'Ethyl acetate', value: 410, note: 'ETB 410; ABB 427' },
  { name: 'Nitromethane', value: 418, note: 'ABB' },
  { name: 'Acetic acid', value: 427, note: 'ETB' },
  { name: 'DMF', value: 455, note: 'ABB' },
  { name: 'Xylenes', value: 463, note: 'o-xylene 463; m-, p- ~528' },
  { name: 'Acetone', value: 465, note: 'ETB, ABB' },
  { name: 'Toluene', value: 480, note: 'ETB, ABB 480; ETB also 530' },
  { name: 'Pyridine', value: 482, note: 'ABB' },
  { name: 'Benzene', value: 498, note: 'ETB, ABB' },
];

export const solventCaution: CautionList = {
  title: 'Solvent autoignition',
  unit: '°C',
  intro:
    'A hot plate at or above these temperatures can ignite solvent vapour with no flame. Red: the plate may reach it with the current settings. Amber: within 50 °C. Values are the lowest of several sources, which differ by tens of degrees; check the SDS, and your bath oil too.',
  sources: 'Engineering ToolBox; ABB Hazlux ignition temperature table; Wikipedia; McMaster chemistry safety (checked 2026-10-26)',
  items: SOLVENT_AIT,
  nearBy: 50,
  reference: (s, values) => {
    const set = values('plate');
    const cut = plateCutoff(s, set);
    const plate = s.values.plate;
    const ref = Math.max(cut, plate ?? -Infinity);
    return { value: ref, label: `Plate may reach ${Math.round(ref)} °C now (cut-off ${cut} °C${plate !== undefined ? `, plate ${Math.round(plate)} °C` : ''}); hard maximum ${set.plateMax} °C` };
  },
  cap: { interlock: 'plate', setting: 'plateMax', margin: 20, label: (v) => `Cap plate at ${v} °C` },
};
