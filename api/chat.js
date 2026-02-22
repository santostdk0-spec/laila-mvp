/**
 * api_chat.js — LAILA SUPREME (revisado)
 * - Adiciona action: "chat" para conversas estilo IA (heurística quando OPENAI_API_KEY ausente)
 * - Mantém simuladores, mirror, strategy, reportError, getReport
 * - Arquitetura simples: armazenamento em ./data/*.json, CORS, rate-limit, helmet
 *
 * Como rodar:
 *   npm i express node-fetch express-rate-limit helmet cors
 *   node api_chat.js
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'laila_db.json');
const ERR_FILE = path.join(DB_DIR, 'laila_errors.json');
const OPENAI_KEY = process.env.OPENAI_API_KEY || null;

// ensure data dir
if(!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ actions: [], notes: [], vulns: [], shadowEnabled: true }, null, 2));
if(!fs.existsSync(ERR_FILE)) fs.writeFileSync(ERR_FILE, JSON.stringify([], null, 2));
function readDB(){ return JSON.parse(fs.readFileSync(DB_FILE,'utf8')||'{}'); }
function writeDB(v){ fs.writeFileSync(DB_FILE, JSON.stringify(v, null, 2)); }
function readErrors(){ return JSON.parse(fs.readFileSync(ERR_FILE,'utf8')||'[]'); }
function writeErrors(v){ fs.writeFileSync(ERR_FILE, JSON.stringify(v, null, 2)); }

function nowTS(){ return Date.now(); }
function safeStr(s){ return (s||'').toString().trim(); }

// heuristics (same spirit as frontend)
function analyzeTextShort(text){
  const t = (text||'').toLowerCase();
  const keywordsConf = ['certeza','confiante','com certeza','tenho certeza','vou'];
  const keywordsRisk = ['arrisc','perder','pagar','apress','urgente','agora'];
  const keywordsEmo = ['raiva','ódio','revolt','frustr'];
  return { confidence: keywordsConf.some(k=>t.includes(k)), risk: keywordsRisk.some(k=>t.includes(k)), emotion: keywordsEmo.some(k=>t.includes(k)) };
}

function mirrorAssessment(text){
  const t = (text||'').toLowerCase();
  if(!t) return 'Entrada vazia — descreva o plano antes de executar.';
  if(t.length < 12) return 'Frase curta — possível impulso. Elabore antes de agir.';
  if(t.includes('vou') && t.includes('agora')) return 'Empolgação detectada — reveja timing.';
  if(t.includes('certo') || t.includes('certeza')) return 'Confiança alta — verifique redundância e vieses.';
  if(t.includes('arrisc')) return 'Reconhece risco — teste controlado primeiro.';
  return 'Análise normal. Atenção ao fator humano e ao timing.';
}

function simulateConflict(input){ return { title:'Simulação de Conflito', input, options:[ {label:'Desescalada',prob:0.48,steps:['Recuar 1 etapa','Usar linguagem neutra','Documentar pontos'] }, {label:'Controle de narrativa',prob:0.32,steps:['Consolidar fatos','Apresentar objetivamente']}, {label:'Escalada',prob:0.20,steps:['Preparar saída','Mitigação'] } ] }; }
function simulateFinance(input){ return { title:'Simulação Financeira', input, options:[ {label:'Conservador',prob:0.50,steps:['Alocar 30% capital','Validar assumptions']},{label:'Moderado',prob:0.30,steps:['Teste 10% capital','Medir 7-14 dias']},{label:'Agressivo',prob:0.20,steps:['Stoploss','Revisão de hipóteses']} ] }; }
function simulateSocial(input){ return { title:'Simulação Social', input, options:[ {label:'Aliança',prob:0.44,steps:['Identificar aliados','Troca de valor']},{label:'Neutro',prob:0.36,steps:['Preservar informações','Medir reações']},{label:'Hostil',prob:0.20,steps:['Limitar exposição','Documentar interações']} ] }; }

// optional OpenAI call (safe fallback)
async function openaiComplete(prompt){
  if(!OPENAI_KEY) return null;
  try{
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json','Authorization':'Bearer '+OPENAI_KEY },
      body: JSON.stringify({ model:'gpt-4o-mini', messages:[{role:'system',content:'You are Laila — concise, brutally honest strategic assistant.'},{role:'user',content:prompt}], max_tokens:450 })
    });
    if(!res.ok) return null;
    const j = await res.json();
    return j?.choices?.[0]?.message?.content || null;
  }catch(e){ console.warn('OpenAI error', e.message); return null; }
}

function detectPatternsAndVulns(db){
  const out = [];
  const last = (db.actions||[]).slice(-6).map(a=> (a.text||'').toLowerCase());
  const dup = last.reduce((s,t,i,arr)=>{ if(t && arr.indexOf(t)!==i) s.add(t); return s; }, new Set());
  if(dup.size>0){ const v={id:nowTS(),type:'Repetição de ação',detail:Array.from(dup).slice(0,3),ts:nowTS()}; db.vulns.push(v); out.push(v); }
  const now = nowTS();
  const recentCount = (db.actions||[]).filter(a=> now - a.ts < 1000*60*20).length;
  if(recentCount>=5){ const v={id:nowTS(),type:'Fadiga',detail:`${recentCount} ações nos últimos 20min`,ts:nowTS()}; db.vulns.push(v); out.push(v); }
  return out;
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit:'64kb' }));
app.use(rateLimit({ windowMs:1000*20, max:40 }));

app.get('/', (req,res)=> res.send('Laila API — alive'));

app.post('/api/chat', async (req,res) => {
  try{
    const { action, text, simType, shadow } = req.body || {};
    const db = readDB();
    const errs = readErrors();
    const cleanText = safeStr(text || '');

    // store basic action for shadow learning
    if(action === 'strategy' || action === 'simulate' || action === 'mirror' || action === 'chat'){
      db.actions = db.actions || [];
      db.actions.push({ text: cleanText, action, ts: nowTS() });
      writeDB(db);
    }

    // chat action — behave like an assistant
    if(action === 'chat'){
      // heuristics-based reply
      // if user asked "SIMULAR:" prefix or "simular:" we delegate to simulate
      const t = cleanText.toLowerCase();
      if(t.startsWith('simular:') || t.startsWith('simular')){
        // parse simple syntax: "simular: tipo: texto"
        let type = 'conflict'; let body = cleanText;
        const parts = cleanText.split(':').map(s=>s.trim());
        if(parts.length>=2 && ['conflict','finance','social','conflito','financeiro','social'].includes(parts[1].toLowerCase())){ type = parts[1].toLowerCase(); body = parts.slice(2).join(':') || parts.slice(1).join(':'); }
        // normalize portuguese keys
        if(type === 'conflito') type = 'conflict';
        if(type === 'financeiro') type = 'finance';
        const simOut = type === 'finance' ? simulateFinance(body) : (type === 'social' ? simulateSocial(body) : simulateConflict(body));
        // optionally augment with AI
        const ai = await openaiComplete(`Simule 3 cenários para: "${body}" tipo:${type}. Dê passos práticos.`);
        return res.json({ type:'chat', subtype:'simulate', simOut, ai: ai || null });
      }

      // normal chat: produce compact assistant reply
      // 1) run mirrorAssessment if user seems to ask for advice (contains 'devo', 'vou', 'quer')
      const askForAdvice = /\\b(devo|vou|quer|o que faço|como|conselho)\\b/i.test(cleanText);
      const heur = analyzeTextShort(cleanText);
      let reply = '';

      if(askForAdvice){
        // produce concise strategy-style response
        const mirror = mirrorAssessment(cleanText);
        const scenarioA = { label:'Executar (curto prazo)', prob: heur.confidence ? 0.35 : 0.55 };
        const scenarioB = { label:'Aguardar (reduzir risco)', prob: 0.30 };
        const scenarioC = { label:'Testar (coletar dados)', prob: 0.15 };
        reply = `Espelho: ${mirror}\n\nCenários:\n- ${scenarioA.label} (${Math.round(scenarioA.prob*100)}%)\n- ${scenarioB.label} (${Math.round(scenarioB.prob*100)}%)\n- ${scenarioC.label} (${Math.round(scenarioC.prob*100)}%)\n\nSugestão: prefira testar controladamente antes de executar se houver risco.`;
        // try OpenAI augmentation
        const ai = await openaiComplete(`Seja Laila (brutal e concisa). Dê uma resposta rápida sobre: "${cleanText}" com 3 opções e um espelho.`);
        if(ai) return res.json({ type:'chat', content: ai });
        return res.json({ type:'chat', content: reply });
      }

      // fallback: short reflection + question to user
      const fallback = `Recebido: "${cleanText}". Você busca análise estratégica (responda 'sim') ou quer só comentário?`;
      const aiFallback = await openaiComplete(`Responda em até 120 tokens como Laila, conciso, para: "${cleanText}"`);
      return res.json({ type:'chat', content: aiFallback || fallback });
    }

    // strategy endpoint (unchanged)
    if(action === 'strategy'){
      const f = analyzeTextShort(cleanText);
      const mirror = mirrorAssessment(cleanText);
      const scenarioA = { label:'Cenário A (executar)', prob: f.confidence ? 0.35 : 0.6, outcome:'Execução imediata com risco reduzido'};
      const scenarioB = { label:'Cenário B (aguardar)', prob: 0.35, outcome:'Aguardar 3h'};
      const scenarioC = { label:'Cenário C (testar)', prob: 0.25, outcome:'Teste controlado'};
      const aiAug = await openaiComplete(`Analise: "${cleanText}" e dê 3 cenários curtos como Laila.`);
      return res.json({ type:'strategy', mirror, scenarios:[scenarioA,scenarioB,scenarioC], ai: aiAug || null });
    }

    if(action === 'mirror'){
      const mirror = mirrorAssessment(cleanText);
      const aiMirror = await openaiComplete(`Seja brutal e honesto. Avalie a ação: "${cleanText}".`);
      return res.json({ type:'mirror', mirror, ai: aiMirror || null });
    }

    if(action === 'simulate'){
      const type = (simType || 'conflict');
      const out = type === 'finance' ? simulateFinance(cleanText) : (type === 'social' ? simulateSocial(cleanText) : simulateConflict(cleanText));
      const aiSim = await openaiComplete(`Simule 3 cenários para: "${cleanText}" tipo:${type}`);
      return res.json({ type:'simulate', simType:type, out, ai: aiSim || null });
    }

    if(action === 'reportError'){
      if(!cleanText) return res.json({ ok:false, error:'text_required' });
      const tag = (cleanText.split(' ')[0] || '').toLowerCase();
      const e = readErrors(); e.push({ text: cleanText, tag, ts: nowTS() }); writeErrors(e);
      db.vulns = db.vulns || []; db.vulns.push({ id: nowTS(), type:'Erro relatado', detail:cleanText, ts: nowTS() }); writeDB(db);
      return res.json({ ok:true, entry:{text:cleanText,tag,ts:nowTS()} });
    }

    if(action === 'getReport'){
      detectPatternsAndVulns(db);
      writeDB(db);
      const totalActions = (db.actions || []).length;
      const totalErrs = (readErrors() || []).length;
      const vulnerabilities = (db.vulns || []).length;
      return res.json({ type:'report', report:{ totalActions, totalErrs, vulnerabilities, vulnerabilities_list: (db.vulns||[]).slice(-10).reverse(), recent_actions: (db.actions||[]).slice(-8).reverse() } });
    }

    return res.status(400).json({ error:'unknown action. allowed: chat, strategy, mirror, simulate, reportError, getReport' });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error:'internal_server_error', detail: err.message });
  }
});

app.get('/api/health', (req,res)=> res.json({ ok:true, now: nowTS(), openai: !!OPENAI_KEY }));
app.listen(PORT, ()=> console.log(`Laila API running http://localhost:${PORT} — POST /api/chat`));
