/** A static open mouth/yawn is not rhythmic speech evidence. */
export function rhythmicSpeech(values:number[], amplitude=.045):boolean {
  if (values.length<6 || values.some(v=>!Number.isFinite(v))) return false;
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  let crossings=0;
  for(let i=1;i<values.length;i++) if((values[i-1]-mean)*(values[i]-mean)<0) crossings++;
  return crossings>=3 && Math.max(...values)-Math.min(...values)>=amplitude;
}
