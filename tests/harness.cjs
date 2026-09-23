const vm = require('node:vm');
const fs = require('node:fs');
function setup(appleTV = false, filename = 'better-player-beta.js', initialStore = {}) {
    let now = 100000, nextTimer = 1, controller = 'player', next = 0;
    const code = fs.readFileSync(__dirname + '/../' + filename, 'utf8');
    const timers = new Map(), store = {...initialStore}, elements = [], requests = [], rows = [], settings = [];
    function emitter() {
        const map = {};
        return {map, follow(k,f){ (map[k] ||= []).push(f); }, remove(k,f){ map[k]=(map[k]||[]).filter(x=>x!==f); },
            send(k,e={}){ (map[k]||[]).slice().forEach(f=>f(e)); }};
    }
    function elem() {
        const classes = new Set();
        const e = {style:{}, children:[], classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},
            appendChild(x){this.children.push(x);},getAttribute(k){return this[k];}};
        elements.push(e); return e;
    }
    const video = {duration:1000,currentTime:100,paused:false,seeking:false,ended:false,readyState:4,play(){this.paused=false;},pause(){this.paused=true;}};
    const Lampa = {
        Storage:{field:k=>store[k],set:(k,v)=>store[k]=v},Platform:{is:()=>appleTV},
        SettingsApi:{addComponent(){},addParam(p){settings.push(p);if(p.param.default!==undefined && !(p.param.name in store)) store[p.param.name]=p.param.default;}},
        Controller:{enabled:()=>({name:controller})},Select:{opened:()=>false},Keypad:{listener:emitter()},Listener:emitter(),
        Player:{listener:emitter()},PlayerVideo:{listener:emitter(),video:()=>video,play:()=>video.play(),pause:()=>video.pause(),rewind(d,n){video.currentTime+=d?n:-n;}},
        PlayerPlaylist:{canNext:()=>true,get:()=>[{title:'One'},{title:'Two'}],position:()=>0,next:()=>next++},
        PlayerPanel:{listener:emitter()},ContentRows:{add:r=>rows.push(r)},
        Favorite:{get:()=>[]},Api:{sources:{tmdb:{get(){}}}}
    };
    function addTimer(fn,delay,interval){const id=nextTimer++;timers.set(id,{fn,at:now+delay,delay,interval});return id;}
    const window = {appready:true,location:{href:'https://lampa.test/'},addEventListener(){}};
    class XHR { constructor(){requests.push(this);} open(...args){this.args=args;} send(){} abort(){this.aborted=true;} }
    const context={window,Lampa,document:{createElement:elem,head:elem(),body:elem()},console:{log(){}},URL,XMLHttpRequest:XHR,
        Date:{now:()=>now},setTimeout:(f,d)=>addTimer(f,d,false),setInterval:(f,d)=>addTimer(f,d,true),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)};
    vm.runInNewContext(code, context);
    Lampa.PlayerPanel.listener.follow('quality',()=>{video.currentTime=0;video.readyState=0;});
    function advance(ms){const end=now+ms;for(;;){let pair=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;const[id,t]=pair;now=t.at;if(t.interval)t.at+=t.delay;else timers.delete(id);t.fn();}now=end;}
    function key(type, code){const e={code,event:{preventDefault(){this.prevented=true;},stopPropagation(){}}};Lampa.Keypad.listener.send(type,e);return e.event;}
    function start(data={}){Lampa.Player.listener.send('start',data);}
    return {Lampa,window,video,store,requests,rows,settings,elements,advance,key,start,controller:n=>controller=n,next:()=>next,context};
}

module.exports = {setup};
