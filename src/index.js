const round=(value,places=6)=>Number(value.toFixed(places));
const sum=values=>values.reduce((total,value)=>total+value,0);
const positive=(value,name)=>{if(!(Number.isFinite(value)&&value>0))throw new Error(`positive ${name} is required`)};

export function validateCell(cell){
  const issues=[];for(const key of ['nominalVoltageV','minimumVoltageV','maximumVoltageV','capacityAh','internalResistanceMilliohm','maximumContinuousDischargeA','maximumChargeA'])if(!(cell[key]>0))issues.push({code:'cell-field',field:key});
  if(cell.minimumVoltageV>=cell.nominalVoltageV||cell.nominalVoltageV>=cell.maximumVoltageV)issues.push({code:'voltage-order'});
  if(cell.maximumPulseDischargeA!=null&&cell.maximumPulseDischargeA<cell.maximumContinuousDischargeA)issues.push({code:'pulse-current'});
  if(cell.minimumTemperatureC!=null&&cell.maximumTemperatureC!=null&&cell.minimumTemperatureC>=cell.maximumTemperatureC)issues.push({code:'temperature-order'});
  return{valid:!issues.length,issues};
}

export function packSummary(cell,configuration){
  const validation=validateCell(cell);if(!validation.valid)throw new Error(`invalid cell: ${validation.issues.map(issue=>issue.code).join(', ')}`);const{series,parallel}=configuration;if(!Number.isInteger(series)||series<1||!Number.isInteger(parallel)||parallel<1)throw new Error('positive integer series and parallel counts are required');
  const capacityAh=cell.capacityAh*parallel,nominalVoltageV=cell.nominalVoltageV*series,nominalEnergyWh=capacityAh*nominalVoltageV;
  return{series,parallel,cellCount:series*parallel,minimumVoltageV:round(cell.minimumVoltageV*series),nominalVoltageV:round(nominalVoltageV),maximumVoltageV:round(cell.maximumVoltageV*series),capacityAh:round(capacityAh),nominalEnergyWh:round(nominalEnergyWh),internalResistanceMilliohm:round(cell.internalResistanceMilliohm*series/parallel),maximumContinuousDischargeA:round(cell.maximumContinuousDischargeA*parallel),maximumPulseDischargeA:round((cell.maximumPulseDischargeA??cell.maximumContinuousDischargeA)*parallel),maximumChargeA:round(cell.maximumChargeA*parallel),nominalEnergyKj:round(nominalEnergyWh*3.6)};
}

export function runtimeEstimate(pack,loadWatts,options={}){
  positive(loadWatts,'load power');const depth=options.usableDepthOfDischarge??.8,conversion=options.conversionEfficiency??.9,retention=options.capacityRetention??1;if(!(depth>0&&depth<=1&&conversion>0&&conversion<=1&&retention>0&&retention<=1))throw new Error('fractions must be within zero and one');
  const usable=pack.nominalEnergyWh*depth*conversion*retention,runtime=usable/loadWatts,current=loadWatts/(pack.nominalVoltageV*conversion);
  return{loadWatts,usableEnergyWh:round(usable),estimatedCurrentA:round(current),runtimeHours:round(runtime),withinContinuousCurrent:current<=pack.maximumContinuousDischargeA,currentMarginA:round(pack.maximumContinuousDischargeA-current)};
}

export function pulseSag(pack,currentA,options={}){
  positive(currentA,'pulse current');const openCircuitVoltageV=options.openCircuitVoltageV??pack.nominalVoltageV,interconnectMilliohm=options.interconnectMilliohm??0;if(!(interconnectMilliohm>=0))throw new Error('non-negative interconnect resistance is required');
  const resistance=(pack.internalResistanceMilliohm+interconnectMilliohm)/1000,drop=currentA*resistance,loaded=openCircuitVoltageV-drop,minimum=options.minimumPackVoltageV??pack.minimumVoltageV;
  return{currentA,openCircuitVoltageV,totalResistanceMilliohm:round(resistance*1000),voltageDropV:round(drop),loadedVoltageV:round(loaded),minimumPackVoltageV:minimum,marginV:round(loaded-minimum),withinPulseCurrent:currentA<=pack.maximumPulseDischargeA,pass:loaded>=minimum&&currentA<=pack.maximumPulseDischargeA};
}

