const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./harness.cjs');

test('one time handler survives repeated starts; destroying/external never catches remote keys',()=>{
    const x=setup();x.start();x.start();x.start();
    assert.equal(x.Lampa.PlayerVideo.listener.map.timeupdate.length,1);
    x.Lampa.Player.listener.send('external');
    assert.equal(x.key('keydown',39).prevented,undefined);
    assert.match(x.window.LampaBetterPlayer.diagnostics().mode,/нативный/);
});
test('arrows navigate player buttons and settings without seeking',()=>{
    const x=setup();x.start();x.controller('player_panel');
    assert.equal(x.key('keydown',39).prevented,undefined);x.advance(1000);
    assert.equal(x.video.currentTime,100);
});
test('short tap and held key seek; direction reversal starts a fresh hold',()=>{
    const x=setup();x.start();x.key('keydown',39);x.key('keyup',39);assert.equal(x.video.currentTime,110);
    x.key('keydown',39);x.advance(900);assert.equal(x.video.paused,true);x.key('keyup',39);
    assert.ok(x.video.currentTime>110);assert.equal(x.video.paused,false);
    x.key('keydown',39);x.key('keydown',37);x.key('keyup',37);assert.ok(x.video.currentTime<110);
});
test('Apple TV repeat events finish without keyup; isolated taps remain short seeks',()=>{
    const x=setup(true);x.start();x.key('keydown',39);x.advance(520);assert.equal(x.video.currentTime,110);
    x.key('keydown',39);x.advance(150);x.key('keydown',39);x.advance(200);x.key('keydown',39);x.advance(520);
    assert.ok(x.video.currentTime>110);assert.equal(x.video.paused,false);
});
test('Escape cancels held seek and restores playing, while paused scrubbing stays paused',()=>{
    const x=setup();x.start();x.key('keydown',39);x.advance(800);x.key('keydown',27);
    assert.equal(x.video.currentTime,100);assert.equal(x.video.paused,false);
    x.video.paused=true;x.key('keydown',39);x.advance(800);x.key('keyup',39);assert.equal(x.video.paused,true);
});
function qualities(x){const data={url:'https://media.test/1080',quality:{'1080p':'https://media.test/1080','720p':'https://media.test/720','480p':'https://media.test/480'}};x.start(data);x.Lampa.PlayerVideo.listener.send('timeupdate',{current:100,duration:1000});return data;}
test('fatal fallback steps down once per URL and restores the original position across a failed replacement',()=>{
    const x=setup();x.store.better_player_fallback=true;const data=qualities(x);
    x.Lampa.PlayerVideo.listener.send('error',{fatal:true});assert.equal(data.url,'https://media.test/720');
    x.Lampa.PlayerVideo.listener.send('error',{fatal:true});assert.equal(data.url,'https://media.test/480');
    x.video.duration=1000;x.Lampa.PlayerVideo.listener.send('loadeddata');assert.equal(x.video.currentTime,100);
    x.Lampa.PlayerVideo.listener.send('error',{fatal:true});assert.equal(x.window.LampaBetterPlayer.diagnostics().qualitySwitches,2);
    assert.equal(x.next(),0);
});
test('buffer recovery ignores pauses, seeking, menus and manual quality choice',()=>{
    const x=setup();x.store.better_player_auto_quality=true;qualities(x);x.video.readyState=1;
    x.video.paused=true;x.advance(20000);assert.equal(x.window.LampaBetterPlayer.diagnostics().qualitySwitches,0);
    x.video.paused=false;x.video.seeking=true;x.advance(20000);assert.equal(x.window.LampaBetterPlayer.diagnostics().qualitySwitches,0);
    x.video.seeking=false;x.controller('player_panel');x.advance(20000);assert.equal(x.window.LampaBetterPlayer.diagnostics().qualitySwitches,0);
    x.controller('player');x.advance(16000);assert.equal(x.window.LampaBetterPlayer.diagnostics().qualitySwitches,1);
    x.Lampa.PlayerVideo.listener.send('loadeddata');x.Lampa.PlayerPanel.listener.send('quality',{name:'1080p',url:'https://media.test/1080'});
    x.advance(20000);assert.equal(x.window.LampaBetterPlayer.diagnostics().qualitySwitches,1);
});
test('VTT handles relative sprite URLs and rejects unsafe schemes, backwards cues and oversized files',()=>{
    const x=setup(), parse=x.window.LampaBetterPlayer.parseVTT;
    const cues=parse('WEBVTT\n\n00:00.000 --> 00:10.000\nsprite.jpg#xywh=320,0,320,180\n\n00:10.000 --> 00:20.000\njavascript:alert(1)\n\n00:30.000 --> 00:20.000\nbad.jpg','https://cdn.test/previews/film.vtt');
    assert.equal(cues.length,1);assert.equal(cues[0].url,'https://cdn.test/previews/sprite.jpg');assert.equal(cues[0].x,320);
    assert.equal(parse('WEBVTT'+'x'.repeat(1048576),'https://cdn.test').length,0);
});
test('late thumbnail response from previous movie cannot replace current cues',()=>{
    const x=setup();x.start({better_player:{thumbnail_vtt:'https://media.test/first.vtt'}});const req=x.requests[0];
    x.start({});req.status=200;req.responseText='WEBVTT\n\n00:00.000 --> 00:10.000\n1.jpg';req.onload();
    assert.equal(req.aborted,true);assert.equal(x.window.LampaBetterPlayer.diagnostics().thumbnailCues,0);
});
test('recommendations exclude watched/adult and deduplicate by media type plus id',()=>{
    const x=setup();const rank=x.window.LampaBetterPlayer.rank;
    const cards=[{id:1,media_type:'movie',genre_ids:[1]},{id:1,media_type:'tv',genre_ids:[1]},{id:2,genre_ids:[2]},{id:3,adult:true},{id:2,genre_ids:[2]}];
    const result=rank(cards,[{id:9,genre_ids:[1]}],{'movie:1':true});
    assert.equal(result.length,2);assert.equal(result[0].media_type,'tv');assert.equal(result[0].id,1);
});
test('recommendations finish once when some metadata requests fail or time out',()=>{
    const x=setup();x.store.better_player_recommendations=true;x.Lampa.Favorite.get=({type})=>type==='like'?[{id:1},{id:2}]:[];
    x.Lampa.Api.sources.tmdb.get=(path,params,ok,bad)=>{if(path.includes('/1/')){bad();bad();}};
    let calls=0;x.rows[0].call()(()=>calls++);x.advance(13000);assert.equal(calls,1);
});
