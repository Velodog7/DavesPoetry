/**
 * poetry-engine.js — the analysis engine behind Dad's Verses.
 *
 * This is the SAME code that runs inside the published site, extracted so the
 * REST server can classify forms and analyse poems identically. Pure functions,
 * no dependencies, no I/O.
 *
 * Everything here is heuristic pattern-matching over the text — counting
 * syllables, word endings, sounds and line positions. It describes what a poem
 * does; it makes no claim about whether the poem is any good.
 */
'use strict';

/* ================= LEXICONS ================= */
/* ---------------- function words (never counted as key words) ---------------- */
var HARD_STOP={};
("a,an,the,and,but,or,nor,for,so,yet,of,in,on,at,to,from,by,with,about,against,between,among,into,through,"+
 "across,behind,beyond,beneath,below,above,under,over,upon,within,without,toward,towards,onto,off,out,up,down,"+
 "during,before,after,while,until,till,since,than,then,as,if,because,though,although,unless,whether,whereas,"+
 "i,me,my,mine,myself,we,us,our,ours,ourselves,you,your,yours,yourself,yourselves,he,him,his,himself,"+
 "she,her,hers,herself,it,its,itself,they,them,their,theirs,themselves,who,whom,whose,which,what,that,this,"+
 "these,those,there,here,where,when,why,how,am,is,are,was,were,be,been,being,have,has,had,having,do,does,"+
 "did,doing,done,will,would,shall,should,can,could,may,might,must,ought,let,lets,not,no,nor,none,neither,"+
 "either,both,each,every,all,any,some,such,other,another,others,more,most,less,least,much,many,few,fewer,"+
 "several,own,same,very,too,also,just,only,even,still,again,ever,never,always,once,now,soon,already,almost,"+
 "quite,rather,really,perhaps,maybe,indeed,thus,hence,however,therefore,meanwhile,anyway,instead,"+
 "one,two,three,four,five,six,seven,eight,nine,ten,first,second,third,next,last,per,via,vs,ok,okay,"+
 "s,t,d,ll,re,ve,m,don,doesn,didn,isn,aren,wasn,weren,hasn,haven,hadn,won,wouldn,couldn,shouldn,ain,"+
 "am,im,ive,id,youre,youve,hes,shes,theyre,weve,thats,its,dont,cant,wont,didnt,doesnt,isnt,arent"
).split(",").forEach(function(w){ HARD_STOP[w]=1; });

/* frequent but low-image words — allowed through, ranked down */
var LIGHT_WORD={};
("back,away,around,along,ahead,aside,apart,together,anymore,everywhere,somewhere,nowhere,else,enough,"+
 "inside,outside,upstairs,downstairs,thing,things,something,nothing,anything,everything,someone,anyone,everyone,nobody,somebody,way,ways,"+
 "lot,kind,sort,bit,part,place,thought,thoughts,say,says,said,saying,get,gets,got,getting,go,goes,going,"+
 "went,gone,come,comes,coming,came,make,makes,making,made,take,takes,taking,took,taken,put,puts,"+
 "want,wants,wanted,seem,seems,seemed,use,used,using,need,needs,needed,try,tries,tried,trying,"+
 "good,bad,big,little,long,short,new,right,wrong,sure,fine,nice,real,true,able,better,best,worse,"+
 "like,likes,liked,ask,asks,asked,asking,tell,tells,told,telling,call,calls,called,calling,mean,means,meant"
).split(",").forEach(function(w){ LIGHT_WORD[w]=1; });

