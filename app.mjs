import {PagesStore} from './store.mjs';
import {wordDocument, download} from './word.mjs';
const backend = new PagesStore();
const $ = id => document.getElementById(id);
const state = {chapters: [], stats: {}, current: null, session: {}, sequence: 0, editBase: null,
  reviewBase: null, historyBase: null, historyRevision: null, mergeBase: null, saving: false};
const themes = {
  paper: {paper:'#f5f2eb',surface:'#faf8f3',sidebar:'#eeebe3',ink:'#302e28',muted:'#827c70',line:'#ded9ce',accent:'#925441',soft:'#eee0d7',success:'#47705d'},
  white: {paper:'#ffffff',surface:'#fafafa',sidebar:'#f4f5f4',ink:'#303530',muted:'#7a817a',line:'#e1e5df',accent:'#616e52',soft:'#e9eee3',success:'#47705d'},
  green: {paper:'#e4eddf',surface:'#edf3e9',sidebar:'#dce6d6',ink:'#303b2b',muted:'#788570',line:'#cbd8c4',accent:'#58744c',soft:'#d2e0ca',success:'#47705d'},
  night: {paper:'#242623',surface:'#2b2e2a',sidebar:'#20221f',ink:'#c8cbbf',muted:'#929889',line:'#3e443a',accent:'#c39275',soft:'#3d342b',success:'#9cae8c'}
};
function readLocal(key, fallback) {try {const v=localStorage.getItem(key); return v===null?fallback:JSON.parse(v);}catch {return fallback;}}
function writeLocal(key, value) {try {localStorage.setItem(key, JSON.stringify(value));}catch {}}
let preferences = readLocal('cz.reading.settings', {});
if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) preferences={};
let savedPositions=readLocal('cz.reading.positions', {});
if (!savedPositions || typeof savedPositions!=='object' || Array.isArray(savedPositions)) savedPositions={};
function date(value) {return value ? new Date(value).toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';}
function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4300);}
function dialog(id) {const el=$(id);if(!el.open)el.showModal();document.body.classList.add('modal-open');}
function closeDialog(id) {$(id).close();if(!document.querySelector('dialog[open]'))document.body.classList.remove('modal-open');}
document.querySelectorAll('dialog').forEach(el=>el.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.classList.remove('modal-open');}));
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>closeDialog(el.dataset.close)));
async function confirmAction(title, message, label='确认') {
  $('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-yes').textContent=label;dialog('confirm-dialog');
  return new Promise(resolve=>{
    const finish=result=>{closeDialog('confirm-dialog');$('confirm-yes').onclick=null;$('confirm-no').onclick=null;$('confirm-dialog').oncancel=null;resolve(result);};
    $('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);
    $('confirm-dialog').oncancel=e=>{e.preventDefault();finish(false);};
  });
}
async function api(path, data) { return backend.dispatch(path, data); }
async function refreshSession() {
  state.session=await api('/api/session');
  $('account-button').textContent=state.session.can_write?state.session.name:state.session.logged_in?'我的书房':'打开书房';
}
function showAuth() {
  $('auth-title').textContent='打开私人书房';
  $('auth-description').textContent='输入迁移版书房的访问密码，即可阅读全部章节。书稿直接保存在 GitHub，不需要家里的服务器开机。';
  $('name-field').hidden=true;$('confirm-field').hidden=true;$('auth-error').textContent='';
  $('password-field').hidden=false;$('auth-submit').hidden=false;
  $('editor-password').value='';$('confirm-password').value='';
  $('editor-password').autocomplete='current-password';
  $('auth-submit').textContent='打开书房';dialog('auth-dialog');
}
function showGitHub() {
  $('github-error').textContent='';$('github-token').value='';dialog('github-dialog');
}
function editorRequired() {
  if(!state.session.logged_in){showAuth();return false;}
  if(!state.session.can_write){showGitHub();return false;}
  return true;
}
$('account-button').onclick=()=>{if(!state.session.logged_in)return showAuth();$('account-name').textContent=`当前署名：${state.session.name}`;dialog('account-dialog');};
$('auth-form').onsubmit=async event=>{
  event.preventDefault();const setup=state.session.setup_required,password=$('editor-password').value;
  if(setup && (password.length<8||password!==$('confirm-password').value)){$('auth-error').textContent=password.length<8?'请设置至少 8 位密码。':'两次输入的密码不一致。';return;}
  $('auth-submit').disabled=true;
  try{await api(setup?'/api/setup':'/api/login',{password,name:$('editor-name').value});await refreshSession();closeDialog('auth-dialog');$('editor-password').value='';$('confirm-password').value='';if(!state.chapters.length)await initialize();toast('已打开书房');}
  catch(e){$('auth-error').textContent=e.message;if(e.status===409)await refreshSession().catch(()=>{});}
  finally{$('auth-submit').disabled=false;}
};
$('logout-button').onclick=async()=>{try{await api('/api/logout',{});await refreshSession();closeDialog('account-dialog');if(state.session.read_login_required){savePosition();state.current=null;state.chapters=[];$('chapter-shell').hidden=true;$('chapter-content').replaceChildren();$('chapter-list').replaceChildren();$('total-count').textContent='—';$('approved-count').textContent='—';await initialize();}toast('已退出编辑');}catch(e){toast(e.message);}};
$('change-password-button').onclick=()=>{closeDialog('account-dialog');$('password-form').reset();$('password-error').textContent='';dialog('password-dialog');};
$('password-form').onsubmit=async event=>{event.preventDefault();if($('new-password').value!==$('new-password-confirm').value){$('password-error').textContent='两次新密码不一致。';return;}const button=event.submitter;button.disabled=true;try{await api('/api/password',{old_password:$('old-password').value,password:$('new-password').value});$('password-form').reset();await refreshSession();closeDialog('password-dialog');showAuth();toast('密码已修改，请用新密码登录');}catch(e){$('password-error').textContent=e.message;}finally{button.disabled=false;}};

function applySettings() {
  const size=Number(preferences.size),line=Number(preferences.line);
  preferences.size=Number.isFinite(size)?Math.min(34,Math.max(16,size)):21;
  preferences.line=Number.isFinite(line)?Math.min(2.8,Math.max(1.5,line)):2;
  let theme=themes[preferences.theme]||themes.paper;
  if(preferences.theme==='custom' && /^#[a-f0-9]{6}$/i.test(preferences.color||'')) {
    const hex=preferences.color.slice(1);const channels=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const lum=channels.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    theme={...(lum<.24?themes.night:themes.paper),paper:preferences.color};
  }
  const root=document.documentElement;
  for(const [key,value]of Object.entries(theme))root.style.setProperty(`--${key==='soft'?'accent-soft':key}`,value);
  root.style.setProperty('--font-size',`${preferences.size}px`);root.style.setProperty('--line-height',preferences.line);
  root.style.setProperty('--book-font',preferences.family==='sans'?'"PingFang SC","Microsoft YaHei",sans-serif':'"Noto Serif SC","Songti SC","STSong","SimSun",serif');
  root.style.colorScheme=(theme===themes.night || theme.ink===themes.night.ink)?'dark':'light';
  $('font-size').value=preferences.size;$('font-value').value=preferences.size;
  $('line-height').value=preferences.line;$('line-value').value=preferences.line.toFixed(1);
  $('font-family').value=preferences.family==='sans'?'sans':'serif';
  $('custom-color').value=theme.paper;document.querySelector('meta[name="theme-color"]').content=theme.paper;
  document.querySelectorAll('[data-theme]').forEach(el=>{const selected=(preferences.theme||'paper')===el.dataset.theme;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});
  writeLocal('cz.reading.settings',preferences);updateProgress();
}
$('font-size').oninput=event=>{preferences.size=Number(event.target.value);applySettings();};
$('line-height').oninput=event=>{preferences.line=Number(event.target.value);applySettings();};
$('font-family').onchange=event=>{preferences.family=event.target.value;applySettings();};
$('custom-color').oninput=event=>{preferences.theme='custom';preferences.color=event.target.value;applySettings();};
document.querySelectorAll('[data-theme]').forEach(el=>el.onclick=()=>{preferences.theme=el.dataset.theme;applySettings();});
$('reset-settings').onclick=()=>{preferences={};applySettings();};
function toggleSettings(open) {$('settings-panel').hidden=!open;$('settings-button').setAttribute('aria-expanded',String(open));}
$('settings-button').onclick=()=>toggleSettings($('settings-panel').hidden);$('settings-close').onclick=()=>toggleSettings(false);
document.addEventListener('click',e=>{if(!$('settings-panel').hidden&&!$('settings-panel').contains(e.target)&&!$('settings-button').contains(e.target))toggleSettings(false);});
function toggleCatalog(open) {document.body.classList.toggle('catalog-open',open);$('scrim').hidden=!open;$('menu-button').setAttribute('aria-expanded',String(open));}
$('menu-button').onclick=()=>toggleCatalog(!document.body.classList.contains('catalog-open'));
$('scrim').onclick=()=>toggleCatalog(false);
$('to-catalog').onclick=()=>{if(matchMedia('(max-width:800px)').matches)toggleCatalog(true);locateCurrent();};
function locateCurrent() {const link=document.querySelector('.chapter-item.active');if(link){link.closest('details').open=true;link.scrollIntoView({block:'center'});}}
$('jump-current').onclick=locateCurrent;
function shortTitle(title) {return title.replace(/^第[零〇一二两三四五六七八九十百千万\d]+章[\s　·：:—-]*/, '');}
function renderCatalog() {
  const term=$('chapter-search').value.trim().toLowerCase(),filter=$('chapter-filter').value,current=state.current?.id;
  const items=state.chapters.filter(chapter=>(!term||chapter.title.toLowerCase().includes(term)||String(chapter.id).includes(term))&&
    (filter==='all'||filter===chapter.status||filter==='draft'&&chapter.source_stage==='draft'||filter==='conflict'&&chapter.conflict));
  const oldOpen=new Set([...document.querySelectorAll('.volume[open]')].map(x=>Number(x.dataset.volume)));
  const groups=new Map();for(const item of items){if(!groups.has(item.volume))groups.set(item.volume,[]);groups.get(item.volume).push(item);}
  const fragment=document.createDocumentFragment();
  for(const [volume,chapters] of groups){
    const details=document.createElement('details');details.className='volume';details.dataset.volume=volume;
    details.open=!!term||filter!=='all'||oldOpen.has(volume)||chapters.some(x=>x.id===current)||(!current&&volume===1);
    const summary=document.createElement('summary');const title=document.createElement('span');title.textContent=chapters[0].volume_title.replace(' · ',' · ');const count=document.createElement('small');count.textContent=`${chapters.length} 章`;summary.append(title,count);details.append(summary);
    for(const chapter of chapters){const link=document.createElement('a');link.href=`#chapter=${chapter.id}`;link.className='chapter-item'+(chapter.id===current?' active':'');link.dataset.id=chapter.id;if(chapter.id===current)link.setAttribute('aria-current','page');
      const id=document.createElement('span');id.className='chapter-id';id.textContent=String(chapter.id).padStart(3,'0');const label=document.createElement('span');label.className='chapter-label';label.textContent=shortTitle(chapter.title);
      const dot=document.createElement('span');dot.className='status-dot '+(chapter.conflict?'conflict':chapter.status==='approved'?'approved':chapter.source_stage==='draft'?'draft':'');dot.title=chapter.conflict?'有新稿待合并':chapter.status==='approved'?'已经批准':chapter.source_stage==='draft'?'新稿待审':'待审阅';link.title=`${chapter.title} · ${dot.title}`;
      link.append(id,label,dot);link.onclick=event=>{event.preventDefault();navigate(chapter.id);};details.append(link);
    }fragment.append(details);
  }
  if(!items.length){const empty=document.createElement('p');empty.className='empty muted';empty.textContent='没有符合条件的章节。';fragment.append(empty);}
  $('chapter-list').replaceChildren(fragment);$('total-count').textContent=state.stats.total??state.chapters.length;$('approved-count').textContent=state.stats.approved??0;
  $('source-summary').textContent=`${state.stats.draft||0} 章新稿待审 · 全书计划 1000 章`;
}
$('chapter-search').oninput=renderCatalog;$('chapter-filter').onchange=renderCatalog;
async function loadCatalog() {const result=await api('/api/chapters');state.chapters=result.chapters;state.stats=result.stats;renderCatalog();}
function updateChapter(chapter) {state.current=chapter;const index=state.chapters.findIndex(x=>x.id===chapter.id);if(index>=0)state.chapters[index]=chapter;state.stats.approved=state.chapters.filter(x=>x.status==='approved').length;state.stats.conflicts=state.chapters.filter(x=>x.conflict).length;renderChapter();renderCatalog();}
function renderChapter() {
  const chapter=state.current;if(!chapter)return;
  document.title=`${chapter.title} · 崇祯十年`;$('volume-label').textContent=chapter.volume_title;
  $('review-badge').textContent=chapter.status==='approved'?'已批准':'待审阅';$('review-badge').classList.toggle('approved',chapter.status==='approved');
  $('stage-badge').textContent=chapter.source_stage==='draft'?'新稿 · 尚未完成自审':'已完成写作自审';$('stage-badge').classList.toggle('draft',chapter.source_stage==='draft');
  $('chapter-number').textContent=`第 ${String(chapter.id).padStart(3,'0')} 章`;$('chapter-title').textContent=shortTitle(chapter.title);
  $('chapter-meta').textContent=`${chapter.words.toLocaleString()} 字　 /　 约 ${Math.max(1,Math.round(chapter.words/400))} 分钟　 /　 第 ${chapter.current_rev} 版`;
  const content=document.createDocumentFragment();for(const paragraph of chapter.content.split(/\n\s*\n/)){if(paragraph.trim()){const p=document.createElement('p');p.textContent=paragraph.trim();content.append(p);}}
  $('chapter-content').replaceChildren(content);$('conflict-banner').hidden=!chapter.conflict;
  $('word-link').href='#';
  $('approve-button').textContent=chapter.status==='approved'?'撤销批准':'批准本章';
  $('approve-button').classList.toggle('primary',chapter.status!=='approved');
  $('approval-info').hidden=chapter.status!=='approved';
  const approval=chapter.events?.find(x=>x.action==='approve'&&x.rev===chapter.current_rev);
  $('approval-info').textContent=chapter.status==='approved'?`${chapter.approved_by} 于 ${date(chapter.approved_at)} 批准了第 ${chapter.current_rev} 版。${approval?.note?'\n审阅备注：'+approval.note:''}`:'';
  const index=state.chapters.findIndex(x=>x.id===chapter.id);$('previous').disabled=index<=0;$('next').disabled=index>=state.chapters.length-1;
  $('chapter-shell').hidden=false;$('loading').hidden=true;$('load-error').hidden=true;requestAnimationFrame(updateProgress);
}
function savePosition() {if(!state.current||$('chapter-shell').hidden)return;savedPositions[state.current.id]=Math.max(0,window.scrollY);writeLocal('cz.reading.positions',savedPositions);writeLocal('cz.reading.last',state.current.id);}
async function navigate(id, options={}) {
  if(!Number.isInteger(id)||!state.chapters.some(x=>x.id===id))id=state.chapters[0]?.id;
  if(!id){$('loading').hidden=true;$('load-error').hidden=false;$('load-error-text').textContent='目前还没有可读的章节。';return;}
  savePosition();const sequence=++state.sequence;$('loading').hidden=false;$('chapter-shell').hidden=true;$('load-error').hidden=true;toggleCatalog(false);toggleSettings(false);
  try{const chapter=await api(`/api/chapters/${id}`);if(sequence!==state.sequence)return;updateChapter(chapter);
    if(!options.fromHistory){const method=options.replace?'replaceState':'pushState';history[method]({chapter:id},'',`#chapter=${id}`);}
    writeLocal('cz.reading.last',id);requestAnimationFrame(()=>{window.scrollTo(0,options.resume?Number(savedPositions[id])||0:0);updateProgress();});
  }catch(e){if(sequence!==state.sequence)return;$('loading').hidden=true;$('load-error').hidden=false;$('load-error-text').textContent=e.message;}
}
function hashChapter() {return Number(location.hash.match(/chapter=(\d+)/)?.[1])||null;}
window.addEventListener('popstate',()=>navigate(hashChapter(),{fromHistory:true,resume:true}));
document.querySelector('.brand').onclick=e=>{e.preventDefault();navigate(1);};
function adjacent(offset) {const index=state.chapters.findIndex(x=>x.id===state.current?.id);const chapter=state.chapters[index+offset];if(chapter)navigate(chapter.id);}
$('previous').onclick=()=>adjacent(-1);$('next').onclick=()=>adjacent(1);
function updateProgress() {const max=document.documentElement.scrollHeight-innerHeight;const percent=max>0?Math.min(100,Math.max(0,window.scrollY/max*100)):0;$('progress-bar').style.width=`${percent}%`;}
let positionTimer;window.addEventListener('scroll',()=>{updateProgress();clearTimeout(positionTimer);positionTimer=setTimeout(savePosition,300);},{passive:true});
window.addEventListener('resize',updateProgress);window.addEventListener('pagehide',savePosition);
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;if(e.key==='ArrowLeft')adjacent(-1);if(e.key==='ArrowRight')adjacent(1);if(e.key==='/'){e.preventDefault();if(matchMedia('(max-width:800px)').matches)toggleCatalog(true);$('chapter-search').focus();}if(e.key==='Escape'){toggleCatalog(false);toggleSettings(false);}});
$('refresh').onclick=async()=>{try{await backend.refresh();await loadCatalog();if(state.current)await navigate(state.current.id,{replace:true,resume:true});await refreshSession();toast('章节目录已更新');}catch(e){toast(e.message);}};
$('retry').onclick=()=>initialize();

