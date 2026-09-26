// ══ THEME ══
const saved=localStorage.getItem('fs-theme');
if(saved) document.documentElement.setAttribute('data-theme',saved);
function toggleTheme(){
  const n=document.documentElement.getAttribute('data-theme')==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',n);
  localStorage.setItem('fs-theme',n);
  [chartInst,compareChartInst,sensChartInst,validationChartInst,mcChartInst].forEach(c=>{if(c) syncChart(c);});
}
function tv(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function syncChart(c){
  if(!c) return;
  const g=tv('--chart-grid'),k=tv('--chart-tick'),b=tv('--tt-bg'),d=tv('--tt-border'),i=tv('--ink2');
  c.options.scales.x.grid.color=c.options.scales.y.grid.color=g;
  c.options.scales.x.ticks.color=c.options.scales.y.ticks.color=k;
  if(c.options.scales.x.title) c.options.scales.x.title.color=k;
  if(c.options.scales.y.title) c.options.scales.y.title.color=k;
  c.options.plugins.tooltip.backgroundColor=b;
  c.options.plugins.tooltip.borderColor=d;
  c.options.plugins.tooltip.bodyColor=i;
  c.update();
}

// Format a value as 10ⁿ notation for log axes.
function logLabel(value){
  const exp = Math.log10(value);
  if(Math.abs(exp - Math.round(exp)) > 0.001) return null;
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const n = Math.round(exp);
  const sign = n < 0 ? '⁻' : '';
  const expStr = String(Math.abs(n)).split('').map(d => digits[+d]).join('');
  return '10' + sign + expStr;
}

// Extract a numeric value from whatever Chart.js passes to a tick callback.
function extractTickNumber(value){
  if(value === null || value === undefined) return NaN;
  if(typeof value === 'number') return value;
  if(typeof value === 'string'){
    const n = Number(value.replace(/,/g,''));
    return isFinite(n) ? n : NaN;
  }
  if(typeof value === 'object'){
    if(value.value !== undefined) return extractTickNumber(value.value);
    if(value.x !== undefined)     return extractTickNumber(value.x);
  }
  return NaN;
}

// ══ STATE ══
let mode='single', selMat='2024-T3';
let chartInst=null, compareChartInst=null, sensChartInst=null, validationChartInst=null, mcChartInst=null;
let lastSingle=null, lastCompare=null, lastSens=null, lastValidation=null, lastMC=null, sensInputs={};
const COLORS={'2024-T3':'#1a56db','7075-T6':'#e8470a'};

const STATUS_CFG={
  OK:      {tagCls:'t-ok',   barCls:'status-ok',   label:'Safe',     prefix:'✓',
             rec:'Structure within safe operating limits. Continue scheduled monitoring per maintenance plan.'},
  DANGEROUS:{tagCls:'t-warn',barCls:'status-warn',  label:'Warning',  prefix:'⚠',
             rec:'Safe life under 10 years. Schedule inspection urgently. Do not increase load levels.'},
  CRITICAL: {tagCls:'t-crit',barCls:'status-crit',  label:'Critical', prefix:'✕',
             rec:'Immediate structural review required. Consider grounding aircraft until formal assessment is complete.'},
  FAILURE:  {tagCls:'t-fail',barCls:'status-fail',  label:'Failure',  prefix:'■',
             rec:'Applied stress exceeds material yield strength. Structural integrity cannot be assumed. DO NOT OPERATE.'},
};

function getStatusCfg(data){
  if(data.yield_warning) return STATUS_CFG.FAILURE;
  return STATUS_CFG[data.status]||STATUS_CFG.OK;
}

// ══ MODE CONTROL ══
function setMode(m){
  mode=m;
  ['single','compare','sens','validation','mc'].forEach(id=>{
    document.getElementById('tab-'+id).classList.toggle('active',id===m);
    const r=document.getElementById('results-'+id);
    if(r) r.style.display='none';
  });
  document.getElementById('mat-card').style.display=(m==='single'||m==='mc')?'':'none';
  document.getElementById('param-num').textContent=m==='single'?'02':'01';
  document.getElementById('placeholder').style.display='flex';
  document.getElementById('runBtn').textContent=
    m==='single'    ?'Assess Fatigue Life':
    m==='compare'   ?'Compare Both Materials':
    m==='sens'      ?'Run Sensitivity Analysis':
    m==='mc'        ?'Run Monte Carlo':
                      'Load Validation Data';
}

function selectMat(el){
  document.querySelectorAll('.mat-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active'); selMat=el.dataset.mat;
}

function toggleEq(panelId,caretId){
  const p=document.getElementById(panelId),c=document.getElementById(caretId);
  c.classList.toggle('open',p.classList.toggle('open'));
}

function showSensTab(mat,el){
  document.querySelectorAll('.sub-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('sensTable2024').style.display=mat==='2024-T3'?'block':'none';
  document.getElementById('sensTable7075').style.display=mat==='7075-T6'?'block':'none';
}

function showErr(m){const e=document.getElementById('errorMsg');e.textContent=m;e.classList.add('show');}
function clearErr(){document.getElementById('errorMsg').classList.remove('show');}
function setLoad(on){document.getElementById('loadingOverlay').classList.toggle('show',on);document.getElementById('runBtn').disabled=on;}

// ══ RUN ══
async function runSim(){
  clearErr();
  if(mode==='validation'){
    setLoad(true);
    try{
      const r=await fetch('/api/validation');
      const d=await r.json();
      if(!r.ok||d.error){showErr(d.error||'Request failed.');return;}
      lastValidation=d; renderValidation(d);
    }catch(e){showErr('Connection error. Is Flask running? Try: python app.py');}
    finally{setLoad(false);}
    return;
  }
  const stress=parseFloat(document.getElementById('stress').value);
  const crack=parseFloat(document.getElementById('crack').value);
  const flights=parseFloat(document.getElementById('flights').value);
  if(!stress||stress<=0)   return showErr('Stress must be greater than 0 MPa.');
  if(!crack||crack<=0)     return showErr('Initial crack must be greater than 0.');
  if(!flights||flights<=0) return showErr('Flights per day must be at least 1.');
  setLoad(true);
  sensInputs={crack,flights};
  try{
    let url, body;
    if(mode==='single'){
      url='/simulate'; body={material:selMat,stress,initial_crack:crack,flights_per_day:flights};
    } else if(mode==='compare'){
      url='/compare';  body={stress,initial_crack:crack,flights_per_day:flights};
    } else if(mode==='mc'){
      url='/api/monte_carlo'; body={material:selMat,stress,initial_crack:crack,flights_per_day:flights};
    } else {
      url='/sensitivity'; body={initial_crack:crack,flights_per_day:flights};
    }
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok||d.error){showErr(d.error||'Request failed.');return;}
    if(mode==='single'){lastSingle=d;renderSingle(d);}
    else if(mode==='compare'){lastCompare=d;renderCompare(d);}
    else if(mode==='mc'){lastMC=d;renderMonteCarlo(d);}
    else{lastSens=d;renderSensitivity(d);}
  }catch(e){showErr('Connection error. Is Flask running? Try: python app.py');}
  finally{setLoad(false);}
}

// ══ FORMAT ══
function fmt(n){
  if(n>=1e9) return(n/1e9).toFixed(2)+'B';
  if(n>=1e6) return(n/1e6).toFixed(2)+'M';
  if(n>=1e3) return(n/1e3).toFixed(1)+'K';
  return Number(n).toLocaleString();
}

// ══ BASE CHART OPTIONS ══
function baseOpts(color,xLabel,yLabel,xFmt,ttFmt){
  return{
    responsive:true, maintainAspectRatio:false,
    animation:{duration:600,easing:'easeOutQuart'},
    plugins:{
      legend:{labels:{color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:11},boxWidth:10}},
      tooltip:{
        backgroundColor:tv('--tt-bg'),borderColor:tv('--tt-border'),borderWidth:1,
        titleColor:color||tv('--chart-tick'),bodyColor:tv('--ink2'),
        titleFont:{family:"'IBM Plex Mono'",size:11},bodyFont:{family:"'IBM Plex Mono'",size:11},
        padding:12, callbacks:ttFmt||{}
      }
    },
    scales:{
      x:{
        ticks:{
          color:tv('--chart-tick'),
          font:{family:"'IBM Plex Mono'",size:10},
          maxTicksLimit:6,
          callback:function(value){
            const n = extractTickNumber(value);
            if(!isFinite(n)) return '';
            return xFmt ? xFmt(n) : String(n);
          }
        },
        grid:{color:tv('--chart-grid')},
        title:{display:!!xLabel,text:xLabel||'',color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},padding:{top:8}}
      },
      y:{
        ticks:{color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10}},
        grid:{color:tv('--chart-grid')},
        title:{display:!!yLabel,text:yLabel||'',color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},padding:{bottom:8}}
      }
    }
  };
}