export function thermalEstimate(pack,currentA,durationSeconds,options={}){
  positive(currentA,'current');positive(durationSeconds,'duration');const ambientC=options.ambientC??25,thermalResistanceCPerW=options.thermalResistanceCPerW??2;positive(thermalResistanceCPerW,'thermal resistance');
  const loss=currentA*currentA*pack.internalResistanceMilliohm/1000,steadyRise=loss*thermalResistanceCPerW,capacity=options.heatCapacityJPerC??null,rise=capacity==null?steadyRise:steadyRise*(1-Math.exp(-durationSeconds/(thermalResistanceCPerW*capacity))),temperature=ambientC+rise,maximum=options.maximumTemperatureC??60;
  return{lossWatts:round(loss),steadyStateRiseC:round(steadyRise),temperatureRiseC:round(rise),estimatedTemperatureC:round(temperature),maximumTemperatureC:maximum,marginC:round(maximum-temperature),pass:temperature<=maximum};
}

export function balancePlan(cellVoltages,options={}){
  if(!Array.isArray(cellVoltages)||cellVoltages.length<2||cellVoltages.some(value=>!(value>0)))throw new Error('at least two positive cell voltages are required');const targetV=options.targetVoltageV??Math.min(...cellVoltages),bleederOhm=options.bleederOhm??100;positive(bleederOhm,'bleeder resistance');const capacityAh=options.capacityAh??null;
  const rows=cellVoltages.map((voltage,index)=>{const excess=Math.max(0,voltage-targetV),current=excess/bleederOhm,power=voltage*current,time=capacityAh==null||current===0?null:capacityAh*excess/voltage/current;return{index,voltageV:voltage,excessVoltageV:round(excess),bleedCurrentMilliamp:round(current*1000),bleedPowerWatts:round(power),estimatedBalanceHours:time==null?null:round(time)}});
  return{targetVoltageV:targetV,spreadMillivolts:round((Math.max(...cellVoltages)-Math.min(...cellVoltages))*1000),rows,totalBleedPowerWatts:round(sum(rows.map(row=>row.bleedPowerWatts)))};
}

export function imbalanceAssessment(cells){
  if(!Array.isArray(cells)||cells.length<2)throw new Error('at least two cell states are required');for(const cell of cells){if(!(cell.capacityAh>0&&cell.stateOfCharge>=0&&cell.stateOfCharge<=1))throw new Error('valid cell capacity and state of charge are required')}
  const available=cells.map(cell=>cell.capacityAh*cell.stateOfCharge),headroom=cells.map(cell=>cell.capacityAh*(1-cell.stateOfCharge)),limitingDischarge=Math.min(...available),limitingCharge=Math.min(...headroom);
  return{limitingDischargeAh:round(limitingDischarge),limitingChargeAh:round(limitingCharge),dischargeLimitingCell:available.indexOf(limitingDischarge),chargeLimitingCell:headroom.indexOf(limitingCharge),socSpreadPercent:round((Math.max(...cells.map(cell=>cell.stateOfCharge))-Math.min(...cells.map(cell=>cell.stateOfCharge)))*100)};
}

