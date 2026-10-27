import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveTvGuides,liveTvGuide} from '../shared/live-tv-guides.ts';
import {returnPath} from '../shared/return-path.ts';

test('Live TV device links survive sign-in and unknown devices do not select an app',()=>{
 for(const guide of liveTvGuides){
  const path='/guides?service=iptv&device='+guide.id;
  assert.equal(returnPath(path),path);
  assert.equal(liveTvGuide(guide.id),guide);
 }
 for(const input of [undefined,null,[], 'tv','phone','unknown'])assert.equal(liveTvGuide(input),undefined);
});

test('Live TV separates browser playback, native playlist apps, and TV alternatives',()=>{
 assert.equal(new Set(liveTvGuides.map(g=>g.id)).size,13);
 assert.deepEqual(liveTvGuides.filter(g=>g.mode==='browser').map(g=>g.id),['browser']);
 for(const id of ['roku','samsung','lg','other-tv'])assert.equal(liveTvGuide(id)?.mode,'alternative');
 for(const id of ['windows','mac','linux'])assert.equal(liveTvGuide(id)?.mode,'vlc');
 for(const guide of liveTvGuides){
  if(guide.mode==='app'||guide.mode==='vlc')assert.equal(new URL(guide.href).protocol,'https:');
  assert.ok(!guide.href.includes('/media/v/'),'App download links must not contain personal credentials');
 }
});