// ══ ANIMATE CRACK GROWTH ══
function animateCrack(chart, datasetArrays){
  const saved = datasetArrays.map(arr => arr.slice());
  const maxLen = Math.max(...saved.map(arr => arr.length));
  if(maxLen < 2) return;

  chart.data.datasets.forEach((ds, i) => {
    ds.data = saved[i].map(pt => {
      if (pt && typeof pt === 'object') return { x: pt.x, y: null };
      return null;
    });
  });
  chart.update('none');

  const frames   = 60;
  const perFrame = Math.max(1, Math.ceil(maxLen / frames));
  let idx = 0;

  const timer = setInterval(() => {
    chart.data.datasets.forEach((ds, i) => {
      for(let j = 0; j < perFrame && idx + j < saved[i].length; j++){
        ds.data[idx + j] = saved[i][idx + j];
      }
    });
    chart.update('none');
    idx += perFrame;
    if(idx >= maxLen) clearInterval(timer);
  }, 20);
}

// ══ RENDER SINGLE ══
function renderSingle(data){
  document.getElementById('placeholder').style.display='none';
  document.getElementById('results-single').style.display='flex';

  const color=COLORS[data.material_key]||COLORS['2024-T3'];
  const sc=getStatusCfg(data);

  const yw=document.getElementById('yieldWarnEl');
  if(data.yield_warning){yw.style.display='block';yw.textContent=data.stress_category;}
  else yw.style.display='none';

  const sce=document.getElementById('stressCatEl');
  const scCls=data.yield_warning?'sc-extreme':data.stress_max<=150?'sc-normal':'sc-high';
  sce.style.display='block';
  sce.innerHTML=`<span class="stress-cat ${scCls}">${data.stress_category}</span>`;

  document.getElementById('metricsGrid').innerHTML=`
    <div class="metric">
      <div class="m-label">Total Cycles</div>
      <div class="m-val ${data.cycles>9999999?'sm':''}">${fmt(data.cycles)}</div>
      <div class="m-unit">to failure</div>
    </div>
    <div class="metric">
      <div class="m-label">Safe Life (SF=2)</div>
      <div class="m-val ${data.years>9999?'sm':''}">${fmt(Math.round(data.years))}</div>
      <div class="m-unit">years</div>
    </div>
    <div class="metric">
      <div class="m-label">Critical Crack a_c</div>
      <div class="m-val">${data.critical_length_mm}</div>
      <div class="m-unit">mm</div>
    </div>
    <div class="metric">
      <div class="m-label">Status</div>
      <div style="margin-top:10px;"><span class="s-tag ${sc.tagCls}">${sc.prefix} ${sc.label}</span></div>
    </div>`;

  document.getElementById('infoGrid').innerHTML=`
    <div class="info-card">
      <div class="info-card-label">Safe Cycles (N/2)</div>
      <div class="info-card-val">${fmt(data.safe_cycles)}</div>
      <div class="info-card-unit">${fmt(data.cycles)} ÷ 2</div>
    </div>
    <div class="info-card">
      <div class="info-card-label">Inspection Interval</div>
      <div class="info-card-val">${fmt(data.inspection_cycles)}</div>
      <div class="info-card-unit">every ${data.inspection_years} yrs</div>
    </div>
    <div class="info-card">
      <div class="info-card-label">Effective Δσ</div>
      <div class="info-card-val">${data.delta_sigma} MPa</div>
      <div class="info-card-unit">σ_max × (1−R=0.1)</div>
    </div>
    <div class="info-card">
      <div class="info-card-label">Y at a₀</div>
      <div class="info-card-val">${data.Y_initial}</div>
      <div class="info-card-unit">rivet hole model</div>
    </div>
    <div class="info-card">
      <div class="info-card-label">Raw Life</div>
      <div class="info-card-val">${fmt(Math.round(data.years_raw))}</div>
      <div class="info-card-unit">yrs before SF applied</div>
    </div>
    <div class="info-card">
      <div class="info-card-label">Crack Range</div>
      <div class="info-card-val">${data.initial_crack_mm}→${data.critical_length_mm}</div>
      <div class="info-card-unit">mm · K_IC=${data.K_IC} MPa√m</div>
    </div>`;

  const sb=document.getElementById('statusBar');
  sb.className=`status-bar reveal ${sc.barCls}`;
  sb.innerHTML=`<strong>${sc.prefix} ${sc.label}</strong>${data.status_message}<span class="rec">${sc.rec}</span>`;

  const pill=document.getElementById('matPill');
  pill.textContent=data.material;
  pill.style.cssText=`color:${color};background:${color}14;border-color:${color}38;`;

  if(chartInst) chartInst.destroy();
  const ctx=document.getElementById('crackChart').getContext('2d');
  const grad=ctx.createLinearGradient(0,0,0,260);
  grad.addColorStop(0,color+'28'); grad.addColorStop(1,color+'00');
  const pointsSingle = data.cycle_list.map((n,i)=>({x:n, y:data.crack_list[i]}));
  const opts=baseOpts(color,
    'Number of Cycles  N','Crack Length  a (mm)',
    v=>fmt(v),
    {title:c=>`Cycle ${fmt(extractTickNumber(c[0].parsed.x))}`,label:c=>` Crack: ${Number(c[0].parsed.y).toFixed(3)} mm`}
  );
  opts.scales.x.type='linear';
  opts.scales.x.min=0;
  chartInst=new Chart(ctx,{type:'line',data:{
    datasets:[{label:data.material,data:pointsSingle,borderColor:color,borderWidth:2,pointRadius:0,tension:0.35,fill:true,backgroundColor:grad}]
  },options:opts});
  animateCrack(chartInst, [pointsSingle]);

  const m_val = data.material_key==='2024-T3'?2.60:2.947;
  document.getElementById('insightList').innerHTML=[
    `At σ_max = ${data.stress_max} MPa, effective stress range Δσ = ${data.delta_sigma} MPa (R=0.1 applied). The rivet hole geometry factor Y = ${data.Y_initial} at a₀ = ${data.initial_crack_mm} mm concentrates local stress — significantly higher than the far-field value of Y=1.12. Crack must grow ${data.initial_crack_mm} → ${data.critical_length_mm} mm before fracture.`,
    data.years<10
      ? `Safe service life of ${data.years} years is critically short. Reducing σ_max by 15% would extend fatigue life by approximately ${Math.round(1/Math.pow(0.85,m_val))}× due to Paris Law nonlinearity (m = ${m_val}).`
      : `Safe service life of ${data.years} years is adequate for typical aircraft service. Scatter factor of 2.0 retires the structure at half its predicted raw life of ${data.years_raw} years.`,
    `Inspection every ${fmt(data.inspection_cycles)} cycles (${data.inspection_years} years) follows the 1/3-life rule — ensuring detection at no more than 1/3 of propagation life, per ICAO damage tolerance principles.`
  ].map(t=>`<div class="insight-item"><span class="insight-bullet">→</span><span>${t}</span></div>`).join('');
}

