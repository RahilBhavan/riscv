import * as k from './vendor/iso-kit.mjs';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const ink='#111214',gray='#52545A',paper='#F5F5EF',yellow='#FFE500';
const text=(x,y,t,size=19,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${ink}" ${extra}>${esc(t)}</text>`;
const rect=(x,y,w,h,fill=paper,stroke='#C6C7BF')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}"/>`;
const line=(x1,y1,x2,y2)=>`<path d="M${x1},${y1}L${x2},${y2}" stroke="${ink}" fill="none"/>`;
const arrow=(x1,y1,x2,y2,label='')=>`${line(x1,y1,x2,y2)}<path d="M${x2-7},${y2-4}L${x2},${y2}L${x2-7},${y2+4}" stroke="${ink}" fill="none"/>${label?text((x1+x2)/2-20,y1-9,label,13):''}`;
const svg=(inner,h=200,label='Instructional diagram')=>`<svg viewBox="0 0 720 ${h}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg" style="font-family:LearningSans,Arial,sans-serif">${inner}</svg>`;
const cap=(title,body,graphic)=>`<figure><div class="fig-label">${title}</div>${graphic}<figcaption>${body}</figcaption></figure>`;
const table=(headers,rows)=>`<div class="table-scroll"><table ${headers[0]==='Instruction'&&headers[1]==='1'?'class="timing-table"':''}>${headers[0]==='Instruction'&&headers[1]==='1'?'<colgroup><col style="width:28%">'+headers.slice(1).map(()=>'<col style="width:'+(72/(headers.length-1))+'%">').join('')+'</colgroup>':''}<thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function pipeline(){
 let s=''; ['IF','ID','EX','MEM','WB'].forEach((n,i)=>{s+=rect(10+i*144,46,120,68,i===2?yellow:paper,ink)+text(25+i*144,86,n,25);if(i<4)s+=arrow(130+i*144,80,153+i*144,80);});
 s+=text(14,25,'Instruction',15)+text(580,25,'Retirement',15);
 return svg(s,140,'Five-stage pipeline from instruction fetch to writeback');
}
function machine(){
 const plate={x:-258,y:-63,w:516,d:126,r:8};
 const P=k.fitProjection([...k.boxCorners(plate,-16,2),[-240,-40,57],[240,40,57]],720,290,{pad:18,azimuth:68});
 const items=[]; let parts=0; let layer=0;
 const add=(plan,z,h,lit=false,id='')=>{parts++;items.push({layer,depth:k.depthOf([plan.x+plan.w/2,plan.y+plan.d/2,z+h/2],P),markup:`<g ${id?`id="${id}"`:''}>${k.solidSvg(k.slabOf(plan,z,h,P,4,.6),{tone:'mid',lit})}</g>`});};
 for(const x of [-237,222])for(const y of [-47,32])add({x,y,w:15,d:15,r:2},-16,5);
 layer=1; add(plate,-11,11); layer=2;
 for(const y of [-39,32])add({x:-248,y,w:496,d:7,r:1},0,8);
 for(let j=0;j<25;j++)add({x:-244+j*20,y:-31,w:12,d:62,r:1},3,3);
 layer=3; for(let i=0;i<5;i++){
   const x=-236+i*96;
   add({x:x+10,y:-53,w:62,d:12,r:2},0,7);
   add({x:x+12,y:-51,w:8,d:9,r:1},7,43);
   add({x:x+62,y:-51,w:8,d:9,r:1},7,43);
   add({x:x+10,y:-52,w:62,d:12,r:1},50,7);
   add({x:x+28,y:-49,w:24,d:13,r:1},35,15);
   add({x:x+35,y:-36,w:10,d:16,r:1},35,7);
   add({x:x+26,y:-22,w:28,d:9,r:1},8,6);
   for(const bx of [x+14,x+64])add({x:bx,y:-50,w:4,d:4,r:.5},57,.9);
   // Moving workpiece and its four corner clamps are carried as one rigid group.
   const plan={x:x+19,y:-10,w:44,d:31,r:2};
   const partsMarkup=[k.solidSvg(k.slabOf(plan,7,4,P,4,.8),{tone:'hi',lit:true})];
   for(const [bx,by] of k.corners(plan,4))partsMarkup.push(k.solidSvg(k.slabOf({x:bx-2,y:by-2,w:4,d:4,r:.3},11,2,P,3,.3),{tone:'lo'}));
   parts+=5;
   items.push({layer:4,depth:k.depthOf([x+41,5,10],P),markup:`<g class="workpiece" data-stage="${i}">${partsMarkup.join('')}</g>`});
 }
 // Rail end stops, mounted gate blocks and square bolt heads.
 layer=5; for(const x of [-254,247])for(const y of [-40,30])add({x,y,w:7,d:10,r:1},0,14);
 const statics=items.sort((a,b)=>a.layer-b.layer || a.depth-b.depth).map(x=>x.markup).join('');
 const title=`Five station indexed assembly conveyor, ${parts} solid parts`;
 return `<div class="machine-frame"><div class="machine-top"><span>FIG 05B / PHYSICAL MODEL</span><span>Five stations, one clock</span></div><div class="iso" data-theme="light">${svg(statics,290,title)}</div><div class="stage-labels">${['IF / fetch','ID / decode','EX / execute','MEM / memory','WB / writeback'].map((s,i)=>`<div><b>${s}</b><span class="occupant" data-stage="${i}">I${5-i}</span></div>`).join('')}</div><div class="machine-controls"><label>Example <select id="scenario"><option value="independent">Independent instructions</option><option value="load">Load-use dependency</option><option value="branch">Taken branch</option></select></label><button id="prev-cycle" type="button">Previous cycle</button><button id="next-cycle" type="button">Next cycle</button><button id="reset-cycle" type="button">Reset</button></div><p id="machine-readout" aria-live="polite">Cycle 5. Five independent instructions occupy the five stations.</p><p class="machine-note">Illustrative physical model. Workpieces represent valid instructions. Exact cycle timing appears in the chapter tables. ${parts} authored solid parts.</p></div>`;
}
export function figure(name){
 switch(name){
 case 'cover':return `<div class="cover-machine">${machine().replaceAll('id="','id="cover-').replaceAll('class="occupant"','class="cover-occupant"')}</div>`;
 case 'route': return table(['Read','Build question','Evidence'],[['Pages 3–10','What does one instruction mean?','Hand-calculated examples'],['Pages 11–19','What changes when instructions overlap?','Hazard and flush tests'],['Pages 20–24','What does DOT4 add?','Signed-lane and dependency checks'],['Pages 25–29','Which claims did the tools establish?','Coverage and route reports']]);
 case 'bits':return cap('FIG 01 / UNSIGNED BYTE','Illustration: each set bit contributes its place value.',svg(Array.from({length:8},(_,i)=>rect(16+i*87,30,76,62,[0,0,1,0,1,1,0,1][i]?yellow:paper,ink)+text(41+i*87,69,[0,0,1,0,1,1,0,1][i],25)+text(35+i*87,119,2**(7-i),15)).join(''),145));
 case 'signed':return table(['Bits','Unsigned 8-bit','Signed 8-bit','32-bit sign extension'],[['01111111','127','127','0x0000007F'],['10000000','128','−128','0xFFFFFF80'],['11111111','255','−1','0xFFFFFFFF']]);
 case 'clock':return cap('FIG 02 / REGISTER BOUNDARY','Illustration: combinational logic settles between active edges.',svg(rect(15,56,130,65,paper,ink)+text(33,95,'Register A',19)+arrow(145,88,260,88,'old value')+rect(260,56,190,65,yellow,ink)+text(281,95,'Combinational',19)+arrow(450,88,575,88,'next value')+rect(575,56,130,65,paper,ink)+text(593,95,'Register B',19)+text(40,150,'launch edge',15)+text(590,150,'capture edge',15),180));
 case 'isa':return table(['Instruction','Inputs','Visible result'],[['addi x1, x0, 7','x0 and immediate 7','x1 = 7'],['add x3, x1, x2','x1 and x2','x3 = x1 + x2'],['lw x4, 128(x0)','base 0, offset 128','x4 = memory word'],['sw x4, 132(x0)','address and x4','memory word = x4']]);
 case 'encoding':return cap('FIG 03 / R-TYPE FIELD MAP','Illustration: field widths sum to 32 bits. Widths use a shared bit scale.',svg((()=>{let x=8;return [[7,'funct7','0000000'],[5,'rs2','00010'],[5,'rs1','00001'],[3,'funct3','000'],[5,'rd','00011'],[7,'opcode','0110011']].map(([w,n,v])=>{let y=rect(x,40,w*22,62,n==='opcode'?yellow:paper,ink)+text(x+w*11,28,n,17,'text-anchor="middle"')+text(x+w*11,78,v,16,'text-anchor="middle"')+text(x+w*11,124,w+' bits',14,'text-anchor="middle"');x+=w*22;return y;}).join('');})(),148));
 case 'datapath':return cap('FIG 04 / ADD DATAFLOW','Illustration: values move forward while control selects the permitted update.',svg(rect(10,52,132,74,paper,ink)+text(25,84,'Instruction',18)+text(25,107,'decode',18)+arrow(142,89,188,89,'rs')+rect(188,52,152,74,paper,ink)+text(203,84,'Register file',18)+text(203,107,'x1 and x2',18)+arrow(340,89,400,89,'a,b')+rect(400,52,120,74,yellow,ink)+text(434,94,'ALU',23)+arrow(520,89,578,89,'sum')+rect(578,52,130,74,paper,ink)+text(590,84,'Write rd',18)+text(590,107,'if enabled',16),160));
 case 'memory':return table(['Byte address','128','129','130','131'],[['Stored byte','0x7F','0x00','0xFF','0x80'],['Role in word','bits 7:0','bits 15:8','bits 23:16','bits 31:24']]);
 case 'pipeline':return cap('FIG 05A / LOGICAL STAGES','Illustration: stage boundaries hold the instruction and its control state.',pipeline());
 case 'machine':return machine();
 case 'hazards':return table(['Mechanism','Purpose','Example'],[['Forward','Use an already computed result','ALU result into next ALU'],['Stall','Wait for a required value','Immediate load consumer'],['Flush','Discard younger wrong-path work','Taken branch resolved in EX']]);
 case 'forwarding':return cap('FIG 06 / EX OPERAND SELECTION','Illustration: the matching non-load MEM result has priority over WB.',svg(rect(15,28,220,43,paper,ink)+text(27,56,'Saved operand: x4 = 0',17)+rect(15,91,220,43,paper,ink)+text(27,119,'WB writer: x4 = 5',17)+rect(15,154,220,43,yellow,ink)+text(27,182,'MEM writer: x4 = 8',17)+line(235,50,330,50)+line(330,50,330,111)+line(235,112,330,112)+line(235,176,330,176)+line(330,176,330,113)+arrow(330,112,410,112,'select')+rect(410,80,155,65,yellow,ink)+text(430,121,'EX input = 8',18)+text(588,118,'newest',17),220));
 case 'wbid':return table(['Clock interval','Producer','Consumer','Needed path'],[['Same interval','WB writes x1','ID captures x1','WB to ID/EX bypass']]);
 case 'load':return table(['At stall edge','Action'],[['PC','Hold current fetch address'],['IF/ID','Hold consumer instruction'],['ID/EX','Insert invalid bubble'],['EX/MEM and MEM/WB','Older work continues']]);
 case 'timeline':return cap('FIG 07 / LOAD, ADD, STORE','Illustration: one held front-end cycle creates one invalid EX entry.',table(['Instruction','1','2','3','4','5','6','7','8'],[['lw x1, 0(x0)','IF','ID','EX','MEM','WB','','',''],['add x2, x1, x1','','IF','ID','ID held','EX','MEM','WB',''],['sw x2, 4(x0)','','','IF','IF held','ID','EX','MEM','WB'],['EX bubble','','','','bubble','','','','']]));
 case 'control':return cap('FIG 08 / EX-STAGE REDIRECT','Illustration: the branch discards younger IF and ID instructions at the end of cycle 3.',table(['Instruction','1','2','3','4','5','6'],[['branch','IF','ID','EX','MEM','WB',''],['wrong-path store','','IF','ID / discard','','',''],['wrong-path ADDI','','','IF / discard','','',''],['target','','','','IF','ID','EX']]));
 case 'dot':return cap('FIG 09 / DOT4 DATAFLOW','Illustration: independent signed-byte products feed one sum.',svg([0,1,2,3].map(i=>{let x=20+i*176;return rect(x,20,148,45,paper,ink)+text(x+15,48,`a[${i}] × b[${i}]`,18)+line(x+74,65,x+74,98)+line(x+74,98,360,98);}).join('')+line(360,98,360,127)+rect(271,127,178,52,yellow,ink)+text(291,160,'signed 32-bit sum',17),200));
 case 'dotworked':return table(['Lane','A byte','A signed','B signed','Product'],[['0','0x80','−128','−1','128'],['1','0xFF','−1','4','−4'],['2','0x02','2','3','6'],['3','0x01','1','2','2'],['Total','','','','132']]);
 case 'oracle':return cap('FIG 10 / TWO EXECUTIONS, ONE COMPARISON','Same program words drive both implementations. A mismatch identifies the first divergent result.',svg(rect(10,75,130,55,paper,ink)+text(24,109,'Program',20)+line(140,102,193,102)+line(193,45,193,165)+arrow(193,45,260,45)+arrow(193,165,260,165)+rect(260,17,190,58,paper,ink)+text(277,52,'Sequential model',18)+rect(260,137,190,58,paper,ink)+text(277,172,'Pipelined RTL',18)+line(450,45,496,45)+line(496,45,496,165)+line(450,165,496,165)+arrow(496,102,560,102,'results')+rect(560,75,145,55,yellow,ink)+text(575,109,'Comparator',19),220));
 case 'coverage':return table(['Metric','Reference result','Scope'],[['Passing programs','144 / 144','Local directed and random suite'],['Retired instructions','7,358 checked','Ordered architectural trace'],['Line instrumentation','37 / 38 = 97.37%','Core only, Verilator 5.020'],['Functional bins','46 / 46','Named class/outcome plan']]);
 case 'synthesis':return cap('FIG 11 / IMPLEMENTATION FLOW','The final timing estimate belongs to a device, constraints, tools and route seed.',svg(['RTL','Synthesis','Placement','Routing'].map((n,i)=>rect(10+i*180,35,150,58,i===3?yellow:paper,ink)+text(22+i*180,72,n,20)+(i<3?arrow(160+i*180,64,190+i*180,64):'')).join(''),118));
 default:return '';
 }
}
