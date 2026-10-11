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

from claude_sync.configuration import build_config, build_config_for_accounts, discover_config, save_config
from claude_sync.platforms import Environment, runtime_base

BASE = runtime_base()
PYTHON = sys.executable

PAGE = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClaudeSync</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}body{margin:0;padding:24px}main{max-width:1180px;margin:auto}.top{display:flex;align-items:center;gap:18px}.top h1{margin:0}.muted{color:#5e6b82}.card{background:white;border:1px solid #d8deea;border-radius:12px;padding:16px;margin:14px 0}.status{background:#eef6ff;border-color:#b9d9ff}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric b{font-size:28px;display:block}.metric span{color:#5e6b82;font-size:13px}.table{overflow:auto}.row{display:grid;grid-template-columns:120px 140px minmax(300px,1.6fr) 180px minmax(280px,1.4fr);gap:10px;align-items:center;padding:9px 6px;border-bottom:1px solid #edf0f5;min-width:930px}.head{font-weight:700;color:#5e6b82}.conflict{background:#fff7ed;color:#b42318}.buttons{display:flex;gap:9px;flex-wrap:wrap}button{border:1px solid #9aa5b8;background:white;border-radius:7px;padding:9px 14px;cursor:pointer}button.primary{background:#0a5cad;color:white;border-color:#0a5cad}button:disabled{opacity:.45;cursor:default}pre{white-space:pre-wrap;max-height:260px;overflow:auto;font-size:12px}.choice{display:flex;gap:10px;white-space:nowrap}.choice label{color:#172033;font-weight:400}.choice input{accent-color:#0a5cad}.setup-grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px}.setup-grid label{display:flex;flex-direction:column;gap:5px;color:#5e6b82;font-size:13px}.setup-grid input{border:1px solid #b9c2d0;border-radius:6px;padding:9px;font:inherit;color:#172033}.error{color:#b42318;margin-top:9px;white-space:pre-wrap}@media(max-width:720px){.setup-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}body{padding:12px}}
</style></head><body><main><div class="top"><h1>ClaudeSync</h1><span id="subtitle" class="muted">手动、可检查、跨平台的本地会话同步</span><select id="language" onchange="changeLanguage(this.value)"><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="es">Español</option><option value="pt-BR">Português</option></select></div>
<section id="setupCard" class="card" hidden><h2 id="setupTitle">第一次使用 ClaudeSync</h2><p id="setupHint" class="muted">先自动发现本机账号；只有发现不完整时才补充目录。设置只保存在本机。</p><div class="setup-grid"><label><span id="sessionRootLabel">会话索引根目录</span><input id="sessionRoot" placeholder="/path/to/claude-code-sessions"></label><label><span id="projectsRootLabel">正文目录</span><input id="projectsRoot" placeholder="~/.claude/projects"></label></div><div class="card"><h3 id="accountSetupTitle">账号列表</h3><div id="accountRows"></div><button id="addAccountButton" onclick="addAccountRow()">＋ 添加账号</button></div><div class="buttons"><button id="saveSetupButton" class="primary" onclick="saveSetup()">保存设置并检查</button></div><div id="setupError" class="error"></div></section>
<section class="card status"><h2 id="status">正在检查…</h2><div id="detail" class="muted">不会在检查阶段写入 Claude 数据。</div><div id="accounts" class="muted"></div></section>
<section class="metrics"><div class="card metric"><b id="add">—</b><span id="metricAdd">可新增会话</span></div><div class="card metric"><b id="title">—</b><span id="metricTitle">可更新标题</span></div><div class="card metric"><b id="conflict">—</b><span id="metricConflict">标题需选择</span></div><div class="card metric"><b id="skip">—</b><span id="metricSkip">本次跳过</span></div></section>
<section class="card"><h2 id="titleDetail">标题明细（冲突在这里选，不弹窗）</h2><div id="rows" class="table"></div></section>
<section class="card"><h2 id="reportTitle">检查报告</h2><pre id="report">—</pre></section>
<div class="buttons"><button id="checkButton" onclick="check()">重新检查</button><button id="sync" class="primary" disabled onclick="run('sync')">同步安全项</button><button id="close" disabled onclick="run('close-sync')">关闭 Claude 并同步</button><button id="reportButton" onclick="openReport()">打开最新报告</button><button id="copyButton" onclick="copyReport()">复制摘要</button><button id="exitButton" onclick="exitApp()">退出 ClaudeSync</button></div>
<p class="muted">选择标题后才会把选择交给同步核心。最后的确认框只确认写入或关闭动作。</p></main>
<script>
let actions=[];let titleGroups=[];let choices={};let latest='';let accountRows=[];let lastData=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={
 'zh-CN':{subtitle:'手动、可检查、跨平台的本地会话同步',metrics:['可新增会话','可更新标题','标题需选择','本次跳过'],detail:'标题明细（一个会话一行）',report:'检查报告',buttons:['重新检查','同步安全项','关闭 Claude 并同步','打开最新报告','复制摘要','退出 ClaudeSync'],setup:['第一次使用 ClaudeSync','先自动发现本机账号；只有发现不完整时才补充目录。设置只保存在本机。','会话索引根目录','正文目录','账号列表','＋ 添加账号','保存设置并检查'],headings:['状态','会话','各账号标题','处理','选择'],ready:'可以同步安全项',close:'需要先关闭 Claude',empty:'没有需要自动处理的项目',checking:'正在检查…',hint:'标题冲突已列在上方；选择一个账号标题或跳过。',account:'已检查账号：',accountPrefix:'账号',accountPath:'账号目录',remove:'删除',skip:'跳过',statuses:{safe:'可统一标题',normalize:'清理旧标记',conflict:'需要选择',auto_difference:'不猜测'},actions:{safe:'唯一手动标题',normalize:'去掉旧标记',conflict:'多个手动标题',auto_difference:'自动标题不同'}},
 en:{subtitle:'Manual, inspectable, cross-platform local session sync',metrics:['Sessions to add','Titles to update','Title choices','Skipped'],detail:'Title details (one row per session)',report:'Check report',buttons:['Check again','Sync safe items','Close Claude and sync','Open latest report','Copy summary','Exit ClaudeSync'],setup:['Set up ClaudeSync','ClaudeSync discovers local accounts first; add folders only when discovery is incomplete. Settings stay on this computer.','Session index root','Transcript folder','Accounts','＋ Add account','Save settings and check'],headings:['Status','Session','Titles by account','Action','Choice'],ready:'Ready to sync safe items',close:'Claude must be closed first',empty:'Nothing needs automatic handling',checking:'Checking…',hint:'Title conflicts are listed above; choose an account title or skip.',account:'Checked accounts: ',accountPrefix:'Account',accountPath:'Account folder',remove:'Remove',skip:'Skip',statuses:{safe:'Can unify',normalize:'Clean old marker',conflict:'Needs choice',auto_difference:'No guess'},actions:{safe:'One manual title',normalize:'Remove marker',conflict:'Multiple manual titles',auto_difference:'Different automatic titles'}},
 ja:{subtitle:'手動で確認できるクロスプラットフォーム同期',metrics:['追加するセッション','更新するタイトル','タイトル選択','スキップ'],detail:'タイトル詳細（セッションごとに1行）',report:'チェックレポート',buttons:['再チェック','安全な項目を同期','Claude を閉じて同期','最新レポートを開く','概要をコピー','ClaudeSync を終了'],setup:['ClaudeSync の初期設定','ローカルアカウントを先に自動検出します。不足がある場合だけフォルダーを追加します。設定はこのコンピューターに保存されます。','索引ルート','本文フォルダー','アカウント一覧','＋ アカウントを追加','保存してチェック'],headings:['状態','セッション','アカウント別タイトル','処理','選択'],ready:'安全な項目を同期できます',close:'先に Claude を閉じてください',empty:'自動処理する項目はありません',checking:'チェック中…',hint:'衝突は上に表示されています。アカウントのタイトルを選ぶかスキップしてください。',account:'確認したアカウント: ',accountPrefix:'アカウント',accountPath:'アカウントフォルダー',remove:'削除',skip:'スキップ',statuses:{safe:'統一可能',normalize:'古い印を削除',conflict:'選択が必要',auto_difference:'推測しない'},actions:{safe:'手動タイトルが1つ',normalize:'印を削除',conflict:'手動タイトルが複数',auto_difference:'自動タイトルが異なる'}},
 es:{subtitle:'Sincronización local manual, clara y multiplataforma',metrics:['Sesiones para añadir','Títulos para actualizar','Elecciones de título','Omitidos'],detail:'Detalles de títulos (una fila por sesión)',report:'Informe de comprobación',buttons:['Comprobar de nuevo','Sincronizar elementos seguros','Cerrar Claude y sincronizar','Abrir último informe','Copiar resumen','Salir de ClaudeSync'],setup:['Configurar ClaudeSync','ClaudeSync descubre primero las cuentas locales; añade carpetas solo si faltan. Se guardan en este equipo.','Raíz de índices','Carpeta de transcripciones','Cuentas','＋ Añadir cuenta','Guardar y comprobar'],headings:['Estado','Sesión','Títulos por cuenta','Acción','Elección'],ready:'Listo para sincronizar elementos seguros',close:'Primero debes cerrar Claude',empty:'No hay nada que procesar automáticamente',checking:'Comprobando…',hint:'Los conflictos están arriba; elige un título de cuenta u omite.',account:'Cuentas comprobadas: ',accountPrefix:'Cuenta',accountPath:'Carpeta de cuenta',remove:'Eliminar',skip:'Omitir',statuses:{safe:'Se puede unificar',normalize:'Limpiar marca antigua',conflict:'Requiere elección',auto_difference:'No adivinar'},actions:{safe:'Un título manual',normalize:'Quitar marca',conflict:'Varios títulos manuales',auto_difference:'Títulos automáticos distintos'}},
 'pt-BR':{subtitle:'Sincronização local manual, clara e multiplataforma',metrics:['Sessões para adicionar','Títulos para atualizar','Escolhas de título','Ignorados'],detail:'Detalhes dos títulos (uma linha por sessão)',report:'Relatório de verificação',buttons:['Verificar novamente','Sincronizar itens seguros','Fechar Claude e sincronizar','Abrir relatório mais recente','Copiar resumo','Sair do ClaudeSync'],setup:['Configurar ClaudeSync','O ClaudeSync descobre primeiro as contas locais; adicione pastas apenas se faltarem. As configurações ficam neste computador.','Raiz dos índices','Pasta de transcrições','Contas','＋ Adicionar conta','Salvar e verificar'],headings:['Status','Sessão','Títulos por conta','Ação','Escolha'],ready:'Pronto para sincronizar itens seguros',close:'Feche o Claude primeiro',empty:'Nada precisa de tratamento automático',checking:'Verificando…',hint:'Os conflitos estão acima; escolha um título de conta ou ignore.',account:'Contas verificadas: ',accountPrefix:'Conta',accountPath:'Pasta da conta',remove:'Remover',skip:'Ignorar',statuses:{safe:'Pode unificar',normalize:'Limpar marca antiga',conflict:'Precisa escolher',auto_difference:'Não adivinhar'},actions:{safe:'Um título manual',normalize:'Remover marca',conflict:'Vários títulos manuais',auto_difference:'Títulos automáticos diferentes'}}
};
function currentText(){return ui[localStorage.getItem('claudesync-language')||'zh-CN']||ui['zh-CN'];}
function localizedAccountLabel(label,index){return /^(账号|Account|アカウント|Cuenta|Conta)\s+\d+$/.test(String(label||''))?currentText().accountPrefix+' '+(index+1):label;}
function readAccountRows(){return [...document.querySelectorAll('#accountRows .account-row')].map((row,i)=>({label:localizedAccountLabel(row.querySelector('.account-label').value,i),path:row.querySelector('.account-path').value}));}
function renderAccountRows(initial){
  if(initial&&initial.length){accountRows=initial.map((item,i)=>({label:localizedAccountLabel(item.label||currentText().accountPrefix+' '+(i+1),i),path:item.path||''}));}
  if(!accountRows.length)accountRows=[{label:currentText().accountPrefix+' 1',path:''},{label:currentText().accountPrefix+' 2',path:''}];
  const t=currentText(),container=document.getElementById('accountRows');if(!container)return;
  container.innerHTML=accountRows.map((row,i)=>'<div class="account-row setup-grid"><label><span>'+esc(t.accountPrefix+' '+(i+1))+'</span><input class="account-label" value="'+esc(row.label)+'"></label><label><span>'+esc(t.accountPath)+'</span><input class="account-path" value="'+esc(row.path)+'" placeholder="/path/to/organization/account"></label></div>').join('');
}
function addAccountRow(){accountRows=readAccountRows();if(accountRows.length>=50)return;accountRows.push({label:currentText().accountPrefix+' '+(accountRows.length+1),path:''});renderAccountRows();}
function removeAccountRow(index){accountRows=readAccountRows();if(accountRows.length<=2)return;accountRows.splice(index,1);renderAccountRows();}
function changeLanguage(lang){localStorage.setItem('claudesync-language',lang);let t=currentText();document.getElementById('subtitle').textContent=t.subtitle;['metricAdd','metricTitle','metricConflict','metricSkip'].forEach((id,i)=>document.getElementById(id).textContent=t.metrics[i]);document.getElementById('titleDetail').textContent=t.detail;document.getElementById('reportTitle').textContent=t.report;['checkButton','sync','close','reportButton','copyButton','exitButton'].forEach((id,i)=>document.getElementById(id).textContent=t.buttons[i]);['setupTitle','setupHint','sessionRootLabel','projectsRootLabel','accountSetupTitle','addAccountButton','saveSetupButton'].forEach((id,i)=>document.getElementById(id).textContent=t.setup[i]);accountRows=readAccountRows();renderAccountRows();if(lastData)render(lastData);}
const savedLanguage=localStorage.getItem('claudesync-language')||'zh-CN';document.getElementById('language').value=savedLanguage;changeLanguage(savedLanguage);

function render(data){
  lastData=data;
  const t=currentText();
  if(data.setup_required){
    document.getElementById('setupCard').hidden=false;
    let d=data.defaults||{};
    if(!document.getElementById('sessionRoot').value)document.getElementById('sessionRoot').value=d.session_root||'';
    if(!document.getElementById('projectsRoot').value)document.getElementById('projectsRoot').value=d.projects_root||'';
    renderAccountRows(d.accounts||null);
    document.getElementById('status').textContent=t.setup[0];
    document.getElementById('detail').textContent=t.setup[1];
    return;
  }
  document.getElementById('setupCard').hidden=true;
  latest=data.report||'';
  document.getElementById('report').textContent=latest;
  let scan=data.scan||{},pre=data.preflight||{},counts=scan.counts||{},acts=scan.title_actions||[];
  actions=acts;titleGroups=scan.title_groups||[];
  let add=Object.values(counts).reduce((n,v)=>n+Number(v.will_add||0),0);
  let title=Object.values(counts).reduce((n,v)=>n+Number(v.will_update_titles||0),0);
  let conf=titleGroups.filter(g=>g.status==='conflict').length;
  let skip=(scan.entries||[]).filter(e=>!['add','branch','present','planned'].includes(e.status)).length;
  for(let [id,v] of Object.entries({add,title,conflict:conf,skip}))document.getElementById(id).textContent=v;
  document.getElementById('accounts').textContent=Object.keys(counts).length?t.account+Object.keys(counts).sort().map((label,i)=>localizedAccountLabel(label,i)).join(' / '):'';
  let blockers=pre.blockers||[];
  document.getElementById('status').textContent=blockers.length?t.close:(add||title?t.ready:t.empty);
  document.getElementById('detail').textContent=blockers.length?'只读检查完成；可以使用“关闭 Claude 并同步”。':t.hint;
  document.getElementById('sync').disabled=!!blockers||!(add||title);
  document.getElementById('close').disabled=!blockers;
  let html='<div class="row head">'+t.headings.map(h=>'<div>'+esc(h)+'</div>').join('')+'</div>';
  for(let g of titleGroups){
    let session=g.cliSessionId||'', conflict=g.status==='conflict';
    let options=g.options||[];
    let titles=options.map((o,i)=>esc(localizedAccountLabel(o.label,i))+'：'+esc(o.title)).join('；');
    let radios='';
    if(conflict){
      if(!choices[session])choices[session]=g.choice||'skip';
      radios=options.map(o=>'<label><input type="radio" name="choice-'+esc(session)+'" data-session="'+esc(session)+'" data-choice="'+esc(o.scope)+'" '+(choices[session]===o.scope?'checked':'')+'>'+esc(localizedAccountLabel(o.label, options.indexOf(o)))+'</label>').join('');
      radios+='<label><input type="radio" name="choice-'+esc(session)+'" data-session="'+esc(session)+'" data-choice="skip" '+(choices[session]==='skip'?'checked':'')+'>'+esc(t.skip)+'</label>';
      radios='<span class="choice">'+radios+'</span>';
    }
    let statusText=(t.statuses&&t.statuses[g.status])||g.status;
    let actionText=(t.actions&&t.actions[g.status])||g.status;
    html+='<div class="row '+(conflict?'conflict':'')+'"><div>'+esc(statusText)+'</div><div>'+esc(session.slice(0,12))+'…</div><div>'+titles+'</div><div>'+esc(actionText)+'</div><div>'+radios+'</div></div>';
  }
  document.getElementById('rows').innerHTML=html;
  document.querySelectorAll('#rows input[data-session]').forEach(input=>input.addEventListener('change',()=>choices[input.dataset.session]=input.dataset.choice));
}
async function check(){document.getElementById('status').textContent=currentText().checking;let r=await fetch('/api/check');render(await r.json())}
async function saveSetup(){
  let error=document.getElementById('setupError');error.textContent='';
  let accounts=readAccountRows();
  let body={session_root:document.getElementById('sessionRoot').value,projects_root:document.getElementById('projectsRoot').value,accounts:accounts};
  let r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let data=await r.json();if(!r.ok){error.textContent=data.error||'设置未保存';return}render(data)
}
async function run(mode){
  let groupChoices={};
  for(let group of titleGroups.filter(g=>g.status==='conflict'))groupChoices[group.cliSessionId]=choices[group.cliSessionId]||'skip';
  if(!confirm(mode==='close-sync'?'确认请求 Claude 正常退出并同步？':'确认同步安全项？'))return;
  let r=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,groups:groupChoices,choices:{}})});
  render(await r.json())
}
function openReport(){window.open('/api/report','_blank')};function copyReport(){navigator.clipboard?.writeText(latest)};async function exitApp(){await fetch('/api/shutdown',{method:'POST'});document.body.innerHTML='<main><div class="card"><h2>ClaudeSync 已退出</h2><p>可以关闭这个浏览器窗口。</p></div></main>'};check();
</script></body></html>'''


def run_command(mode, choices=None, groups=None):
    resolution = None
    try:
        if choices or groups:
            fd, resolution = tempfile.mkstemp(prefix="claudesync-title-resolutions-", suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"version": 2, "choices": choices or {}, "groups": groups or {}}, stream, ensure_ascii=False)
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
        try:
            save_config(BASE, discover_config(env.root, env.projects))
        except (OSError, ValueError):
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
                if isinstance(body.get("accounts"), list):
                    data = build_config_for_accounts(body.get("session_root", ""), body["accounts"],
                                                      body.get("projects_root", ""))
                else:
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
        self.send_json(run_command(
            mode,
            body.get("choices") if isinstance(body.get("choices"), dict) else {},
            body.get("groups") if isinstance(body.get("groups"), dict) else {},
        ))

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