// ══ RENDER COMPARE ══
function renderCompare(data){
  document.getElementById('placeholder').style.display='none';
  document.getElementById('results-compare').style.display='flex';

  const mats=Object.keys(data);
  const d0=data[mats[0]], d1=data[mats[1]];

  const datasets = mats.map(mat=>{
    const d=data[mat],col=COLORS[mat];
    const pts = d.cycle_list.map((n,i)=>({x:n, y:d.crack_list[i]}));
    return{label:d.material,data:pts,borderColor:col,borderWidth:2,pointRadius:0,tension:0.35,fill:false};
  });

  if(compareChartInst) compareChartInst.destroy();
  const ctx=document.getElementById('compareChart').getContext('2d');
  const opts=baseOpts(null,
    'Number of Cycles  N','Crack Length  a (mm)',
    v=>fmt(v),
    {title:c=>`Cycle ${fmt(extractTickNumber(c[0].parsed.x))}`,label:c=>` ${c.dataset.label}: ${Number(c[0].parsed.y).toFixed(3)} mm`}
  );
  opts.scales.x.type='linear';
  opts.scales.x.min=0;
  compareChartInst=new Chart(ctx,{type:'line',data:{datasets},options:opts});
  animateCrack(compareChartInst, datasets.map(d=>d.data));

  const w=(a,b,hi=true)=>hi?(a>b?0:1):(a<b?0:1);
  const rows=[
    ['Total Cycles',       fmt(d0.cycles),                  fmt(d1.cycles),               w(d0.cycles,d1.cycles)],
    ['Safe Life (yrs)',    `${fmt(Math.round(d0.years))}`,  `${fmt(Math.round(d1.years))}`,w(d0.years,d1.years)],
    ['Safe Cycles',        fmt(d0.safe_cycles),             fmt(d1.safe_cycles),           w(d0.safe_cycles,d1.safe_cycles)],
    ['Insp. Interval',     fmt(d0.inspection_cycles)+' cyc',fmt(d1.inspection_cycles)+' cyc',w(d0.inspection_cycles,d1.inspection_cycles)],
    ['Critical Crack',     d0.critical_length_mm+' mm',     d1.critical_length_mm+' mm',  w(d0.critical_length_mm,d1.critical_length_mm)],
    ['Y at a₀',           d0.Y_initial,                    d1.Y_initial,                  w(d0.Y_initial,d1.Y_initial,false)],
    ['K_IC (MPa√m)',       d0.K_IC,                         d1.K_IC,                       w(d0.K_IC,d1.K_IC)],
    ['σ_y (MPa)',          d0.sigma_y,                      d1.sigma_y,                    w(d0.sigma_y,d1.sigma_y)],
  ];
  const better=d0.cycles>d1.cycles?mats[0]:mats[1];
  const ratio=Math.round(Math.max(d0.cycles,d1.cycles)/Math.min(d0.cycles,d1.cycles));
  document.getElementById('compareTable').innerHTML=`
    <thead><tr>
      <th>Parameter</th>
      <th style="color:${COLORS[mats[0]]}">${mats[0]}</th>
      <th style="color:${COLORS[mats[1]]}">${mats[1]}</th>
    </tr></thead>
    <tbody>
      ${rows.map(([l,v0,v1,wi])=>`<tr><td>${l}</td><td class="${wi===0?'winner':''}">${v0}</td><td class="${wi===1?'winner':''}">${v1}</td></tr>`).join('')}
      <tr><td><strong>Verdict</strong></td>
          <td colspan="2" style="color:var(--ok);font-weight:600;">
            ${better} lasts ${ratio}× longer. Higher tensile strength ≠ better fatigue resistance — Paris coefficient C governs crack speed.
          </td></tr>
    </tbody>`;

  document.getElementById('compareInsightList').innerHTML=[
    `AA2024-T3 achieves ${fmt(d0.cycles)} cycles vs AA7075-T6 at ${fmt(d1.cycles)} cycles under identical conditions. Although AA7075-T6 has higher yield strength (469 vs 332 MPa), its Paris coefficient C = 5.27×10⁻¹⁰ is ${(5.27/1.44).toFixed(1)}× larger than 2024-T3's, driving proportionally faster crack growth.`,
    `Critical crack lengths differ: 2024-T3 reaches failure at ${d0.critical_length_mm} mm, 7075-T6 at ${d1.critical_length_mm} mm. This reflects their fracture toughness values — K_IC = ${d0.K_IC} vs ${d1.K_IC} MPa√m. Higher K_IC allows the crack to grow larger before catastrophic fracture, extending the propagation phase.`
  ].map(t=>`<div class="insight-item"><span class="insight-bullet">→</span><span>${t}</span></div>`).join('');
}

