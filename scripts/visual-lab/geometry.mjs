import * as k from '../textbook/vendor/iso-kit.mjs';
// Physical assembly layers: feet, bed, rails, sockets, supported inserts, caps.
// No free lines, pipes, cylinders or hidden wireframes are authored.
export function instrument(kind){
 const bed={x:-230,y:-83,w:460,d:166,r:7};
 const P=k.fitProjection([...k.boxCorners(bed,-20,0),[-230,-83,70],[230,83,70]],800,340,{pad:18,azimuth:62});
 const items=[];let parts=0;
 const add=(x,y,w,d,z,h,layer=2,lit=false,key='')=>{
  parts++;
  const markup=k.solidSvg(k.slabOf({x,y,w,d,r:Math.min(2,w/5,d/5)},z,h,P,3,.5),{tone:lit?'hi':'mid',lit});
  items.push({layer,depth:k.depthOf([x+w/2,y+d/2,z+h/2],P),s:`<g ${key?`data-part="${key}"`:''}>${markup}</g>`});
 };
 for(const x of [-213,197])for(const y of [-66,50]){add(x,y,16,16,-20,4,0);add(x+2,y+2,12,12,-16,5,0);add(x+5,y+5,6,6,0,1,2);}
 add(-230,-83,460,166,-11,11,1);
 for(const y of [-64,56]){add(-219,y,438,8,0,5);for(const x of [-222,212]){add(x,y-2,10,12,0,10);for(const dx of [1,6])add(x+dx,y,2,3,10,1,3);}}
 for(const y of [-46,42]){add(-212,y,424,7,0,4);for(const x of [-206,202])add(x,y+2,3,3,4,1,3);}
 add(-215,-42,430,84,0,4); // insert mounting deck: every socket seats at z=4
 add(-207,69,414,9,0,2);
 for(let i=0;i<8;i++)add(-194+i*51,70,26,6,2,2,3);
 const press=(x,y,w,index)=>{
  add(x,y,w,44,4,5,3);
  for(const px of [x+2,x+w-8]){add(px,y+2,6,8,9,41,4);add(px+1,y+3,3,3,56,1,6);}
  add(x,y+1,w,10,50,6,5);add(x+w/2-8,y+3,16,13,30,20,5);
  add(x+w/2-5,y+16,10,8,30,5,5);
  add(x+8,y+20,w-16,21,9,5,5,true,`carrier-${index}`);
  for(const px of [x+9,x+w-13])for(const py of [y+21,y+36])add(px,py,4,4,14,2,6);
 };
 if(kind==='bits')for(let i=0;i<8;i++){
  const x=-201+i*51;add(x,-24,42,48,4,8,3);add(x+5,-20,32,40,12,2,4);add(x+10,-13,22,17,14,8,5,true,`bit-${i}`);
  for(const y of [-19,17])add(x+2,y,3,3,12,1,4);
 };
 if(kind==='decode'){
  const widths=[7,5,5,3,5,7];let x=-208;
  for(let i=0;i<6;i++){
   const w=widths[i]*12;add(x,-29,w-3,60,4,5,3);add(x+3,-23,w-9,47,9,4,4,i===5,`field-${i}`);
   for(const y of [-28,27])add(x+2,y,w-7,4,9,5,5);
   x+=w+1;
  }
 }
 if(kind==='pipeline'||kind==='hazards')for(let i=0;i<5;i++)press(-209+i*85,-25,73,i);
 if(kind==='dot')for(let i=0;i<4;i++)press(-203+i*104,-25,86,i);
 if(kind==='verify'){
  for(let row=0;row<2;row++){
   const y=-34+row*54;add(-204,y,408,6,4,6,3);
   for(let i=0;i<4;i++){const x=-192+i*99;add(x,y-9,78,25,10,4,4);add(x+6,y-5,66,16,14,5,5,true,`sample-${row}-${i}`);}
  }
  for(let i=0;i<4;i++)add(-162+i*99,-3,8,16,4,5,3,true,`match-${i}`);
 }
 if(kind==='synth'){
  add(-173,-41,346,82,4,6,3);add(-164,-34,328,68,10,3,4);
  for(let i=0;i<16;i++){
   const x=-153+i*20;add(x,-40,9,6,10,3,5);add(x,34,9,6,10,3,5);
   add(x,-26,14,52,13,7,5);add(x+2,-23,10,46,20,2,6,i===7,`logic-${i}`);
  }
 }
 if(kind==='research')for(let i=0;i<8;i++){
  const x=-205+i*52;add(x,-35,44,72,4,4,3);add(x,-35,4,72,8,48,4);
  add(x+7,-29,30,59,8,39,5,i===0,`file-${i}`);add(x+12,-23,15,11,47,5,6,i===0,`tab-${i}`);
 }
 const body=items.sort((a,b)=>a.layer-b.layer||a.depth-b.depth).map(x=>x.s).join('');
 return {parts,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 340" role="img" aria-label="${kind} teaching instrument, ${parts} solid parts">${body}</svg>`};
}
