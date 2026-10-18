import {test} from 'node:test';
import assert from 'node:assert/strict';
import {byteModel,decode,dot4,compare} from './models.mjs';
test('all byte patterns round trip through signed interpretation',()=>{
 for(let n=0;n<256;n++){const x=byteModel(n);assert.equal(x.bits.reduce((s,b)=>2*s+b,0),n);assert.equal(x.signed<0?x.signed+256:x.signed,n);}
 assert.throws(()=>byteModel(256));
});
test('DOT4 known values, extrema and every isolated lane pair',()=>{
 assert.equal(dot4([-128,-1,2,1],[-1,4,3,2]).sum,132);
 assert.equal(dot4([-128,-128,-128,-128],[-128,-128,-128,-128]).sum,65536);
 assert.equal(dot4([-128,-128,-128,-128],[127,127,127,127]).sum,-65024);
 for(let lane=0;lane<4;lane++)for(let a=-128;a<128;a++)for(let b=-128;b<128;b++){
  const x=[0,0,0,0],y=[0,0,0,0];x[lane]=a;y[lane]=b;assert.equal(dot4(x,y).sum,a*b+0);
 }
 assert.throws(()=>dot4([128,0,0,0],[0,0,0,0]));
});
test('known ADD and DOT4 fields',()=>{
 assert.deepEqual(decode(0x002081b3).fields,[0,2,1,0,3,0x33]);
 assert.equal(decode(0x0020818b).name,'DOT4');
});
test('comparator catches data and missing record errors',()=>{
 assert.deepEqual(compare([7,3,10],[7,3,10]),{equal:true,first:-1});
 assert.equal(compare([7,3,10],[7,3,11]).first,2);
 assert.equal(compare([7,3],[7]).first,1);
});