// ══ RENDER SENSITIVITY ══
function renderSensitivity(data){
  document.getElementById('placeholder').style.display='none';
  document.getElementById('results-sens').style.display='flex';

  if(sensChartInst) sensChartInst.destroy();
  const ctx=document.getElementById('sensChart').getContext('2d');
  const opts=baseOpts(null,
    'Applied Stress σ_max (MPa)','Total Cycles to Failure  N',
    null,
    {title:c=>`σ = ${c[0].parsed.x} MPa`,label:c=>` ${c.dataset.label}: ${fmt(c.parsed.y)} cycles`}
  );
  opts.scales.x.type='linear';
  opts.scales.x.ticks={color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},stepSize:20};
  opts.scales.y.ticks={color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},callback:v=>fmt(v)};

  sensChartInst=new Chart(ctx,{type:'line',data:{datasets:
    Object.entries(data).map(([mat,rows])=>{
      const col=COLORS[mat];
      return{label:mat,data:rows.map(r=>({x:r.stress,y:r.cycles})),
        borderColor:col,backgroundColor:col+'18',borderWidth:2.5,
        pointRadius:4,pointHoverRadius:6,fill:false,tension:0.3};
    })
  },options:opts});

  ['2024-T3','7075-T6'].forEach(mat=>{
    const rows=data[mat]||[];
    const elId=mat==='2024-T3'?'sensTable2024':'sensTable7075';
    const col=COLORS[mat];
    document.getElementById(elId).innerHTML=`
      <table class="sens-table">
        <thead><tr>
          <th>Stress (MPa)</th><th>Total Cycles</th><th>Safe Cycles</th>
          <th>Inspect (cycles)</th><th>Safe Life (yrs)</th><th>a_c (mm)</th>
        </tr></thead>
        <tbody>${rows.map(r=>`
          <tr class="${r.yield_warning?'r-crit':r.years<5?'r-warn':''}">
            <td style="color:${col}">${r.stress}</td>
            <td>${fmt(r.cycles)}</td>
            <td>${fmt(r.safe_cycles)}</td>
            <td>${fmt(r.inspection_cycles)}</td>
            <td>${r.years}</td>
            <td>${r.critical_length_mm}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  });

  const rows24=data['2024-T3']||[],rows75=data['7075-T6']||[];
  const lo=rows24[0],hi=rows24[rows24.length-1];
  const ratio=lo&&hi?Math.round(lo.cycles/hi.cycles):0;
  const mid24=rows24.find(r=>r.stress===120)||rows24[Math.floor(rows24.length/2)];
  const mid75=rows75.find(r=>r.stress===120)||rows75[Math.floor(rows75.length/2)];
  const xRatio=mid24&&mid75?Math.round(mid24.cycles/mid75.cycles):0;
  const shortLife=rows24.filter(r=>r.years<5);
  document.getElementById('sensInsightList').innerHTML=[
    lo&&hi?`Stress sensitivity for AA2024-T3: increasing σ_max from ${lo.stress} to ${hi.stress} MPa reduces fatigue life by ${ratio}×. This steep relationship reflects Paris exponent m = 2.60 — small stress increases cause disproportionately large drops in cycle life.`:'',
    mid24&&mid75?`At σ = 120 MPa: AA2024-T3 achieves ${fmt(mid24.cycles)} cycles vs AA7075-T6 at ${fmt(mid75.cycles)} cycles (${xRatio}× difference). Despite lower tensile strength, 2024-T3 resists crack growth better because its Paris C is ${(5.27/1.44).toFixed(1)}× smaller.`:'',
    shortLife.length>0?`AA2024-T3 safe life drops below 5 years above σ = ${shortLife[0].stress} MPa. In this range, inspection intervals must be drastically shortened and structural reassessment is mandatory before continued operation.`:''
  ].filter(Boolean).map(t=>`<div class="insight-item"><span class="insight-bullet">→</span><span>${t}</span></div>`).join('');
}