function editDirty() {return !!state.editBase&&($('edit-title').value!==state.editBase.title||$('edit-content').value!==state.editBase.content||$('edit-note').value.trim()!=='');}
async function closeEditor() {if(state.saving)return;if(editDirty()&&!await confirmAction('放弃尚未保存的修改？','这些文字还没有保存到 GitHub。返回编辑可以继续修改。','放弃修改'))return;closeDialog('edit-dialog');state.editBase=null;}
$('edit-close').onclick=closeEditor;$('edit-cancel').onclick=closeEditor;
$('edit-dialog').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('edit-button').onclick=()=>{if(!state.current||!editorRequired())return;state.editBase={...state.current};$('edit-title').value=state.current.title;$('edit-content').value=state.current.content;$('edit-note').value='';$('edit-error').textContent='';$('edit-version').textContent=`第 ${state.current.id} 章 · 正在修改第 ${state.current.current_rev} 版`;$('edit-status').textContent=state.current.status==='approved'?'保存改动后需要重新批准':'每次保存都会生成新版本';dialog('edit-dialog');};
window.addEventListener('beforeunload',e=>{if($('edit-dialog').open&&editDirty()){e.preventDefault();e.returnValue='';}});
$('edit-form').onsubmit=async e=>{e.preventDefault();if(state.saving||!state.editBase)return;state.saving=true;$('save-button').disabled=true;$('edit-error').textContent='';try{const result=await api(`/api/chapters/${state.editBase.id}/save`,{expected_rev:state.editBase.current_rev,title:$('edit-title').value,content:$('edit-content').value,note:$('edit-note').value});updateChapter(result);closeDialog('edit-dialog');state.editBase=null;toast(`已保存为第 ${result.current_rev} 版，等待你批准`);}catch(error){$('edit-error').textContent=error.message;}finally{state.saving=false;$('save-button').disabled=false;}};
$('approve-button').onclick=()=>{if(!state.current||!editorRequired())return;state.reviewBase={...state.current};const approved=state.current.status==='approved';$('review-title').textContent=approved?'撤销本章批准':'批准这一章';$('review-description').textContent=approved?`第 ${state.current.current_rev} 版会恢复为待审阅，已有批准记录仍可查看。`:`你将批准「${state.current.title}」的第 ${state.current.current_rev} 版。之后再修改正文，需要重新批准。`;$('review-submit').textContent=approved?'确认撤销批准':'确认批准当前版本';$('review-note').value='';$('review-error').textContent='';dialog('review-dialog');};
$('review-form').onsubmit=async e=>{e.preventDefault();const base=state.reviewBase;if(!base)return;$('review-submit').disabled=true;try{const action=base.status==='approved'?'unapprove':'approve';const result=await api(`/api/chapters/${base.id}/${action}`,{expected_rev:base.current_rev,note:$('review-note').value});updateChapter(result);closeDialog('review-dialog');toast(action==='approve'?'本章已批准':'已撤销批准');}catch(error){$('review-error').textContent=error.message;}finally{$('review-submit').disabled=false;}};

