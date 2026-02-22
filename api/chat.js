/*
  api_chat.js — LAILA SUPREME
  Full, tuned, self-contained Node/Express API for the "Laila" strategic assistant.

  Features:
  - /api/chat POST endpoint that handles actions: strategy, mirror, simulate, reportError, getReport
  - Lightweight heuristics (same spirit as index.html) so it works offline without OpenAI
  - Optional OpenAI integration (set OPENAI_API_KEY) for richer natural-language responses
  - Simple file-based persistence (data stored in ./data/laila_db.json and ./data/laila_errors.json)
  - Rate limiting, CORS, basic security headers
  - Clear JSON responses ready to be consumed by a frontend (like your index.html)

  How to run:
  1) npm init -y
  2) npm i express node-fetch express-rate-limit helmet cors
  3) node api_chat.js
  4) Server runs on PORT (default 3000)

  Example request:
    POST http://localhost:3000/api/chat
    Content-Type: application/json
    Body: { "action":"strategy", "text":"Vou enviar aquele e-mail arriscado pra chefe" }
*/

const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const fetch = require('node-fetch');

// --- Config ---
const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'laila_db.json');
const ERR_FILE = path.join(DB_DIR, 'laila_errors.json');
const OPENAI_KEY = process.env.OPENAI_API_KEY || null; // optional

// Ensure data folder exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ actions: [], notes: [], vulns: [], shadowEnabled: true }, null, 2));
if (!fs.existsSync(ERR_FILE)) fs.writeFileSync(ERR_FILE, JSON.stringify([], null, 2));

function readDB() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}'); }
function writeDB(obj) { fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2)); }
function readErrors() { return JSON.parse(fs.readFileSync(ERR_FILE, 'utf8') || '[]'); }
function writeErrors(arr) { fs.writeFileSync(ERR_FILE, JSON.stringify(arr, null, 2)); }

// --- Utilities ---
function nowTS(){ return Date.now(); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function safeStr(s){ return (s||'').toString().trim(); }

// Simple heuristic analyzer (mirrors index.html heuristics)
function analyzeTextShort(text){
  const t = (text||'').toLowerCase();
  const keywordsConf = ['certeza','certezas','confiante','com certeza','tenho certeza','vamo','vou'];
  const keywordsRisk = ['arrisc','perder','pagar','apostar','apress','urgente','agora'];
  const keywordsEmo = ['raiva','ódio','revolt','frustr','fury','hate'];
  return {
    confidence: keywordsConf.some(k=>t.includes(k)),
    risk: keywordsRisk.some(k=>t.includes(k)),
    emotion: keywordsEmo.some(k=>t.includes(k))
  };
}

function mirrorAssessment(text){
  const t = (text||'').toLowerCase();
  if(!t) return 'Entrada vazia — descreva claramente o plano antes de executar.';
  if(t.length < 12) return 'Frase curta — possível impulso. Elaborar mais antes de agir.';
  if(t.includes('vou') && t.includes('agora')) return 'Empolgação detectada — reveja timing.';
  if(t.includes('certo') || t.includes('certeza')) return 'Confiança alta — verifique redundância e vieses. Você tende a confirmar hipóteses já escolhidas.';
  if(t.includes('arrisc')) return 'Reconhece risco — mas não confunda coragem com planejamento. Teste controlado primeiro.';
  return 'Análise normal. Cuidado com excesso de otimismo e com subestimação do fator humano.';
}

// Simulators
function simulateConflict(input){
  return {
    title: 'Simulação de Conflito',
    input,
    options: [
      { label:'Desescalada', prob:0.48, steps:['Recuar uma etapa','Usar linguagem de baixa carga emocional','Documentar pontos principais'] },
      { label:'Controle da narrativa', prob:0.32, steps:['Consolidar fatos','Apresentar em formato objetivo','Alinhar testemunhas'] },
      { label:'Escalada', prob:0.20, steps:['Preparar saída','Evitar resposta pública imediata','Planejar mitigação'] }
    ]
  };
}

function simulateFinance(input){
  return {
    title: 'Simulação Financeira',
    input,
    options: [
      { label:'Conservador', prob:0.50, steps:['Alocar 30% capital','Validar assumptions','Horizonte 12+ meses'] },
      { label:'Moderado', prob:0.30, steps:['Teste com 10% capital','Medir sinais mercado 7-14 dias'] },
      { label:'Agressivo', prob:0.20, steps:['Não executar sem redundância','Stoploss claro','Revisão de hipóteses'] }
    ]
  };
}

function simulateSocial(input){
  return {
    title: 'Simulação Social',
    input,
    options: [
      { label:'Aliança', prob:0.44, steps:['Identificar 2 aliados','Oferecer troca de valor clara'] },
      { label:'Neutro', prob:0.36, steps:['Preservar informações','Medir reações sutis'] },
      { label:'Hostil', prob:0.20, steps:['Limitar exposição','Documentar interações'] }
    ]
  };
}

// Optional OpenAI helper (if key present) — returns null on failure
async function openaiComplete(prompt){
  if(!OPENAI_KEY) return null;
  try{
    const res = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+OPENAI_KEY },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages:[{role:'system',content:'You are Laila — concise, brutally honest strategic assistant.'},{role:'user',content:prompt}], max_tokens:450 })
    });
    if(!res.ok) return null;
    const j = await res.json();
    // Defensive: ensure structure
    const txt = j?.choices?.[0]?.message?.content || null;
    return txt;
  }catch(err){
    console.warn('OpenAI call failed', err.message);
    return null;
  }
}