/* ---------------- image fields ---------------- */
var IMAGE_FIELDS=[
  {key:"light", name:"Light & shadow", words:"light,lights,lit,bright,brightness,shine,shines,shining,shone,glow,glowing,gleam,gleaming,glint,glimmer,shimmer,sparkle,flicker,flickering,flame,flames,burn,burning,blaze,dark,darkness,darkening,dim,dusk,shade,shadow,shadows,gray,grey,gold,golden,silver,white,black,red,blue,green,amber,pale,bleach,bleached,glare,beam,beams,ray,rays,lamp,candle,sun,sunlight,moonlight,star,stars,dawn,daylight"},
  {key:"sky", name:"Sky & weather", words:"sky,skies,cloud,clouds,cloudy,rain,rains,raining,rained,storm,storms,stormy,thunder,lightning,wind,winds,windy,breeze,snow,snowing,frost,frozen,ice,icy,fog,mist,misty,hail,sun,moon,horizon,air,weather,gust,drizzle,overcast,heat,cold,chill,chilly,warm,warmth,thaw"},
  {key:"earth", name:"Earth & growing", words:"tree,trees,leaf,leaves,branch,branches,root,roots,grass,garden,gardens,flower,flowers,bloom,blooms,blooming,blossom,seed,seeds,soil,dirt,ground,earth,field,fields,wood,woods,forest,maple,oak,pine,birch,vine,moss,weed,weeds,green,grow,grows,growing,grew,grown,harvest,crop,orchard,stem,bud,buds,petal,petals,bark,hedge,lawn,mow,mowing,mowed,ripe,ripen,rot,rotting"},
  {key:"water", name:"Water", words:"water,waters,sea,ocean,wave,waves,river,rivers,stream,streams,creek,lake,pond,rain,tide,tides,flood,flooded,drip,dripping,drop,drops,pour,pours,poured,pouring,spill,spilled,wash,washed,washing,swim,swimming,swam,wet,damp,soak,soaked,steam,steaming,kettle,current,shore,shoreline,depth,deep,drown,drowning,puddle,mud"},
  {key:"time", name:"Time & season", words:"year,years,month,months,week,weeks,day,days,night,nights,hour,hours,minute,minutes,moment,moments,morning,mornings,afternoon,evening,evenings,noon,midnight,today,tomorrow,yesterday,spring,summer,autumn,fall,winter,season,seasons,clock,clocks,watch,calendar,age,aging,young,younger,youth,old,older,early,late,later,forever,past,future,ancient,eternal"},
  {key:"body", name:"The body", words:"hand,hands,finger,fingers,palm,palms,arm,arms,eye,eyes,face,faces,mouth,lip,lips,tooth,teeth,hair,head,heads,heart,hearts,chest,breath,breathe,breathing,breathed,skin,bone,bones,blood,knee,knees,foot,feet,leg,legs,shoulder,shoulders,back,neck,throat,voice,voices,touch,touched,touching,ache,aches,aching,tired,weary,sleep,sleeping,slept,wake,waking,woke,awake,pulse,belly,spine,wrist,thumb"},
  {key:"house", name:"House & making", words:"house,houses,home,homes,room,rooms,door,doors,window,windows,floor,floors,wall,walls,roof,ceiling,stair,stairs,kitchen,table,tables,chair,chairs,bed,beds,porch,garage,attic,basement,yard,fence,gate,key,keys,lamp,cup,cups,coffee,bread,plate,dish,dishes,tool,tools,wrench,wrenches,hammer,nail,nails,screw,screwdriver,bolt,bolts,engine,machine,radio,car,truck,wood,board,boards,frame,build,built,building,fix,fixed,fixing,mend,mended,repair,paint,painted,drawer,shelf,shelves,pot,pan"},
  {key:"sound", name:"Sound & silence", words:"sound,sounds,noise,noises,silence,silent,quiet,quietly,hush,hushed,loud,whisper,whispers,whispered,whispering,murmur,murmurs,hum,humming,buzz,rustle,rustling,creak,creaks,creaking,crack,cracks,ring,rings,ringing,roar,roaring,thunder,echo,echoes,echoing,song,songs,sing,sings,singing,sang,sung,music,note,notes,tune,cry,cries,cried,crying,laugh,laughs,laughing,laughter,shout,shouts,call,calls,called,calling,speak,speaks,spoke,spoken,tick,ticks,ticking,sigh,sighs,sighed,groan,groans,bell,bells,listen,listens,listened,listening,hear,hears,heard,hearing"},
  {key:"motion", name:"Movement", words:"walk,walks,walked,walking,run,runs,ran,running,dance,dances,danced,dancing,fly,flies,flew,flying,fall,falls,fell,fallen,falling,drift,drifts,drifted,drifting,sway,sways,swayed,swaying,move,moves,moved,moving,rush,rushes,rushed,rushing,climb,climbs,climbed,climbing,turn,turns,turned,turning,spin,spins,spinning,shake,shakes,shaking,shook,tremble,trembles,trembling,rise,rises,rose,rising,risen,sink,sinks,sank,sinking,lean,leans,leaned,leaning,bend,bends,bent,bending,carry,carries,carried,carrying,push,pushed,pull,pulled,step,steps,stepped,stepping,wander,wandered,crawl,slip,slipped,swing,swung,curl,curls,curled,curling"},
  {key:"kin", name:"Kin & people", words:"father,fathers,dad,mother,mothers,mom,son,sons,daughter,daughters,child,children,kid,kids,boy,boys,girl,girls,brother,brothers,sister,sisters,wife,husband,family,families,grandfather,grandmother,grandchild,parent,parents,friend,friends,neighbor,neighbors,man,men,woman,women,people,stranger,strangers,name,names,love,loved,loving,lover"},
  {key:"loss", name:"Loss & memory", words:"memory,memories,remember,remembers,remembered,remembering,forget,forgets,forgot,forgotten,forgetting,lose,loses,lost,losing,loss,gone,leave,leaves,left,leaving,miss,missed,missing,grief,grieve,grieving,mourn,mourning,death,dead,die,dies,died,dying,grave,graves,buried,bury,ash,ashes,funeral,farewell,goodbye,absence,absent,empty,emptiness,alone,lonely,ghost,ghosts,keep,kept,keeping,hold,holds,held,holding,still,ago,used"}
];
var FIELD_LOOKUP={};
IMAGE_FIELDS.forEach(function(f){ f.list=f.words.split(","); f.list.forEach(function(w){ if(!FIELD_LOOKUP[w]) FIELD_LOOKUP[w]=f.key; }); });