export function protectionSetpoints(cell,configuration,options={}){
  const pack=packSummary(cell,configuration),underMargin=options.undervoltageMarginVPerCell??.1,overMargin=options.overvoltageMarginVPerCell??.05,currentMargin=options.currentMarginPercent??20;
  if(!(underMargin>=0&&overMargin>=0&&currentMargin>=0))throw new Error('non-negative protection margins are required');
  return{undervoltageCutoffV:round((cell.minimumVoltageV+underMargin)*configuration.series),overvoltageCutoffV:round((cell.maximumVoltageV-overMargin)*configuration.series),continuousOvercurrentA:round(pack.maximumContinuousDischargeA*(1-currentMargin/100)),pulseOvercurrentA:round(pack.maximumPulseDischargeA*(1-currentMargin/100)),maximumChargeA:pack.maximumChargeA};
}

export function chargerProfile(cell,configuration,options={}){
  const pack=packSummary(cell,configuration),requested=options.requestedChargeA??pack.maximumChargeA,chargeA=Math.min(requested,pack.maximumChargeA),terminationFraction=options.terminationCurrentFraction??.1;if(!(requested>0&&terminationFraction>0&&terminationFraction<1))throw new Error('valid requested charge and termination fraction are required');
  const startSoc=options.startStateOfCharge??.1,cvStartSoc=options.constantVoltageStartSoc??.8;if(!(startSoc>=0&&startSoc<cvStartSoc&&cvStartSoc<1))throw new Error('valid charge state boundaries are required');
  const ccHours=pack.capacityAh*(cvStartSoc-startSoc)/chargeA,cvHours=options.constantVoltageHours??pack.capacityAh*(1-cvStartSoc)/(chargeA*.5);
  return{constantCurrentA:round(chargeA),constantVoltageV:pack.maximumVoltageV,terminationCurrentA:round(chargeA*terminationFraction),estimatedConstantCurrentHours:round(ccHours),estimatedConstantVoltageHours:round(cvHours),estimatedTotalHours:round(ccHours+cvHours),currentLimited:requested>pack.maximumChargeA};
}

export function selectConductorAndFuse(catalog,currentA,lengthM,systemVoltageV,options={}){
  if(!Array.isArray(catalog)||!catalog.length)throw new Error('conductor catalog is required');positive(currentA,'current');positive(lengthM,'length');positive(systemVoltageV,'system voltage');const ampacityMargin=options.ampacityMarginPercent??25,maximumDropPercent=options.maximumVoltageDropPercent??3,requiredAmpacity=currentA*(1+ampacityMargin/100);
  const rows=catalog.map(item=>{const resistance=item.resistanceOhmPerM*lengthM*2,drop=currentA*resistance,dropPercent=drop/systemVoltageV*100;return{id:item.id,ampacityA:item.ampacityA,resistanceOhm:round(resistance),voltageDropV:round(drop),voltageDropPercent:round(dropPercent),lossWatts:round(currentA*currentA*resistance),pass:item.ampacityA>=requiredAmpacity&&dropPercent<=maximumDropPercent}}).sort((a,b)=>Number(b.pass)-Number(a.pass)||a.ampacityA-b.ampacityA);
  const selected=rows.find(row=>row.pass)??null,fuseMinimum=currentA*(options.fuseLoadFactor??1.25),fuseMaximum=selected?.ampacityA??null;
  return{requiredAmpacityA:round(requiredAmpacity),rows,selected,fuseRangeA:{minimum:round(fuseMinimum),maximum:fuseMaximum},pass:selected!=null};
}

export function missionSimulation(pack,segments,options={}){
  if(!Array.isArray(segments)||!segments.length)throw new Error('mission segments are required');let remaining=(options.initialStateOfCharge??1)*pack.nominalEnergyWh*(options.usableDepthOfDischarge??.8),elapsed=0;const rows=segments.map((segment,index)=>{positive(segment.durationHours,`duration ${index}`);positive(segment.powerWatts,`power ${index}`);const efficiency=segment.efficiency??options.conversionEfficiency??.9,draw=segment.powerWatts*segment.durationHours/efficiency,current=segment.powerWatts/(pack.nominalVoltageV*efficiency);remaining-=draw;elapsed+=segment.durationHours;return{id:segment.id??`segment-${index+1}`,durationHours:segment.durationHours,powerWatts:segment.powerWatts,energyFromPackWh:round(draw),estimatedCurrentA:round(current),remainingEnergyWh:round(remaining),stateOfChargePercent:round(Math.max(0,remaining)/(pack.nominalEnergyWh*(options.usableDepthOfDischarge??.8))*100),pass:remaining>=0&&current<=pack.maximumContinuousDischargeA}});return{rows,totalDurationHours:round(elapsed),remainingEnergyWh:round(remaining),pass:rows.every(row=>row.pass)};
}

