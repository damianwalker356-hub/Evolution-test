// Derived from Evolution's Mutation, Recombination, Selection, RandomPicker,
// GaussianPRNG and RunningObjectiveTracker. Upstream restrictions apply.
const f=Math.fround;
const valid=x=>typeof x==='number'&&Number.isFinite(x);
export function createRandom(seed=1) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff) throw new RangeError('uint32 seed required');
  let state=seed>>>0, spare=null;
  function unit(){state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
  return {
    // Browser reproducibility only: NOT Unity's random sequence.
    int(min,max){if(!Number.isInteger(min)||!Number.isInteger(max)||max<min)throw new RangeError('invalid integer range');return max===min?min:min+Math.floor(unit()*(max-min));},
    float(min,max){return f(min+(max-min)*unit());},
    gaussian(){if(spare!==null){const z=spare;spare=null;return z;}let u,v;do{u=f(unit());v=f(unit());}while(u<=1.401298464324817e-45);const r=f(Math.sqrt(f(-2*f(Math.log(u))))),a=f(f(2*Math.PI)*v);spare=f(r*f(Math.sin(a)));return f(r*f(Math.cos(a)));}
  };
}
function chromosome(values){if(!(values instanceof Float32Array)||values.length<2||!values.every(valid))throw new TypeError('finite Float32Array with at least two weights required');}
export function mutate(values,mode,rng) {
  chromosome(values);
  const n=values.length, change=i=>{values[i]=f(values[i]+rng.gaussian());if(!valid(values[i]))throw new RangeError('mutation overflow');};
  if(mode===1){for(let i=0;i<n;i++)if(rng.int(1,100)>25)change(i);}
  else if(mode===2){const start=rng.int(0,n-1),end=rng.int(start,n-1),mid=Math.floor((start+end)/2);for(let i=start;i<=mid;i++){const j=end-i+start,x=values[i];values[i]=values[j];values[j]=x;}}
  else {const start=rng.int(0,n-1),length=Math.min(Math.max(0,n-start-3),rng.int(2,15));
    // Source compatibility: length is an END bound, not start+length.
    for(let i=start;i<length;i++)change(i);
  }
  return values;
}
export function recombine(a,b,mode,rng){
  chromosome(a);chromosome(b);if(a.length!==b.length)throw new RangeError('parent length mismatch');
  const n=a.length,x=new Float32Array(n),y=new Float32Array(n);
  if(mode===1){const part=Math.floor(n/Math.min(n,5));for(let i=0;i<n;i++){const swap=Math.floor(i/part)%2;x[i]=swap?b[i]:a[i];y[i]=swap?a[i]:b[i];}}
  else if(mode===2){for(let i=0;i<n;i++){const swap=rng.int(0,2);x[i]=swap?b[i]:a[i];y[i]=swap?a[i]:b[i];}}
  else{const split=rng.int(1,n);for(let i=0;i<n;i++){x[i]=i<split?a[i]:b[i];y[i]=i<split?b[i]:a[i];}}
  return [x,y];
}
export function createSelector(population,mode,rng){
  if(!Array.isArray(population)||population.length===0||!population.every(p=>p&&valid(p.fitness)&&p.fitness>=0))throw new TypeError('nonempty finite nonnegative-fitness population required');
  if(![0,1,2,3].includes(mode))throw new RangeError('invalid selection mode');
  const sorted=population.slice().sort((a,b)=>a.fitness-b.fitness);
  let total=0;const cdf=sorted.map((p,i)=>{total=f(total+(mode===1?p.fitness:mode===3?i:1));return total;});
  function pick(){const r=rng.float(0,total);for(let i=0;i<cdf.length;i++)if(cdf[i]>r)return sorted[i];return sorted[sorted.length-1];}
  return {
    best(n){if(!Number.isInteger(n)||n<0||n>sorted.length)throw new RangeError('invalid elite count');return sorted.slice(sorted.length-n).reverse();},
    select(){if(mode!==2)return pick();const a=pick(),b=pick(),c=pick();return a.fitness>b.fitness?(a.fitness>c.fitness?a:c):(b.fitness>c.fitness?b:c);}
  };
}
export function runningFitness(currentJointMeanX,initialJointMeanX,seconds){
  if(![currentJointMeanX,initialJointMeanX,seconds].every(valid)||seconds<=0)throw new RangeError('finite positions and positive duration required');
  return f(f(f(currentJointMeanX)-f(initialJointMeanX))/f(55*f(seconds)));
}
