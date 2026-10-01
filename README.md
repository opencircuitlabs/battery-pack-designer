# Battery Pack Designer

`battery-pack-designer` is a dependency-free Node.js toolkit for traceable early-stage battery-system engineering. It converts a qualified cell specification into series/parallel architecture, voltage and energy limits, runtime, pulse sag, heat, balancing, BMS thresholds, charging, conductors, fuse ranges, mission endurance, ageing, and tolerance yield.

This software supports engineering studies and reviews. Battery packs can cause fire, toxic exposure, shock, and stored-energy hazards. Cell qualification, certified protection hardware, mechanical containment, thermal propagation testing, applicable transport/product standards, and review by experienced battery engineers remain essential.

## Capabilities

- Validate cell voltage, capacity, resistance, current, and temperature ratings.
- Build series/parallel pack voltage, capacity, energy, resistance, and current limits.
- Estimate runtime with depth-of-discharge, conversion-efficiency, and ageing allowances.
- Calculate pulse voltage sag including interconnect resistance and current limits.
- Estimate steady-state or first-order transient pack heating.
- Plan passive balancing current, dissipation, and optional balance time.
- Identify charge- and discharge-limiting cells from capacity and state of charge.
- Derive guarded undervoltage, overvoltage, and overcurrent setpoints.
- Construct CC-CV charging profiles constrained by cell charge-current limits.
- Select conductors by ampacity and round-trip voltage drop, then expose a fuse range.
- Simulate multi-mode missions with cumulative state of energy and current checks.
- Project multiplicative cycle/calendar ageing and end of life.
- Run deterministic Monte Carlo analysis across capacity, resistance, and voltage tolerances.
- Generate review-ready Markdown summaries.

## Requirements

- Node.js 18 or newer

## Quick start

```bash
npm install
npm test
node src/cli.js validate examples/cell.json
node src/cli.js summary examples/cell.json examples/configuration.json --output result.json
node src/cli.js runtime result.json 20
node src/cli.js sag result.json 20 --interconnect 10
node src/cli.js mission result.json examples/mission.json
node src/cli.js monte-carlo examples/cell.json examples/configuration.json 20 --iterations 1000 --seed 42
node src/cli.js report result.json --output report.md
```

## Cell and configuration model

```json
{
  "nominalVoltageV":3.6,
  "minimumVoltageV":2.8,
  "maximumVoltageV":4.2,
  "capacityAh":3,
  "internalResistanceMilliohm":20,
  "maximumContinuousDischargeA":10,
  "maximumPulseDischargeA":15,
  "maximumChargeA":3
}
```

```json
{"series":4,"parallel":2}
```

The example produces a 4S2P, 14.4 V nominal, 6 Ah, 86.4 Wh pack with 40 mΩ nominal cell-path resistance.

## CLI

```text
battery-pack-designer validate cell.json
battery-pack-designer summary cell.json configuration.json
battery-pack-designer runtime pack.json loadWatts --depth fraction --efficiency fraction
battery-pack-designer sag pack.json currentA --ocv voltageV --interconnect milliohm
battery-pack-designer thermal pack.json currentA durationSeconds --ambient C --theta C/W --capacity J/C
battery-pack-designer balance voltages.json --target V --resistance ohm
battery-pack-designer imbalance cells.json
battery-pack-designer protection cell.json configuration.json
battery-pack-designer charger cell.json configuration.json --current A
battery-pack-designer conductor catalog.json currentA lengthM --voltage V
battery-pack-designer mission pack.json segments.json
battery-pack-designer ageing initialCapacityAh usage.json
battery-pack-designer monte-carlo cell.json configuration.json currentA --iterations N --seed N
battery-pack-designer report pack.json [mission.json] --output report.md
```

## Library API

```js
import {
  validateCell, packSummary, runtimeEstimate, pulseSag, thermalEstimate,
  balancePlan, imbalanceAssessment, protectionSetpoints, chargerProfile,
  selectConductorAndFuse, missionSimulation, ageingProjection,
  monteCarloPack, reportMarkdown
} from '@opencircuitlabs/battery-pack-designer';

const pack = packSummary(cell, { series: 4, parallel: 2 });
const sag = pulseSag(pack, 20, { interconnectMilliohm: 10 });
console.log(pack.nominalEnergyWh, sag.loadedVoltageV, sag.pass);
```

## Engineering assumptions

- Values are pack-level screening calculations using a lumped equivalent model.
- Constant-power runtime current is estimated at nominal voltage; a nonlinear cell model or measured discharge curve is required for precise endpoint prediction.
- Thermal analysis treats the pack as one lumped mass and cannot predict cell-to-cell gradients or propagation.
- Passive balance-time estimates are approximate and depend on the relationship between state of charge and open-circuit voltage.
- Conductor catalog ampacity must already account for insulation, bundling, ambient temperature, installation, duty cycle, and applicable code requirements.
- Ageing and Monte Carlo models are planning tools; use qualified cell-lot data and mission-specific validation for production decisions.

## Development

```bash
npm test
npm run check
```

CI runs the full test suite on Node.js 18, 20, and 22.

## License

MIT © OpenCircuitLabs contributors. See [LICENSE](LICENSE).
