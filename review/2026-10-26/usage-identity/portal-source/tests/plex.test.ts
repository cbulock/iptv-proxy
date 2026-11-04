import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRemote} from '../server/core/http-client.ts';
test('Plex XML preserves immutable IDs, filter attributes, and repeated library sections',()=>{const data=parseRemote('<MediaContainer><SharedServer userID="42" filterMovies="contentRating=G"><Section key="1" shared="1"/><Section key="2" shared="0"/></SharedServer></MediaContainer>');assert.equal(data.MediaContainer.SharedServer[0].userID,'42');assert.equal(data.MediaContainer.SharedServer[0].filterMovies,'contentRating=G');assert.equal(data.MediaContainer.SharedServer[0].Section.length,2);});
