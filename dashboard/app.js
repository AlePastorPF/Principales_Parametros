(function(){
  "use strict";

  const DATA = JSON.parse(document.getElementById('data-blob').textContent);
  const LOGOS = JSON.parse(document.getElementById('logos-blob').textContent);

  const F = {}; // colFields -> index
  DATA.colFields.forEach((name,i)=>F[name]=i);

  const POS_COLORS = {
    'Primera Línea':'#1C3A5E',
    'Segunda/Tercera Línea':'#2D7D95',
    'Medio Scrum':'#7A5C9E',
    'Backs Internos':'#C1622D',
    'Backs Externos':'#3F8F5F'
  };
  const POS_SOFT = {
    'Primera Línea':'#E7EDF3',
    'Segunda/Tercera Línea':'#E4F0F3',
    'Medio Scrum':'#EFEAF5',
    'Backs Internos':'#F6E9E0',
    'Backs Externos':'#E7F3EC'
  };

  // ---------- Ball icon (custom flat SVG, no watermark) ----------
  const BALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <g transform="rotate(-38 32 32)">
      <ellipse cx="32" cy="32" rx="26" ry="15" fill="#C98A2B"/>
      <ellipse cx="32" cy="32" rx="26" ry="15" fill="none" stroke="#9C6A1E" stroke-width="2"/>
      <line x1="10" y1="32" x2="54" y2="32" stroke="#9C6A1E" stroke-width="1.6"/>
      <g stroke="#F4E3C1" stroke-width="1.6">
        <line x1="21" y1="26" x2="21" y2="38"/>
        <line x1="27" y1="24" x2="27" y2="40"/>
        <line x1="37" y1="24" x2="37" y2="40"/>
        <line x1="43" y1="26" x2="43" y2="38"/>
      </g>
    </g>
  </svg>`;
  LOGOS['BALL'] = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(BALL_SVG)));

  // Preload Image objects, pre-scaled to a small fixed-size canvas (Chart.js draws
  // Image/Canvas pointStyle at its own pixel size, ignoring pointRadius — so we must
  // resize the source ourselves to get small, consistent markers).
  const ICON_PX = 22; // grande lo suficiente para distinguir el escudo de cada rival
  const IMG_CACHE = {};
  const iconReady = [];
  function buildIcon(code, src){
    const p = new Promise(resolve=>{
      const raw = new Image();
      raw.onload = ()=>{
        const canvas = document.createElement('canvas');
        canvas.width = ICON_PX; canvas.height = ICON_PX;
        const cctx = canvas.getContext('2d');
        const scale = Math.min(ICON_PX/raw.naturalWidth, ICON_PX/raw.naturalHeight);
        const w = raw.naturalWidth*scale, h = raw.naturalHeight*scale;
        cctx.drawImage(raw, (ICON_PX-w)/2, (ICON_PX-h)/2, w, h);
        IMG_CACHE[code] = canvas;
        resolve();
      };
      raw.onerror = resolve;
      raw.src = src;
    });
    iconReady.push(p);
  }
  function getImg(code){
    if(!code) code='BALL';
    return IMG_CACHE[code] || IMG_CACHE['BALL'];
  }
  Object.keys(LOGOS).forEach(code=>buildIcon(code, LOGOS[code]));
  const iconsReadyPromise = Promise.all(iconReady);

  document.getElementById('sicLogo').src = LOGOS['SIC'];

  function logoFor(row){
    // row: raw array
    return row[F.isMatch]===1 ? getImg(row[F.rival] && LOGOS[row[F.rival]] ? row[F.rival] : null) : getImg('BALL');
  }
  function logoSrcFor(row){
    if(row[F.isMatch]===1 && row[F.rival] && LOGOS[row[F.rival]]) return LOGOS[row[F.rival]];
    return LOGOS['BALL'];
  }

  // ---------- Filter state ----------
  const state = {
    temporada: new Set(DATA.temporadas.length ? [DATA.temporadas[DATA.temporadas.length-1]] : []),
    puesto: new Set(),
    jugador: new Set(),
    etiqueta: new Set(),
    actividad: new Set(),
  };
  const durState = { min:0, max:Infinity };
  // start with only latest season selected, everything else = "todos" (empty set = no restriction)

  function rowMatches(row, ignoreKey){
    if(row[F.dur] < durState.min || row[F.dur] > durState.max) return false;
    if(state.temporada.size && ignoreKey!=='temporada' && !state.temporada.has(row[F.temporada])) return false;
    // Nota de diseño: el filtro de Actividad no depende de Puesto/Jugador (solo de
    // Temporada y Tipo) para que elegir un jugador no reduzca la lista de actividades.
    if(state.puesto.size && ignoreKey!=='puesto' && ignoreKey!=='actividad' && !state.puesto.has(DATA.puestos[row[F.puestoIdx]])) return false;
    if(state.jugador.size && ignoreKey!=='jugador' && ignoreKey!=='actividad' && !state.jugador.has(DATA.players[row[F.playerIdx]])) return false;
    if(state.etiqueta.size && ignoreKey!=='etiqueta' && !state.etiqueta.has(row[F.isMatch]===1?'Partido':'Entrenamiento')) return false;
    if(state.actividad.size && ignoreKey!=='actividad' && !state.actividad.has(row[F.actividad])) return false;
    return true;
  }

  function getFiltered(){
    return DATA.rows.filter(r=>rowMatches(r,null));
  }

  // ---------- Duration range slider ----------
  const globalDurMax = Math.ceil(Math.max(...DATA.rows.map(r=>r[F.dur])));

  function setupDurationSlider(){
    const elMin = document.getElementById('durMin');
    const elMax = document.getElementById('durMax');
    const fill = document.getElementById('durRangeFill');
    const label = document.getElementById('durRangeLabel');
    elMin.max = globalDurMax; elMax.max = globalDurMax;
    elMin.value = 0; elMax.value = globalDurMax;

    function update(fromUser){
      let vMin = parseInt(elMin.value,10), vMax = parseInt(elMax.value,10);
      if(vMin > vMax){ if(fromUser==='min'){ vMax = vMin; elMax.value = vMax; } else { vMin = vMax; elMin.value = vMin; } }
      durState.min = vMin; durState.max = vMax;
      const pctMin = (vMin/globalDurMax)*100, pctMax = (vMax/globalDurMax)*100;
      fill.style.left = pctMin+'%';
      fill.style.width = (pctMax-pctMin)+'%';
      label.textContent = `${vMin} – ${vMax} min`;
      if(fromUser) onFiltersChanged();
    }
    elMin.addEventListener('input', ()=>update('min'));
    elMax.addEventListener('input', ()=>update('max'));
    update(false);
  }

  // ---------- Filter UI ----------
  const FILTER_DEFS = {
    temporada: { label:v=>String(v), search:false, groups:false },
    puesto:    { label:v=>v, search:true, groups:false },
    jugador:   { label:v=>v, search:true, groups:false },
    etiqueta:  { label:v=>v, search:false, groups:false },
    actividad: { label:v=>v, search:true, groups:true },
  };

  function optionsFor(key){
    const seen = new Map(); // value -> count
    DATA.rows.forEach(r=>{
      if(!rowMatches(r,key)) return;
      let val;
      if(key==='temporada') val = r[F.temporada];
      else if(key==='puesto') val = DATA.puestos[r[F.puestoIdx]];
      else if(key==='jugador') val = DATA.players[r[F.playerIdx]];
      else if(key==='etiqueta') val = r[F.isMatch]===1 ? 'Partido' : 'Entrenamiento';
      else if(key==='actividad') val = r[F.actividad];
      seen.set(val, (seen.get(val)||0) + 1);
    });
    return seen;
  }

  function actividadMeta(val){
    // find a representative row to know isMatch/rival for grouping+icon
    for(const r of DATA.rows){ if(r[F.actividad]===val) return r; }
    return null;
  }

  function renderFilterPanel(key){
    const root = document.querySelector(`.filter[data-key="${key}"]`);
    const list = root.querySelector('.filter-list');
    const searchEl = root.querySelector('.filter-search');
    const term = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const opts = optionsFor(key);
    let entries = Array.from(opts.keys());

    if(key==='temporada'){ entries.sort((a,b)=>a-b); }
    else { entries.sort((a,b)=>String(a).localeCompare(String(b),'es')); }

    if(term){ entries = entries.filter(v=>String(v).toLowerCase().includes(term)); }

    list.innerHTML='';
    if(!entries.length){
      list.innerHTML = '<div class="filter-empty">Sin opciones para la selección actual</div>';
      return;
    }

    if(key==='actividad'){
      const trainings = entries.filter(v=>{const m=actividadMeta(v); return m && m[F.isMatch]===0;});
      const matches = entries.filter(v=>{const m=actividadMeta(v); return m && m[F.isMatch]===1;});
      if(trainings.length) appendGroup('Entrenamiento', trainings);
      if(matches.length) appendGroup('Partido', matches);
    } else {
      entries.forEach(v=>appendOption(v));
    }

    function appendGroup(label, arr){
      const g = document.createElement('div');
      g.className='filter-group-label';
      g.textContent = label;
      list.appendChild(g);
      arr.forEach(v=>appendOption(v));
    }

    function appendOption(v){
      const row = document.createElement('label');
      row.className='filter-option';
      const cb = document.createElement('input');
      cb.type='checkbox';
      cb.checked = state[key].has(v);
      cb.addEventListener('change', ()=>{
        if(cb.checked) state[key].add(v); else state[key].delete(v);
        onFiltersChanged();
      });
      row.appendChild(cb);
      if(key==='actividad'){
        const meta = actividadMeta(v);
        const img = document.createElement('img');
        img.src = meta ? logoSrcFor(meta) : LOGOS['BALL'];
        row.appendChild(img);
      }
      const span = document.createElement('span');
      span.textContent = FILTER_DEFS[key].label(v);
      row.appendChild(span);
      list.appendChild(row);
    }
  }

  function updateFilterButtonLabels(){
    Object.keys(state).forEach(key=>{
      const root = document.querySelector(`.filter[data-key="${key}"]`);
      const txt = root.querySelector('.fbtn-text');
      const n = state[key].size;
      if(!n){ txt.textContent = key==='temporada' ? 'Todas' : 'Todos'; }
      else if(n===1){ txt.textContent = FILTER_DEFS[key].label(Array.from(state[key])[0]); }
      else { txt.textContent = `${n} seleccionados`; }
    });
    renderActiveFiltersBar();
  }

  const FILTER_LABELS = { temporada:'Temporada', puesto:'Puesto', jugador:'Jugador', etiqueta:'Tipo', actividad:'Actividad' };

  function renderActiveFiltersBar(){
    const bar = document.getElementById('activeFiltersBar');
    const chipsEl = document.getElementById('activeFiltersChips');
    const clearBtn = document.getElementById('clearAllFilters');
    chipsEl.innerHTML = '';
    const durActive = durState.min>0 || (isFinite(durState.max) && durState.max<globalDurMax);
    let anyActive = durActive;
    Object.keys(FILTER_LABELS).forEach(key=>{
      const n = state[key].size;
      if(!n) return;
      anyActive = true;
      const chip = document.createElement('span');
      chip.className='active-filter-chip';
      const label = n===1 ? FILTER_DEFS[key].label(Array.from(state[key])[0]) : `${n} seleccionados`;
      chip.innerHTML = `${FILTER_LABELS[key]}: ${label} <span class="x" title="Quitar este filtro">✕</span>`;
      chip.querySelector('.x').addEventListener('click', ()=>{ state[key].clear(); onFiltersChanged(); });
      chipsEl.appendChild(chip);
    });
    if(durActive){
      const chip = document.createElement('span');
      chip.className='active-filter-chip';
      chip.innerHTML = `Duración: ${durState.min}–${durState.max} min <span class="x" title="Quitar este filtro">✕</span>`;
      chip.querySelector('.x').addEventListener('click', ()=>{
        document.getElementById('durMin').value = 0;
        document.getElementById('durMax').value = globalDurMax;
        document.getElementById('durMin').dispatchEvent(new Event('input'));
        document.getElementById('durMax').dispatchEvent(new Event('input'));
      });
      chipsEl.appendChild(chip);
    }
    bar.style.display = anyActive ? 'flex' : 'none';
    clearBtn.style.display = anyActive ? '' : 'none';
  }

  function setupFilterInteractions(){
    document.querySelectorAll('.filter').forEach(root=>{
      const key = root.dataset.key;
      const btn = root.querySelector('.filter-btn');
      const panel = root.querySelector('.filter-panel');
      const searchEl = root.querySelector('.filter-search');

      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const wasOpen = root.classList.contains('open');
        document.querySelectorAll('.filter.open').forEach(f=>f.classList.remove('open'));
        if(!wasOpen){
          root.classList.add('open');
          renderFilterPanel(key);
          if(searchEl) searchEl.focus();
        }
      });
      if(searchEl){
        searchEl.addEventListener('input', ()=>renderFilterPanel(key));
        searchEl.addEventListener('click', e=>e.stopPropagation());
      }
      panel.addEventListener('click', e=>e.stopPropagation());
      root.querySelectorAll('.filter-actions button').forEach(b=>{
        b.addEventListener('click', ()=>{
          const opts = optionsFor(key);
          if(b.dataset.act==='all'){ Array.from(opts.keys()).forEach(v=>state[key].add(v)); }
          else { state[key].clear(); }
          renderFilterPanel(key);
          onFiltersChanged();
        });
      });
    });
    document.addEventListener('click', ()=>{
      document.querySelectorAll('.filter.open').forEach(f=>f.classList.remove('open'));
    });
  }

  function onFiltersChanged(){
    updateFilterButtonLabels();
    document.querySelectorAll('.filter.open').forEach(f=>{
      renderFilterPanel(f.dataset.key);
    });
    renderAll();
  }

  // ---------- Cards ----------
  function renderCards(filtered){
    const row = document.getElementById('cardsRow');
    row.innerHTML='';
    if(!filtered.length){
      row.innerHTML = '<div class="empty-state">No hay registros para esta combinación de filtros.</div>';
      return;
    }
    const byGroup = {};
    filtered.forEach(r=>{
      const pg = DATA.posgroups[r[F.posGroupIdx]];
      if(!byGroup[pg] || r[F.eruUnits] > byGroup[pg][F.eruUnits]) byGroup[pg]=r;
    });
    const cards = Object.values(byGroup).sort((a,b)=>b[F.eruUnits]-a[F.eruUnits]);
    const maxCardUnits = cards[0][F.eruUnits];

    const metricDefs = [
      {k:'dur', lbl:'Duración', unit:'min', field:F.dur, cf:F.c_dur},
      {k:'de',  lbl:'Dist Exp', unit:'m',   field:F.de,  cf:F.c_de},
      {k:'rhie',lbl:'RHIE',     unit:'',    field:F.rhie,cf:F.c_rhie},
      {k:'big', lbl:'BiG',      unit:'s',   field:F.big, cf:F.c_big},
      {k:'con', lbl:'Contactos',unit:'',    field:F.con, cf:F.c_con},
    ];

    cards.forEach((r,i)=>{
      const pg = DATA.posgroups[r[F.posGroupIdx]];
      const color = POS_COLORS[pg];
      const soft = POS_SOFT[pg];
      const card = document.createElement('div');
      card.className = 'pcard' + (i===0 ? ' rank-1':'');
      const rng = DATA.seasonRanges[r[F.temporada]];
      const weights = DATA.weights[pg];

      let barsHtml = '';
      metricDefs.forEach(m=>{
        const contribMax = weights[m.k]*100; // max possible contribution points for this metric
        const pct = contribMax>0 ? Math.min(100, (r[m.cf]/contribMax)*100) : 0;
        barsHtml += `<div class="bar-row">
            <div class="lbl">${m.lbl}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(0)}%; background:${color}"></div></div>
            <div class="val">${formatMetric(r[m.field], m.unit)}</div>
          </div>`;
      });

      card.innerHTML = `
        <div class="top-row">
          <div>
            <div class="name">${DATA.players[r[F.playerIdx]]}</div>
            <div class="pos-tag" style="background:${soft}; color:${color}">${DATA.puestos[r[F.puestoIdx]]}</div>
          </div>
        </div>
        <div class="eru-block">
          <div class="eru-units">${r[F.eruUnits].toFixed(1)}<span class="eru-units-lbl">u.</span></div>
          <div class="eru-pct-badge" style="background:${soft}; color:${color}">${r[F.eruPct].toFixed(0)}%<span>del máx. ${r[F.temporada]}</span></div>
        </div>
        <div class="meta-row">
          <img src="${logoSrcFor(r)}" alt="">
          <span>${r[F.actividad]}</span>
          <span class="sep">·</span>
          <span>${r[F.temporada]}</span>
        </div>
        <div class="bars">${barsHtml}</div>
      `;
      row.appendChild(card);
    });
  }

  function hexAlpha(hex, a){
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function formatMetric(v, unit){
    if(unit==='min') return v.toFixed(1)+' min';
    if(unit==='m') return v.toFixed(0)+' m';
    if(unit==='s') return v.toFixed(2)+' s';
    return v.toFixed(0);
  }

  // ---------- Chart.js plugin: dashed mean lines ----------
  const meanLinesPlugin = {
    id: 'meanLines',
    afterDraw(chart, args, opts){
      if(!opts || opts.x==null || opts.y==null) return;
      const {ctx, chartArea, scales} = chart;
      if(!chartArea) return;
      const xPix = scales.x.getPixelForValue(opts.x);
      const yPix = scales.y.getPixelForValue(opts.y);
      ctx.save();
      ctx.setLineDash([5,4]);
      ctx.strokeStyle = '#9AA3B2';
      ctx.lineWidth = 1.25;
      if(xPix>=chartArea.left && xPix<=chartArea.right){
        ctx.beginPath();
        ctx.moveTo(xPix, chartArea.top);
        ctx.lineTo(xPix, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#6B7280';
        ctx.font = '600 10.5px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`ERU medio ${opts.x.toFixed(1)}`, xPix, chartArea.top-4);
        ctx.setLineDash([5,4]);
      }
      if(yPix>=chartArea.top && yPix<=chartArea.bottom){
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yPix);
        ctx.lineTo(chartArea.right, yPix);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#6B7280';
        ctx.font = '600 10.5px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Duración media ${opts.y.toFixed(1)} min`, chartArea.left+4, yPix-5);
      }
      ctx.restore();
    }
  };
  Chart.register(meanLinesPlugin);

  function hexAlpha(hex, a){
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------- Scatter chart ----------
  let scatterChart=null;
  function renderChart(filtered){
    const note = document.getElementById('chartModeNote');
    if(note){
      note.textContent = filtered.length > 300
        ? `Cada punto es un registro · pelota = entrenamiento, logo del rival = partido · color = grupo posicional. Con ${filtered.length.toLocaleString('es-AR')} registros los íconos se superponen — filtrá por tipo, actividad o jugador para verlos con claridad.`
        : 'Cada punto es un registro · pelota = entrenamiento, logo del rival = partido · color = grupo posicional';
    }
    const ctx = document.getElementById('scatterChart').getContext('2d');
    const datasets = DATA.posgroups.map((pg,idx)=>{
      const pts = filtered.filter(r=>r[F.posGroupIdx]===idx).map(r=>({
        x:r[F.eruUnits], y:r[F.dur], _row:r
      }));
      return {
        label: pg,
        data: pts,
        parsing:false,
        pointStyle: pts.map(p=>logoFor(p._row)),
        pointRadius: 11,
        pointHoverRadius: 13,
        borderColor: POS_COLORS[pg],
        backgroundColor: POS_COLORS[pg],
        borderWidth: 1,
      };
    });

    if(scatterChart){ scatterChart.destroy(); }
    const meanX = filtered.length ? filtered.reduce((s,r)=>s+r[F.eruUnits],0)/filtered.length : null;
    const meanY = filtered.length ? filtered.reduce((s,r)=>s+r[F.dur],0)/filtered.length : null;
    scatterChart = new Chart(ctx, {
      type:'scatter',
      data:{datasets},
      options:{
        maintainAspectRatio:false,
        animation:false,
        layout:{padding:{top:16}},
        scales:{
          x:{ min:0, max:70, title:{display:true, text:'Índice ERU (unidades)'}, grid:{color:'#EEF0F4'} },
          y:{ title:{display:true, text:'Duración (min)'}, grid:{color:'#EEF0F4'} },
        },
        plugins:{
          legend:{ display:false },
          meanLines:{ x:meanX, y:meanY },
          tooltip:{
            backgroundColor:'#161A22',
            padding:10,
            titleFont:{size:12.5, weight:'600'},
            bodyFont:{size:11.5},
            callbacks:{
              title(items){ const r=items[0].raw._row; return DATA.players[r[F.playerIdx]]; },
              label(item){
                const r = item.raw._row;
                return [
                  `Puesto: ${DATA.puestos[r[F.puestoIdx]]}`,
                  `Actividad: ${r[F.actividad]} (${r[F.temporada]})`,
                  `Índice ERU: ${r[F.eruUnits].toFixed(1)} u. · ${r[F.eruPct].toFixed(0)}% del máx.`,
                  `Duración: ${r[F.dur].toFixed(1)} min   Dist Exp: ${r[F.de].toFixed(0)} m`,
                  `RHIE: ${r[F.rhie].toFixed(0)}   BiG: ${r[F.big].toFixed(2)} s   Contactos: ${r[F.con]}`,
                ];
              }
            }
          }
        }
      }
    });
    const legend = document.getElementById('posLegend');
    legend.innerHTML='';
    DATA.posgroups.forEach((pg,idx)=>{
      const item = document.createElement('div');
      item.className='item';
      item.innerHTML = `<span class="dot" style="background:${POS_COLORS[pg]}"></span>${pg}`;
      item.addEventListener('click', ()=>{
        const meta = scatterChart.getDatasetMeta(idx);
        meta.hidden = meta.hidden===null ? !scatterChart.data.datasets[idx].hidden : !meta.hidden;
        item.classList.toggle('off');
        scatterChart.update();
      });
      legend.appendChild(item);
    });
  }

  // ---------- Table ----------
  let sortCol = 'eruUnits', sortDir = -1, page=1, pageSize=50;
  const COLS = [
    {k:'jugador', num:false}, {k:'puesto', num:false}, {k:'actividad', num:false},
    {k:'temporada', num:false}, {k:'dur', num:true}, {k:'de', num:true},
    {k:'rhie', num:true}, {k:'big', num:true}, {k:'con', num:true},
    {k:'eruUnits', num:true}, {k:'eruPct', num:true},
  ];
  function sortVal(r, k){
    switch(k){
      case 'jugador': return DATA.players[r[F.playerIdx]];
      case 'puesto': return DATA.puestos[r[F.puestoIdx]];
      case 'actividad': return r[F.actividad];
      case 'temporada': return r[F.temporada];
      case 'dur': return r[F.dur];
      case 'de': return r[F.de];
      case 'rhie': return r[F.rhie];
      case 'big': return r[F.big];
      case 'con': return r[F.con];
      case 'eruUnits': return r[F.eruUnits];
      case 'eruPct': return r[F.eruPct];
    }
  }

  function pctToColor(pct){
    const p = Math.max(0, Math.min(100, pct));
    const hue = 120 - (p/100)*120; // 120=verde -> 0=rojo
    return { bg:`hsl(${hue}, 68%, 91%)`, fg:`hsl(${hue}, 55%, 32%)` };
  }

  function renderTable(filtered){
    const sorted = filtered.slice().sort((a,b)=>{
      const va=sortVal(a,sortCol), vb=sortVal(b,sortCol);
      if(typeof va==='string') return va.localeCompare(vb,'es')*sortDir;
      return (va-vb)*sortDir;
    });
    const totalPages = Math.max(1, Math.ceil(sorted.length/pageSize));
    if(page>totalPages) page = totalPages;
    const start = (page-1)*pageSize;
    const pageRows = sorted.slice(start, start+pageSize);
    const maxEruInView = sorted.length ? sorted[0][F.eruUnits] : 0;
    const top3cut = sorted.length>=3 ? sorted[2][F.eruUnits] : -1;

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML='';
    if(!pageRows.length){
      tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No hay registros para esta combinación de filtros.</td></tr>`;
    } else {
      pageRows.forEach(r=>{
        const pg = DATA.posgroups[r[F.posGroupIdx]];
        const col = pctToColor(r[F.eruPct]);
        const tr = document.createElement('tr');
        if(sortCol==='eruUnits' && sortDir===-1 && r[F.eruUnits]>=top3cut) tr.classList.add('top3');
        tr.innerHTML = `
          <td>${DATA.players[r[F.playerIdx]]}</td>
          <td><span class="pos-chip" style="background:${POS_SOFT[pg]};color:${POS_COLORS[pg]}">${DATA.puestos[r[F.puestoIdx]]}</span></td>
          <td><div class="act-cell"><img src="${logoSrcFor(r)}" alt=""><span class="act-txt" title="${r[F.actividad]}">${r[F.actividad]}</span></div></td>
          <td>${r[F.temporada]}</td>
          <td class="num">${r[F.dur].toFixed(1)}</td>
          <td class="num">${r[F.de].toFixed(0)}</td>
          <td class="num">${r[F.rhie].toFixed(0)}</td>
          <td class="num">${r[F.big].toFixed(2)}</td>
          <td class="num">${r[F.con]}</td>
          <td class="num" style="background:${col.bg}; color:${col.fg}; font-weight:650;">${r[F.eruUnits].toFixed(1)}</td>
          <td class="num" style="background:${col.bg}; color:${col.fg}; font-weight:650;">${r[F.eruPct].toFixed(0)}%</td>
        `;
        tbody.appendChild(tr);
      });
    }

    document.getElementById('tableRange').textContent =
      sorted.length ? `${start+1}–${Math.min(start+pageRows.length, sorted.length)} de ${sorted.length}` : '0 de 0';
    document.getElementById('pgLabel').textContent = `${page} / ${totalPages}`;
    document.getElementById('pgFirst').disabled = page<=1;
    document.getElementById('pgPrev').disabled = page<=1;
    document.getElementById('pgNext').disabled = page>=totalPages;
    document.getElementById('pgLast').disabled = page>=totalPages;

    document.querySelectorAll('table.main-table thead th').forEach(th=>{
      th.classList.toggle('sorted', th.dataset.col===sortCol);
      th.querySelector('.arrow')?.remove();
      if(th.dataset.col===sortCol){
        const s = document.createElement('span');
        s.className='arrow';
        s.textContent = sortDir===1 ? '▲' : '▼';
        th.appendChild(s);
      }
    });
  }

  function setupTableInteractions(){
    document.querySelectorAll('table.main-table thead th').forEach(th=>{
      th.addEventListener('click', ()=>{
        const col = th.dataset.col;
        if(sortCol===col){ sortDir*=-1; } else { sortCol=col; sortDir = (col==='jugador'||col==='puesto'||col==='actividad') ? 1 : -1; }
        page=1;
        renderAll();
      });
    });
    document.getElementById('pageSize').addEventListener('change', e=>{
      pageSize = parseInt(e.target.value,10); page=1; renderAll();
    });
    document.getElementById('pgFirst').addEventListener('click', ()=>{page=1; renderAll();});
    document.getElementById('pgPrev').addEventListener('click', ()=>{page=Math.max(1,page-1); renderAll();});
    document.getElementById('pgNext').addEventListener('click', ()=>{page=page+1; renderAll();});
    document.getElementById('pgLast').addEventListener('click', ()=>{page=1e9; renderAll();});
  }

  // ---------- Weights list (methodology) ----------
  function renderWeights(){
    const ul = document.getElementById('weightsList');
    ul.innerHTML='';
    DATA.posgroups.forEach(pg=>{
      const w = DATA.weights[pg];
      const li = document.createElement('li');
      li.innerHTML = `<strong>${pg}:</strong> Duración ${Math.round(w.dur*100)}% · Dist Exp ${Math.round(w.de*100)}% · RHIE ${Math.round(w.rhie*100)}% · BiG ${Math.round(w.big*100)}% · Contactos ${Math.round(w.con*100)}%`;
      ul.appendChild(li);
    });
  }

  // ---------- Master render ----------
  function renderAll(){
    const filtered = getFiltered();
    document.getElementById('headlineCount').textContent = filtered.length.toLocaleString('es-AR');
    renderCards(filtered);
    renderChart(filtered);
    renderTable(filtered);
  }

  updateFilterButtonLabels();
  setupFilterInteractions();
  setupTableInteractions();
  setupDurationSlider();
  renderWeights();
  document.getElementById('clearAllFilters').addEventListener('click', ()=>{
    Object.keys(state).forEach(k=>state[k].clear());
    document.getElementById('durMin').value = 0;
    document.getElementById('durMax').value = globalDurMax;
    document.getElementById('durMin').dispatchEvent(new Event('input'));
    document.getElementById('durMax').dispatchEvent(new Event('input'));
  });
  iconsReadyPromise.then(renderAll);

})();
