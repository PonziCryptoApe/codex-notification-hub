export const SETUP_UI_URI = "ui://codex-notification-hub/settings-v1.html";

/**
 * A dependency-free MCP Apps component. It never receives or renders existing
 * credentials; submitted values go directly to the local MCP server.
 */
export const setupUiHtml = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#1f2937;background:#fff}.wrap{max-width:580px;padding:20px}.hint{color:#667085;line-height:1.55}.row{margin:16px 0}label{display:block;font-weight:600;margin-bottom:7px}input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit}button{border:0;border-radius:6px;padding:9px 13px;background:#0f62fe;color:#fff;font:inherit;font-weight:600;cursor:pointer}button.secondary{background:#fff;color:#334155;border:1px solid #cbd5e1}button.danger{color:#b42318;border-color:#fecdca}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.status{min-height:20px;margin-top:12px}.ok{color:#067647}.error{color:#b42318}.privacy{margin-top:18px;padding:10px 12px;background:#f8fafc;border-radius:6px;color:#475467;line-height:1.5}</style>
</head><body><main class="wrap"><h2>飞书通知设置</h2><p class="hint" id="state">正在读取本机设置…</p>
<form id="settings"><div class="row"><label for="webhook">飞书机器人 Webhook URL</label><input id="webhook" type="url" required autocomplete="off" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"></div>
<div class="row"><label for="secret">签名密钥（建议填写）</label><input id="secret" type="password" autocomplete="new-password" placeholder="开启飞书签名校验后取得"></div>
<div class="actions"><button type="submit">保存并启用</button><button class="secondary danger" type="button" id="clear">清除本机设置</button></div></form>
<p id="message" class="status" role="status"></p><p class="privacy">凭据仅保存到本机插件私有目录，文件权限为当前用户可读写；页面和保存结果不会回显凭据，也不会写入项目或提交到 GitHub。建议开启 macOS FileVault。</p></main>
<script>
const message=document.getElementById('message'),state=document.getElementById('state'),form=document.getElementById('settings');
let nextId=1;const pending=new Map();
function request(method,params){const id=nextId++;window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}
window.addEventListener('message',event=>{const data=event.data;if(!data||data.jsonrpc!=='2.0')return;if(data.id&&pending.has(data.id)){const item=pending.get(data.id);pending.delete(data.id);data.error?item.reject(new Error(data.error.message||'操作失败')):item.resolve(data.result);}});
function setMessage(text,kind){message.textContent=text;message.className='status '+kind;}
function output(result){return result&&result.structuredContent?result.structuredContent:result;}
async function refresh(){try{const result=output(await request('tools/call',{name:'get_notification_settings',arguments:{}}));state.textContent=result&&result.enabled?'飞书通知已启用。已保存的凭据不会在页面中显示。':'尚未配置飞书通知。保存后才会向外发送消息。';}catch{state.textContent='可填写后保存。';}}
form.addEventListener('submit',async event=>{event.preventDefault();setMessage('正在保存…','');try{const result=output(await request('tools/call',{name:'save_feishu_settings',arguments:{webhookUrl:document.getElementById('webhook').value,signingSecret:document.getElementById('secret').value||undefined}}));document.getElementById('secret').value='';setMessage(result&&result.enabled?'已保存并启用飞书通知。':'保存失败。','ok');await refresh();}catch(error){setMessage(error.message||'保存失败。','error');}});
document.getElementById('clear').addEventListener('click',async()=>{if(!confirm('确定清除本机飞书通知设置吗？'))return;try{await request('tools/call',{name:'clear_notification_settings',arguments:{}});document.getElementById('webhook').value='';document.getElementById('secret').value='';setMessage('已清除，本插件不会再发送飞书通知。','ok');await refresh();}catch(error){setMessage(error.message||'清除失败。','error');}});refresh();
</script></body></html>`;