$('history-button').onclick=async()=>{
  if(!state.current)return;if(!state.session.logged_in)return showAuth();state.historyBase={...state.current};state.historyRevision=null;$('history-list').replaceChildren();$('history-title').textContent='正在载入…';$('history-meta').textContent='';$('history-content').textContent='';$('history-error').textContent='';$('restore-button').hidden=true;$('review-events').replaceChildren();dialog('history-dialog');
  try{const rows=await api(`/api/chapters/${state.historyBase.id}/history`);for(const row of rows){const button=document.createElement('button');button.className='revision-item';button.dataset.rev=row.rev;const strong=document.createElement('strong');strong.textContent=`第 ${row.rev} 版${row.rev===state.historyBase.current_rev?' · 当前稿':''}`;const small=document.createElement('small');small.textContent=`${row.author} · ${date(row.created_at)}`;const reason=document.createElement('small');reason.textContent=row.reason;button.append(strong,small,reason);button.onclick=()=>selectRevision(row.rev);$('history-list').append(button);}if(rows.length)await selectRevision(rows[0].rev);
    const events=state.historyBase.events||[];if(events.length){const title=document.createElement('h3');title.className='review-events-heading';title.textContent='审阅与合并记录';$('review-events').append(title);for(const event of events){const div=document.createElement('div');div.className='event-item';div.textContent=`${event.author} · ${event.action==='approve'?'批准':event.action==='unapprove'?'撤销批准':'保留当前稿'}第 ${event.rev} 版${event.note?'\n'+event.note:''}`;const small=document.createElement('small');small.textContent=date(event.created_at);div.append(small);$('review-events').append(div);}}
  }catch(e){$('history-error').textContent=e.message;}
};
let historySequence=0;
async function selectRevision(rev) {const sequence=++historySequence;$('restore-button').hidden=true;try{const row=await api(`/api/chapters/${state.historyBase.id}/history/${rev}`);if(sequence!==historySequence)return;state.historyRevision=row;$('history-title').textContent=row.title;$('history-meta').textContent=`第 ${row.rev} 版 · ${row.author} · ${date(row.created_at)} · ${row.reason}`;$('history-content').textContent=row.content;$('restore-button').hidden=row.rev===state.historyBase.current_rev;document.querySelectorAll('.revision-item').forEach(el=>el.classList.toggle('selected',Number(el.dataset.rev)===rev));}catch(e){$('history-error').textContent=e.message;}}
$('restore-button').onclick=async()=>{if(!editorRequired())return;const base=state.historyBase,revision=state.historyRevision;if(!base||!revision||!await confirmAction('恢复这个历史版本？',`第 ${revision.rev} 版会成为一个新的当前版本，现有稿件仍保存在版本记录中。本章需要重新批准。`,'确认恢复'))return;$('restore-button').disabled=true;try{const result=await api(`/api/chapters/${base.id}/restore`,{expected_rev:base.current_rev,revision:revision.rev});updateChapter(result);closeDialog('history-dialog');toast(`已恢复为第 ${result.current_rev} 版`);}catch(e){$('history-error').textContent=e.message;}finally{$('restore-button').disabled=false;}};
$('merge-button').onclick=()=>{if(!state.current?.incoming||!editorRequired())return;state.mergeBase={...state.current};$('merge-current').textContent=state.current.title+'\n\n'+state.current.content;$('merge-incoming').textContent=state.current.incoming.title+'\n\n'+state.current.incoming.content;$('merge-error').textContent='';dialog('merge-dialog');};
async function resolveIncoming(choice) {const base=state.mergeBase;if(!base)return;if(choice==='adopt'&&!await confirmAction('采用同步的新稿？','当前稿会保留在版本记录中，新稿会成为新的当前版本，并重新等待批准。','采用新稿'))return;$('keep-current').disabled=true;$('adopt-incoming').disabled=true;try{const result=await api(`/api/chapters/${base.id}/resolve`,{expected_rev:base.current_rev,choice,incoming_hash:base.incoming.hash});updateChapter(result);closeDialog('merge-dialog');toast(choice==='keep'?'已保留你的当前稿':'已采用同步的新稿');}catch(e){$('merge-error').textContent=e.message;}finally{$('keep-current').disabled=false;$('adopt-incoming').disabled=false;}}
$('keep-current').onclick=()=>resolveIncoming('keep');$('adopt-incoming').onclick=()=>resolveIncoming('adopt');
async function initialize() {
  $('loading').hidden=false;$('load-error').hidden=true;
  $('load-error-title').textContent='书稿暂时没有载入';$('retry').textContent='重新载入';$('retry').onclick=initialize;
  try{await refreshSession();if(state.session.read_login_required&&!state.session.logged_in){$('loading').hidden=true;$('chapter-shell').hidden=true;$('load-error').hidden=false;$('load-error-title').textContent='欢迎回到私人书房';$('load-error-text').textContent=state.session.setup_required?'书房尚未启用，请先由站点所有者在服务器终端设置访问密码。':'登录后即可继续阅读、修改正文和批准章节。';$('retry').textContent=state.session.setup_required?'查看首次启用说明':'登录并打开书房';$('retry').onclick=showAuth;return;}await loadCatalog();const explicit=hashChapter();const last=Number(readLocal('cz.reading.last',1));await navigate(explicit||last,{replace:true,resume:!explicit||explicit===last});}
  catch(e){$('loading').hidden=true;$('load-error').hidden=false;$('load-error-text').textContent=e.message;}
}