// ══ RENDER VALIDATION ══
function renderValidation(data){
  document.getElementById('placeholder').style.display='none';
  document.getElementById('results-validation').style.display='flex';

  if(validationChartInst) validationChartInst.destroy();
  const ctx=document.getElementById('validationChart').getContext('2d');

  const modelSets=Object.entries(data.model_curves).map(([mat,curve])=>({
    label:`${mat} model`,
    data:curve.delta_K.map((x,i)=>({x,y:curve.da_dN[i]})),
    borderColor:COLORS[mat]||'#888',borderWidth:2,pointRadius:0,
    showLine:true,fill:false,tension:0
  }));

  const dataSets=Object.entries(data.nasa_points).map(([mat,pts])=>{
    const modelMat=mat==='2024-T351'?'2024-T3':mat;
    return{
      label:`NASA ${mat} (Forth et al. 2005)`,
      data:pts.delta_K.map((x,i)=>({x,y:pts.da_dN[i]})),
      borderColor:COLORS[modelMat]||'#888',backgroundColor:COLORS[modelMat]||'#888',
      pointRadius:6,pointHoverRadius:8,pointStyle:'triangle',showLine:false
    };
  });

  const opts={
    responsive:true,maintainAspectRatio:false,
    animation:{duration:600,easing:'easeOutQuart'},
    plugins:{
      legend:{
        labels:{
          color:tv('--chart-tick'),
          font:{family:"'IBM Plex Mono'",size:11},
          boxWidth:10,
          usePointStyle:true
        }
      },
      tooltip:{
        backgroundColor:tv('--tt-bg'),borderColor:tv('--tt-border'),borderWidth:1,
        titleColor:tv('--chart-tick'),bodyColor:tv('--ink2'),
        titleFont:{family:"'IBM Plex Mono'",size:11},bodyFont:{family:"'IBM Plex Mono'",size:11},
        padding:12,
        callbacks:{label:c=>` ${c.dataset.label}: ΔK=${c.parsed.x.toFixed(2)}, da/dN=${c.parsed.y.toExponential(2)}`}
      }
    },
    scales:{
      x:{
        type:'logarithmic',min:8,max:35,
        ticks:{color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10}},
        grid:{color:tv('--chart-grid')},
        title:{display:true,text:'ΔK (MPa√m)',color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},padding:{top:8}}
      },
      y:{
        type:'logarithmic',min:1e-7,max:1e-5,
        ticks:{
          color:tv('--chart-tick'),
          font:{family:"'IBM Plex Mono'",size:10},
          callback: logLabel
        },
        grid:{
          color: (ctx) => {
            const v = ctx.tick && ctx.tick.value;
            if(v){
              const exp = Math.log10(v);
              if(Math.abs(exp - Math.round(exp)) > 0.001) return 'transparent';
            }
            return tv('--chart-grid');
          }
        },
        title:{display:true,text:'da/dN (m/cycle)',color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},padding:{bottom:8}}
      }
    }
  };

  validationChartInst=new Chart(ctx,{type:'scatter',data:{datasets:[...modelSets,...dataSets]},options:opts});

  const s=data.validation_summary;
  document.getElementById('validationSummary').innerHTML=Object.entries(s).map(([mat,m])=>
    `<div class="insight-item"><span class="insight-bullet">→</span><span><strong>${mat}</strong> (specimen ${m.specimen}, ${m.n_points} pts vs ${m.model_material} model): mean model/NASA ratio = ${m.mean_model_to_nasa_ratio}× · ${m.pct_within_factor_2}% within a factor of 2. Source: ${m.source}.</span></div>`
  ).join('');
}

