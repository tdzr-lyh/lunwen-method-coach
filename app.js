(function () {
  'use strict';
  const modules = (globalThis.THESIS_MODULES || []).sort((a, b) => a.id.localeCompare(b.id));
  const tasks = modules.flatMap(module => module.tasks.map(task => ({...task, module})));
  const M = globalThis.ThesisModel;
  const KEY = 'lunwen-method-coach:v1';
  const main = document.getElementById('main');
  const icons = {
    home:'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z',
    route:'M4 5h5v5H4zM15 14h5v5h-5zM9 7h7a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h7',
    lab:'M9 3h6M10 3v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M7 16h10',
    review:'M4 10a8 8 0 1 1 1 8M4 4v6h6M12 8v5l3 2',
    record:'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
    clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
    arrow:'M5 12h14M13 6l6 6-6 6',
    book:'M3 4h7a2 2 0 0 1 2 2v15a3 3 0 0 0-3-2H3zM21 4h-7a2 2 0 0 0-2 2v15a3 3 0 0 1 3-2h6z',
    check:'M5 12l4 4L19 6',
    data:'M4 6c0-5 16-5 16 0s-16 5-16 0v12c0 5 16 5 16 0V6M4 12c0 5 16 5 16 0',
    cluster:'M8 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0M20 6a2 2 0 1 0-4 0 2 2 0 0 0 4 0M15 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0M8 8l8-1M7 9l5 7M17 8l-3 8',
    feature:'M4 5h16M4 12h16M4 19h16M8 2v6M15 9v6M10 16v6',
    risk:'M12 3l10 18H2zM12 9v5M12 17h.01',
    screen:'M3 4h18v13H3zM8 22h8M12 17v5',
    download:'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
    shield:'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6zM8 12l3 3 5-6'
  };
  function icon(name, size=18) {return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.book}"></path></svg>`;}
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const findTask = id => tasks.find(task => task.id === id);
  const record = id => state.tasks[id] || null;
  const done = id => record(id)?.status === 'completed';
  const editable = id => state.activeTaskId === id && !done(id);
  const taskNumber = task => String(tasks.findIndex(item => item.id === task.id) + 1).padStart(2, '0');
  let state, storageWarning = '', pendingImport = null, toastTimer, activeLab = 'features';
  let recoveryRaw = null, startupRaw = null;
  let guestState = null, cloud = null, accountUser = null, cloudBootPending = false;
  let cloudKind = 'connecting', cloudMessage = '正在连接云同步…', cloudTimer = null, cloudConflict = null;
  let authMode = 'signin', authBusy = false;
  let lastCompleted = null, glossaryQuery = '', clusterStep = 0;
  let featureInputs = {last:'2024-12-28',reference:'2025-01-02',frequency:'5',monetary:'1000',click:'50',cart:'15'};
  let matrixInputs = {tp:'1855',fp:'3332',fn:'138',tn:'14410'};
  const labState = {reviewAnswers:{},reviewFeedback:{}};
  try {
    if (!M || !tasks.length) throw new Error('课程文件未加载完整');
    startupRaw = localStorage.getItem(KEY);
    state = startupRaw ? M.normalizeState(JSON.parse(startupRaw), tasks) : M.freshState();
  } catch (error) {
    state = M ? M.freshState() : null;
    recoveryRaw = startupRaw;
    storageWarning = `未能恢复本机记录：${error.message}。原记录未被自动覆盖，请先在学习记录页导出待检查记录；确认后再继续学习。`;
  }
  if (state) guestState = M.normalizeState(state, tasks);
  function persist(next) {
    if (cloudBootPending) throw new Error('正在恢复账号的云端记录，请稍等再修改。');
    state = next;
    if (accountUser && cloud) {
      cloud.stage(state);
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(() => { void cloud.pull(); }, 400);
    } else {
      guestState = M.normalizeState(state, tasks);
      try {localStorage.setItem(KEY, JSON.stringify(state)); storageWarning = '';}
      catch (_) {storageWarning = '当前浏览器无法保存进度。此次操作暂存在页面内，关闭后可能丢失；请到学习记录页导出备份。';}
    }
    updateChrome();
  }
  function hasProgress(value) { return !!value && Object.keys(value.tasks || {}).length > 0; }
  function legacyHandled() {
    try { return !!accountUser && localStorage.getItem(KEY + ':legacy-handled:' + accountUser.id) === '1'; }
    catch (_) { return false; }
  }
  function markLegacyHandled() {
    if (!accountUser) return;
    try { localStorage.setItem(KEY + ':legacy-handled:' + accountUser.id, '1'); } catch (_) { /* optional reminder */ }
  }
  function updateCloudUI() {
    const accountLabel = document.getElementById('accountLabel');
    if (accountLabel) accountLabel.textContent = accountUser ? accountUser.email || '我的账号' : '登录同步';
    const saveLabel = document.getElementById('saveLabel');
    const readyLabel = cloud?.current().hasRemote ? '已与云端同步' : '账号已连接';
    if (saveLabel) saveLabel.textContent = accountUser ? ({ready:readyLabel,pending:'等待上传',syncing:'正在同步…',offline:'离线暂存',error:'同步未完成',conflict:'需要核对记录'}[cloudKind] || '正在恢复记录…') : '未登录，仅此设备保存';
    const syncBadge = document.getElementById('syncBadge');
    if (syncBadge) {
      syncBadge.textContent = accountUser ? ({ready:cloud?.current().hasRemote?'已同步':'已连接',pending:'等待上传',syncing:'同步中',offline:'离线暂存',error:'同步失败',conflict:'待核对'}[cloudKind] || '恢复中') : '未登录';
      syncBadge.className = 'sync-badge ' + cloudKind;
      syncBadge.title = cloudMessage;
    }
    const dot = document.getElementById('syncDot');
    if (dot) dot.className = ['offline','error','pending','conflict'].includes(cloudKind) ? (cloudKind === 'conflict' ? 'error' : cloudKind) : '';
    const notice = document.getElementById('cloudNotice');
    if (!notice) return;
    let text = '', action = '', label = '';
    if (!accountUser) {
      text = '电脑、平板和手机共用同一份进度：请在每台设备登录同一个邮箱账号。'; action = 'account'; label = '登录同步';
    } else if (cloudBootPending) {
      text = '正在恢复账号的云端学习记录，请稍等。';
    } else if (cloudKind === 'conflict') {
      text = cloudMessage; action = 'sync-conflict'; label = '核对两份记录';
    } else if (['offline','error'].includes(cloudKind)) {
      text = cloudMessage; action = 'sync-now'; label = '重新同步';
    } else if (hasProgress(guestState) && !legacyHandled()) {
      const count = M.summary(guestState, tasks).completed;
      text = `此设备还保留着登录前的学习记录（已完成 ${count} 组）。可以把这份原进度同步到当前账号。`;
      action = 'adopt-local'; label = '同步本机原进度';
    }
    notice.hidden = !text;
    notice.className = 'cloud-notice ' + cloudKind;
    notice.innerHTML = text ? `<span>${esc(text)}</span>${action ? `<button class="btn small" data-action="${action}">${esc(label)}</button>` : ''}` : '';
    const detail = document.getElementById('accountSyncStatus');
    if (detail) detail.textContent = cloudMessage;
  }
  function applyCloudState(value) {
    try {
      state = value && Object.keys(value).length ? M.normalizeState(value, tasks) : M.freshState();
      cloudBootPending = false; lastCompleted = null;
      render(false);
    } catch (_) {
      cloudKind = 'error'; cloudMessage = '云端记录格式暂时无法恢复，此设备原记录已保留，请导出备份后联系维护。';
      updateCloudUI();
    }
  }
  function startCloud() {
    if (!globalThis.ThesisCloud?.CloudSync) {
      cloudKind = 'error'; cloudMessage = '云同步文件未能加载，请刷新页面重试。'; updateCloudUI(); return;
    }
    cloud = new globalThis.ThesisCloud.CloudSync({
      validateState: value => M.normalizeState(value, tasks),
      onAuth(user, snapshot) {
        accountUser = user; cloudConflict = null; lastCompleted = null;
        cloudBootPending = !!user && !snapshot?.state;
        state = user ? (snapshot?.state ? M.normalizeState(snapshot.state, tasks) : M.freshState()) : M.normalizeState(guestState || M.freshState(), tasks);
        render(false);
      },
      onRemote: applyCloudState,
      onStatus(kind, message) {
        cloudKind = kind; cloudMessage = message;
        if (['ready','offline','error','conflict','signed-out','local'].includes(kind)) cloudBootPending = false;
        updateCloudUI();
      },
      onConflict(value) {cloudConflict = value; updateCloudUI();}
    });
    void cloud.init();
  }
  function toast(text) {
    const box = document.getElementById('toast'); box.textContent = text; box.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => {box.hidden = true;}, 3300);
  }
  function updateChrome() {
    if (!state) return;
    const s = M.summary(state, tasks);
    document.getElementById('sideProgress').style.width = `${s.percent}%`;
    document.getElementById('sideProgressText').textContent = `${s.completed} / ${s.total} 组已完成 · ${s.percent}%`;
    document.getElementById('courseCount').textContent = modules.length;
    const badge = document.getElementById('mistakeCount'); badge.textContent = s.mistakes; badge.hidden = !s.mistakes;
    const notice = document.getElementById('storageNotice'); notice.textContent = storageWarning; notice.hidden = !storageWarning;
    document.getElementById('saveLabel').textContent = storageWarning ? '保存状态需要处理' : '进度保存在当前浏览器';
    document.getElementById('todayDate').textContent = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'short'}).format(new Date());
    const route = location.hash.slice(1).split('/')[0] || 'today';
    const nav = route === 'task' ? 'today' : route === 'reference' ? 'lab' : route;
    document.querySelectorAll('[data-nav]').forEach(a => {const on = a.dataset.nav === nav; a.classList.toggle('active', on); if(on) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');});
    const labels = {today:'任务大厅',roadmap:'学习路线',lab:'方法实验室',reviews:'错题复习',records:'学习记录',reference:'论文口径与资料',task:'当前学习任务'};
    document.getElementById('breadcrumb').innerHTML = `我的学习空间 <b>/</b> ${labels[route] || '任务大厅'}`;
    updateCloudUI();
  }
  function heading(kicker, title, description, aside='') {return `<div class="page-heading"><div><div class="overline">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${aside ? `<div class="heading-note">${aside}</div>` : ''}</div>`;}
  function go(hash) {if(location.hash === hash) render(); else location.hash = hash;}
  function sourceLink(source) {
    const url = /^(https?:\/\/|#reference)/.test(source.url || '') ? source.url : '#reference';
    return `<a href="${esc(url)}" ${url[0] !== '#' ? 'target="_blank" rel="noopener noreferrer"' : ''}>${esc(source.label)} ↗</a>`;
  }
  function sources(task) {return `<div class="source-links"><span>学习依据</span>${(task.sources || []).map(sourceLink).join('')}</div>`;}
  function pipeline(task) {
    const n = Number(task?.module.id.slice(1) || 1);
    const current = n <= 2 ? 0 : n <= 4 ? 1 : n <= 8 ? 2 : n <= 10 ? 3 : 4;
    const rows = [['data','检查数据','一行对应一名用户'],['feature','构建特征','消费与行为怎样表示'],['cluster','形成群体','相似用户怎样分在一起'],['risk','识别规则风险','模型怎样比较和评分'],['screen','展示与解释','数据怎样出现在网站']];
    return `<section class="paper compact-panel"><div class="panel-title"><h3>先把整条方法链串起来</h3></div><div class="pipeline">${rows.map((r,i)=>`<div class="pipeline-row ${i===current?'current':''}"><span class="pipeline-node">${icon(r[0],16)}</span><div><strong>${r[1]}</strong><small>${r[2]}</small></div></div>`).join('')}</div></section>`;
  }
  function todayPage() {
    const next = M.nextTask(state, tasks), s = M.summary(state, tasks);
    const active = !!state.activeTaskId;
    const success = lastCompleted ? `<div class="success-banner">${icon('check',23)}<div><h3>第 ${taskNumber(findTask(lastCompleted))} 组已完成，记录已保存。</h3><p>可以先休息，也可以按自己的节奏领取下一组。</p></div></div>` : '';
    const mission = next ? `<section class="paper"><div class="mission-head"><div class="mission-id"><span class="mission-number">${taskNumber(next)}</span><div><small>本轮学习任务</small><strong>${esc(next.module.title)}</strong></div></div><span class="pill ${active?'gold':''}">${active?'进行中':'可以领取'}</span></div><div class="mission-body"><span class="mini-label">${esc(next.module.chapter)} · 第 ${next.module.tasks.indexOf(next)+1 || Number(next.id.slice(-2))} 小节</span><h2>${esc(next.title)}</h2><p class="lead">${esc(next.goal)}</p><div class="task-meta"><span>${icon('clock',15)}建议 ${next.minutes} 分钟</span><span>${icon('book',15)}讲解 + 例题</span><span>${icon('check',15)}3 道自测 + 口述</span></div><div class="outcomes"><span>完成这组，你应该能</span>${next.oral.checklist.map(x=>`<p><i class="check-dot">✓</i>${esc(x)}</p>`).join('')}</div><div class="action-line"><button class="btn primary" data-action="${active?'continue':'claim'}" data-id="${next.id}">${active?'继续这组任务':`领取第 ${taskNumber(next)} 组任务`}${icon('arrow',17)}</button><small>${active?'答案、笔记和自测记录已保留':'每次领取一组，完成后再手动领取下一组。'}</small></div></div><div class="mission-bottom">${icon('shield',16)}<span>以理解和复述为目标，按掌握程度推进。笔记选填，用时只作参考。</span></div></section>` : `<section class="paper all-done"><span class="pill">33 组学习任务已完成</span><h2>现在，试着把整个系统讲一遍。</h2><p>从原始用户数据讲到网页展示。遇到卡点，回到对应章节；完整记录已保留。</p><div class="action-line"><a class="btn primary" href="#lab/exam">开始综合口述${icon('arrow')}</a><a class="btn" href="#roadmap">回看学习路线</a></div></section>`;
    const currentIndex = next ? modules.findIndex(m=>m.id===next.module.id) : modules.length-1;
    const previews = modules.slice(Math.min(currentIndex, modules.length-3), Math.min(currentIndex, modules.length-3)+3);
    return heading('循序领任务 · 学会再往前走','今天，讲清一个方法。','从论文里的概念出发，用例子理解，再把它讲成自己的话。',`已完成 <strong>${s.completed}</strong> / ${s.total} 组`)+success+`<div class="dashboard"><div>${mission}</div><aside class="right-column">${pipeline(next)}<section class="note-panel"><h3>先记住这个研究边界</h3><p>项目使用用户级汇总记录。风险模型识别的是当前规则风险，尚未验证未来真实流失；解释效果时也要说明误报和指标取舍。</p><a href="#reference">查看容易说错的口径 ↗</a></section></aside></div><div class="section-heading"><h2>你的学习路线</h2><a href="#roadmap">查看全部 ${modules.length} 个模块 ↗</a></div><div class="module-preview">${previews.map(m=>`<a class="module-small" href="#roadmap/${m.id}"><div class="module-small-top"><span>模块 ${m.id.slice(1)}</span><span>${m.tasks.filter(t=>done(t.id)).length} / ${m.tasks.length} 组</span></div><h3>${esc(m.title)}</h3><p>${esc(m.description)}</p><small>${esc(m.chapter)} · 查看任务 →</small></a>`).join('')}</div>`;
  }
  function roadmapPage() {
    const s = M.summary(state,tasks), next = M.nextTask(state,tasks);
    return heading('11 个模块 · 33 组任务','按这条路线，把方法学完整。','从数据和基础概念开始，再学分群、风险识别与网站实现。可以预览全部内容，领取按顺序推进。')+`<div class="course-progress"><div class="goal-track"><span style="width:${s.percent}%"></span></div><small>${s.completed} / ${s.total} 组已完成 · ${s.percent}%</small></div>`+modules.map(m=>`<section class="paper roadmap-module" id="${m.id}"><header class="module-header"><span class="module-index">${m.id.slice(1)}</span><div><h2>${esc(m.title)}</h2><p>${esc(m.description)}</p></div><span class="pill neutral">${esc(m.chapter)}</span></header>${m.tasks.map(t=>{const finished=done(t.id),on=state.activeTaskId===t.id,available=!state.activeTaskId&&next?.id===t.id;return `<div class="task-row"><span class="row-icon ${finished?'done':on?'active':''}">${finished?'✓':taskNumber(t)}</span><div class="row-body"><h3>${esc(t.title)}</h3><p>${esc(t.goal)}</p></div><div class="row-actions"><small>${t.minutes} 分钟</small>${on?`<a class="btn small primary" href="#task/${t.id}/learn">继续</a>`:finished?`<a class="btn small" href="#task/${t.id}/learn">回看</a>`:available?`<button class="btn small primary" data-action="claim" data-id="${t.id}">领取</button>`:`<a class="btn small" href="#task/${t.id}/learn">预览</a>`}</div></div>`;}).join('')}</section>`).join('');
  }
  const steps = [['learn','读懂方法'],['practice','算一算'],['quiz','做自测'],['oral','讲出来']];
  function taskPage(id, tab='learn') {
    const task=findTask(id); if(!task)return empty('没有找到这组任务','请从学习路线打开有效任务。','查看学习路线','#roadmap');
    if(!steps.some(x=>x[0]===tab))tab='learn';
    const r=record(id), canEdit=editable(id), finished=done(id), preview=!canEdit&&!finished;
    return `<div class="task-page"><a class="back-link" href="#${finished?'roadmap':'today'}">← 返回${finished?'学习路线':'任务大厅'}</a><div class="task-title-row"><div><div class="overline">第 ${taskNumber(task)} 组 / ${tasks.length} · ${esc(task.module.shortTitle || task.module.title)}</div><h1>${esc(task.title)}</h1><p>${esc(task.goal)}</p></div><span class="pill ${finished?'':canEdit?'gold':'neutral'}">${finished?'已完成 · 回看':canEdit?'正在学习':'内容预览'}</span></div><div class="task-tabs" role="tablist" aria-label="任务步骤">${steps.map((s,i)=>`<button role="tab" aria-selected="${s[0]===tab}" class="${s[0]===tab?'active':''}" data-action="task-tab" data-id="${id}" data-tab="${s[0]}"><small>${i+1}</small>${s[1]}</button>`).join('')}</div>${preview?'<div class="notice gold">这是内容预览。学习进度按顺序推进，请在任务大厅领取当前任务；预览不会记录成绩。</div>':''}${finished?'<div class="notice green">这组任务已经完成，答案和笔记按完成时记录保留。你可以回看讲解与解析，重新口述自检。</div>':''}<section class="paper reader">${tab==='learn'?lesson(task):tab==='practice'?practice(task):tab==='quiz'?quiz(task,r,canEdit):oral(task,r,canEdit)}</section><div class="task-bottom-nav">${steps.findIndex(s=>s[0]===tab)>0?`<button class="btn" data-action="task-tab" data-id="${id}" data-tab="${steps[steps.findIndex(s=>s[0]===tab)-1][0]}">← ${steps[steps.findIndex(s=>s[0]===tab)-1][1]}</button>`:'<a class="btn" href="#roadmap">查看学习路线</a>'}${tab!=='oral'?`<button class="btn primary" data-action="task-tab" data-id="${id}" data-tab="${steps[steps.findIndex(s=>s[0]===tab)+1][0]}">下一步：${steps[steps.findIndex(s=>s[0]===tab)+1][1]} ${icon('arrow')}</button>`:''}</div></div>`;
  }
  function lesson(task) {
    return `<p class="reading-intro">先把术语弄明白，再看项目怎样使用它。读完后，用自己的话概括每段的意思。</p><dl class="term-grid">${task.terms.map(t=>`<div class="term"><dt>${esc(t.name)}</dt><dd>${esc(t.meaning)}</dd></div>`).join('')}</dl>${task.lesson.map(s=>`<section class="lesson-section"><h2>${esc(s.title)}</h2><p>${esc(s.body)}</p></section>`).join('')}${task.formulas.map(f=>`<div class="formula"><code>${esc(f.expression)}</code><p>${esc(f.explanation)}</p></div>`).join('')}<div class="example"><h3>${esc(task.example.title)}</h3><p>${esc(task.example.body)}</p></div><h3>放回你的论文里</h3><ul class="fact-list">${task.projectFacts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h3>这些地方要讲准确</h3><ul class="pitfall-list">${task.pitfalls.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${sources(task)}`;
  }
  function practice(task) {
    const related = ({m03:'features',m05:'cluster',m06:'cluster',m10:'metrics'})[task.module.id];
    return `<div class="overline">用一个小例子，验证自己是否理解</div><h2 style="font-size:21px;margin-bottom:20px">先自己想，再展开参考思路。</h2><section class="lesson-section"><p>${esc(task.practice.prompt)}</p></section><details><summary>展开参考思路</summary><p>${esc(task.practice.answer)}</p></details>${task.formulas.length?`<h3 style="margin-top:26px">对照公式</h3>${task.formulas.map(f=>`<div class="formula"><code>${esc(f.expression)}</code><p>${esc(f.explanation)}</p></div>`).join('')}`:''}${related?`<div class="notice" style="margin-top:24px">想换一组数字试试？<a class="text-button" href="#lab/${related}">打开对应小实验 ↗</a></div>`:''}<p class="muted" style="font-size:12px;margin:22px 0">练习按参考思路自行核对，不通过文字长度判断掌握程度。确认理解后，再去做选择题自测。</p>${sources(task)}`;
  }
  function quiz(task, r, canEdit) {
    const answers=r?.answers || {}, grade=r?.grade;
    return `<div class="overline">概念自测 · 每组 3 题</div><h2 style="font-size:21px;margin-bottom:10px">用判断检验理解。</h2><p class="reading-intro">每题选择一个答案，再统一检查。答错会保留到错题复习；全部答对后，还需完成口述自检。</p>${grade?`<div class="quiz-score"><strong>${grade.correct} / ${grade.total}</strong><p>${grade.passed?'这轮自测已通过。接下来合上讲解，试着把方法讲出来。':'先看解析，回到讲解补上卡点，再修改答案并重新检查。'}</p></div>`:''}<form id="quizForm" data-task="${task.id}">${task.quiz.map((q,i)=>{const answered=Number.isInteger(answers[q.id]),correct=answers[q.id]===q.answer;return `<fieldset class="quiz-question"><legend>${i+1}. ${esc(q.question)}</legend>${q.options.map((option,j)=>`<label class="quiz-option ${answers[q.id]===j?'selected':''} ${grade&&j===q.answer?'correct':''} ${grade&&answers[q.id]===j&&!correct?'wrong':''}"><input type="radio" name="${q.id}" value="${j}" data-question="${q.id}" data-task="${task.id}" ${answers[q.id]===j?'checked':''} ${canEdit?'':'disabled'}><span>${String.fromCharCode(65+j)}. ${esc(option)}</span></label>`).join('')}${grade?`<div class="quiz-feedback ${correct?'':'is-wrong'}"><strong>${correct?'回答正确':answered?'需要订正':'本题未作答'}</strong> · ${esc(q.explanation)}</div>`:''}</fieldset>`;}).join('')}${canEdit?`<button type="submit" class="btn primary">${grade?'再次检查答案':'检查这组答案'} ${icon('check')}</button><p class="save-hint">选项自动保存；修改已检查的答案后，需要重新检查。</p>`:'<p class="muted" style="font-size:12px">'+(done(task.id)?'完成记录已保留，可以对照解析回顾。':'领取这组任务后，可以保存和检查答案。')+'</p>'}</form>`;
  }
  function completeControl(task, r, canEdit) {
    if(!canEdit)return '';
    const passed=!!r?.grade?.passed, allChecks=task.oral.checklist.every((_,i)=>r?.oralChecks?.[i]===true);
    return `<p>${!passed?'先在“做自测”中答对全部题目并检查答案。':!allChecks?'请先脱稿讲一遍，再如实勾选上面的口述核对项。':'自测与口述核对已完成，可以结束这组任务。'}</p><button class="btn primary" data-action="complete" data-id="${task.id}" ${passed&&allChecks?'':'disabled'}>完成这组任务 ${icon('check')}</button><p class="save-hint">口述由你自行核对；本站不会把填写文字当作自动评分。</p>`;
  }
  function oral(task, r, canEdit) {
    return `<div class="overline">合上讲解 · 用自己的话说</div><p class="oral-prompt">${esc(task.oral.prompt)}</p><p class="muted" style="font-size:12px;margin-bottom:20px">建议按“输入 → 步骤 → 采用理由 → 结果 → 局限”组织。先脱稿讲60—90秒，再核对参考思路。</p><details><summary>讲过以后，再看口述参考</summary><p>${esc(task.oral.reference)}</p></details><h3 style="margin:25px 0 13px">我刚才的讲解是否做到了</h3>${task.oral.checklist.map((c,i)=>`<label class="check-label"><input type="checkbox" data-oral="${i}" data-task="${task.id}" ${r?.oralChecks?.[i]?'checked':''} ${canEdit?'':'disabled'}><span>${esc(c)}</span></label>`).join('')}<label class="field-label" for="taskNotes">给自己留一条笔记 <span class="muted">· 选填</span></label><textarea id="taskNotes" data-task="${task.id}" maxlength="20000" placeholder="记下还讲不清的地方，或者写一版自己的口述。" ${canEdit?'':'readonly'}>${esc(r?.notes || '')}</textarea><p class="save-hint" id="noteSaveHint">${canEdit?'笔记自动保存，无需另外提交。':r?.notes?'保留的学习笔记。':'这组没有填写笔记。'}</p><div class="completion-block" id="completionControl">${completeControl(task,r,canEdit)}</div>`;
  }
  function empty(title, text, label, href) {return `<section class="paper empty"><div class="empty-symbol">${icon('book',40)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p><a class="btn primary" href="${esc(href)}">${esc(label)} ${icon('arrow')}</a></section>`;}
  function reviewsPage() {
    const unresolved=Object.values(state.mistakes).filter(x=>!x.resolved);
    return heading('把卡住的地方，变成下一次会讲的地方','先补一个薄弱点。','这里保留自测中尚未订正的题目。先回忆，再看解释；回到原任务重新检查全部答案后，错题自动移出。')+(unresolved.length?unresolved.map(item=>{const task=findTask(item.taskId),q=task?.quiz.find(q=>q.id===item.questionId);if(!q)return '';const key=`${item.taskId}:${item.questionId}`,feedback=labState.reviewFeedback[key];return `<section class="paper review-item"><div class="review-meta"><span class="pill gold">待订正</span><span>第 ${taskNumber(task)} 组 · ${esc(task.module.shortTitle)}</span><span>累计答错 ${item.wrongCount} 次</span></div><h3>${esc(q.question)}</h3>${q.options.map((a,i)=>`<label class="review-answer"><input type="radio" name="review-${key}" value="${i}" data-review="${key}" ${labState.reviewAnswers[key]===i?'checked':''}><span>${String.fromCharCode(65+i)}. ${esc(a)}</span></label>`).join('')}<div class="action-line" style="margin-top:17px"><button class="btn small" data-action="review-check" data-key="${key}">检查这题</button><a class="text-button" href="#task/${task.id}/quiz">回到原任务订正 ↗</a></div>${feedback?`<div class="quiz-feedback ${feedback.correct?'':'is-wrong'}"><strong>${feedback.correct?'答对了':'再想一想'}</strong> · ${esc(q.explanation)}${feedback.correct?' 回到原任务重新检查后，将更新错题状态。':''}</div>`:''}</section>`;}).join(''):empty('目前没有待订正的错题','完成自测后，需要复习的概念会出现在这里。已经订正的题目保留在原任务记录中。','继续学习','#today'));
  }
  function dateText(value) {if(!value)return '未记录';try{return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}catch(_){return '未记录';}}
  function recordsPage() {
    const s=M.summary(state,tasks),started=tasks.filter(t=>record(t.id));
    return heading('每一组理解，都留得下来','回看你已经走过的路。',accountUser ? '任务、答案、笔记和错题自动同步到当前账号；其他设备登录同一邮箱即可恢复。' : '本机原记录仍保留。登录同步账号后，可以把进度带到电脑、平板和手机。')+`<div class="record-summary"><div class="paper record-stat"><span>已完成任务</span><strong>${s.completed}<small> / ${s.total}</small></strong></div><div class="paper record-stat"><span>学习进度</span><strong>${s.percent}<small>%</small></strong></div><div class="paper record-stat"><span>待订正错题</span><strong>${s.mistakes}</strong></div></div>`+(started.length?`<section class="paper table-wrap"><table class="records-table"><thead><tr><th>任务</th><th>状态</th><th>最近自测</th><th>笔记</th><th>最近更新</th></tr></thead><tbody>${started.slice().reverse().map(t=>{const r=record(t.id);return `<tr><td><a href="#task/${t.id}/learn">${taskNumber(t)} · ${esc(t.title)}</a></td><td><span class="pill ${done(t.id)?'':'gold'}">${done(t.id)?'已完成':'进行中'}</span></td><td>${r.grade?`${r.grade.correct} / ${r.grade.total}`:'尚未检查'}</td><td>${r.notes?'已保存':'未填写'}</td><td>${dateText(r.updatedAt||r.completedAt||r.claimedAt)}</td></tr>`;}).join('')}</tbody></table></section>`:empty('第一条学习记录，等你开启','领取任务后，就会在这里保存进度、自测和笔记。','领取第一组','#today'))+`<section class="paper backup-panel"><h2>学习备份</h2><p>备份包含任务进度、答题和笔记，可在另一台设备的本站导入。导入会替换当前记录，先导出一份更稳妥。</p><div class="backup-actions"><button class="btn" data-action="export">${icon('download',17)}导出备份</button><button class="btn" data-action="import">导入备份</button><button class="text-button" data-action="export-oral">导出口述笔记</button>${recoveryRaw?'<button class="text-button" data-action="export-recovery">导出无法恢复的原记录</button>':''}</div></section>`;
  }
  function labPage(tab) {
    if(['features','cluster','metrics','glossary','exam'].includes(tab))activeLab=tab;
    const tabs=[['features','RFM计算'],['cluster','K-Means迭代'],['metrics','分类指标'],['glossary','知识速查'],['exam','综合口述']];
    return heading('换一组数字，再理解一次','让抽象的方法动起来。','这里的小实验用于理解方法，使用教学数据；论文结果仍以保存的真实实验产物为准。')+`<div class="lab-tabs" role="tablist" aria-label="方法实验"><div hidden></div>${tabs.map(t=>`<button role="tab" aria-selected="${activeLab===t[0]}" class="${activeLab===t[0]?'active':''}" data-action="lab-tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div id="labContent">${activeLab==='features'?featureLab():activeLab==='cluster'?clusterLab():activeLab==='metrics'?metricLab():activeLab==='glossary'?glossaryLab():examLab()}</div>`;
  }
  function featureLab() {
    const fields=[['reference','统一参考日','date'],['last','最近购买日','date'],['frequency','累计购买次数 F','number'],['monetary','累计购买金额 M（元）','number'],['click','累计点击次数','number'],['cart','累计加购次数','number']];
    return `<div class="lab-layout"><section class="paper lab-card"><h2>同一名用户，怎样变成一组特征？</h2><p>调整下面的教学数据，观察日期差、金额与次数的关系。</p><div class="input-grid">${fields.map(f=>`<label>${f[1]}<input type="${f[2]}" data-feature="${f[0]}" value="${esc(featureInputs[f[0]])}" ${f[2]==='number'?'min="0" step="any"':''}></label>`).join('')}</div><p class="save-hint" style="margin-top:17px">这里只演示特征公式。论文参考日固定为2025-01-02；实验台更改日期不会修改论文数据。</p></section><section id="featureResult" class="lab-result">${featureResult()}</section></div>`;
  }
  function featureResult() {
    const x=featureInputs,n=['frequency','monetary','click','cart'].map(k=>Number(x[k]));
    const ref=Date.parse(`${x.reference}T00:00:00Z`),last=Date.parse(`${x.last}T00:00:00Z`);
    if(n.some(v=>!Number.isFinite(v)||v<0)||['frequency','click','cart'].some(k=>x[k]===''||!Number.isInteger(Number(x[k])))||x.monetary===''||!Number.isFinite(ref)||!Number.isFinite(last)||last>ref)return '<h3>先检查输入</h3><p>次数应为非负整数，金额应为非负数；最近购买日应不晚于参考日，所有字段都需要填写。</p>';
    const divide=(a,b)=>b===0?0:a/b, rows=[['R · 最近消费间隔',`${Math.round((ref-last)/864e5)} 天`],['F · 累计购买次数',`${n[0]} 次`],['M · 累计购买金额',`${n[1].toFixed(2)} 元`],['平均客单价',`${divide(n[1],n[0]).toFixed(2)} 元`],['加购 / 点击',divide(n[3],n[2]).toFixed(4)],['购买 / 点击',divide(n[0],n[2]).toFixed(4)],['购买 / 加购',divide(n[0],n[3]).toFixed(4)]];
    return `<h3>从原始字段到消费特征</h3>${rows.map(r=>`<div class="metric-line"><span>${r[0]}</span><strong>${r[1]}</strong></div>`).join('')}<p>分母为0时按项目保护规则记0，这种0不代表已经观察到真实转化概率。累计行为比值也可能超过1，需要核对统计口径。</p>`;
  }
  function metricLab() {
    return `<div class="lab-layout"><section class="paper lab-card"><h2>召回高，为什么还会有很多误报？</h2><p>默认填入论文AdaBoost的留出测试混淆矩阵。你可以改数字，比较各指标。</p><div class="matrix">${[['tn','TN · 正常用户判正常'],['fp','FP · 正常用户被误报'],['fn','FN · 风险用户被漏判'],['tp','TP · 风险用户判对']].map(r=>`<label class="${r[0]==='tp'||r[0]==='tn'?'good':''}">${r[1]}<input type="number" min="0" step="1" value="${matrixInputs[r[0]]}" data-matrix="${r[0]}"></label>`).join('')}</div><div class="action-line"><button class="btn small" data-action="matrix-reset">恢复论文数字</button><button class="text-button" data-action="matrix-all-negative">全部判正常，试试看</button></div><p class="save-hint">这些指标对应当前规则标签与0.5分类阈值，不等同于页面高风险名单的实际准确程度。</p></section><section class="lab-result" id="metricResult">${metricResult()}</section></div>`;
  }
  function metricResult() {
    const x=matrixInputs;if(Object.values(x).some(v=>v===''||!Number.isInteger(Number(v))||Number(v)<0))return '<h3>先检查输入</h3><p>四个数量都应为非负整数。</p>';
    const tp=+x.tp,tn=+x.tn,fp=+x.fp,fn=+x.fn,N=tp+tn+fp+fn,d=(a,b)=>b?a/b:0,p=d(tp,tp+fp),r=d(tp,tp+fn);
    const rows=[['Accuracy · 判对占全部',d(tp+tn,N)],['Precision · 预警里有多少判对',p],['Recall · 风险用户找回多少',r],['F1 · 精确率与召回率的平衡',d(2*p*r,p+r)]];
    return `<h3>混淆矩阵怎样变成评价指标</h3>${rows.map(a=>`<div class="metric-line"><span>${a[0]}</span><strong>${(a[1]*100).toFixed(2)}%</strong></div>`).join('')}<p>共 ${N.toLocaleString('zh-CN')} 人，其中误报 ${fp.toLocaleString('zh-CN')} 人、漏判 ${fn.toLocaleString('zh-CN')} 人。分母为0时此演示将对应指标显示为0，并应结合“没有正类预测”等情况解释；单看准确率容易掩盖漏判。</p>`;
  }
  const plotPoints=[[1,1],[2,1.6],[1.5,3],[3,2.8],[3.6,4],[6.2,7],[7.6,6.8],[8.7,8.3],[7.2,8.9],[9,6.2]];
  function clusterFrames() {
    let centers=[[1,1],[3,2.8]], labels=plotPoints.map(()=>-1), frames=[{centers:centers.map(c=>c.slice()),labels:labels.slice(),stage:'先选两个初始中心',sse:null}];
    for(let round=1;round<=4;round++){
      labels=plotPoints.map(p=>{const ds=centers.map(c=>(p[0]-c[0])**2+(p[1]-c[1])**2);return ds[0]<=ds[1]?0:1;});
      const sse=plotPoints.reduce((s,p,i)=>s+(p[0]-centers[labels[i]][0])**2+(p[1]-centers[labels[i]][1])**2,0);
      frames.push({centers:centers.map(c=>c.slice()),labels:labels.slice(),stage:`第${round}轮 · 分给最近的中心`,sse});
      const old=centers;centers=centers.map((c,j)=>{const pts=plotPoints.filter((_,i)=>labels[i]===j);return pts.length?[0,1].map(dim=>pts.reduce((s,p)=>s+p[dim],0)/pts.length):c;});
      frames.push({centers:centers.map(c=>c.slice()),labels:labels.slice(),stage:`第${round}轮 · 用簇内均值更新中心`,sse:plotPoints.reduce((s,p,i)=>s+(p[0]-centers[labels[i]][0])**2+(p[1]-centers[labels[i]][1])**2,0)});
      if(centers.every((c,j)=>c.every((v,k)=>v===old[j][k])))break;
    }
    return frames;
  }
  function clusterLab() {
    const frames=clusterFrames(),f=frames[Math.min(clusterStep,frames.length-1)],colors=['#3158b8','#9d397a'];
    const X=x=>42+x*37,Y=y=>342-y*31;
    return `<div class="lab-layout"><section class="paper lab-card"><h2>两件事交替做：分组、更新中心。</h2><p>教学例子：10个二维点、2个中心。圆点表示样本，十字表示中心；颜色表示当前分组。</p><svg class="plot" viewBox="0 0 440 370" role="img" aria-label="K-Means二维教学散点图，${esc(f.stage)}"><path d="M42 20V342H420" fill="none" stroke="#cdd9e0"/>${[2,4,6,8,10].map(n=>`<path d="M${X(n)} 25V342M42 ${Y(n)}H413" stroke="#edf1f4"/><text x="${X(n)}" y="359" text-anchor="middle" font-size="10" fill="#657c88">${n}</text><text x="30" y="${Y(n)+4}" font-size="10" fill="#657c88">${n}</text>`).join('')}${plotPoints.map((p,i)=>{const j=f.labels[i];return `${j>=0?`<path d="M${X(p[0])} ${Y(p[1])}L${X(f.centers[j][0])} ${Y(f.centers[j][1])}" stroke="${colors[j]}" opacity=".16" stroke-dasharray="3 4"/>`:''}<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="6" fill="${j<0?'#91a3b0':colors[j]}"/>`;}).join('')}${f.centers.map((c,j)=>`<g stroke="${colors[j]}" stroke-width="4"><path d="M${X(c[0])-9} ${Y(c[1])}h18M${X(c[0])} ${Y(c[1])-9}v18"/></g>`).join('')}</svg><div class="action-line"><button class="btn primary" data-action="cluster-next" ${clusterStep>=frames.length-1?'disabled':''}>${clusterStep>=frames.length-1?'中心已稳定':'进行下一步'} ${icon('arrow')}</button><button class="text-button" data-action="cluster-reset">从头演示</button></div></section><section class="lab-result"><h3>当前：${esc(f.stage)}</h3><div class="metric-line"><span>步骤</span><strong>${clusterStep+1} / ${frames.length}</strong></div><div class="metric-line"><span>当前SSE</span><strong>${f.sse===null?'—':f.sse.toFixed(2)}</strong></div>${f.centers.map((c,i)=>`<p><b>中心${i+1}</b> = (${c[0].toFixed(2)}, ${c[1].toFixed(2)})</p>`).join('')}<p>${clusterStep===0?'初始中心可以影响后续路径。项目使用K-Means++并多次初始化，减少单一起点的影响。':clusterStep%2===1?'此时中心固定，每个点选择最近的中心。接下来保持分组，计算新的均值中心。':'此时按刚才的分组更新中心，接下来需要重新分配样本。两步交替，直到中心移动足够小。'}</p><p>本例使用普通均值帮助理解；你的改进版本使用加权均值。论文实际在预处理后的8维空间分5类，不能用这张教学图代替实验结果。</p></section></div>`;
  }
  function glossaryLab() {
    const seen=new Set(),terms=[]; tasks.forEach(task=>task.terms.forEach(term=>{if(!seen.has(term.name)){seen.add(term.name);terms.push({...term,task});}}));
    const aliases={'Z-score':'标准化 zscore z score','log1p':'对数变换 自然对数','One-Hot编码':'独热编码 onehot','SSE':'簇内平方和 平方误差和','ARI':'调整兰德指数','Precision':'精确率','Recall':'召回率'};
    const q=glossaryQuery.toLowerCase().trim(),matches=terms.filter(t=>(t.name+t.meaning+t.task.title+(aliases[t.name]||'')).toLowerCase().includes(q));
    return `<label class="field-label" for="glossarySearch" style="margin-top:0">查一个术语</label><div class="glossary-search"><input type="search" id="glossarySearch" value="${esc(glossaryQuery)}" placeholder="例如：SSE、召回率、标准化"></div><p class="muted" style="font-size:11px;margin-bottom:15px">共 ${terms.length} 个术语，当前匹配 ${matches.length} 个。点击来源可回看完整解释。</p><div class="glossary-list" id="glossaryList">${matches.length?matches.map(t=>`<article class="paper glossary-item"><h3>${esc(t.name)}</h3><p>${esc(t.meaning)}</p><a href="#task/${t.task.id}/learn">第${taskNumber(t.task)}组 · ${esc(t.task.title)} ↗</a></article>`).join(''):'<div class="notice">没有找到这个词。试试“风险”“距离”或更短的关键词。</div>'}</div>`;
  }
  function examLab() {
    const exams=[['30秒：这个系统给谁用，解决什么问题？','说明面向运营人员，使用98,673条用户汇总记录；构建消费与行为特征，进行五类分群和规则风险识别，最后通过网站展示。主动说明没有验证未来真实流失。'],['3分钟：从一名用户的原始字段讲到网页画像。','按数据检查→RFM与扩展特征→任务各自预处理→聚类归属与规则标签→风险模型分数→保存结果→网页查询讲解。区分事实、人工规则和模型输出。'],['为什么选择K=5？为什么改进后的SSE反而更大？','比较K=2至10，结合肘部、轮廓、CH、DB与规模；DB最佳7不能推导所有指标都选7。组合降权改变质心目标，当前DB和ARI改善，SSE/轮廓/CH有代价，按稳健性优先条件采用。'],['第20近邻距离和到中心的距离有什么不同？','第20近邻距离描述用户周围的稀疏程度；到中心距离描述用户离所属群体典型位置有多远。ε用于d20离群，固定中心半径补充统计没有重新聚类；不能把半径外都叫离群。'],['既然知道R就能构造标签，为什么还训练模型？','标签是R≥72规则，直接知道R时可以直接判规则。模型实验比较其他汇总特征对规则正类的关联区分能力；不能说它发现了真实未来流失机制。还需要未来表现期、独立验证等证据。'],['AdaBoost为什么采用？旋转森林是否更好？','AdaBoost按35%Recall、35%F1、25%AUC、5%Accuracy的规则采用；Recall约.9308、Precision约.3576，误报较多。旋转森林部分指标略高，不能说某一模型全面最优。'],['讲解网站六个页面，每个关键数字从哪里来？','总览：聚合统计；个体：属性、特征、群体、规则标签、风险分数；群体：均值、雷达和规则词云；风险：已存分数筛选排序；模型：留出测试指标和离线图；方法：流程说明。页面查询不重新训练。'],['本机版和公网静态版的查询有什么区别？','本机Flask接收请求后查SQLite、用Jinja2渲染并交给ECharts绘图；GitHub Pages版读取发布时导出的HTML/JSON快照，浏览器按需加载分片。两者更新方式不同，公网版本需重新导出和发布。'],['你能依据当前测试结果作出多大范围的结论？','21项基础和50项附加核对支持规定的数据、页面、查询分支与资源检查。测试客户端计时不包含真实网络、浏览器渲染和并发；历史桌面截图不证明所有设备或浏览器兼容。']];
    return `<div class="notice green">先不展开答案，按题目脱稿说。综合口述不自动评分，也不会改变已经完成的任务。</div><div class="exam-prompts">${exams.map(e=>`<details><summary>${esc(e[0])}</summary><p>${esc(e[1])}</p></details>`).join('')}</div><div class="action-line" style="margin-top:23px"><button class="btn" data-action="export-oral">${icon('download')}导出口述笔记</button><a class="text-button" href="#roadmap">按薄弱点回看模块 ↗</a></div>`;
  }
  function referencePage() {
    return heading('核对事实，再把方法讲清楚','论文口径与学习依据','依据2026年10月23日核查的论文、当前代码和已有实验产物组织。本文档修改时间不代表每一章已经同步。')+`<article class="paper reference-body"><h2>这份学习站依据什么</h2><p>主要范围来自《外卖平台用户画像系统的设计与实现》最新“摘要一页版”Word，并结合完整初稿、方法全集、入门指南、模拟答辩问答与当前代码、特征文件、聚类和分类实验产物核对。站内“教学例子”只用来帮助理解，不冒充原始样本或新的实验结果。</p><h2>先学会完整的数据流</h2><p>98,673条、16字段用户级汇总记录 → 质量检查 → 14列特征表 → 8维聚类 / 另一套风险分类输入 → 群体、规则标签和分数 → SQLite结果库 → 网站查询与解释。聚类标签不直接作为风险模型输入。</p><h2>最新Word部分正文还需纠正</h2><ul><li><b>数据库：</b>当前SQLite包含9张实体表，user_profile_view是37列预合并实体表，并非SQL视图。MySQL文件只是6表结构参考，尚未完成连接验证。</li><li><b>测试：</b>当前独立复核为21项基础检查和50项附加核对；部分正文仍沿用历史21项与旧耗时。当前客户端平均计时约2.653—902.333ms，不代表公网或并发性能。</li><li><b>泄漏历史：</b>学习时说明为何排除R、生命周期及相关派生字段即可，不把缺少保存产物支持的早期“AUC接近1”背成已核实结论。</li><li><b>数据含义：</b>累计行为比值没有逐次事件匹配，不能直接视为真实转化概率；群体业务名称也不证明未来行为稳定。</li></ul><h2>三组最重要的区别</h2><ul><li><b>规则、分类与展示：</b>R≥72天构造9,965个规则正类；0.5为分类评估阈值；0.4和0.7用于页面三级风险。网页高风险12,379人来自全量重训后的分数，与规则正类人数含义不同。</li><li><b>局部稀疏与中心距离：</b>第20近邻距离的ε约0.806672，标记8,293名低密度离群用户；固定最终中心的半径分析是补充描述，未按新半径重新训练。</li><li><b>采用与最优：</b>组合K-Means以DB、ARI改善换取部分其他指标损失；AdaBoost按项目综合规则采用，旋转森林仍是重要对照，二者都没有“所有指标全面最好”的结论。</li></ul><h2>网站版本与学习记录</h2><p>原分析系统本机版使用Flask、Jinja2、SQLite与ECharts；项目提供的GitHub Pages版将结果导出成HTML和JSON，使用浏览器JavaScript读取分片。当前学习站独立保存进度，不读取或修改原雅思网站和论文计划站的学习记录。</p><p>登录同一个邮箱同步账号后，任务、答案、笔记和错题会保存到云端；访客记录仍只保存在当前浏览器。首次登录可通过“同步本机原进度”上传已有记录。断网时暂存在此设备，恢复联网后核对版本并重试；两端同时修改时会提示核对，避免静默覆盖。仍可导出备份作为额外副本。自测为固定答案判分，口述由你自行核对，不声称有AI自动口述评分。</p><h2>可查阅的官方解释</h2><ul><li><a href="https://scikit-learn.org/stable/modules/clustering.html" target="_blank" rel="noopener">scikit-learn：K-Means、聚类评价与层次聚类</a></li><li><a href="https://scikit-learn.org/stable/modules/ensemble.html" target="_blank" rel="noopener">scikit-learn：随机森林与AdaBoost等集成方法</a></li><li><a href="https://scikit-learn.org/stable/common_pitfalls.html" target="_blank" rel="noopener">scikit-learn：预处理和数据泄漏</a></li><li><a href="https://flask.palletsprojects.com/" target="_blank" rel="noopener">Flask：请求、路由和模板</a></li><li><a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages" target="_blank" rel="noopener">GitHub：静态网站托管</a></li></ul><p>项目特定权重、阈值与模型取舍依据本项目代码和实验记录；不能把它们说成上述官方文档规定的通用最优参数。</p><div class="action-line" style="margin-top:24px"><a class="btn primary" href="#today">回到任务大厅${icon('arrow')}</a><a class="btn" href="https://tdzr-lyh.github.io/takeaway-user-portrait/" target="_blank" rel="noopener">打开原画像系统 ↗</a></div></article>`;
  }
  function render(scroll=true) {
    if(!state||!M||tasks.length!==33){main.innerHTML='<section class="paper empty"><h1>课程文件尚未完整加载</h1><p>请刷新页面。如果离线使用，请确认四个JavaScript文件都在同一目录。</p></section>';return;}
    const route=(location.hash.slice(1)||'today').split('/'),name=route[0];
    try {main.innerHTML=name==='roadmap'?roadmapPage():name==='task'?taskPage(route[1],route[2]):name==='lab'?labPage(route[1]):name==='reviews'?reviewsPage():name==='records'?recordsPage():name==='reference'?referencePage():todayPage();}
    catch(e){main.innerHTML=empty('这页暂时没有打开',e.message,'回到任务大厅','#today');}
    document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon,19));
    updateChrome();
    if(scroll){window.scrollTo({top:0,behavior:'instant'}); main.focus({preventScroll:true});if(name==='roadmap'&&route[1])document.getElementById(route[1])?.scrollIntoView({block:'start'});}
  }
  function showDialog(html) {document.getElementById('dialogContent').innerHTML=html;document.getElementById('dialog').showModal();}
  function showAccount(mode = 'signin') {
    authMode = mode;
    if (accountUser) {
      showDialog(`<section class="cloud-account"><h2>我的云同步账号</h2><div class="account-details"><p><b>${esc(accountUser.email || '已登录')}</b></p><p id="accountSyncStatus">${esc(cloudMessage)}</p></div><p>电脑、平板和手机登录同一个邮箱账号，任务、答案、笔记和错题会自动同步。</p><div class="action-line"><button class="btn primary" data-action="sync-now">立即同步</button><button class="btn" data-action="signout">退出账号</button></div>${hasProgress(guestState) && !legacyHandled()?'<p class="sync-help">此设备还保留登录前的原记录。</p><button class="text-button" data-action="adopt-local">核对并同步本机原进度 ↗</button>':''}</section>`);
      return;
    }
    const signup = mode === 'signup';
    showDialog(`<section class="cloud-account"><h2>${signup?'创建同步账号':'登录后，在任何设备接着学'}</h2><p>可使用雅思网站的同一邮箱账号登录。首次使用可以注册；各网站的学习记录分别保存。</p><div class="auth-switch"><button class="${signup?'':'active'}" data-action="auth-mode" data-mode="signin">登录</button><button class="${signup?'active':''}" data-action="auth-mode" data-mode="signup">注册</button></div><form class="auth-form" id="authForm"><label for="authEmail">邮箱</label><input id="authEmail" type="email" autocomplete="email" inputmode="email" required placeholder="请输入你的邮箱"><label for="authPassword">密码</label><input id="authPassword" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="6" required placeholder="${signup?'至少6位密码':'请输入账号密码'}"><div id="authStatus" class="auth-status" role="status"></div><button class="btn primary" id="authSubmit" type="submit">${signup?'注册同步账号':'登录并恢复云端进度'}</button></form><p class="sync-help">登录前的本机进度会保留。首次登录后，可以点击“同步本机原进度”上传电脑上已有的记录。</p></section>`);
  }
  function showLocalMigration() {
    if (!accountUser || !cloud) {showAccount(); return;}
    if (!hasProgress(guestState)) {toast('此设备没有需要迁移的登录前记录。'); return;}
    const local = M.summary(guestState, tasks), remote = M.summary(state, tasks);
    showDialog(`<h2>把电脑上原来的进度同步到账号</h2><p>当前账号：${esc(accountUser.email || '')}</p><div class="migration-grid"><div>此设备登录前的原记录<strong>${local.completed} / ${local.total}</strong>组已完成${guestState.activeTaskId?'，另有进行中任务':''}</div><div>当前账号记录<strong>${remote.completed} / ${remote.total}</strong>组已完成${state.activeTaskId?'，另有进行中任务':''}</div></div><p>${hasProgress(state)?'选择本机原进度后，将用这份记录替换当前账号记录。建议先导出当前账号备份。':'上传后，在平板或手机登录同一账号就能恢复这些任务和笔记。'}本机原记录也会保留。</p><div class="action-line"><button class="btn primary" data-action="adopt-confirm">把原进度同步到账号</button><button class="btn" data-action="export">导出当前账号备份</button><button class="text-button" data-action="keep-account">继续使用当前账号记录</button></div>`);
  }
  function showConflict() {
    if (!cloudConflict) {void cloud?.pull(); return;}
    const local = M.summary(cloudConflict.local || M.freshState(), tasks);
    let remote;
    try {remote = M.summary(cloudConflict.remote ? M.normalizeState(cloudConflict.remote, tasks) : M.freshState(), tasks);}
    catch (_) {toast('另一份记录暂时无法读取，请先导出此设备备份。');return;}
    showDialog(`<h2>两台设备同时修改了进度</h2><p>系统没有自动覆盖任何一份。请核对后选择接下来使用的记录。</p><div class="migration-grid"><div>此设备草稿<strong>${local.completed} / ${local.total}</strong>组已完成<br><button class="text-button" data-action="export-conflict" data-choice="local">导出这份备份</button></div><div>另一设备的云端记录<strong>${remote.completed} / ${remote.total}</strong>组已完成<br><button class="text-button" data-action="export-conflict" data-choice="remote">导出这份备份</button></div></div><p>选择后会以选中的整份记录继续同步。如两份都含有重要笔记，请先分别导出备份。</p><div class="action-line"><button class="btn primary" data-action="resolve-conflict" data-choice="remote">使用云端记录</button><button class="btn" data-action="resolve-conflict" data-choice="local">保留此设备记录</button></div>`);
  }
  function authError(error) {
    const message = String(error?.message || error);
    if (/invalid login|invalid credentials/i.test(message)) return '邮箱或密码不匹配，请核对后再试。';
    if (/email not confirmed/i.test(message)) return '请先完成邮箱验证，再回到本站登录。';
    if (/already registered|already exists/i.test(message)) return '这个邮箱已经注册，请切换到登录。';
    if (/rate|too many|over_email/i.test(message)) return '尝试次数较多，请稍后再试；已有雅思账号可直接切换到登录。';
    if (/password/i.test(message)) return '请使用至少6位密码，并满足账号服务的密码要求。';
    if (/fetch|network|connection|timeout/i.test(message)) return '暂时无法连接账号服务，请检查网络后重试。此设备原进度仍保留。';
    return '账号操作未完成，请核对邮箱、密码和邮箱验证状态后重试。';
  }
  function download(name, text, type) {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportBackup() {
    download(`论文有方-学习备份-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json;charset=utf-8');toast('学习备份已导出，请妥善保存。');
  }
  function exportOral() {
    const text=['# 论文方法口述笔记','',`导出时间：${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'long'}).format(new Date())}`,'','口述由本人自检；自测记录不等同于真实答辩表现。','',...tasks.filter(t=>record(t.id)).flatMap(t=>{const r=record(t.id);return [`## 第${taskNumber(t)}组 ${t.title}`,`状态：${done(t.id)?'已完成':'进行中'}；自测：${r.grade?`${r.grade.correct}/${r.grade.total}`:'尚未检查'}`,'',`口述题目：${t.oral.prompt}`,'','我的笔记：',r.notes||'（未填写）','','核对要点：',...t.oral.checklist.map((x,i)=>`- [${r.oralChecks?.[i]?'x':' '}] ${x}`),''];})].join('\n');
    download('论文有方-我的口述笔记.md',text,'text/markdown;charset=utf-8');toast('口述笔记已导出。');
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action,id=button.dataset.id;
    try {
      if(action==='claim'){const next=M.nextTask(state,tasks);if(next?.id!==id)throw new Error('请先继续当前任务，完成后再领取下一组。');persist(M.claimTask(state,tasks));lastCompleted=null;go(`#task/${state.activeTaskId}/learn`);toast('已领取。这一组任务会保留到完成。');}
      else if(action==='continue')go(`#task/${id}/learn`);
      else if(action==='task-tab')go(`#task/${id}/${button.dataset.tab}`);
      else if(action==='complete'){const task=findTask(id);persist(M.completeTask(state,task));lastCompleted=id;go('#today');toast('这组任务已完成。下一组由你手动领取。');}
      else if(action==='lab-tab')go(`#lab/${button.dataset.tab}`);
      else if(action==='cluster-next'){clusterStep=Math.min(clusterStep+1,clusterFrames().length-1);render(false);}
      else if(action==='cluster-reset'){clusterStep=0;render(false);}
      else if(action==='matrix-reset'){matrixInputs={tp:'1855',fp:'3332',fn:'138',tn:'14410'};render(false);}
      else if(action==='matrix-all-negative'){matrixInputs={tp:'0',fp:'0',fn:'1993',tn:'17742'};render(false);}
      else if(action==='export')exportBackup();
      else if(action==='export-recovery'&&recoveryRaw)download('论文有方-待检查原记录.json',recoveryRaw,'application/json;charset=utf-8');
      else if(action==='export-oral')exportOral();
      else if(action==='account')showAccount();
      else if(action==='auth-mode')showAccount(button.dataset.mode);
      else if(action==='sync-now'){
        if (!accountUser) showAccount();
        else {await cloud.pull();updateCloudUI();if(cloudKind==='ready')toast('已核对云端记录。');}
      }
      else if(action==='adopt-local')showLocalMigration();
      else if(action==='adopt-confirm'){
        if(!accountUser||!cloud)throw new Error('请先登录同步账号。');
        persist(M.normalizeState(guestState,tasks));
        document.getElementById('dialog').close();render(false);
        await cloud.pull();
        if(!cloud.current().dirty&&!cloud.current().conflict&&cloud.current().hasRemote){markLegacyHandled();updateCloudUI();toast('本机原进度已同步，其他设备登录同一账号即可恢复。');}
      }
      else if(action==='keep-account'){markLegacyHandled();document.getElementById('dialog').close();updateCloudUI();}
      else if(action==='sync-conflict')showConflict();
      else if(action==='export-conflict'&&cloudConflict){
        const selected=button.dataset.choice==='local'?cloudConflict.local:cloudConflict.remote;
        download(`论文有方-${button.dataset.choice==='local'?'本机':'云端'}冲突备份.json`,JSON.stringify(selected||M.freshState(),null,2),'application/json;charset=utf-8');
      }
      else if(action==='resolve-conflict'){
        const choice=button.dataset.choice;
        await cloud.resolveConflict(choice);cloudConflict=cloud.current().conflict?cloudConflict:null;
        document.getElementById('dialog').close();render(false);
        if(cloudKind==='ready')toast('已按选择继续同步。');
      }
      else if(action==='signout'){
        if(cloud.current().dirty){showDialog('<h2>此设备还有等待上传的记录</h2><p>可以先尝试同步。若现在退出，草稿仍绑定此账号保存在本设备，下次登录后可继续上传。</p><div class="action-line"><button class="btn primary" data-action="sync-now">先同步</button><button class="btn" data-action="signout-confirm">保留草稿并退出</button></div>');}
        else {await cloud.signOut();document.getElementById('dialog').close();render(false);toast('已退出账号，云端记录仍保留。');}
      }
      else if(action==='signout-confirm'){await cloud.signOut();document.getElementById('dialog').close();render(false);toast('已退出，未上传草稿保留在此设备。');}
      else if(action==='import')document.getElementById('importFile').click();
      else if(action==='confirm-import'){if(!pendingImport)return;persist(pendingImport);pendingImport=null;lastCompleted=null;document.getElementById('dialog').close();render();toast('备份已导入，任务与笔记已恢复。');}
      else if(action==='close-dialog'){pendingImport=null;document.getElementById('dialog').close();}
      else if(action==='review-check'){const key=button.dataset.key,parts=key.split(':'),task=findTask(parts[0]),q=task.quiz.find(q=>q.id===parts[1]);if(!Number.isInteger(labState.reviewAnswers[key]))throw new Error('先选择一个答案，再检查。');labState.reviewFeedback[key]={correct:labState.reviewAnswers[key]===q.answer};render(false);}
    }catch(error){toast(error.message);}
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    try {
      if(el.matches('[data-question]')){persist(M.draftTask(state,el.dataset.task,{answers:{[el.dataset.question]:Number(el.value)}}));const y=scrollY;render(false);window.scrollTo(0,y);document.querySelector(`input[data-question="${el.dataset.question}"][value="${el.value}"]`)?.focus({preventScroll:true});}
      if(el.matches('[data-oral]')){const task=findTask(el.dataset.task),checks=task.oral.checklist.map((_,i)=>i===Number(el.dataset.oral)?el.checked:record(task.id)?.oralChecks?.[i]===true);persist(M.draftTask(state,task.id,{oralChecks:checks}));document.getElementById('completionControl').innerHTML=completeControl(task,record(task.id),true);}
      if(el.matches('[data-review]')){labState.reviewAnswers[el.dataset.review]=Number(el.value);delete labState.reviewFeedback[el.dataset.review];}
    }catch(error){toast(error.message);}
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    try {
      if(el.id==='taskNotes'){persist(M.draftTask(state,el.dataset.task,{notes:el.value}));document.getElementById('noteSaveHint').textContent=storageWarning?'保存暂时不可用，请导出备份。':'笔记已自动保存。';}
      if(el.dataset.feature){featureInputs[el.dataset.feature]=el.value;document.getElementById('featureResult').innerHTML=featureResult();}
      if(el.dataset.matrix){matrixInputs[el.dataset.matrix]=el.value;document.getElementById('metricResult').innerHTML=metricResult();}
      if(el.id==='glossarySearch'){const position=el.selectionStart;glossaryQuery=el.value;document.getElementById('labContent').innerHTML=glossaryLab();const input=document.getElementById('glossarySearch');input.focus({preventScroll:true});input.setSelectionRange(position,position);}
    }catch(error){toast(error.message);}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id==='authForm'){
      event.preventDefault();if(authBusy)return;
      const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;
      const status=document.getElementById('authStatus'),submit=document.getElementById('authSubmit');
      if(!cloud){status.textContent='云同步尚未连接，请刷新页面重试。';return;}
      authBusy=true;submit.disabled=true;status.textContent='正在连接账号…';
      try {
        const result=await (authMode==='signup'?cloud.signUp(email,password):cloud.signIn(email,password));
        if(result.confirmationRequired){status.textContent='请打开邮箱完成验证，再回到本站登录；已有本机进度仍然保留。';}
        else {document.getElementById('dialog').close();render(false);toast('账号已连接，请在其他设备登录同一邮箱。');}
      }catch(error){status.textContent=authError(error);}
      finally{authBusy=false;submit.disabled=false;}
      return;
    }
    if(event.target.id!=='quizForm')return;event.preventDefault();
    try {const task=findTask(event.target.dataset.task),graded=M.gradeTask(state,task);persist(graded.state);const y=scrollY;render(false);window.scrollTo(0,y);toast(graded.result.passed?'这组自测全部答对，接下来练习口述。':`答对 ${graded.result.correct} / ${graded.result.total} 题，先看解析再订正。`);}catch(error){toast(error.message);}
  });
  document.getElementById('importFile').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try {if(file.size>3*1024*1024)throw new Error('备份文件超过3MB，请选择本站导出的JSON备份。');const raw=JSON.parse(await file.text());pendingImport=M.normalizeState(raw,tasks);const stats=M.summary(pendingImport,tasks);showDialog(`<h2>导入这份学习记录？</h2><p>已验证备份：完成 ${stats.completed} / ${stats.total} 组，${stats.mistakes} 道待订正错题。${accountUser?'导入将替换当前账号的记录，并同步到其他设备。':'导入将替换当前浏览器的进度、答案和笔记。'}</p><div class="action-line"><button class="btn" data-action="export">先导出当前备份</button><button class="btn primary" data-action="confirm-import">确认导入</button></div>`);}catch(error){pendingImport=null;toast(`未导入：${error.message}`);}
  });
  document.getElementById('dialog').addEventListener('cancel',()=>{pendingImport=null;});
  window.addEventListener('hashchange',()=>render());
  window.addEventListener('storage',event=>{
    if(accountUser){if(event.key==='lunwen-method-coach:cloud:v1:'+accountUser.id)void cloud?.pull();return;}
    if(event.key!==KEY||!event.newValue)return;
    try{state=M.normalizeState(JSON.parse(event.newValue),tasks);guestState=M.normalizeState(state,tasks);render(false);toast('已同步此浏览器另一标签页的学习记录。');}
    catch(_){toast('另一标签页的记录无法读取，当前进度暂时保留。');}
  });
  render();
  startCloud();
})();
