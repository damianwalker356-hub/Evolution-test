// Evolution FeedForwardNetwork.cs / MatrixUtils.cs and generation rules.
// Derived-source restrictions apply. No rendering or substitute physics.
import {createRandom,createSelector,recombine,mutate} from './genetics.mjs';
const f=Math.fround;
function finiteArray(a){return a instanceof Float32Array && a.every(Number.isFinite);}
export class CreatureNetwork {
  constructor(layers,weights,rng=createRandom(1)) {
    if(!Array.isArray(layers)||layers.length<2||layers.length>10||!layers.every(n=>Number.isInteger(n)&&n>=1&&n<=4096))throw new RangeError('invalid network dimensions');
    let count=0;for(let i=0;i<layers.length-1;i++)count+=layers[i]*layers[i+1];
    if(count>1000000)throw new RangeError('network memory limit exceeded');
    this.layers=Object.freeze(layers.slice());
    if(weights!==undefined&&(!finiteArray(weights)||weights.length!==count))throw new TypeError('weight size or values invalid');
    this.weights=weights?weights.slice():Float32Array.from({length:count},()=>rng.float(-3,3));
    this.inputs=new Float32Array(layers[0]);
    this.buffers=layers.slice(1).map(n=>new Float32Array(n));
  }
  evaluate(inputs=this.inputs) {
    if(!finiteArray(inputs)||inputs.length!==this.inputs.length)throw new TypeError('invalid observations');
    this.inputs.set(inputs);let source=this.inputs,offset=0;
    for(let l=0;l<this.buffers.length;l++){
      const target=this.buffers[l],rows=this.layers[l],cols=this.layers[l+1];
      for(let j=0;j<cols;j++){
        // Original MatrixProductTranspose uses += without clearing tempResults.
        let sum=target[j];
        for(let k=0;k<rows;k++)sum=f(sum+f(this.weights[offset+k*cols+j]*source[k]));
        target[j]=f(1/(1+Math.exp(-sum)));
      }
      offset+=rows*cols;source=target;
    }
    return source; // Reused buffer, as in the original controller.
  }
  reset(){this.inputs.fill(0);for(const b of this.buffers)b.fill(0);}
  snapshot(){return {schema:'creature-network-v1',layers:[...this.layers],weights:[...this.weights],inputs:[...this.inputs],buffers:this.buffers.map(b=>[...b])};}
  static restore(s){
    if(!s||s.schema!=='creature-network-v1'||!Array.isArray(s.weights)||!s.weights.every(Number.isFinite)||!Array.isArray(s.inputs)||!s.inputs.every(Number.isFinite))throw new TypeError('invalid network checkpoint');
    const n=new CreatureNetwork(s.layers,Float32Array.from(s.weights));
    if(s.inputs.length!==n.inputs.length||!Array.isArray(s.buffers)||s.buffers.length!==n.buffers.length)throw new TypeError('checkpoint shape mismatch');
    n.inputs.set(s.inputs);
    s.buffers.forEach((a,i)=>{if(!Array.isArray(a)||a.length!==n.buffers[i].length||!a.every(Number.isFinite))throw new TypeError('invalid activation checkpoint');n.buffers[i].set(a);});
    return n;
  }
}
export class CreaturePopulation {
  constructor({layers,size=50,seed=1,selection=1,crossover=0,mutation=0,mutationRate=0.05,keepBest=true}){
    if(!Number.isInteger(size)||size<2||size>1000||![0,1,2,3].includes(selection)||![0,1,2].includes(crossover)||![0,1,2].includes(mutation)||!Number.isFinite(mutationRate)||mutationRate<0||mutationRate>1)throw new RangeError('invalid population settings');
    this.rng=createRandom(seed);this.layers=layers.slice();this.size=size;this.selection=selection;this.crossover=crossover;this.mutation=mutation;this.mutationRate=mutationRate;this.keepBest=keepBest;this.generation=1;
    this.networks=Array.from({length:size},()=>new CreatureNetwork(layers,undefined,this.rng));
  }
  advance(fitness){
    if(!finiteArray(fitness)||fitness.length!==this.size||fitness.some(x=>x<0))throw new TypeError('one finalized nonnegative fitness per creature required');
    const candidates=this.networks.map((network,i)=>({fitness:fitness[i],network}));
    const selector=createSelector(candidates,this.selection,this.rng),weights=[];
    if(this.keepBest)for(const e of selector.best(2))weights.push(e.network.weights.slice());
    while(weights.length<this.size){
      const a=selector.select().network.weights,b=selector.select().network.weights;
      const children=recombine(a,b,this.crossover,this.rng);
      for(const child of children){if(weights.length===this.size)break;if(this.rng.float(0,100)<this.mutationRate*100)mutate(child,this.mutation,this.rng);weights.push(child);}
    }
    this.networks=weights.map(w=>new CreatureNetwork(this.layers,w));this.generation++;
    return this.networks;
  }
}
