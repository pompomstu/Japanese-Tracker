// ==UserScript==
// @name         Japanese‑Tracker (extended‑fixed)
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Track Netflix episodes + Manga chapters, SRS, Speaking & Skip – draggable HUD, charts, full calendar with month/year navigation & editable day‑popup. Skip toggle & calendar color coding.
// @match        *://www.netflix.com/watch/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function () {
    'use strict';

    /* ---------------- USER‑TWEAKABLE CONSTANTS ---------------- */
    const EPISODES_PER_DAY = 12;   // Anime goal
    const CHAPTERS_PER_DAY = 5;    // Manga chapters/day
    const HUD_KEEPALIVE_MS = 2500; // how often to make sure the HUD is still in the DOM
    /* ---------------------------------------------------------- */

    /* ---------------- SIMPLE LOCAL‑STORAGE WRAPPERS ----------- */
    const KEYS = {
        SETTINGS : 'netflixAnimeSettings',          // colours, opacity
        MARKED   : 'netflixAnimeEpisodesWatched',   // 0–12 per date
        POSITION : 'netflixHudPosition',            // {left,top} or null
        READING  : 'jpReadingChapters',             // integer chapters per date
        TASKS    : 'jpDailyFlags'                   // {srs:boolean,speak:boolean,skip:boolean} per date
    };
    const load = (k,f={}) => JSON.parse(localStorage.getItem(k) || JSON.stringify(f));
    const save = (k,v)   => localStorage.setItem(k,JSON.stringify(v));

    const todayKey = ()=>{const d=new Date();d.setHours(0,0,0,0);return d.toISOString().split('T')[0];};
    const dateKey  = d   =>{d.setHours(0,0,0,0);return d.toISOString().split('T')[0];};

    /* ---------- settings with default fall‑backs ---------- */
    let settings = load(KEYS.SETTINGS,{ opacity:0.7, episodeColor:'#0f0', dailyColor:'#0f0' });

    /* ---------- data buckets ---------- */
    let markedEpisodes  = load(KEYS.MARKED   ,{});
    let readingChapters = load(KEYS.READING  ,{});
    let dailyFlags      = load(KEYS.TASKS    ,{});

    /* ===================================================================
       MAIN HUD PANEL (draggable) + INTERNAL TOGGLE BUTTON
       =================================================================== */
    const MAX_Z = 2147483647;

    const hud=document.createElement('div');
    Object.assign(hud.style,{position:'fixed',background:`rgba(0,0,0,${settings.opacity})`,color:'#fff',padding:'12px',borderRadius:'10px',
        zIndex:MAX_Z,fontFamily:'Arial',fontSize:'14px',display:'flex',flexDirection:'column',alignItems:'center',
        minWidth:'190px',boxSizing:'border-box',cursor:'move'});

    const safePlace=()=>{hud.style.bottom='60px';hud.style.right='20px';hud.style.left='auto';hud.style.top='auto';};
    const pos=load(KEYS.POSITION,null);
    if(pos){hud.style.left=pos.left;hud.style.top=pos.top;hud.style.right='auto';hud.style.bottom='auto';
        const x=parseInt(pos.left||0), y=parseInt(pos.top||0);
        if(x<-50||y<-50||x>innerWidth-50||y>innerHeight-50){ safePlace(); save(KEYS.POSITION,null); }}
    else safePlace();

    document.body.appendChild(hud);

    // drag to move
    let dragging=false, dx=0, dy=0;
    hud.addEventListener('mousedown',e=>{if(e.target!==hud&&e.target.closest('button'))return; dragging=true; dx=e.offsetX; dy=e.offsetY;});
    window.addEventListener('mouseup',()=>{dragging=false; save(KEYS.POSITION,{left:hud.style.left,top:hud.style.top});});
    window.addEventListener('mousemove',e=>{if(dragging){ hud.style.left=`${e.clientX-dx}px`; hud.style.top=`${e.clientY-dy}px`; hud.style.right='auto'; hud.style.bottom='auto'; }});

    const hideBtn=document.createElement('div'); hideBtn.textContent='⏷';
    Object.assign(hideBtn.style,{position:'absolute',top:'4px',left:'4px',width:'20px',height:'20px',display:'flex',alignItems:'center',justifyContent:'center',
        background:'#444',borderRadius:'4px',cursor:'pointer',userSelect:'none'});
    hud.appendChild(hideBtn);

    const bodyWrap=document.createElement('div'); bodyWrap.style.marginTop='6px'; hud.appendChild(bodyWrap);
    hideBtn.onclick=()=>{ const hidden=bodyWrap.style.display==='none'; bodyWrap.style.display=hidden?'block':'none'; hideBtn.textContent=hidden?'⏷':'⏵'; };

    /* ===================================================================
                          UI HELPERS
       =================================================================== */
    const makeRow=(n,filled,onClick,color='#0f0',w=12,h=12)=>{
        const row=document.createElement('div'); row.style.display='flex'; row.style.gap='4px';
        for(let i=0;i<n;i++){
            const box=document.createElement('div');
            Object.assign(box.style,{width:`${w}px`,height:`${h}px`,border:'1px solid #fff',borderRadius:'2px',background:i<filled?color:'transparent',cursor:onClick?'pointer':'default'});
            if(onClick) box.onclick=()=>onClick(i);
            row.appendChild(box);
        }
        return row;
    };
    const addSection=title=>{ const head=document.createElement('div'); head.textContent=title;
        Object.assign(head.style,{fontWeight:'bold',cursor:'pointer',marginTop:'6px'});
        const body=document.createElement('div'); bodyWrap.append(head,body);
        head.onclick=()=>{ body.style.display = body.style.display==='none'?'block':'none'; };
        return body;
    };

    /* ===================================================================
                             SECTIONS
       =================================================================== */

    /* (1) Anime section ------------------------------------------------- */
    const epSec=addSection('🎬 Anime');
    const playPercent=document.createElement('div'); epSec.appendChild(playPercent);
    const epBar=makeRow(10,0,null,'#2196f3',18,6); epBar.style.marginTop='2px'; epSec.appendChild(epBar);
    const epCountTxt=document.createElement('div'); epCountTxt.style.marginTop='6px'; epSec.appendChild(epCountTxt);

    function renderEpGrid(){
        const old=epSec.querySelector('.ep‑grid'); if(old) old.remove();
        const g=document.createElement('div'); g.className='ep‑grid'; g.style.display='flex'; g.style.flexDirection='column'; g.style.gap='4px';
        for(let r=0;r<2;r++){
            const row=document.createElement('div'); row.style.display='flex'; row.style.gap='8px';
            for(let p=0;p<3;p++){
                const start=r*6+p*2;
                const filled=Math.max(0,Math.min(2,(markedEpisodes[todayKey()]||0)-start));
                const pair=makeRow(2,filled,i=>{
                    const idx=start+i; const cur=markedEpisodes[todayKey()]||0;
                    markedEpisodes[todayKey()] = idx<cur ? cur-1 : cur+1;
                    save(KEYS.MARKED,markedEpisodes); refreshHUD();
                },settings.dailyColor);
                row.appendChild(pair);
            }
            g.appendChild(row);
        }
        epSec.appendChild(g);
    }

    /* (2) Reading progress -------------------------------------------- */
    const readSec=addSection('📚 Reading (Chapters)');
    const readBar=document.createElement('div'); readBar.style.display='flex'; readSec.appendChild(readBar);

    function renderReadBar(){
        const ch=readingChapters[todayKey()]||0;
        const filled=Math.min(CHAPTERS_PER_DAY,ch);
        readBar.innerHTML='';
        // toggle on click: filled->-1, else +1
        const row = makeRow(CHAPTERS_PER_DAY, filled, i=>{
            const cur=readingChapters[todayKey()]||0;
            readingChapters[todayKey()] = i<cur ? cur-1 : cur+1;
            save(KEYS.READING,readingChapters); refreshHUD();
        },'#4caf50',24,24);
        readBar.appendChild(row);
    }

    /* (3) Daily flags --------------------------------------------------- */
    const flagSec=addSection('🗓 Daily Tasks');
    function makeFlagBtn(label,flag){
        const b=document.createElement('button'); b.textContent=label;
        Object.assign(b.style,{margin:'2px 4px',background:'#333',color:'#fff',border:'1px solid #888',borderRadius:'6px',cursor:'pointer'});
        b.onclick=()=>{
            const k=todayKey();
            const d=dailyFlags[k]||{srs:false,speak:false,skip:false};
            d[flag] = !d[flag];
            dailyFlags[k] = d;
            save(KEYS.TASKS,dailyFlags);
            refreshHUD();
        };
        flagSec.appendChild(b);
        return b;
    }
    const srsBtn   = makeFlagBtn('✅ SRS','srs');
    const speakBtn = makeFlagBtn('🗣 Speaking','speak');
    const skipBtn  = makeFlagBtn('🚫 Skip','skip');

    /* (4) footer (settings + calendar) --------------------------------- */
    const footer=document.createElement('div'); footer.style.display='flex'; footer.style.gap='10px'; footer.style.marginTop='10px'; bodyWrap.appendChild(footer);
    const makeFootBtn=(txt,cb)=>{ const b=document.createElement('button'); b.textContent=txt;
        Object.assign(b.style,{background:'#333',color:'#fff',border:'1px solid #888',borderRadius:'6px',padding:'4px 8px',cursor:'pointer',fontSize:'16px'});
        b.onclick=cb; footer.appendChild(b);
    };
    makeFootBtn('⚙️',openSettings);
    makeFootBtn('📅',openCalendar);

    /* ===================================================================
                             SETTINGS POPUP
       =================================================================== */
    function styliseInput(input){ Object.assign(input.style,{background:'#222',color:'#fff',border:'1px solid #555',borderRadius:'4px',padding:'2px 4px',boxSizing:'border-box'}); }

    function openSettings(){
        const pop=document.createElement('div');
        Object.assign(pop.style,{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'#111',color:'#fff',padding:'20px',borderRadius:'10px',zIndex:MAX_Z,fontFamily:'Arial'});
        const mkRow=(lbl,input)=>{ const l=document.createElement('label'); l.textContent=lbl; l.style.display='block'; l.style.margin='8px 0'; l.appendChild(input); return l; };

        const op=document.createElement('input'); Object.assign(op,{type:'number',step:'0.1',min:0,max:1,value:settings.opacity}); styliseInput(op);
        const col=document.createElement('input'); col.type='color'; col.value=settings.episodeColor;

        pop.appendChild(mkRow('Panel opacity',op));
        pop.appendChild(mkRow('Episode‑grid colour',col));

        const saveBtn=document.createElement('button'); saveBtn.textContent='Save'; saveBtn.style.marginTop='10px'; saveBtn.onclick=()=>{
            settings.opacity = parseFloat(op.value) || settings.opacity;
            settings.episodeColor = col.value || settings.episodeColor;
            save(KEYS.SETTINGS,settings);
            hud.style.background=`rgba(0,0,0,${settings.opacity})`;
            pop.remove(); refreshHUD();
        };
        pop.appendChild(saveBtn);

        const closeBtn=document.createElement('button'); closeBtn.textContent='Close'; closeBtn.style.marginLeft='8px'; closeBtn.onclick=()=>pop.remove();
        pop.appendChild(closeBtn);
        document.body.appendChild(pop);
    }

    /* ===================================================================
                                CALENDAR / CHART
       =================================================================== */
    function openCalendar(){
        const overlay=document.createElement('div');
        Object.assign(overlay.style,{position:'fixed',top:'0',left:'0',width:'100%',height:'100%',background:'rgba(0,0,0,0.8)',zIndex:MAX_Z,overflowY:'auto'});
        overlay.onclick=e=>{ if(e.target===overlay) overlay.remove(); };

        const container=document.createElement('div'); container.style.width='100%'; container.style.maxWidth='720px'; container.style.margin='60px auto'; container.style.color='#fff'; overlay.appendChild(container);
        const canvas=document.createElement('canvas'); canvas.width=680; canvas.height=360; container.appendChild(canvas);

        const labels=[], epData=[], readData=[], srsData=[], speakData=[];
        for(let i=29;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=dateKey(d);
            labels.push(k.slice(5)); epData.push(markedEpisodes[k]||0); readData.push(readingChapters[k]||0);
            const f=dailyFlags[k]||{}; srsData.push(f.srs?1:0); speakData.push(f.speak?1:0);
        }
        new Chart(canvas.getContext('2d'),{
            type:'bar', data:{labels,datasets:[
                {label:'Episodes',data:epData,yAxisID:'y1',backgroundColor:'#4caf50'},
                {label:'Chapters',data:readData,yAxisID:'y1',backgroundColor:'#2196f3'},
                {label:'SRS ✔',data:srsData,yAxisID:'y2',type:'line',borderWidth:2,fill:false,borderColor:'#ffeb3b'},
                {label:'Speak ✔',data:speakData,yAxisID:'y2',type:'line',borderWidth:2,fill:false,borderColor:'#ff5722'}
            ]},
            options:{plugins:{legend:{labels:{color:'#fff'}}}, scales:{x:{ticks:{color:'#fff'}}, y1:{beginAtZero:true,ticks:{color:'#fff'}}, y2:{beginAtZero:true,max:1,position:'right',grid:{display:false},ticks:{stepSize:1,color:'#fff'}}}
        }});

        const navWrapper=document.createElement('div');
        Object.assign(navWrapper.style,{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'30px',gap:'10px'});
        container.appendChild(navWrapper);

        const navBtnStyle={background:'#333',color:'#fff',border:'1px solid #888',borderRadius:'4px',cursor:'pointer',padding:'2px 6px',fontSize:'14px'};
        const prevYearBtn=document.createElement('button'); prevYearBtn.textContent='«'; Object.assign(prevYearBtn.style,navBtnStyle);
        const prevMonthBtn=document.createElement('button'); prevMonthBtn.textContent='‹'; Object.assign(prevMonthBtn.style,navBtnStyle);
        const nextMonthBtn=document.createElement('button'); nextMonthBtn.textContent='›'; Object.assign(nextMonthBtn.style,navBtnStyle);
        const nextYearBtn=document.createElement('button'); nextYearBtn.textContent='»'; Object.assign(nextYearBtn.style,navBtnStyle);
        const monthLabel=document.createElement('div'); monthLabel.style.flex='1'; monthLabel.style.textAlign='center'; monthLabel.style.fontWeight='bold';
        navWrapper.append(prevYearBtn,prevMonthBtn,monthLabel,nextMonthBtn,nextYearBtn);

        const calDiv=document.createElement('div'); calDiv.style.marginTop='10px'; container.appendChild(calDiv);
        let viewDate=new Date();
        const renderCalendar=()=>{ monthLabel.textContent=`${viewDate.toLocaleString('default',{month:'long'})} ${viewDate.getFullYear()}`; buildCalendar(calDiv,viewDate); };
        prevYearBtn.onclick=()=>{ viewDate.setFullYear(viewDate.getFullYear()-1); renderCalendar(); };
        nextYearBtn.onclick=()=>{ viewDate.setFullYear(viewDate.getFullYear()+1); renderCalendar(); };
        prevMonthBtn.onclick=()=>{ viewDate.setMonth(viewDate.getMonth()-1); renderCalendar(); };
        nextMonthBtn.onclick=()=>{ viewDate.setMonth(viewDate.getMonth()+1); renderCalendar(); };
        renderCalendar();
        document.body.appendChild(overlay);
    }

    /* ---------- buildCalendar + day‑edit popup ---------- */
    function buildCalendar(target,date){
        target.innerHTML='';
        const tbl=document.createElement('table'); tbl.style.width='100%'; tbl.style.borderCollapse='collapse'; tbl.style.textAlign='center';
        const headerRow=document.createElement('tr'); ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d=>{ const th=document.createElement('th'); th.textContent=d; th.style.padding='4px 0'; tbl.appendChild(th); });
        tbl.appendChild(headerRow);

        const firstOfMonth=new Date(date.getFullYear(),date.getMonth(),1);
        const offset=((firstOfMonth.getDay()+6)%7);
        const daysInMonth=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
        let curDay=1-offset;

        for(let r=0;r<6;r++){
            const tr=document.createElement('tr');
            for(let c=0;c<7;c++){
                const td=document.createElement('td'); td.style.padding='4px'; td.style.cursor='pointer';
                if(curDay>0 && curDay<=daysInMonth){
                    const d=new Date(date.getFullYear(),date.getMonth(),curDay);
                    const k=dateKey(d);
                    td.textContent=curDay;
                    td.style.color=(k===todayKey())?'#0ff':'#fff';
                    const watched = markedEpisodes[k]||0;
                    const read    = readingChapters[k]||0;
                    const f       = dailyFlags[k]||{};
                    td.title = `Ep ${watched}/${EPISODES_PER_DAY}\nCh ${read}/${CHAPTERS_PER_DAY}\nSRS:${f.srs?'✔':'✘'} Speak:${f.speak?'✔':'✘'} Skip:${f.skip?'✔':'✘'}`;
                    // color code
                    if(f.skip) {
                        td.style.backgroundColor = '#2196f3'; // blue
                    } else if(watched>=EPISODES_PER_DAY && read>=CHAPTERS_PER_DAY && f.srs && f.speak) {
                        td.style.backgroundColor = '#4caf50'; // green
                    } else if(watched===0 && read===0 && !f.srs && !f.speak) {
                        td.style.backgroundColor = '#f44336'; // red
                    } else {
                        td.style.backgroundColor = '#ffeb3b'; // partial
                    }
                    td.style.border = '1px solid #888';
                    td.style.borderRadius = '4px';
                    td.onclick = ()=>openDayPopup(d);
                } else {
                    td.textContent='';
                }
                tr.appendChild(td);
                curDay++;
            }
            tbl.appendChild(tr);
        }
        target.appendChild(tbl);
    }

    function openDayPopup(d){
        const k=dateKey(d);
        const pop=document.createElement('div');
        Object.assign(pop.style,{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'#111',color:'#fff',padding:'20px',borderRadius:'10px',zIndex:MAX_Z,fontFamily:'Arial',minWidth:'220px'});
        const mkField=(lbl,input)=>{ const w=document.createElement('div'); w.style.margin='8px 0'; const l=document.createElement('span'); l.textContent=lbl; l.style.marginRight='8px'; w.append(l,input); return w; };

        const epInput   = document.createElement('input'); Object.assign(epInput,{type:'number',min:0,max:EPISODES_PER_DAY,value:markedEpisodes[k]||0}); styliseInput(epInput);
        const chInput   = document.createElement('input'); Object.assign(chInput,{type:'number',min:0,max:CHAPTERS_PER_DAY,value:readingChapters[k]||0}); styliseInput(chInput);
        const srsChk    = document.createElement('input'); srsChk.type='checkbox'; srsChk.checked=(dailyFlags[k]||{}).srs||false;
        const speakChk  = document.createElement('input'); speakChk.type='checkbox'; speakChk.checked=(dailyFlags[k]||{}).speak||false;
        const skipChk   = document.createElement('input'); skipChk.type='checkbox'; skipChk.checked=(dailyFlags[k]||{}).skip||false;

        pop.appendChild(mkField('Episodes',epInput));
        pop.appendChild(mkField('Chapters',chInput));
        pop.appendChild(mkField('SRS ✔',srsChk));
        pop.appendChild(mkField('Speak ✔',speakChk));
        pop.appendChild(mkField('Skip 🚫',skipChk));

        const saveBtn=document.createElement('button'); saveBtn.textContent='Save'; saveBtn.onclick=()=>{
            markedEpisodes[k]  = parseInt(epInput.value)||0;
            readingChapters[k] = parseInt(chInput.value)||0;
            dailyFlags[k]      = { srs: srsChk.checked, speak: speakChk.checked, skip: skipChk.checked };
            save(KEYS.MARKED, markedEpisodes);
            save(KEYS.READING, readingChapters);
            save(KEYS.TASKS,   dailyFlags);
            pop.remove(); refreshHUD();
        };
        const closeBtn=document.createElement('button'); closeBtn.textContent='Cancel'; closeBtn.style.marginLeft='8px'; closeBtn.onclick=()=>pop.remove();
        pop.append(saveBtn,closeBtn);
        document.body.appendChild(pop);
    }

    /* ===================================================================
                                  REFRESH HUD
       =================================================================== */
    function refreshHUD(){
        const ep=markedEpisodes[todayKey()]||0; epCountTxt.textContent=`Watched: ${ep}/${EPISODES_PER_DAY}`;
        renderReadBar();
        renderEpGrid();
        const f=dailyFlags[todayKey()]||{};
        srsBtn.style.background   = f.srs   ? '#00695c' : '#333';
        speakBtn.style.background = f.speak ? '#00695c' : '#333';
        skipBtn.style.background  = f.skip  ? '#00695c' : '#333';
    }

    function updatePlayBar(){
        const v=document.querySelector('video');
        const pct=(v&&v.duration)?v.currentTime/v.duration:0;
        const filled=Math.round(pct*10);
        playPercent.textContent=`Episode progress: ${(pct*100).toFixed(0)}%`;
        [...epBar.children].forEach((b,i)=>{ b.style.background=i<filled?'#2196f3':'transparent'; });
    }

    setInterval(()=>{ if(!document.body.contains(hud)) document.body.appendChild(hud); },HUD_KEEPALIVE_MS);
    setInterval(updatePlayBar,1000);
    refreshHUD(); updatePlayBar();
})();