// Pattern detection & vulnerability addition
function detectPatternsAndVulns(db){
  // repeated recent decisions
  const last = (db.actions||[]).slice(-6).map(a=> (a.text||'').toLowerCase());
  const dupSet = last.reduce((acc,t,i,arr)=>{ if(t && arr.indexOf(t)!==i) acc.add(t); return acc; }, new Set());
  const results = [];
  if(dupSet.size>0){
    const vuln = { id: nowTS(), type: 'Repetição de ação', detail: Array.from(dupSet).slice(0,3), ts: nowTS() };
    db.vulns = db.vulns||[]; db.vulns.push(vuln); results.push(vuln);
  }
  // fatigue heuristic
  const now = nowTS();
  const recentCount = (db.actions||[]).filter(a=> now - a.ts < 1000*60*20).length;
  if(recentCount>=5){
    const vuln = { id: nowTS(), type: 'Fadiga', detail: `${recentCount} ações nos últimos 20min`, ts: nowTS() };
    db.vulns.push(vuln); results.push(vuln);
  }
  return results;
}

// --- Express app ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '40kb' }));

const limiter = rateLimit({ windowMs: 1000*20, max: 30 });
app.use(limiter);

app.get('/', (req,res)=>{
  res.send('Laila API — alive. Use POST /api/chat');
});

app.post('/api/chat', async (req,res)=>{
  try{
    const { action, text, simType } = req.body || {};
    const db = readDB();
    const errors = readErrors();

    // Normalize
    const cleanText = safeStr(text || '');

    // Store some actions (shadow)
    if(action === 'strategy' || action === 'simulate' || action === 'mirror'){
      db.actions = db.actions || [];
      db.actions.push({ text: cleanText, action, ts: nowTS() });
      writeDB(db);
    }

    // Handler switch
    if(action === 'strategy'){
      // quick heuristics
      const f = analyzeTextShort(cleanText);
      const mirror = mirrorAssessment(cleanText);

      // quick scenarios
      const scenarioA = { label:'Cenário A (executar)', prob: f.confidence ? 0.35 : 0.6, outcome:'Execução imediata com risco reduzido'};
      const scenarioB = { label:'Cenário B (aguardar)', prob: 0.35, outcome:'Aguardar 3h para redução de risco por fadiga'};
      const scenarioC = { label:'Cenário C (testar)', prob: 0.25, outcome:'Teste controlado para coletar dados'};

      // attempt OpenAI augmentation
      let aiAug = await openaiComplete(`Faça uma resposta curta como Laila: analise: "${cleanText}". Dê 3 cenários e um resumo brutal.`);
      if(aiAug) {
        return res.json({ type:'strategy', mirror, scenarios:[scenarioA,scenarioB,scenarioC], ai: aiAug });
      }

      // fallback
      return res.json({ type:'strategy', mirror, scenarios:[scenarioA,scenarioB,scenarioC], note:'fallback local heuristics used' });
    }

    if(action === 'mirror'){
      const mirror = mirrorAssessment(cleanText);
      // try AI for richer mirror
      const aiMirror = await openaiComplete(`Seja brutal e honesto. Avalie a seguinte ação: "${cleanText}". Um parágrafo.`);
      return res.json({ type:'mirror', mirror, ai: aiMirror || null });
    }

    if(action === 'simulate'){
      const type = (simType || 'conflict');
      let out;
      if(type === 'conflict') out = simulateConflict(cleanText);
      else if(type === 'finance') out = simulateFinance(cleanText);
      else out = simulateSocial(cleanText);

      // AI augmentation optional
      const aiSim = await openaiComplete(`Simule 3 cenários para o seguinte: "${cleanText}" em contexto ${type}. Dê passos concretos.`);
      return res.json({ type:'simulate', simType:type, out, ai: aiSim || null });
    }

    if(action === 'reportError'){
      // expects text describing the error
      const tag = (cleanText.split(' ')[0] || '').toLowerCase();
      const errs = readErrors();
      const entry = { text: cleanText, tag, ts: nowTS() };
      errs.push(entry); writeErrors(errs);
      // integrate quickly into vuln map
      db.vulns = db.vulns || [];
      db.vulns.push({ id: nowTS(), type: 'Erro relatado', detail: cleanText, ts: nowTS() });
      writeDB(db);
      return res.json({ ok:true, entry });
    }

    if(action === 'getReport'){
      // build quick report
      detectPatternsAndVulns(db);
      writeDB(db);
      const totalActions = (db.actions||[]).length;
      const totalErrs = (readErrors()||[]).length;
      const vulnerabilities = (db.vulns||[]).length;
      const report = {
        totalActions, totalErrs, vulnerabilities,
        vulnerabilities_list: (db.vulns||[]).slice(-10).reverse(),
        recent_actions: (db.actions||[]).slice(-8).reverse()
      };
      return res.json({ type:'report', report });
    }

    // Unknown action
    return res.status(400).json({ error:'unknown action. allowed: strategy, mirror, simulate, reportError, getReport' });

  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
});

// small health endpoint
app.get('/api/health', (req,res)=> res.json({ ok:true, now: nowTS(), openai: !!OPENAI_KEY }));

// start
app.listen(PORT, ()=>{
  console.log(`Laila API running on http://localhost:${PORT} — POST /api/chat`);
});
