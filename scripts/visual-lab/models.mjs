export const signedByte = n => (n & 255) >= 128 ? (n & 255)-256 : n & 255;
export const hex = n => (n>>>0).toString(16).padStart(8,'0');
export function byteModel(n){
 if(!Number.isInteger(n)||n<0||n>255)throw new RangeError('Use an integer from 0 to 255');
 return {unsigned:n,signed:signedByte(n),bits:Array.from({length:8},(_,i)=>(n>>(7-i))&1)};
}
export function decode(n){
 n=n>>>0;
 const op=n&127,f3=(n>>>12)&7,f7=n>>>25;
 return {word:n,opcode:op,rd:(n>>>7)&31,rs1:(n>>>15)&31,rs2:(n>>>20)&31,funct3:f3,funct7:f7,
 fields:[f7,(n>>>20)&31,(n>>>15)&31,f3,(n>>>7)&31,op],
 name:op===0x0b&&f3===0&&f7===0?'DOT4':op===0x33&&f3===0&&f7===0?'ADD':'Other encoding'};
}
export function dot4(a,b){
 if(a.length!==4||b.length!==4||[...a,...b].some(n=>!Number.isInteger(n)||n< -128||n>127))throw new RangeError('Each lane must be an integer from −128 to 127');
 const products=a.map((n,i)=>n*b[i]);
 return {products,sum:products.reduce((x,y)=>x+y,0),packedA:a.reduce((n,x,i)=>n|((x&255)<<(8*i)),0)>>>0,packedB:b.reduce((n,x,i)=>n|((x&255)<<(8*i)),0)>>>0};
}
export function compare(expected,actual){
 const first=expected.findIndex((v,i)=>v!==actual[i]);
 return {equal:first===-1&&expected.length===actual.length,first:first===-1&&expected.length!==actual.length?Math.min(expected.length,actual.length):first};
}
export function traceFrame(data,name,index){
 const trace=data.traces[name];
 return trace.frames[Math.max(0,Math.min(trace.frames.length-1,index))];
}