/* ---------------- mode lexicons ---------------- */
var ADDRESS_WORDS={you:1,your:1,yours:1,thou:1,thee:1,thy:1,thine:1,ye:1};
var PRAISE_WORDS="praise,praised,glory,glorious,beauty,beautiful,honor,honour,bless,blessed,blessing,hail,celebrate,celebrated,wonder,wonderful,wondrous,thank,thanks,thankful,grateful,gratitude,splendid,splendor,magnificent,noble,humble,faithful,gift,gifts,marvel,marvelous,holy,sacred,sing,sings,praise,tribute,homage,ode,worthy,perfect,grace,graceful,dear,beloved,steadfast,patient,quiet,plain,simple,honest,sturdy,true".split(",");
var GRIEF_WORDS="grief,grieve,grieving,mourn,mourning,mourned,death,dead,die,dies,died,dying,grave,graves,buried,bury,funeral,ashes,farewell,goodbye,widow,widower,loss,lost,gone,absence,absent,coffin,eulogy,memorial,departed,passing,passed".split(",");

/* ================= FORM METADATA ================= */
var ACCENT_SWATCHES=['#3B6FD4','#E08A2E','#2FA36B','#8B5CF6','#0EA5B7','#D9538F'];
/* stable colour per form — the badge encodes category, not decoration */
var FORM_COLORS={
  'Ode':'#E08A2E', 'Elegy':'#8B5CF6', 'Ballad':'#2FA36B', 'Lyric':'#0EA5B7',
  'Sonnet':'#D9538F', 'Haiku':'#0EA5B7', 'Tanka':'#0EA5B7', 'Villanelle':'#D9538F',
  'Limerick':'#E08A2E', 'Catalogue':'#7C6BD6', 'Prose poem':'#7A8290',
  'Blank verse':'#7A8290', 'Free verse':'#3B6FD4'
};
function formColor(f){ return FORM_COLORS[f]||'#3B6FD4'; }
var COUNTABLE_FORMS=['Ode','Elegy','Ballad','Lyric','Sonnet','Haiku','Tanka','Villanelle','Limerick','Catalogue'];
function formCountPhrase(form,n){
  var low=form.toLowerCase();
  if(COUNTABLE_FORMS.indexOf(form)>=0) return n+' '+low+(n===1?'':'s');
  return n+' in '+low;
}
var STEP_VALUES=[0.9,1,1.15,1.3,1.5,1.7];

