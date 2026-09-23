const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./harness.cjs');
const fresh = (apple=false, values={})=>setup(apple,'better-player.js',values);
test('hotfix: valid settings maps, migration of invalid old selections, layout scope',()=>{
    const x=fresh(false,{better_player_seek_step:'0'});
    assert.equal(x.store.better_player_seek_step,'10');
    const select=x.settings.filter(p=>p.param.type==='select');
    assert.equal(select.length,3);
    select.forEach(p=>{assert.equal(typeof p.param.values,'object');assert.ok(p.param.default in p.param.values);});
    let styled=false;x.settings[1].onRender({addClass(v){styled=v==='bp-setting';}});assert.ok(styled);
});
test('hotfix: external tvOS has explicit diagnostics and never intercepts keys or auto-next',()=>{
    const x=fresh(true,{player:'tvospro'});x.Lampa.Player.listener.send('external');
    assert.equal(x.window.LampaBetterPlayer.diagnostics().configuredPlayer,'tvospro');
    assert.match(x.window.LampaBetterPlayer.diagnostics().mode,/tvOS/);
    assert.equal(x.key('keydown',39).prevented,undefined);
    x.Lampa.PlayerVideo.listener.send('timeupdate',{current:999.9,duration:1000});
    x.Lampa.PlayerVideo.listener.send('ended');x.advance(1);assert.equal(x.next(),0);
});
test('hotfix: Apple TV inner-player repeat seek and panel navigation',()=>{
    const x=fresh(true);x.start();x.key('keydown',39);x.advance(150);x.key('keydown',39);x.advance(520);
    assert.ok(x.video.currentTime>100);assert.equal(x.video.paused,false);
    x.controller('player_panel');assert.equal(x.key('keydown',37).prevented,undefined);
});
test('hotfix: countdown, early-next OK consumes keyup, only one handler across episodes',()=>{
    const x=fresh();x.start();x.start();x.start();
    assert.equal(x.Lampa.PlayerVideo.listener.map.timeupdate.length,1);
    x.Lampa.PlayerVideo.listener.send('timeupdate',{current:994,duration:1000});
    assert.ok(x.key('keydown',13).prevented);assert.equal(x.next(),1);
    assert.ok(x.key('keyup',13).prevented);
    x.Lampa.PlayerVideo.listener.send('ended');x.advance(1);assert.equal(x.next(),1);
});
test('hotfix: ended fallback advances but does not double-skip when Lampa already started next episode',()=>{
    const x=fresh();x.start();x.Lampa.PlayerVideo.listener.send('ended');x.advance(1);assert.equal(x.next(),1);
    x.start();x.Lampa.PlayerVideo.listener.send('ended');x.start();x.advance(1);assert.equal(x.next(),1);
});
test('hotfix: no regression for raw KeyboardEvent code strings',()=>{
    const x=fresh();x.start();let consumed=false;
    const e={code:'ArrowRight',key:'ArrowRight',preventDefault(){consumed=true;},stopPropagation(){}};
    x.Lampa.Keypad.listener.send('keydown',e);x.Lampa.Keypad.listener.send('keyup',e);
    assert.equal(consumed,true);assert.equal(x.video.currentTime,110);
});