// ══ RENDER MONTE CARLO ══
function renderMonteCarlo(data){
  document.getElementById('placeholder').style.display='none';
  document.getElementById('results-mc').style.display='flex';

  const color=COLORS[data.material_key]||COLORS['2024-T3'];

  if(mcChartInst) mcChartInst.destroy();
  const ctx=document.getElementById('mcChart').getContext('2d');

  const labels=data.histogram.map(h=>Math.round(h.bin_mid));
  const counts=data.histogram.map(h=>h.count);

  const grad=ctx.createLinearGradient(0,0,0,300);
  grad.addColorStop(0,color+'cc'); grad.addColorStop(1,color+'44');

  const opts={
    responsive:true, maintainAspectRatio:false,
    animation:{duration:600,easing:'easeOutQuart'},
    plugins:{
      legend:{display:false},
      tooltip:{
        backgroundColor:tv('--tt-bg'),borderColor:tv('--tt-border'),borderWidth:1,
        titleColor:tv('--chart-tick'),bodyColor:tv('--ink2'),
        titleFont:{family:"'IBM Plex Mono'",size:11},bodyFont:{family:"'IBM Plex Mono'",size:11},
        padding:12,
        callbacks:{
          title:c=>`Life ≈ ${fmt(Number(c[0].label))} cycles`,
          label:c=>` ${c.parsed.y} of ${data.n_runs} runs`
        }
      }
    },
    scales:{
      x:{
        ticks:{
          color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},maxTicksLimit:8,
          callback:function(value){
            const label=this.getLabelForValue(value);
            const n = extractTickNumber(label);
            if(!isFinite(n)) return '';
            return fmt(n);
          }
        },
        grid:{color:tv('--chart-grid')},
        title:{display:true,text:'Fatigue Life (cycles)',color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},padding:{top:8}}
      },
      y:{
        ticks:{color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10}},
        grid:{color:tv('--chart-grid')},
        title:{display:true,text:'Frequency (runs)',color:tv('--chart-tick'),font:{family:"'IBM Plex Mono'",size:10},padding:{bottom:8}}
      }
    }
  };

  mcChartInst=new Chart(ctx,{type:'bar',data:{
    labels:labels,
    datasets:[{label:'Simulated lives',data:counts,backgroundColor:grad,borderColor:color,borderWidth:1}]
  },options:opts});

  document.getElementById('mcMetrics').innerHTML=`
    <div class="metric">
      <div class="m-label">Mean Life</div>
      <div class="m-val">${fmt(Math.round(data.mean))}</div>
      <div class="m-unit">cycles</div>
    </div>
    <div class="metric">
      <div class="m-label">Median Life</div>
      <div class="m-val">${fmt(Math.round(data.median))}</div>
      <div class="m-unit">cycles</div>
    </div>
    <div class="metric">
      <div class="m-label">P5 Safe Life</div>
      <div class="m-val">${fmt(Math.round(data.p5))}</div>
      <div class="m-unit">95% survival</div>
    </div>
    <div class="metric">
      <div class="m-label">P5 / Mean</div>
      <div class="m-val">${(data.p5/data.mean).toFixed(3)}</div>
      <div class="m-unit">conservatism ratio</div>
    </div>`;

  const meanY = data.mean / (sensInputs.flights * 365);
  const p5Y   = data.p5   / (sensInputs.flights * 365);
  document.getElementById('mcInsight').innerHTML=[
    `The Monte Carlo simulation runs ${data.n_runs} full crack-growth integrations, each with a different value of the Paris coefficient C sampled from a log-normal distribution (COV = ${data.cov_input}). This represents batch-to-batch material variability measured by Bogdanov (2014) for these alloys.`,
    `Mean life = ${fmt(Math.round(data.mean))} cycles (${meanY.toFixed(1)} years at ${sensInputs.flights} flights/day). The P5 life = ${fmt(Math.round(data.p5))} cycles (${p5Y.toFixed(1)} years) — meaning 95% of simulated specimens survive at least this long. This is the probabilistic safe life, more conservative than the deterministic scatter-factor approach.`,
    `The P5/mean ratio of ${(data.p5/data.mean).toFixed(3)} is consistent with the expected value for a log-normal distribution with COV = ${data.cov_input}. The histogram shows a right-skewed distribution, as expected for fatigue lives.`
  ].map(t=>`<div class="insight-item"><span class="insight-bullet">→</span><span>${t}</span></div>`).join('');
}

