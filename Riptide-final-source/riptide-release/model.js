// Shared illustrative model. This is not a flood forecast or operational guidance.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RiptideModel = factory();
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const definitions = [
    ['underpass','Central underpass',.8,.1,.4], ['road','MG arterial road',2.2,.1,.4],
    ['rail','Rail track cutting',1.6,.1,.3], ['station','Central station',2.5,.4,.9],
    ['canal','Storm drain outfall',1.1,.4,.8], ['power','Power substation',2,.3,.7],
    ['hospital','District hospital',4.5,.5,1.2]
  ];
  function calculate(input) {
    const {water,velocity,rainfall,blockage,gate,pumps,sandbags}=input;
    const stage=Math.max(.2,water+rainfall/100*1.5*(1+blockage/100*1.8)-pumps*.22-gate/100*.35-(sandbags?.45:0));
    const assets=definitions.map(([id,name,elevation,caution,critical])=>{
      const relief=(id==='underpass'?.9:0)+(sandbags&&['underpass','rail'].includes(id)?.4:0);
      const depth=Math.max(0,stage-elevation-relief);
      return {id,name,depth,status:depth>critical?'BLOCKED':depth>caution?'CAUTION':'SAFE'};
    });
    const submerged=assets.filter(a=>a.status==='BLOCKED').length;
    const area=stage>1.2?Math.min(18.5,(stage-1.2)*2.8+submerged*.8):.2;
    return {water,velocity,rainfall,blockage,gate,pumps,sandbags,manualReroute:!!input.manualReroute,siren:!!input.siren,broadcast:!!input.broadcast,stage,area,assets};
  }
  return {calculate};
});
