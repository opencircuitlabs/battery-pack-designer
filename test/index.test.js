import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageingProjection,balancePlan,chargerProfile,imbalanceAssessment,
  missionSimulation,monteCarloPack,packSummary,protectionSetpoints,pulseSag,
  reportMarkdown,runtimeEstimate,selectConductorAndFuse,thermalEstimate,validateCell
} from '../src/index.js';

const cell={nominalVoltageV:3.6,minimumVoltageV:2.8,maximumVoltageV:4.2,capacityAh:3,internalResistanceMilliohm:20,maximumContinuousDischargeA:10,maximumPulseDischargeA:15,maximumChargeA:3,minimumTemperatureC:-20,maximumTemperatureC:60};
const configuration={series:4,parallel:2};
const pack=packSummary(cell,configuration);

test('validates a complete cell specification',()=>{
  assert.deepEqual(validateCell(cell),{valid:true,issues:[]});
});

test('reports missing fields and unsafe ordering',()=>{
  const result=validateCell({nominalVoltageV:4.3,minimumVoltageV:4.4,maximumVoltageV:4.2,capacityAh:0,internalResistanceMilliohm:0,maximumContinuousDischargeA:10,maximumPulseDischargeA:5,maximumChargeA:0,minimumTemperatureC:60,maximumTemperatureC:20});
  const codes=result.issues.map(issue=>issue.code);
  for(const code of ['cell-field','voltage-order','pulse-current','temperature-order'])assert.ok(codes.includes(code));
});

test('builds a series-parallel pack electrical summary',()=>{
  assert.deepEqual(pack,{series:4,parallel:2,cellCount:8,minimumVoltageV:11.2,nominalVoltageV:14.4,maximumVoltageV:16.8,capacityAh:6,nominalEnergyWh:86.4,internalResistanceMilliohm:40,maximumContinuousDischargeA:20,maximumPulseDischargeA:30,maximumChargeA:6,nominalEnergyKj:311.04});
});

test('requires positive integer series and parallel counts',()=>{
  assert.throws(()=>packSummary(cell,{series:0,parallel:2}),/positive integer/);
  assert.throws(()=>packSummary(cell,{series:4.5,parallel:2}),/positive integer/);
});

test('estimates usable energy, current, and runtime',()=>{
  const result=runtimeEstimate(pack,43.2,{usableDepthOfDischarge:.8,conversionEfficiency:.9});
  assert.equal(result.usableEnergyWh,62.208);
  assert.equal(result.runtimeHours,1.44);
  assert.equal(result.estimatedCurrentA,3.333333);
  assert.equal(result.withinContinuousCurrent,true);
});

test('flags continuous-current overload and validates fractions',()=>{
  assert.equal(runtimeEstimate(pack,300,{usableDepthOfDischarge:.8,conversionEfficiency:.9}).withinContinuousCurrent,false);
  assert.throws(()=>runtimeEstimate(pack,10,{usableDepthOfDischarge:1.1}),/fractions/);
});

test('calculates pulse voltage sag and current margin',()=>{
  const result=pulseSag(pack,20);
  assert.equal(result.voltageDropV,.8);
  assert.equal(result.loadedVoltageV,13.6);
  assert.equal(result.marginV,2.4);
  assert.equal(result.pass,true);
});

test('accounts for interconnect loss and rejects excessive pulses',()=>{
  const result=pulseSag(pack,35,{interconnectMilliohm:10});
  assert.equal(result.totalResistanceMilliohm,50);
  assert.equal(result.withinPulseCurrent,false);
  assert.equal(result.pass,false);
  assert.throws(()=>pulseSag(pack,1,{interconnectMilliohm:-1}),/non-negative interconnect/);
});

test('estimates steady-state pack heating',()=>{
  const result=thermalEstimate(pack,10,100,{ambientC:25,thermalResistanceCPerW:2,maximumTemperatureC:40});
  assert.equal(result.lossWatts,4);
  assert.equal(result.temperatureRiseC,8);
  assert.equal(result.estimatedTemperatureC,33);
  assert.equal(result.pass,true);
});

test('models transient thermal capacitance',()=>{
  const result=thermalEstimate(pack,10,200,{ambientC:25,thermalResistanceCPerW:2,heatCapacityJPerC:100,maximumTemperatureC:30});
  assert.equal(result.temperatureRiseC,5.056964);
  assert.equal(result.pass,false);
});

test('plans passive balancing currents and dissipation',()=>{
  const result=balancePlan([4.2,4.15,4.1],{bleederOhm:100});
  assert.equal(result.targetVoltageV,4.1);
  assert.equal(result.spreadMillivolts,100);
  assert.deepEqual(result.rows.map(row=>row.bleedCurrentMilliamp),[1,.5,0]);
  assert.equal(result.totalBleedPowerWatts,.006275);
});

test('validates balancing inputs',()=>{
  assert.throws(()=>balancePlan([4.2]),/at least two/);
  assert.throws(()=>balancePlan([4.2,4.1],{bleederOhm:0}),/positive bleeder/);
});