export function ageingProjection(initialCapacityAh,usage,options={}){
  positive(initialCapacityAh,'initial capacity');const cycles=usage.equivalentFullCycles??0,years=usage.calendarYears??0,cycleFadePer100=options.cycleFadePercentPer100Cycles??2,calendarFadePerYear=options.calendarFadePercentPerYear??2;if(!(cycles>=0&&years>=0&&cycleFadePer100>=0&&calendarFadePerYear>=0))throw new Error('non-negative ageing inputs are required');const cycleRetention=Math.pow(1-cycleFadePer100/100,cycles/100),calendarRetention=Math.pow(1-calendarFadePerYear/100,years),retention=cycleRetention*calendarRetention;return{equivalentFullCycles:cycles,calendarYears:years,retentionPercent:round(retention*100),remainingCapacityAh:round(initialCapacityAh*retention),endOfLife:retention<(options.endOfLifeRetention??.8)};
}

function rng(seed){let state=seed>>>0;return()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296}}
export function monteCarloPack(cell,configuration,currentA,options={}){
  const iterations=options.iterations??500;if(!Number.isInteger(iterations)||iterations<1)throw new Error('positive integer iterations are required');const random=rng(options.seed??42),energies=[],loadedVoltages=[];let failures=0;
  for(let index=0;index<iterations;index++){const capacity=cell.capacityAh*(1+(random()*2-1)*(cell.capacityTolerancePercent??0)/100),resistance=cell.internalResistanceMilliohm*(1+(random()*2-1)*(cell.resistanceTolerancePercent??0)/100),voltage=cell.nominalVoltageV*(1+(random()*2-1)*(cell.voltageTolerancePercent??0)/100),varied={...cell,capacityAh:capacity,internalResistanceMilliohm:resistance,nominalVoltageV:voltage},pack=packSummary(varied,configuration),sag=pulseSag(pack,currentA,{minimumPackVoltageV:options.minimumPackVoltageV??pack.minimumVoltageV});energies.push(pack.nominalEnergyWh);loadedVoltages.push(sag.loadedVoltageV);if(!sag.pass)failures++}
  energies.sort((a,b)=>a-b);loadedVoltages.sort((a,b)=>a-b);const q=(values,p)=>values[Math.floor(p*(iterations-1))];return{iterations,seed:options.seed??42,p05EnergyWh:round(q(energies,.05)),p50EnergyWh:round(q(energies,.5)),p05LoadedVoltageV:round(q(loadedVoltages,.05)),p50LoadedVoltageV:round(q(loadedVoltages,.5)),failureCount:failures,yieldPercent:round((iterations-failures)/iterations*100)};
}

export function reportMarkdown(pack,mission=null){return`# Battery pack design\n\nConfiguration: ${pack.series}S${pack.parallel}P (${pack.cellCount} cells) | Nominal: ${pack.nominalVoltageV} V, ${pack.capacityAh} Ah, ${pack.nominalEnergyWh} Wh\n\nVoltage range: ${pack.minimumVoltageV}–${pack.maximumVoltageV} V | Continuous current: ${pack.maximumContinuousDischargeA} A | Pack resistance: ${pack.internalResistanceMilliohm} mΩ\n${mission?`\nMission duration: ${mission.totalDurationHours} h | Remaining energy: ${mission.remainingEnergyWh} Wh | Pass: ${mission.pass?'yes':'no'}\n`:''}`}
