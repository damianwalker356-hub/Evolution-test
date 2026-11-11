// Editor property <-> stored design value conversion. Penalty is stored as a 0..1 fraction, shown as 0..100 percent.
const PERCENT_FIELDS=new Set(['penalty']);
export const isPercentField=k=>PERCENT_FIELDS.has(k);
export const fieldLabel=k=>isPercentField(k)?k+' (%)':k;
const round=x=>Math.round(x*1e6)/1e6;
export const toDisplay=(k,v)=>isPercentField(k)?round(v*100):v;
export function fromInput(k,text){
 const raw=typeof text==='string'?text.trim():text;
 if(raw===''||raw===null||raw===undefined)throw new Error('Enter a number for '+k);
 const n=Number(raw);
 if(!Number.isFinite(n))throw new Error(k+' must be a number');
 if(isPercentField(k)){if(n<0||n>100)throw new Error(k+' must be between 0 and 100 percent');return round(n/100);}
 return n;
}