// ══ PDF REPORT EXPORT ══
async function exportPDFReport(tabId, btnEl){
  const panels = {
    single:     { el: 'results-single',     title: 'Fatigue Life Assessment Report',          file: 'Single' },
    compare:    { el: 'results-compare',    title: 'Material Comparison Report',              file: 'Compare' },
    sens:       { el: 'results-sens',       title: 'Sensitivity Analysis Report',             file: 'Sensitivity' },
    validation: { el: 'results-validation', title: 'NASA Validation Report',                  file: 'Validation' },
    mc:         { el: 'results-mc',         title: 'Monte Carlo Probabilistic Assessment',    file: 'MonteCarlo' }
  };

  const cfg = panels[tabId];
  if(!cfg){ alert('Unknown tab for PDF export.'); return; }

  const panel = document.getElementById(cfg.el);
  if(!panel || panel.style.display === 'none'){
    alert('Run the analysis first, then export the report.');
    return;
  }

  const btn = btnEl || null;
  const origText = btn ? btn.textContent : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Generating…'; }

  const hiddenBtns = panel.querySelectorAll('.btn-export');
  hiddenBtns.forEach(b => b.style.visibility = 'hidden');

  const originalTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'light');
  await new Promise(r => setTimeout(r, 150));

  const scalesToTry = [2, 1.5, 1];
  let canvas = null;
  let lastErr = null;

  for(const scale of scalesToTry){
    try {
      canvas = await html2canvas(panel, {
        backgroundColor: '#ffffff',
        scale: scale,
        logging: false,
        useCORS: true,
        imageTimeout: 15000,
        removeContainer: true,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.setAttribute('data-theme', 'light');
        }
      });
      if(canvas.width > 12000 || canvas.height > 12000){
        throw new Error('Canvas too large at scale ' + scale);
      }
      break;
    } catch(err){
      lastErr = err;
      canvas = null;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  hiddenBtns.forEach(b => b.style.visibility = '');

  if(originalTheme){
    document.documentElement.setAttribute('data-theme', originalTheme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  if(!canvas){
    if(btn && origText){ btn.disabled = false; btn.textContent = origText; }
    alert('PDF export failed: canvas too large. Try hiding the chart or using the CSV export. Details: ' + (lastErr ? lastErr.message : 'unknown'));
    return;
  }

  try {
    const imgData = canvas.toDataURL('image/jpeg', 0.85);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;

    pdf.setFillColor(26, 86, 219);
    pdf.rect(0, 0, pageW, 22, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('AeroDTA', margin, 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Aerospace Damage Tolerance Assessment', margin, 17);
    pdf.setFontSize(8);
    pdf.text(new Date().toLocaleString(), pageW - margin, 17, { align: 'right' });

    pdf.setTextColor(20, 20, 20);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text(cfg.title, margin, 33);

    let yTop = 40;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(80, 80, 80);

    if(tabId === 'single' && lastSingle){
      const d = lastSingle;
      pdf.text(
        `Material: ${d.material}   |   σ_max = ${d.stress_max} MPa   |   a₀ = ${d.initial_crack_mm} mm   |   ${d.flights_per_day} flights/day   |   R = 0.1`,
        margin, 40
      );
      yTop = 46;
    } else if(tabId === 'mc' && lastMC){
      const d = lastMC;
      pdf.text(
        `Material: ${d.material}   |   σ_max = ${d.stress_max} MPa   |   a₀ = ${d.initial_crack_mm} mm   |   N runs = ${d.n_runs}`,
        margin, 40
      );
      yTop = 46;
    } else if(tabId === 'compare' && lastCompare){
      const keys = Object.keys(lastCompare);
      const d = lastCompare[keys[0]];
      pdf.text(
        `Materials: ${keys.join(' vs ')}   |   σ_max = ${d.stress_max} MPa   |   a₀ = ${d.initial_crack_mm} mm   |   ${d.flights_per_day} flights/day`,
        margin, 40
      );
      yTop = 46;
    } else if(tabId === 'sens' && sensInputs.crack){
      pdf.text(
        `Initial crack: ${(sensInputs.crack * 1000).toFixed(2)} mm   |   ${sensInputs.flights} flights/day   |   Sweep: 80–250 MPa   |   Both alloys`,
        margin, 40
      );
      yTop = 46;
    } else if(tabId === 'validation'){
      pdf.text(
        `Validation source: Forth et al. (2005), NASA/TM-2005-213907   |   R = 0.1   |   Lab air, room temperature`,
        margin, 40
      );
      yTop = 46;
    }

    const imgW = pageW - 2 * margin;
    const imgH = (canvas.height / canvas.width) * imgW;
    const maxH = pageH - yTop - 18;
    const renderH = Math.min(imgH, maxH);
    pdf.addImage(imgData, 'JPEG', margin, yTop, imgW, renderH);

    pdf.setFontSize(7);
    pdf.setTextColor(140, 140, 140);
    pdf.text(
      'Generated by AeroDTA — Paris Law + LEFM + Monte Carlo. Geometry factor: Tada et al. (2000). ' +
      'Material constants: Li et al. (2024), Fageehi & Alshoaibi (2025). ' +
      'This report is a preliminary damage tolerance assessment, not a certification document.',
      margin, pageH - 8,
      { maxWidth: pageW - 2 * margin }
    );

    pdf.save(`AeroDTA_${cfg.file}_${new Date().toISOString().slice(0,10)}.pdf`);
  } catch(err) {
    console.error('PDF export error:', err);
    alert('PDF export failed: ' + err.message + '\n\nYou can still use the CSV export as a fallback.');
  } finally {
    if(btn && origText){ btn.disabled = false; btn.textContent = origText; }
  }
}

// ══ CSV EXPORT ══
function dl(csv,name){
  const b=new Blob([csv],{type:'text/csv'});
  const u=URL.createObjectURL(b);
  const a=document.createElement('a');
  a.href=u; a.download=name; a.click(); URL.revokeObjectURL(u);
}
function toCSV(rows,comment){
  const h=Object.keys(rows[0]);
  return [`# AeroDTA — ${new Date().toLocaleString()}`,comment||'','',h.join(','),
    ...rows.map(r=>h.map(k=>r[k]).join(','))].filter(l=>l!==undefined).join('\n');
}

function exportSingleCSV(){
  if(!lastSingle){alert('Run a simulation first.');return;}
  const d=lastSingle;
  dl(toCSV([{Material:d.material,Stress_MPa:d.stress_max,Initial_Crack_mm:d.initial_crack_mm,
    Flights_day:d.flights_per_day,Total_Cycles:d.cycles,Safe_Cycles:d.safe_cycles,
    Inspection_Cycles:d.inspection_cycles,Safe_Life_years:d.years,
    Inspection_years:d.inspection_years,Critical_Crack_mm:d.critical_length_mm,Status:d.status}]),
  `AeroDTA_Single_${d.material_key}_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportCompareCSV(){
  if(!lastCompare){alert('Run a comparison first.');return;}
  const rows=Object.values(lastCompare).map(d=>({Material:d.material,Stress_MPa:d.stress_max,
    Initial_Crack_mm:d.initial_crack_mm,Flights_day:d.flights_per_day,
    Total_Cycles:d.cycles,Safe_Cycles:d.safe_cycles,Inspection_Cycles:d.inspection_cycles,
    Safe_Life_years:d.years,Critical_Crack_mm:d.critical_length_mm,Status:d.status}));
  dl(toCSV(rows,`# Compare — crack ${(sensInputs.crack*1000).toFixed(2)}mm`),
    `AeroDTA_Compare_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportSensCSV(){
  if(!lastSens){alert('Run sensitivity analysis first.');return;}
  const rows=[];
  Object.entries(lastSens).forEach(([mat,matRows])=>matRows.forEach(r=>rows.push({
    Material:mat,Stress_MPa:r.stress,Initial_Crack_mm:(sensInputs.crack*1000).toFixed(2),
    Flights_day:sensInputs.flights,Total_Cycles:r.cycles,Safe_Cycles:r.safe_cycles,
    Inspection_Cycles:r.inspection_cycles,Safe_Life_years:r.years,
    Inspection_years:r.inspection_years,Critical_Crack_mm:r.critical_length_mm,Status:r.status})));
  dl(toCSV(rows,'# Sensitivity sweep 80–250 MPa'),
    `AeroDTA_Sensitivity_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportMCCSV(){
  if(!lastMC){alert('Run a Monte Carlo simulation first.');return;}
  const d=lastMC;
  dl(toCSV([{Material:d.material_key,Stress_MPa:d.stress_max,Initial_Crack_mm:d.initial_crack_mm,
    N_Runs:d.n_runs,Mean_cycles:Math.round(d.mean),Median_cycles:Math.round(d.median),
    P5_cycles:Math.round(d.p5),COV:d.cov_input}],'# Monte Carlo summary'),
    `AeroDTA_MonteCarlo_${d.material_key}_${new Date().toISOString().slice(0,10)}.csv`);
}