/* ---------------- utilities ---------------- */
/* ================= HELPERS ================= */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function clamp(v,a,b){ return Math.min(b,Math.max(a,v)); }
function round2(v){ return Math.round(v*100)/100; }
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function genId(){ return 'id'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function pad2(n){ return n<10 ? '0'+n : ''+n; }
function fmtDate(iso){ var d=new Date(iso+'T00:00:00'); return isNaN(d)?iso:d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }
function fmtShort(iso){ var d=new Date(iso+'T00:00:00'); return isNaN(d)?iso:d.toLocaleDateString('en-US',{month:'short',year:'numeric'}); }
function fmtTiny(iso){ var d=new Date(iso+'T00:00:00'); return isNaN(d)?iso:d.toLocaleDateString('en-US',{month:'short',year:'2-digit'}); }
function timeAgo(iso){
  var t=new Date(iso).getTime(); if(isNaN(t)) return '';
  var m=Math.floor(Math.max(0,Date.now()-t)/60000);
  if(m<1) return 'just now';
  if(m<60) return m+' min ago';
  var h=Math.floor(m/60); if(h<24) return h+' hr ago';
  var d=Math.floor(h/24); if(d<30) return d+' days ago';
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function excerpt(body,n){
  var lines=body.split(/\r?\n/).filter(function(l){ return l.trim()!==''; });
  return lines.slice(0,n||4).join('\n');
}
function simpleHash(s){ var h=5381; for(var i=0;i<s.length;i++){ h=((h*33)^s.charCodeAt(i))>>>0; } return h.toString(36); }
function listJoin(arr,conj){
  conj=conj||'and';
  if(!arr.length) return '';
  if(arr.length===1) return arr[0];
  if(arr.length===2) return arr[0]+' '+conj+' '+arr[1];
  return arr.slice(0,-1).join(', ')+', '+conj+' '+arr[arr.length-1];
}
/* ================= HIGHLIGHT TOKENISER ================= */
/* ================= AUTHOR HIGHLIGHTS ================= */
var WORD_RE=/[A-Za-z0-9À-ɏ][A-Za-z0-9'’À-ɏ]*/g;
/* Split a poem into word tokens (indexed) and the gaps between them. Gaps keep
   newlines and punctuation, so re-joining reproduces the poem exactly. */
function tokenizePoem(body){
  var re=new RegExp(WORD_RE.source,'g'), toks=[], last=0, m, wi=0;
  while((m=re.exec(body))!==null){
    if(m.index>last) toks.push({t:'gap',s:body.slice(last,m.index)});
    toks.push({t:'word',s:m[0],i:wi++});
    last=m.index+m[0].length;
  }
  if(last<body.length) toks.push({t:'gap',s:body.slice(last)});
  return toks;
}
function poemWords(body){
  return tokenizePoem(body).filter(function(t){ return t.t==='word'; });
}
function highlightsOf(p){ return Array.isArray(p.highlights)?p.highlights:[]; }
/* Indices of every occurrence of the given words (matched loosely, by stem). */
function indicesForWords(body,words){
  var want={};
  words.forEach(function(w){
    var k=String(w).toLowerCase().replace(/[^a-z0-9']/g,'');
    if(k){ want[k]=1; want[stemOf(k)]=1; }
  });
  var out=[];
  poemWords(body).forEach(function(t){
    var k=t.s.toLowerCase();
    if(want[k]||want[stemOf(k)]) out.push(t.i);
  });
  return out;
}
/* Keep highlights pointing at the same words after the poem text is edited. */
function remapHighlights(oldBody,newBody,indices){
  if(!indices||!indices.length) return [];
  var oldW=poemWords(oldBody), newW=poemWords(newBody);
  if(oldBody===newBody) return indices.slice();
  var used={}, out=[];
  indices.forEach(function(i){
    var tok=oldW[i]; if(!tok) return;
    var target=tok.s.toLowerCase();
    for(var d=0;d<=newW.length;d++){
      var cands=[i+d,i-d];
      for(var c=0;c<cands.length;c++){
        var j=cands[c];
        if(j<0||j>=newW.length||used[j]) continue;
        if(newW[j].s.toLowerCase()===target){ used[j]=1; out.push(j); return; }
      }
    }
  });
  return out.sort(function(a,b){ return a-b; });
}
/* Poem markup. mode 'read' wraps highlights in <mark>; 'pick' makes every word tappable. */
function renderVerseHtml(body,indices,mode){
  var set={}; (indices||[]).forEach(function(i){ set[i]=1; });
  var n=0;
  return tokenizePoem(body).map(function(tk){
    if(tk.t==='gap') return esc(tk.s);
    var on=!!set[tk.i];
    if(mode==='pick'){
      return '<span class="wtok'+(on?' on':'')+'" data-wi="'+tk.i+'" role="button" tabindex="0"'+
        ' aria-pressed="'+on+'" aria-label="'+esc(tk.s)+'">'+esc(tk.s)+'</span>';
    }
    if(!on) return esc(tk.s);
    return '<mark class="hl" style="--d:'+(n++*45)+'ms">'+esc(tk.s)+'</mark>';
  }).join('');
}

/* ================= ANALYSIS ================= */
/* ================= LANGUAGE ANALYSIS ================= */
function tokenize(text){
  var m=(text.toLowerCase().match(/[a-z][a-z']*/g))||[];
  return m.map(function(w){ return w.replace(/^'+|'+$/g,''); }).filter(Boolean);
}
function getLines(body){ return body.split(/\r?\n/).filter(function(l){ return l.trim()!==''; }); }
function getStanzas(body){
  return body.split(/\n\s*\n/).map(function(s){ return s.split(/\r?\n/).filter(function(l){ return l.trim()!==''; }); })
    .filter(function(st){ return st.length; });
}
var IRREGULAR={};
("held:hold,holds:hold,holding:hold,told:tell,kept:keep,left:leave,felt:feel,made:make,went:go,gone:go,"+
 "came:come,took:take,taken:take,gave:give,given:give,saw:see,seen:see,knew:know,known:know,grew:grow,"+
 "grown:grow,rose:rise,risen:rise,fell:fall,fallen:fall,sang:sing,sung:sing,ran:run,sat:sit,stood:stand,"+
 "found:find,lost:lose,sent:send,spent:spend,built:build,caught:catch,taught:teach,brought:bring,"+
 "thought:think,bought:buy,wore:wear,worn:wear,broke:break,broken:break,spoke:speak,spoken:speak,"+
 "wrote:write,written:write,drove:drive,driven:drive,chose:choose,froze:freeze,frozen:freeze,woke:wake,"+
 "woken:wake,swore:swear,tore:tear,torn:tear,slept:sleep,wept:weep,crept:creep,swept:sweep,dug:dig,"+
 "hung:hang,swung:swing,sank:sink,sunk:sink,drank:drink,drunk:drink,began:begin,begun:begin,"+
 "children:child,men:man,women:woman,feet:foot,teeth:tooth,leaves:leaf,lives:life,knives:knife,"+
 "wives:wife,selves:self,shelves:shelf,halves:half,loaves:loaf,thieves:thief"
).split(",").forEach(function(pair){ var kv=pair.split(":"); IRREGULAR[kv[0]]=kv[1]; });

function stemOf(w){
  if(IRREGULAR[w]) return IRREGULAR[w];
  var s=w;
  if(s.length>4 && /ies$/.test(s)) s=s.slice(0,-3)+'y';
  else if(s.length>4 && /(ses|xes|zes|ches|shes)$/.test(s)) s=s.slice(0,-2);
  else if(s.length>3 && /s$/.test(s) && !/(ss|us|is)$/.test(s)) s=s.slice(0,-1);
  if(s.length>5 && /ing$/.test(s)) s=s.slice(0,-3);
  else if(s.length>4 && /ed$/.test(s)) s=s.slice(0,-2);
  if(s.length>3 && /([bdfglmnprt])\1$/.test(s)) s=s.slice(0,-1);
  if(s.length>3 && /e$/.test(s)) s=s.slice(0,-1);
  return s||w;
}
function countSyllables(raw){
  var w=raw.toLowerCase().replace(/[^a-z]/g,'');
  if(!w) return 0;
  if(w.length<=3) return 1;
  w=w.replace(/(?:es|ed)$/,'').replace(/e$/,'');
  var m=w.match(/[aeiouy]+/g);
  return m?Math.max(1,m.length):1;
}
var VOWEL_NORM={ea:'e',ee:'e',ie:'e',ei:'e',ey:'e',ai:'a',ay:'a',oa:'o',ow:'o',oo:'u',au:'o',aw:'o',oy:'oi',ue:'u',ui:'u',y:'i',eau:'o'};
/* rhyme core: last vowel nucleus + the consonants after it, normalised for spelling */
function rhymeCore(raw){
  var w=raw.toLowerCase().replace(/[^a-z]/g,'');
  if(!w) return null;
  /* silent -e, and the silent e of a regular -ed ending */
  if(/[^aeiou]ed$/.test(w) && !/[td]ed$/.test(w)) w=w.slice(0,-2)+w.slice(-1);
  else if(w.length>3 && /e$/.test(w) && !/[aeiou]e$/.test(w)) w=w.slice(0,-1);
  var m=w.match(/([aeiouy]+)([^aeiouy]*)$/);
  if(!m) return {v:w.slice(-2),c:''};
  var v=m[1];
  return { v:(VOWEL_NORM[v]||v.charAt(0)), c:m[2] };
}
function rhymeKey(raw){
  var r=rhymeCore(raw);
  return r?r.v+r.c:'';
}
/* true rhyme or close slant rhyme */
function rhymesWith(a,b){
  if(!a||!b) return false;
  if(a.v!==b.v) return false;
  if(a.c===b.c) return true;
  if(!a.c||!b.c) return false;
  return a.c.charAt(0)===b.c.charAt(0) && Math.abs(a.c.length-b.c.length)<=1;
}
function endWordCores(stanza){
  return stanza.map(function(l){ var ws=tokenize(l); return ws.length?rhymeCore(ws[ws.length-1]):null; });
}
/* count how many line endings participate in a rhyme, using fuzzy matching */
function rhymeStats(stanzas){
  var rhymed=0,total=0;
  stanzas.forEach(function(st){
    var cores=endWordCores(st).filter(Boolean);
    total+=cores.length;
    var used=cores.map(function(){ return false; });
    for(var i=0;i<cores.length;i++){
      for(var j=i+1;j<cores.length;j++){
        if(rhymesWith(cores[i],cores[j])){ used[i]=true; used[j]=true; }
      }
    }
    used.forEach(function(u){ if(u) rhymed++; });
  });
  return { rhymed:rhymed, total:total, density: total?rhymed/total:0 };
}
var DIGRAPHS=['th','sh','ch','wh','ph','str','spr','scr','st','sp','sc','sk','sl','sm','sn','sw','tr','br','cr','dr','fr','gr','pr','gl','bl','cl','fl','pl'];
function initialSound(w){
  var s=w.toLowerCase().replace(/[^a-z]/g,'');
  for(var i=0;i<DIGRAPHS.length;i++){ if(s.indexOf(DIGRAPHS[i])===0) return DIGRAPHS[i]; }
  return s.charAt(0);
}
function vowelSound(w){
  var s=w.toLowerCase().replace(/[^a-z]/g,'');
  var m=s.match(/[aeiouy]+/);
  return m?m[0]:'';
}
function mode(arr){
  if(!arr.length) return 0;
  var t={},best=arr[0],bc=0;
  arr.forEach(function(v){ t[v]=(t[v]||0)+1; });
  Object.keys(t).forEach(function(k){ if(t[k]>bc){ bc=t[k]; best=+k; } });
  return best;
}
function schemeOf(stanza){
  var cores=endWordCores(stanza);
  var groups=[],out=[];
  cores.forEach(function(c){
    if(!c){ out.push('-'); return; }
    var found=-1;
    for(var i=0;i<groups.length;i++){ if(rhymesWith(groups[i],c)){ found=i; break; } }
    if(found<0){ groups.push(c); found=groups.length-1; }
    out.push(String.fromCharCode(65+found));
  });
  return out.join('');
}

/* key words: content words, stemmed, ranked by count and weight */
function keyWords(body,limit){
  var words=tokenize(body);
  var groups={};
  words.forEach(function(w){
    if(HARD_STOP[w] || w.length<3) return;
    var st=stemOf(w);
    if(!groups[st]) groups[st]={stem:st,count:0,surfaces:{}};
    groups[st].count++;
    groups[st].surfaces[w]=(groups[st].surfaces[w]||0)+1;
  });
  var out=Object.keys(groups).map(function(st){
    var g=groups[st];
    var best='',bc=0;
    Object.keys(g.surfaces).forEach(function(s){ if(g.surfaces[s]>bc || (g.surfaces[s]===bc && s.length<best.length)){ bc=g.surfaces[s]; best=s; } });
    var light=!!(LIGHT_WORD[best]||LIGHT_WORD[st]);
    return { word:best, stem:st, count:g.count, light:light, weight:g.count*(light?0.4:1)*(FIELD_LOOKUP[best]?1.15:1) };
  });
  out.sort(function(a,b){ return b.weight-a.weight || b.count-a.count || a.word.localeCompare(b.word); });
  return limit ? out.slice(0,limit) : out;
}

function imageFieldCounts(body){
  var words=tokenize(body);
  var counts={},examples={};
  IMAGE_FIELDS.forEach(function(f){ counts[f.key]=0; examples[f.key]={}; });
  words.forEach(function(w){
    var k=FIELD_LOOKUP[w];
    if(k){ counts[k]++; examples[k][w]=(examples[k][w]||0)+1; }
  });
  return IMAGE_FIELDS.map(function(f){
    var ex=Object.keys(examples[f.key]).sort(function(a,b){ return examples[f.key][b]-examples[f.key][a]; }).slice(0,4);
    return { key:f.key, name:f.name, count:counts[f.key], examples:ex };
  }).sort(function(a,b){ return b.count-a.count; });
}

/* ---------------- form classification ---------------- */
function classifyForm(body,title){
  var lines=getLines(body), stanzas=getStanzas(body), words=tokenize(body);
  var n=lines.length, wc=words.length;
  var syl=lines.map(function(l){ return tokenize(l).reduce(function(s,w){ return s+countSyllables(w); },0); });
  var schemes=stanzas.map(schemeOf);
  var sizes=stanzas.map(function(s){ return s.length; });
  var uniform=sizes.length>1 && sizes.every(function(s){ return s===sizes[0]; });
  var avgWordsPerLine=n?wc/n:0;

  var rhymeDensity=rhymeStats(stanzas).density;
  var pentameter=syl.filter(function(s){ return Math.abs(s-10)<=1; }).length;
  var pentameterRatio=n?pentameter/n:0;

  var starts={};
  lines.forEach(function(l){ var ws=tokenize(l); if(ws[0]) starts[ws[0]]=(starts[ws[0]]||0)+1; });
  var maxAnaphora=0,anaWord='';
  Object.keys(starts).forEach(function(k){ if(starts[k]>maxAnaphora){ maxAnaphora=starts[k]; anaWord=k; } });

  var addressHits=0; words.forEach(function(w){ if(ADDRESS_WORDS[w]) addressHits++; });
  var addressRatio=wc?addressHits/wc:0;
  var praiseHits={}; words.forEach(function(w){ if(PRAISE_WORDS.indexOf(w)>=0) praiseHits[w]=1; });
  var praiseCount=Object.keys(praiseHits).length;
  var griefHits={}; words.forEach(function(w){ if(GRIEF_WORDS.indexOf(w)>=0) griefHits[w]=1; });
  var griefCount=Object.keys(griefHits).length;

  var t=(title||'').trim();
  var titleOde=/^ode\b/i.test(t) || /^to\s+(?:a|an|the|my|his|her|our|your)?\s*\S/i.test(t);
  var titleElegy=/\belegy\b|\bin memoriam\b|\brequiem\b|\blament\b/i.test(t);

  var structure;
  if(!sizes.length) structure='a single passage';
  else if(uniform){
    var nameBySize={1:'single lines',2:'couplets',3:'tercets',4:'quatrains',5:'quintains',6:'sestets',8:'octaves'};
    structure=(nameBySize[sizes[0]]||(sizes[0]+'-line stanzas'));
    structure=sizes.length+' '+(sizes.length===1?structure.replace(/s$/,''):structure);
  } else if(sizes.length===1) structure='one unbroken stanza of '+n+' lines';
  else structure=sizes.length+' stanzas of uneven length ('+sizes.join('–')+' lines)';

  function res(form,family,evidence){ return {form:form,family:family,structure:structure,evidence:evidence,
    rhymeDensity:rhymeDensity, maxAnaphora:maxAnaphora, anaWord:anaWord, syllableMode:mode(syl),
    avgWordsPerLine:avgWordsPerLine, schemes:schemes, uniform:uniform, stanzaSizes:sizes}; }

  /* fixed forms first */
  if(n===3 && syl.reduce(function(a,b){ return a+b; },0)<=20)
    return res('Haiku','fixed','Three lines, '+syl.join('–')+' syllables — within the compass of haiku.');
  if(n===5 && Math.abs(syl[0]-5)<=1 && Math.abs(syl[1]-7)<=1 && Math.abs(syl[2]-5)<=1)
    return res('Tanka','fixed','Five lines running '+syl.join('–')+' syllables, close to the 5-7-5-7-7 of tanka.');
  if(n===5 && schemes.length===1 && /^AABBA$/.test(schemes[0]))
    return res('Limerick','fixed','Five lines rhyming AABBA.');
  if(n===14 && rhymeDensity>0.3){
    var kind=(schemes.join('')==='ABABCDCDEFEFGG')?'the Shakespearean pattern':'a sonnet pattern';
    return res('Sonnet','fixed','Fourteen rhymed lines following '+kind+'.');
  }
  if(n===19 && stanzas.length===6)
    return res('Villanelle','fixed','Nineteen lines in five tercets and a closing quatrain.');

  /* modes */
  if(titleOde) return res('Ode','mode','The title addresses its subject directly — the gesture of an ode: praise turned toward one thing.');
  if(addressRatio>0.022 && praiseCount>=2)
    return res('Ode','mode','It speaks to its subject throughout and reaches for praise ('+listJoin(Object.keys(praiseHits).slice(0,3).map(function(w){ return '“'+w+'”'; }))+') — an ode in everything but title.');
  if(titleElegy || griefCount>=4)
    return res('Elegy','mode','The vocabulary of loss runs through it ('+listJoin(Object.keys(griefHits).slice(0,3).map(function(w){ return '“'+w+'”'; }))+') — the poem is doing the work of an elegy.');
  if(n>=6 && maxAnaphora>=Math.max(3,Math.round(n*0.4)))
    return res('Catalogue','mode','“'+anaWord+'” opens '+maxAnaphora+' of the '+n+' lines — the poem accumulates by listing.');
  if(avgWordsPerLine>=14 && n<=6)
    return res('Prose poem','mode','Long unbroken lines averaging '+Math.round(avgWordsPerLine)+' words — the poem runs as prose does.');

  /* structural fallbacks */
  if(rhymeDensity>=0.45 && uniform && sizes[0]===4){
    var sc=schemes[0]||'';
    if(sc==='ABCB' || sc==='ABAB' || sc==='AABB')
      return res('Ballad','structure','Rhymed quatrains ('+sc+') in the old ballad shape.');
    return res('Lyric','structure','Rhymed quatrains, rhyming '+listJoin(schemes.slice(0,3))+'.');
  }
  if(rhymeDensity>=0.4)
    return res('Lyric','structure','Rhyme carries roughly '+Math.round(rhymeDensity*100)+'% of the line endings, in '+structure+'.');
  if(rhymeDensity<0.15 && pentameterRatio>=0.6 && n>=8)
    return res('Blank verse','structure',Math.round(pentameterRatio*100)+'% of the lines hold near ten syllables, unrhymed — blank verse measure.');
  return res('Free verse','structure','No fixed rhyme or measure; the poem sets its own line, in '+structure+'.');
}

/* ---------------- full analysis ---------------- */
function analyzePoem(body,title){
  var lines=getLines(body), stanzas=getStanzas(body), words=tokenize(body);
  var wc=words.length;
  var uniq={}; words.forEach(function(w){ uniq[w]=1; });
  var uniqueCount=Object.keys(uniq).length;

  var keys=keyWords(body);
  var fields=imageFieldCounts(body);
  var form=classifyForm(body,title);

  /* repeated phrases from content-bearing pairs */
  var bigrams={};
  for(var i=0;i<words.length-1;i++){
    var a=words[i],b=words[i+1];
    if(HARD_STOP[a] && HARD_STOP[b]) continue;
    var bg=a+' '+b;
    bigrams[bg]=(bigrams[bg]||0)+1;
  }
  var repeatedPhrases=Object.keys(bigrams).filter(function(k){ return bigrams[k]>1; })
    .map(function(k){ return {phrase:k,count:bigrams[k]}; })
    .sort(function(a,b){ return b.count-a.count; }).slice(0,4);

  /* alliteration with the actual sound and words */
  var allit=[];
  lines.forEach(function(l){
    var ws=tokenize(l).filter(function(w){ return !HARD_STOP[w]; });
    var sounds=ws.map(initialSound);
    for(var j=0;j<sounds.length-1;j++){
      if(sounds[j] && sounds[j]===sounds[j+1]){
        allit.push({line:l.trim(), sound:sounds[j], words:[ws[j],ws[j+1]]});
        break;
      }
    }
  });

  /* assonance: repeated vowel sounds among content words in a line */
  var assonance=[];
  lines.forEach(function(l){
    var ws=tokenize(l).filter(function(w){ return !HARD_STOP[w] && w.length>2; });
    var seen={};
    for(var j=0;j<ws.length;j++){
      var v=vowelSound(ws[j]);
      if(!v) continue;
      if(seen[v] && seen[v]!==ws[j]){ assonance.push({line:l.trim(),vowel:v,words:[seen[v],ws[j]]}); break; }
      seen[v]=ws[j];
    }
  });

  /* line endings */
  var stopped=lines.filter(function(l){ return /[.,;:!?—–-]\s*$/.test(l.trim()); }).length;
  var enjambRatio=lines.length?1-(stopped/lines.length):0;
  var enjambExamples=[];
  for(var k=0;k<lines.length-1;k++){
    if(!/[.,;:!?—–-]\s*$/.test(lines[k].trim())){
      enjambExamples.push(lines[k].trim()+'\n'+lines[k+1].trim());
      if(enjambExamples.length>=2) break;
    }
  }

  /* figurative language */
  var similes=[];
  var simRe=/([A-Za-z',\s]{3,40}?)\b(like|as)\b\s+((?:a|an|the|my|his|her|its|their)\s+)?([A-Za-z']+(?:\s+[A-Za-z']+){0,3})/g;
  var mm;
  while((mm=simRe.exec(body))!==null && similes.length<4){
    var lead=mm[1].trim().split(/\s+/).slice(-4).join(' ');
    similes.push((lead?lead+' ':'')+mm[2]+' '+(mm[3]||'')+mm[4]);
  }

  /* sentence & syntax */
  var sentences=(body.match(/[^.!?]+[.!?]+/g)||(body.trim()?[body.trim()]:[]));
  var sentLens=sentences.map(function(s){ return tokenize(s).length; }).filter(function(x){ return x>0; });
  var avgSent=sentLens.length?sentLens.reduce(function(a,b){ return a+b; },0)/sentLens.length:wc;
  var shortest=sentLens.length?Math.min.apply(null,sentLens):0;
  var longest=sentLens.length?Math.max.apply(null,sentLens):0;

  var lineWordCounts=lines.map(function(l){ return tokenize(l).length; });
  var lineVar=0;
  if(lineWordCounts.length){
    var mu=lineWordCounts.reduce(function(a,b){ return a+b; },0)/lineWordCounts.length;
    lineVar=Math.sqrt(lineWordCounts.reduce(function(a,b){ return a+(b-mu)*(b-mu); },0)/lineWordCounts.length);
  }

  var punct={
    comma:(body.match(/,/g)||[]).length,
    dash:(body.match(/—|–|--/g)||[]).length,
    question:(body.match(/\?/g)||[]).length,
    exclaim:(body.match(/!/g)||[]).length,
    semicolon:(body.match(/;/g)||[]).length
  };

  return {
    lineCount:lines.length, stanzaCount:stanzas.length, wordCount:wc,
    uniqueCount:uniqueCount, richness:wc?uniqueCount/wc:0,
    keys:keys, fields:fields, form:form,
    repeatedPhrases:repeatedPhrases, allit:allit, assonance:assonance,
    enjambRatio:enjambRatio, enjambExamples:enjambExamples, similes:similes,
    sentenceCount:sentences.length, avgSent:avgSent, shortestSent:shortest, longestSent:longest,
    lineWordCounts:lineWordCounts, lineVar:lineVar, punct:punct,
    avgWordsPerLine:lines.length?wc/lines.length:0
  };
}


/* ---- analysis cache keyed by poem id + a hash of its text ---- */
var _cache = Object.create(null);
function analysisFor(poem){
  var key = poem.id + ':' + simpleHash((poem.body || '') + '|' + (poem.title || ''));
  if (!_cache[key]) _cache[key] = analyzePoem(poem.body || '', poem.title || '');
  return _cache[key];
}
function formOf(poem){ return analysisFor(poem).form.form; }
function clearCache(){ _cache = Object.create(null); }

module.exports = {
  /* text → tokens */
  tokenize, tokenizePoem, poemWords, getLines, getStanzas,
  /* morphology & sound */
  stemOf, countSyllables, rhymeCore, rhymeKey, rhymesWith, rhymeStats,
  initialSound, vowelSound, schemeOf,
  /* meaning */
  keyWords, imageFieldCounts, IMAGE_FIELDS,
  /* form */
  classifyForm, formColor, formCountPhrase, FORM_COLORS,
  /* whole-poem */
  analyzePoem, analysisFor, formOf, clearCache,
  /* highlights */
  indicesForWords, remapHighlights,
  /* small helpers the server reuses */
  listJoin, cap, round2, simpleHash
};
