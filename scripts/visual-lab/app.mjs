import {byteModel,decode,dot4,compare,hex,traceFrame} from './models.mjs';
export function mount(DATA){
 const $=s=>document.querySelector(s);
 const names=['Bits and clocked state','Instruction decoding','Five-stage pipeline','Hazards and recovery','Signed DOT4','Differential verification','Synthesis and timing','Research and release'];
 const ids=['01-foundations','02-rv32i-datapath','03-pipeline','04-hazards','05-dot4','06-verification','07-synthesis-fpga','08-research-release'];
 let view=0,frame=3,trace='decode_add',auto=false,timer=null;
 const rail=$('#lessons'),controls=$('#controls'),readout=$('#readout'),detail=$('#detail');
 const table=(headers,rows)=>`<div class="scroll"><table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 const part=(name,on)=>{const el=$(`[data-part="${name}"]`);if(el){el.style.opacity=on?'1':'.17';el.style.transform=on?'':'translateY(2px)';}};
 const traceOptions=()=>Object.keys(DATA.traces.traces).map(n=>`<option value="${n}" ${n===trace?'selected':''}>${n.replaceAll('_',' ')}</option>`).join('');
 function stop(){auto=false;clearInterval(timer);if($('#play'))$('#play').textContent='Play cycles';}
 function updateTrace(){
  const t=DATA.traces.traces[trace];frame=Math.max(0,Math.min(frame,t.frames.length-1));const f=traceFrame(DATA.traces,trace,frame);
  for(let i=0;i<5;i++)part('carrier-'+i,f.stages[i].valid);
  $('#cycle').value=frame;$('#cycle-number').textContent=f.cycle;
  readout.textContent=`Cycle ${f.cycle} · ${f.stall?'load-use stall pending':f.flush?'redirect or trap flush pending':'normal advance'}`;
  detail.innerHTML=table(['Stage','Valid','PC','Instruction word'],f.stages.map((s,i)=>[['IF','ID','EX','MEM','WB'][i],s.valid?'yes':'bubble',s.valid?'0x'+hex(s.pc):'—',s.valid?'0x'+hex(t.words[s.pc/4]??0x13):'—']))+`<p>EX operands: A = 0x${hex(f.a)}, B = 0x${hex(f.b)}. ${t.retirements} retirement records and ${t.stores} byte writes checked for this program.</p><p class="muted">${DATA.traces.scope} The illuminated carriers encode validity, not occupancy by area. The table identifies each instruction.</p>`;
 }
 function draw(){
  stop();rail.querySelectorAll('button').forEach((b,i)=>{b.setAttribute('aria-current',i===view?'step':'false');});
  $('#title').textContent=names[view];$('#number').textContent=`FIG ${String(view+1).padStart(2,'0')}`;
  $('#art').innerHTML=DATA.art[view].svg;$('#part-count').textContent=DATA.art[view].parts+' solid parts';
  $('#book').href=DATA.bookBase+ids[view]+'.html';$('#pdf').href=DATA.bookBase+ids[view]+'.pdf';
  $('#source').href='https://github.com/RahilBhavan/riscv/blob/main/'+['docs/textbook/series/labs/rtl_basics.sv','rtl/rv32_core.sv','rtl/rv32_core.sv','rtl/rv32_core.sv','rtl/rv32_core.sv','tests/run.py','rtl/timing_top.sv','docs/EXPERIMENT_LOG.md'][view];
  const tasks=[['Set a byte, then interpret the same eight bits two ways.','make learning-labs','Predict what 0x80 means as an unsigned and a signed byte.'],['Read the fields before guessing what an instruction does.','make learning-labs','Change ADD to DOT4. Which field changes?'],['Step a captured RTL execution; a lit carrier is a valid instruction.','make visual-evidence','Find the interval where ADD reaches EX.'],['Watch the front end hold while older instructions advance.','make learning-labs reset-test','Find a stall, then compare the next interval. Try the branch trace and locate discarded instructions.'],['Four signed products contribute to one 32-bit result.','make learning-labs','Try four −128 × −128 products. Why does the sum need more than 16 bits?'],['A checker compares ordered results from two independent executions.','make test coverage','Inject a mismatch in the teaching comparator and find the first differing record.'],['A timing result belongs to this device, shell, constraints and seed.','make timing','Explain why internal Fmax is not a demonstrated board clock.'],['An experiment is ready only when its evidence is reproducible.','make test learning-labs reset-test lint coverage timing','Pick one record, make a prediction, and state what result would disprove it.']][view];
  $('#hint').textContent=tasks[0];$('#command').textContent=tasks[1];$('#challenge').textContent=tasks[2];
  if(view===0){
   controls.innerHTML='<label>Unsigned byte <input id="byte" type="range" min="0" max="255" value="128"></label><button id="clock">Capture rising edge</button>';
   let captured=0;const render=()=>{const x=byteModel(Number($('#byte').value));x.bits.forEach((b,i)=>part('bit-'+i,b));readout.textContent=`Input ${x.unsigned} · signed ${x.signed} · captured ${captured}`;detail.innerHTML=`<p class="formula">${x.bits.join('')}₂</p><p>Bit 7 has unsigned weight 128 and signed weight −128. The drawn caps encode the current input; the captured value changes only when you press the clock button. This is an illustrative one-register model.</p>`;};$('#byte').oninput=render;$('#clock').onclick=()=>{captured=Number($('#byte').value);render();};render();
  }else if(view===1){
   controls.innerHTML='<label>Encoding <select id="word"><option value="002081b3">ADD x3, x1, x2</option><option value="0020818b">DOT4 x3, x1, x2</option></select></label>';
   const render=()=>{const d=decode(parseInt($('#word').value,16));readout.textContent=`0x${hex(d.word)} · ${d.name} x${d.rd}, x${d.rs1}, x${d.rs2}`;detail.innerHTML=table(['Field (high → low)','Width','Value'],['funct7','rs2','rs1','funct3','rd','opcode'].map((n,i)=>[n,[7,5,5,3,5,7][i],d.fields[i]]))+'<p>Card insert widths use one common bit scale. Both operations use R-type field positions; the custom-0 opcode selects DOT4.</p>';};$('#word').onchange=render;render();
  }else if(view===2||view===3){
   trace=view===2?'decode_add':'load_store';frame=3;
   controls.innerHTML=`<label>Checked program <select id="trace">${traceOptions()}</select></label><div class="buttons"><button id="prev">Previous</button><button id="next">Next cycle</button><button id="play">Play cycles</button><button id="reset">Reset</button></div><label>Cycle <output id="cycle-number"></output><input id="cycle" type="range" min="0" max="${DATA.traces.traces[trace].frames.length-1}" value="3"></label>`;
   $('#trace').onchange=()=>{stop();trace=$('#trace').value;frame=0;$('#cycle').max=DATA.traces.traces[trace].frames.length-1;updateTrace();};
   $('#prev').onclick=()=>{stop();frame--;updateTrace();};$('#next').onclick=()=>{stop();frame++;updateTrace();};$('#reset').onclick=()=>{stop();frame=0;updateTrace();};$('#cycle').oninput=()=>{stop();frame=Number($('#cycle').value);updateTrace();};
   $('#play').onclick=()=>{if(auto){stop();return;}auto=true;$('#play').textContent='Pause';timer=setInterval(()=>{if(document.hidden||!$('#figure').getBoundingClientRect().bottom||!onscreen){stop();return;}if(frame>=DATA.traces.traces[trace].frames.length-1){stop();return;}frame++;updateTrace();},1100);};updateTrace();
  }else if(view===4){
   controls.innerHTML='<div class="lanes">'+['A','B'].map((n,row)=>`<fieldset><legend>${n} signed lanes (0 → 3)</legend>${(row?[-1,4,3,2]:[-128,-1,2,1]).map((v,i)=>`<input type="number" aria-label="${n} lane ${i}" min="-128" max="127" step="1" value="${v}">`).join('')}</fieldset>`).join('')+'</div><button id="extreme">Set maximum sum</button>';
   const render=()=>{try{const inputs=[...controls.querySelectorAll('input')];if(inputs.some(x=>x.value===''))throw Error('Fill all eight lanes.');const values=inputs.map(x=>Number(x.value)),d=dot4(values.slice(0,4),values.slice(4));readout.textContent=`DOT4 = ${d.sum} · 0x${hex(d.sum)}`;d.products.forEach((p,i)=>part('carrier-'+i,p!==0));detail.innerHTML=table(['Lane','A signed','B signed','Product'],d.products.map((p,i)=>[i,values[i],values[i+4],p]))+`<p>Packed A = 0x${hex(d.packedA)}, B = 0x${hex(d.packedB)}. Lane 0 is the least significant byte. No accumulation or saturation. The four lit carriers indicate nonzero contributions; their size does not encode product magnitude.</p>`;}catch(e){readout.textContent=e.message;detail.textContent='Enter eight integer values in the signed-byte range.';}};
   controls.querySelectorAll('input').forEach(x=>x.oninput=render);$('#extreme').onclick=()=>{controls.querySelectorAll('input').forEach(x=>x.value=-128);render();};render();
  }else if(view===5){
   controls.innerHTML='<label>Teaching comparator <select id="mismatch"><option value="0">Matching traces</option><option value="1">Inject wrong result</option><option value="2">Drop final result</option></select></label>';
   const render=()=>{const a=[7,3,10,132],b=[...a];if($('#mismatch').value==='1')b[2]=11;if($('#mismatch').value==='2')b.pop();const c=compare(a,b);for(let i=0;i<4;i++){part('sample-1-'+i,i<b.length);part('match-'+i,a[i]===b[i]);}readout.textContent=c.equal?'Teaching traces agree':`First mismatch: record ${c.first+1}`;detail.innerHTML=table(['Record','Expected','Observed'],a.map((v,i)=>[i+1,v,b[i]??'missing']))+`<p>The switch injects a synthetic fault into this teaching model. Real regression: ${DATA.verification.test_cases} programs, ${DATA.verification.retired_instructions.toLocaleString()} retirement records. Core line instrumentation: ${DATA.coverage.hit}/${DATA.coverage.total} = ${DATA.coverage.percent}%. These are separate metrics; neither is ISA certification.</p>`;};$('#mismatch').onchange=render;render();
  }else if(view===6){
   controls.innerHTML='<button id="boundary">Show measurement boundary</button>';
   readout.textContent=`${DATA.fmax.toFixed(2)} MHz internal Fmax · HX8K · seed ${DATA.implementation.seed}`;
   detail.innerHTML=table(['Measured quantity','Result'],[['LUT4',DATA.implementation.synthesis_primitives.SB_LUT4],['Flip-flops',DATA.implementation.flip_flops],['Packed logic cells',DATA.implementation.utilization.ICESTORM_LC.used+' / '+DATA.implementation.utilization.ICESTORM_LC.available],['Target constraint',DATA.implementation.constraint_mhz+' MHz'],['Board tested','No']])+`<p>The socket is an illustrative device, not a placement plot or utilization chart. Actual counts come from the archived tools. ${DATA.implementation.design}. ${DATA.implementation.io_constraints}.</p>`;
   $('#boundary').onclick=()=>{readout.textContent='Included: core + registered shell. Excluded: memories, peripherals and board timing.';};
  }else{
   const records=[['Question','Does reset suppress a pending memory request?'],['Baseline','Old RTL fails reset_tb before a clock edge.'],['Change','Gate dmem_read and dmem_wstrb with !reset.'],['Correctness','Pending store, pending load, state clearing and restart pass.'],['Measurement','Rerun coverage and synthesis on the new RTL.'],['Provenance',DATA.traces.source_sha256['rtl/rv32_core.sv']],['Limit','No FPGA board run or external ISA certification.'],['Next experiment','Compare DOT4 with scalar RV32I software multiplication under the same memory contract.']];
   controls.innerHTML='<label>Experiment record <select id="record">'+records.map((r,i)=>`<option value="${i}">${i+1}. ${r[0]}</option>`).join('')+'</select></label>';
   const render=()=>{const i=Number($('#record').value);for(let j=0;j<8;j++){part('file-'+j,j===i);part('tab-'+j,j===i);}readout.textContent=records[i][0];detail.innerHTML=`<p class="record">${records[i][1]}</p><p>Change one factor, retain the baseline, rerun correctness, then compare a clearly defined measurement. Record negative results too.</p>`;};$('#record').onchange=render;render();
  }
 }
 rail.innerHTML=names.map((n,i)=>`<button type="button" data-view="${i}"><span>${String(i+1).padStart(2,'0')}</span>${n}</button>`).join('');
 rail.onclick=e=>{const b=e.target.closest('[data-view]');if(b){view=Number(b.dataset.view);draw();}};
 $('#theme').onclick=()=>{const light=document.body.dataset.theme!=='light';document.body.dataset.theme=light?'light':'dark';$('#art').dataset.theme=light?'light':'dark';$('#theme').textContent=light?'Dark figure':'Light figure';};
 let onscreen=true;new IntersectionObserver(([entry])=>{onscreen=entry.isIntersecting;if(!onscreen)stop();}).observe($('#figure'));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 draw();
}