$('word-link').onclick=event=>{
  event.preventDefault();if(!state.current)return;
  download(wordDocument(state.current.title,state.current.content),state.current.title+'.docx');
};
$('connect-github').onclick=()=>{closeDialog('account-dialog');showGitHub();};
$('github-form').onsubmit=async event=>{
  event.preventDefault();$('github-submit').disabled=true;$('github-error').textContent='';
  try{
    await backend.connect($('github-token').value,$('github-name').value,$('github-remember').checked);
    $('github-token').value='';await refreshSession();await loadCatalog();if(state.current)await navigate(state.current.id,{replace:true,resume:true});closeDialog('github-dialog');toast('已连接 GitHub，可以修改和批准章节');
  }catch(error){$('github-error').textContent=error.message;}
  finally{$('github-submit').disabled=false;}
};
$('export-book').onclick=async()=>{
  const button=$('export-book');button.disabled=true;
  try{
    const snapshot=await backend.export((done,total)=>{button.textContent='正在导出 '+done+' / '+total;});
    download(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),'崇祯十年_全书与版本记录.json');
    toast('全书与版本记录已导出');
  }catch(error){toast(error.message);}
  finally{button.disabled=false;button.textContent='导出全书与版本记录';}
};
const originalLogout=$('logout-button').onclick;
$('logout-button').onclick=async()=>{
  await originalLogout();
  if(!backend.key){
    for(const id of ['history-content','history-title','history-list','review-events','merge-current','merge-incoming'])$(id).replaceChildren();
    for(const id of ['edit-form','review-form','github-form'])$(id).reset();
    state.editBase=state.reviewBase=state.historyBase=state.historyRevision=state.mergeBase=null;
  }
};

applySettings();initialize();
