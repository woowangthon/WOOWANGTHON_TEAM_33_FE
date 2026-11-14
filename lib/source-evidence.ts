// Recover only whitespace differences, then return a literal span of the source.
// Ambiguity and character changes are never guessed.
export function exactSourceSpan(source:string,proposed:string):string|null {
  if(source.includes(proposed))return proposed;
  const positions:number[]=[];let compact='';
  for(let i=0;i<source.length;i++)if(!/\s/u.test(source[i])){compact+=source[i];positions.push(i);}
  const needle=proposed.replace(/\s/gu,''),start=needle?compact.indexOf(needle):-1;
  if(start<0||compact.indexOf(needle,start+1)>=0)return null;
  return source.slice(positions[start],positions[start+needle.length-1]+1);
}
