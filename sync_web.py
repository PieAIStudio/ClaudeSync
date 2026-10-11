#!/usr/bin/env python3
"""Dependency-free browser GUI fallback for machines without Tk."""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import webbrowser

from claude_sync.configuration import build_config, save_config
from claude_sync.platforms import Environment, runtime_base

BASE = runtime_base()
PYTHON = sys.executable

PAGE = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClaudeSync</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}body{margin:0;padding:24px}main{max-width:1180px;margin:auto}.top{display:flex;align-items:center;gap:18px}.top h1{margin:0}.muted{color:#5e6b82}.card{background:white;border:1px solid #d8deea;border-radius:12px;padding:16px;margin:14px 0}.status{background:#eef6ff;border-color:#b9d9ff}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric b{font-size:28px;display:block}.metric span{color:#5e6b82;font-size:13px}.table{overflow:auto}.row{display:grid;grid-template-columns:120px 140px minmax(150px,1fr) minmax(150px,1fr) 180px minmax(270px,1.3fr);gap:10px;align-items:center;padding:9px 6px;border-bottom:1px solid #edf0f5;min-width:930px}.head{font-weight:700;color:#5e6b82}.conflict{background:#fff7ed;color:#b42318}.buttons{display:flex;gap:9px;flex-wrap:wrap}button{border:1px solid #9aa5b8;background:white;border-radius:7px;padding:9px 14px;cursor:pointer}button.primary{background:#0a5cad;color:white;border-color:#0a5cad}button:disabled{opacity:.45;cursor:default}pre{white-space:pre-wrap;max-height:260px;overflow:auto;font-size:12px}.choice{display:flex;gap:10px;white-space:nowrap}.choice label{color:#172033;font-weight:400}.choice input{accent-color:#0a5cad}.setup-grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px}.setup-grid label{display:flex;flex-direction:column;gap:5px;color:#5e6b82;font-size:13px}.setup-grid input{border:1px solid #b9c2d0;border-radius:6px;padding:9px;font:inherit;color:#172033}.error{color:#b42318;margin-top:9px;white-space:pre-wrap}@media(max-width:720px){.setup-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}body{padding:12px}}
</style></head><body><main><div class="top"><h1>ClaudeSync</h1><span id="subtitle" class="muted">手动、可检查、跨平台的本地会话同步</span><select id="language" onchange="changeLanguage(this.value)"><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="es">Español</option><option value="pt-BR">Português</option></select></div>
<section id="setupCard" class="card" hidden><h2 id="setupTitle">第一次使用 ClaudeSync</h2><p id="setupHint" class="muted">先选择两个账号的本地索引目录和 JSONL 正文目录。设置只保存在本机。</p><div class="setup-grid"><label><span id="sessionRootLabel">会话索引根目录</span><input id="sessionRoot" placeholder="/path/to/claude-code-sessions"></label><label><span id="accountALabel">账号 A 目录</span><input id="accountA" placeholder="/path/to/organization/account"></label><label><span id="accountBLabel">账号 B 目录</span><input id="accountB" placeholder="/path/to/organization/account"></label><label><span id="projectsRootLabel">正文目录</span><input id="projectsRoot" placeholder="~/.claude/projects"></label><label><span id="labelALabel">账号 A 名称</span><input id="labelA" value="账号 A"></label><label><span id="labelBLabel">账号 B 名称</span><input id="labelB" value="账号 B"></label></div><div class="buttons"><button id="saveSetupButton" class="primary" onclick="saveSetup()">保存设置并检查</button></div><div id="setupError" class="error"></div></section>
<section class="card status"><h2 id="status">正在检查…</h2><div id="detail" class="muted">不会在检查阶段写入 Claude 数据。</div><div id="accounts" class="muted"></div></section>
<section class="metrics"><div class="card metric"><b id="add">—</b><span id="metricAdd">可新增会话</span></div><div class="card metric"><b id="title">—</b><span id="metricTitle">可更新标题</span></div><div class="card metric"><b id="conflict">—</b><span id="metricConflict">标题需选择</span></div><div class="card metric"><b id="skip">—</b><span id="metricSkip">本次跳过</span></div></section>
<section class="card"><h2 id="titleDetail">标题明细（冲突在这里选，不弹窗）</h2><div id="rows" class="table"></div></section>
<section class="card"><h2 id="reportTitle">检查报告</h2><pre id="report">—</pre></section>
<div class="buttons"><button id="checkButton" onclick="check()">重新检查</button><button id="sync" class="primary" disabled onclick="run('sync')">同步安全项</button><button id="close" disabled onclick="run('close-sync')">关闭 Claude 并同步</button><button id="reportButton" onclick="openReport()">打开最新报告</button><button id="copyButton" onclick="copyReport()">复制摘要</button><button id="exitButton" onclick="exitApp()">退出 ClaudeSync</button></div>
<p class="muted">选择标题后才会把选择交给同步核心。最后的确认框只确认写入或关闭动作。</p></main>
<script>
let actions=[];let choices={};let latest='';
const ui={
 'zh-CN':{subtitle:'手动、可检查、跨平台的本地会话同步',metrics:['可新增会话','可更新标题','标题需选择','本次跳过'],detail:'标题明细（冲突在这里选，不弹窗）',report:'检查报告',buttons:['重新检查','同步安全项','关闭 Claude 并同步','打开最新报告','复制摘要','退出 ClaudeSync'],setup:['第一次使用 ClaudeSync','先选择两个账号的本地索引目录和 JSONL 正文目录。设置只保存在本机。','会话索引根目录','账号 A 目录','账号 B 目录','正文目录','账号 A 名称','账号 B 名称','保存设置并检查'],headings:['状态','会话','来源标题','目标标题','处理','选择'],ready:'可以同步安全项',close:'需要先关闭 Claude',empty:'没有需要自动处理的项目',checking:'正在检查…',hint:'标题冲突已列在上方；默认跳过，选择后再同步。',account:'已检查账号：'},
 en:{subtitle:'Manual, inspectable, cross-platform local session sync',metrics:['Sessions to add','Titles to update','Title choices','Skipped'],detail:'Title details (choose conflicts here)',report:'Check report',buttons:['Check again','Sync safe items','Close Claude and sync','Open latest report','Copy summary','Exit ClaudeSync'],setup:['Set up ClaudeSync','Choose the two local index folders and the JSONL transcript folder. Settings stay on this computer.','Session index root','Account A folder','Account B folder','Transcript folder','Account A name','Account B name','Save settings and check'],headings:['Status','Session','Source title','Target title','Action','Choice'],ready:'Ready to sync safe items',close:'Claude must be closed first',empty:'Nothing needs automatic handling',checking:'Checking…',hint:'Title conflicts are listed above; choose one before syncing.',account:'Checked accounts: '},
 ja:{subtitle:'手動で確認できるクロスプラットフォーム同期',metrics:['追加するセッション','更新するタイトル','タイトル選択','スキップ'],detail:'タイトル詳細（ここで衝突を選択）',report:'チェックレポート',buttons:['再チェック','安全な項目を同期','Claude を閉じて同期','最新レポートを開く','概要をコピー','ClaudeSync を終了'],setup:['ClaudeSync の初期設定','二つのローカル索引フォルダーと JSONL 本文フォルダーを選択します。設定はこのコンピューターに保存されます。','索引ルート','アカウント A','アカウント B','本文フォルダー','アカウント A 名','アカウント B 名','保存してチェック'],headings:['状態','セッション','元のタイトル','対象タイトル','処理','選択'],ready:'安全な項目を同期できます',close:'先に Claude を閉じてください',empty:'自動処理する項目はありません',checking:'チェック中…',hint:'衝突は上に表示されています。選択してから同期してください。',account:'確認したアカウント: '},
 es:{subtitle:'Sincronización local manual, clara y multiplataforma',metrics:['Sesiones para añadir','Títulos para actualizar','Elecciones de título','Omitidos'],detail:'Detalles de títulos (elige aquí los conflictos)',report:'Informe de comprobación',buttons:['Comprobar de nuevo','Sincronizar elementos seguros','Cerrar Claude y sincronizar','Abrir último informe','Copiar resumen','Salir de ClaudeSync'],setup:['Configurar ClaudeSync','Elige las dos carpetas de índices locales y la carpeta de transcripciones JSONL. Se guardan en este equipo.','Raíz de índices','Carpeta de Cuenta A','Carpeta de Cuenta B','Carpeta de transcripciones','Nombre de Cuenta A','Nombre de Cuenta B','Guardar y comprobar'],headings:['Estado','Sesión','Título origen','Título destino','Acción','Elección'],ready:'Listo para sincronizar elementos seguros',close:'Primero debes cerrar Claude',empty:'No hay nada que procesar automáticamente',checking:'Comprobando…',hint:'Los conflictos están arriba; elige uno antes de sincronizar.',account:'Cuentas comprobadas: '},
 'pt-BR':{subtitle:'Sincronização local manual, clara e multiplataforma',metrics:['Sessões para adicionar','Títulos para atualizar','Escolhas de título','Ignorados'],detail:'Detalhes dos títulos (escolha conflitos aqui)',report:'Relatório de verificação',buttons:['Verificar novamente','Sincronizar itens seguros','Fechar Claude e sincronizar','Abrir relatório mais recente','Copiar resumo','Sair do ClaudeSync'],setup:['Configurar ClaudeSync','Escolha as duas pastas de índices locais e a pasta de transcrições JSONL. As configurações ficam neste computador.','Raiz dos índices','Pasta da Conta A','Pasta da Conta B','Pasta de transcrições','Nome da Conta A','Nome da Conta B','Salvar e verificar'],headings:['Status','Sessão','Título de origem','Título de destino','Ação','Escolha'],ready:'Pronto para sincronizar itens seguros',close:'Feche o Claude primeiro',empty:'Nada precisa de tratamento automático',checking:'Verificando…',hint:'Os conflitos estão acima; escolha antes de sincronizar.',account:'Contas verificadas: '}
};
function changeLanguage(lang){localStorage.setItem('claudesync-language',lang);let t=ui[lang]||ui['zh-CN'];document.getElementById('subtitle').textContent=t.subtitle;['metricAdd','metricTitle','metricConflict','metricSkip'].forEach((id,i)=>document.getElementById(id).textContent=t.metrics[i]);document.getElementById('titleDetail').textContent=t.detail;document.getElementById('reportTitle').textContent=t.report;['checkButton','sync','close','reportButton','copyButton','exitButton'].forEach((id,i)=>document.getElementById(id).textContent=t.buttons[i]);['setupTitle','setupHint','sessionRootLabel','accountALabel','accountBLabel','projectsRootLabel','labelALabel','labelBLabel','saveSetupButton'].forEach((id,i)=>document.getElementById(id).textContent=t.setup[i]);}
const savedLanguage=localStorage.getItem('claudesync-language')||'zh-CN';document.getElementById('language').value=savedLanguage;changeLanguage(savedLanguage);

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={same:'标题一致',safe:'可安全同步',normalize:'可统一标题',conflict:'需要选择',auto_difference:'不猜测',keep_target:'保留目标'};
const actionText={same:'无变化',safe:'将更新目标',normalize:'去掉旧标记',conflict:'两边都手动改过',auto_difference:'两个都是自动标题',keep_target:'保留目标标题'};
function render(data){
  const t=ui[localStorage.getItem('claudesync-language')||'zh-CN']||ui['zh-CN'];
  if(data.setup_required){document.getElementById('setupCard').hidden=false;let d=data.defaults||{};for(let [id,key] of [['sessionRoot','session_root'],['projectsRoot','projects_root']])if(!document.getElementById(id).value)document.getElementById(id).value=d[key]||'';document.getElementById('status').textContent=t.setup[0];document.getElementById('detail').textContent=t.setup[1];return;}
  document.getElementById('setupCard').hidden=true;latest=data.report||'';document.getElementById('report').textContent=latest;let scan=data.scan||{},pre=data.preflight||{},counts=scan.counts||{},acts=scan.title_actions||[];actions=acts;let add=Object.values(counts).reduce((n,v)=>n+Number(v.will_add||0),0),title=Object.values(counts).reduce((n,v)=>n+Number(v.will_update_titles||0),0),conf=new Set(acts.filter(a=>a.status==='conflict').map(a=>a.cliSessionId)).size,skip=(scan.entries||[]).filter(e=>!['add','branch','present','planned'].includes(e.status)).length;for(let [id,v] of Object.entries({add,title,conflict:conf,skip}))document.getElementById(id).textContent=v;document.getElementById('accounts').textContent=Object.keys(counts).length?t.account+Object.keys(counts).sort().join(' / '):'';let blockers=pre.blockers||[];document.getElementById('status').textContent=blockers.length?t.close:(add||title?t.ready:t.empty);document.getElementById('detail').textContent=blockers.length?'只读检查完成；可以使用“关闭 Claude 并同步”。':t.hint;document.getElementById('sync').disabled=!!blockers||!(add||title);document.getElementById('close').disabled=!blockers;let seen=new Set(),html='<div class="row head">'+t.headings.map(h=>`<div>${esc(h)}</div>`).join('')+'</div>';for(let a of acts){let session=a.cliSessionId||'',conflict=a.status==='conflict';if(conflict&&seen.has(session))continue;if(conflict)seen.add(session);let source=a.source||'账号 A',target=a.target||'账号 B';if(conflict&&!choices[session])choices[session]='skip';let radios=conflict?`<span class="choice"><label><input type="radio" name="choice-${esc(session)}" data-session="${esc(session)}" data-choice="${esc(source)}" ${choices[session]===source?'checked':''}>${esc(source)}</label><label><input type="radio" name="choice-${esc(session)}" data-session="${esc(session)}" data-choice="${esc(target)}" ${choices[session]===target?'checked':''}>${esc(target)}</label><label><input type="radio" name="choice-${esc(session)}" data-session="${esc(session)}" data-choice="skip" ${choices[session]==='skip'?'checked':''}>跳过</label></span>`:'';html+=`<div class="row ${conflict?'conflict':''}"><div>${esc(labels[a.status]||a.status)}</div><div>${esc(session.slice(0,12))}…</div><div>${esc(a.source_title)}</div><div>${esc(a.target_title)}</div><div>${esc(actionText[a.status]||a.status)}</div><div>${radios}</div></div>`}document.getElementById('rows').innerHTML=html;document.querySelectorAll('#rows input[data-session]').forEach(input=>input.addEventListener('change',()=>choices[input.dataset.session]=input.dataset.choice));
}
async function check(){document.getElementById('status').textContent=(ui[localStorage.getItem('claudesync-language')||'zh-CN']||ui['zh-CN']).checking;let r=await fetch('/api/check');render(await r.json())}
async function saveSetup(){let error=document.getElementById('setupError');error.textContent='';let body={session_root:document.getElementById('sessionRoot').value,account_a:document.getElementById('accountA').value,account_b:document.getElementById('accountB').value,projects_root:document.getElementById('projectsRoot').value,label_a:document.getElementById('labelA').value,label_b:document.getElementById('labelB').value};let r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data=await r.json();if(!r.ok){error.textContent=data.error||'设置未保存';return}render(data)}
async function run(mode){let conflicts=actions.filter(a=>a.status==='conflict'),map={};for(let a of conflicts){let key=a.cliSessionId;if(!choices[key]||choices[key]==='skip')map[a.target_path]='skip';else if(choices[key]===a.source)map[a.target_path]='source';else if(choices[key]===a.target)map[a.target_path]='target'}if(!confirm(mode==='close-sync'?'确认请求 Claude 正常退出并同步？':'确认同步安全项？'))return;let r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,choices:map})});render(await r.json())}
function openReport(){window.open('/api/report','_blank')};function copyReport(){navigator.clipboard?.writeText(latest)};async function exitApp(){await fetch('/api/shutdown',{method:'POST'});document.body.innerHTML='<main><div class="card"><h2>ClaudeSync 已退出</h2><p>可以关闭这个浏览器窗口。</p></div></main>'};check();
</script></body></html>'''


def run_command(mode, choices):
    resolution = None
    try:
        if choices:
            fd, resolution = tempfile.mkstemp(prefix="claudesync-title-resolutions-", suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"version": 1, "choices": choices}, stream, ensure_ascii=False)
        args = ["--" + mode]
        if resolution:
            args += ["--title-resolutions", resolution]
        subprocess.run(([sys.executable] if getattr(sys, "frozen", False) else [PYTHON, str(BASE / "sync_sessions.py")]) + args, cwd=str(BASE),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    finally:
        if resolution:
            Path(resolution).unlink(missing_ok=True)
    return read_report()


def read_report():
    try:
        data = json.loads((BASE / "reports/latest.json").read_text(encoding="utf-8"))
        data["report"] = (BASE / "reports/latest.txt").read_text(encoding="utf-8")
        return data
    except (OSError, ValueError) as exc:
        return {"preflight": {"blockers": [str(exc)]}, "report": str(exc)}


def check_or_setup():
    if not (BASE / "config.json").exists():
        env = Environment(BASE)
        return {"setup_required": True, "defaults": {
            "session_root": str(env.root), "projects_root": str(env.projects)}}
    return run_command("check", {})


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers(); self.wfile.write(PAGE.encode())
        elif self.path == "/api/check":
            self.send_json(check_or_setup())
        elif self.path == "/api/report":
            report = (BASE / "reports/latest.txt").read_bytes() if (BASE / "reports/latest.txt").exists() else b"No report yet."
            self.send_response(200); self.send_header("Content-Type", "text/plain; charset=utf-8"); self.end_headers(); self.wfile.write(report)
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except (TypeError, ValueError):
            self.send_json({"error": "请求格式无法识别。"}, status=400)
            return
        if not isinstance(body, dict):
            self.send_json({"error": "请求格式无法识别。"}, status=400)
            return
        if self.path == "/api/config":
            try:
                data = build_config(body.get("session_root", ""), body.get("account_a", ""),
                                    body.get("account_b", ""), body.get("projects_root", ""),
                                    body.get("label_a", "账号 A"), body.get("label_b", "账号 B"))
                save_config(BASE, data)
            except (OSError, TypeError, ValueError) as exc:
                self.send_json({"error": str(exc)}, status=400)
                return
            self.send_json(run_command("check", {}))
            return
        if self.path == "/api/shutdown":
            self.send_json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if self.path != "/api/run":
            self.send_error(404)
            return
        mode = body.get("mode") if body.get("mode") in ("sync", "close-sync") else "sync"
        self.send_json(run_command(mode, body.get("choices") if isinstance(body.get("choices"), dict) else {}))

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    url = "http://127.0.0.1:%d/" % server.server_port
    print("ClaudeSync browser GUI: " + url, flush=True)
    threading.Timer(0.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