test('identifies charge and discharge limiting cells',()=>{
  const result=imbalanceAssessment([{capacityAh:3,stateOfCharge:.8},{capacityAh:3,stateOfCharge:.7}]);
  assert.equal(result.limitingDischargeAh,2.1);
  assert.equal(result.dischargeLimitingCell,1);
  assert.equal(result.limitingChargeAh,.6);
  assert.equal(result.chargeLimitingCell,0);
  assert.equal(result.socSpreadPercent,10);
});

test('derives guarded BMS protection thresholds',()=>{
  const result=protectionSetpoints(cell,configuration);
  assert.equal(result.undervoltageCutoffV,11.6);
  assert.equal(result.overvoltageCutoffV,16.6);
  assert.equal(result.continuousOvercurrentA,16);
  assert.equal(result.pulseOvercurrentA,24);
});

test('constructs a CC-CV charging profile and enforces cell limits',()=>{
  const result=chargerProfile(cell,configuration,{requestedChargeA:8});
  assert.equal(result.constantCurrentA,6);
  assert.equal(result.constantVoltageV,16.8);
  assert.equal(result.terminationCurrentA,.6);
  assert.equal(result.estimatedTotalHours,1.1);
  assert.equal(result.currentLimited,true);
});

test('validates charge state boundaries',()=>{
  assert.throws(()=>chargerProfile(cell,configuration,{startStateOfCharge:.9,constantVoltageStartSoc:.8}),/charge state boundaries/);
});

test('selects the smallest conductor satisfying ampacity and drop',()=>{
  const catalog=[{id:'small',ampacityA:10,resistanceOhmPerM:.02},{id:'large',ampacityA:30,resistanceOhmPerM:.005}];
  const result=selectConductorAndFuse(catalog,15,2,12);
  assert.equal(result.requiredAmpacityA,18.75);
  assert.equal(result.selected.id,'large');
  assert.equal(result.selected.voltageDropV,.3);
  assert.equal(result.selected.voltageDropPercent,2.5);
  assert.deepEqual(result.fuseRangeA,{minimum:18.75,maximum:30});
});

test('reports when no conductor meets constraints',()=>{
  const result=selectConductorAndFuse([{id:'small',ampacityA:10,resistanceOhmPerM:.1}],15,2,12);
  assert.equal(result.pass,false);
  assert.equal(result.selected,null);
  assert.throws(()=>selectConductorAndFuse([],1,1,1),/catalog/);
});

test('simulates a multi-mode energy mission',()=>{
  const result=missionSimulation(pack,[{id:'idle',durationHours:1,powerWatts:20,efficiency:.9},{id:'active',durationHours:.5,powerWatts:40,efficiency:.8}]);
  assert.equal(result.totalDurationHours,1.5);
  assert.equal(result.rows[0].energyFromPackWh,22.222222);
  assert.equal(result.remainingEnergyWh,21.897778);
  assert.equal(result.pass,true);
});

test('flags mission energy exhaustion and current overload',()=>{
  const result=missionSimulation(pack,[{durationHours:10,powerWatts:300,efficiency:.9}]);
  assert.equal(result.pass,false);
  assert.ok(result.remainingEnergyWh<0);
});

test('projects multiplicative cycle and calendar ageing',()=>{
  const result=ageingProjection(3,{equivalentFullCycles:500,calendarYears:2},{cycleFadePercentPer100Cycles:2,calendarFadePercentPerYear:2});
  assert.equal(result.retentionPercent,86.812553);
  assert.equal(result.remainingCapacityAh,2.604377);
  assert.equal(result.endOfLife,false);
});

test('detects end of life and validates ageing inputs',()=>{
  assert.equal(ageingProjection(3,{equivalentFullCycles:2000,calendarYears:5},{cycleFadePercentPer100Cycles:3,calendarFadePercentPerYear:3}).endOfLife,true);
  assert.throws(()=>ageingProjection(0,{equivalentFullCycles:1}),/positive initial/);
});

test('runs deterministic battery tolerance Monte Carlo analysis',()=>{
  const tolerant={...cell,capacityTolerancePercent:5,resistanceTolerancePercent:15,voltageTolerancePercent:1};
  const first=monteCarloPack(tolerant,configuration,20,{iterations:100,seed:5}),second=monteCarloPack(tolerant,configuration,20,{iterations:100,seed:5});
  assert.deepEqual(first,second);
  assert.ok(first.p05EnergyWh<=first.p50EnergyWh);
  assert.ok(first.p05LoadedVoltageV<=first.p50LoadedVoltageV);
  assert.throws(()=>monteCarloPack(tolerant,configuration,20,{iterations:0}),/positive integer/);
});

test('renders a concise pack and mission report',()=>{
  const mission=missionSimulation(pack,[{durationHours:1,powerWatts:10}]);
  const report=reportMarkdown(pack,mission);
  assert.match(report,/# Battery pack design/);
  assert.match(report,/4S2P \(8 cells\)/);
  assert.match(report,/86.4 Wh/);
  assert.match(report,/Mission duration: 1 h/);
});
