import {test} from 'node:test';
import assert from 'node:assert/strict';
import {returnPath} from '../shared/return-path.ts';
import {plexGuides,plexGuide} from '../shared/plex-guides.ts';
test('authentication return paths preserve device choice but reject external and unexpected routes',()=>{
 const path='/guides?service=plex&device=roku';assert.equal(returnPath(path),path);
 for(const input of ['//evil.test','https://evil.test','/\\evil.test','/admin','/guides\n',null,['/guides']])assert.equal(returnPath(input),'/');
});
test('platform choices are explicit and only browser uses the configured server destination',()=>{
 assert.equal(plexGuides.length,13);assert.equal(plexGuide(undefined),undefined);assert.equal(plexGuide('tv'),undefined);
 assert.deepEqual(plexGuides.filter(g=>!g.href).map(g=>g.id),['browser']);
 for(const guide of plexGuides){assert.match(guide.find,/Bulock Video/);if(guide.id!=='browser')assert.match(guide.href,/^https:\/\//);}
});
