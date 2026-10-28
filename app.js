/* 画面とデータ保存。ロジックは logic.js（window.SplitLogic）を使う */
(function () {
  'use strict';
  const L = window.SplitLogic;
  const KEY = 'bunkatsu.v1';
  const $app = document.getElementById('app');
  const $tabs = document.getElementById('tabs');

  // ---------- 保存 ----------
  function blank() { return { answers: null, choice: null, levelOverride: null, logs: {}, swap: {}, checkins: [], sample: false, restDefault: null, restByEx: {}, exSwap: {}, customEx: {}, custom: null, weights: {}, restOn: true, lastBackup: null }; }
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  // 保存データ・バックアップの形をそろえる。形が合わない部分は捨てて、アプリが止まらないようにする
  function sanitize(s) {
    const out = Object.assign(blank(), s);
    ['logs', 'swap', 'restByEx', 'exSwap', 'customEx', 'weights'].forEach((k) => { if (!isObj(out[k])) out[k] = {}; });
    if (!Array.isArray(out.checkins)) out.checkins = [];
    Object.keys(out.logs).forEach((k) => {
      const lg = out.logs[k];
      const ok = isObj(lg) && Number.isInteger(lg.session) && Array.isArray(lg.items)
        && lg.items.every((it) => isObj(it) && typeof it.name === 'string' && Array.isArray(it.sets) && it.sets.every(isObj));
      if (!ok || !/^\d{4}-\d{2}-\d{2}$/.test(k)) delete out.logs[k];
    });
    Object.keys(out.swap).forEach((k) => { if (!Number.isInteger(out.swap[k])) delete out.swap[k]; });
    if (out.custom !== null && !(isObj(out.custom) && Array.isArray(out.custom.menus) && Array.isArray(out.custom.weekdays))) out.custom = null;
    out.answers = out.answers === null ? null : validAnswers(out.answers);
    return out;
  }
  // 回答の必須項目（日数・曜日・目的・時間）がそろっているか確かめ、ほかは既定値で埋める。足りなければ null
  function validAnswers(a) {
    if (!isObj(a)) return null;
    const days = a.days;
    const wds = a.weekdays;
    if (!Number.isInteger(days) || days < 1 || days > 7) return null;
    if (!Array.isArray(wds) || !wds.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) || new Set(wds).size !== wds.length) return null;
    if (!L.GOAL_NAME[a.goal] || !['le45', 'm60', 'm75', 'ge90'].includes(a.sessionMin)) return null;
    return Object.assign({}, a, {
      sex: ['male', 'female', 'none'].includes(a.sex) ? a.sex : 'none',
      lifts: isObj(a.lifts) ? a.lifts : {},
      recovery: ['good', 'normal', 'poor'].includes(a.recovery) ? a.recovery : 'normal',
      schedule: ['fixed', 'sometimes', 'irregular'].includes(a.schedule) ? a.schedule : 'fixed',
      priority: Array.isArray(a.priority) ? a.priority.filter((x) => typeof x === 'string') : [],
      bodyweight: +a.bodyweight > 0 ? +a.bodyweight : null,
    });
  }
  // そのデータで主な画面が描けるか試す（描けなければ使わない）
  function usable(s) {
    if (!s.answers) return true;
    const keep = state;
    try {
      state = s;
      const p = currentPlan();
      if (!p || !p.menus.length) return false;
      vDash(); vLog(); vProgram(); vMore();
      return true;
    } catch (e) { return false; } finally { state = keep; }
  }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (isObj(s)) return sanitize(s); } catch (e) { /* 読めなければ新規 */ }
    return blank();
  }
  let state = load();
  // 見ただけの日（入力も完了もメモもない記録）は保存しない
  const emptyLog = (lg) => !lg.touched && !lg.note && (lg.items || []).every((it) => it.sets.every((x) => !x.done && x.w === '' && x.r === ''));
  function serialize() {
    const logs = {};
    Object.keys(state.logs).forEach((k) => { if (!emptyLog(state.logs[k])) logs[k] = state.logs[k]; });
    return JSON.stringify({ ...state, logs });
  }
  function save() {
    try { localStorage.setItem(KEY, serialize()); } catch (e) { /* 保存できない環境でも動かす */ }
  }
  // ブラウザが容量不足のときに勝手に消さないよう、永続保存を一度だけ申請する（対応していない環境では何もしない）
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
  } catch (e) { /* 申請できない環境 */ }

  // ---------- バックアップ ----------
  const BACKUP_DAYS = 30;
  // 30日以上バックアップしていなければ一言促す（記録がない人には出さない）
  function backupNag() {
    const keys = Object.keys(state.logs || {}).filter((k) => !emptyLog(state.logs[k])).sort();
    if (!keys.length) return '';
    const since = state.lastBackup || keys[0];
    const days = Math.floor((today() - parseKey(since)) / 864e5);
    if (days < BACKUP_DAYS) return '';
    return state.lastBackup ? `最後のバックアップから${days}日たっています。ファイルに保存しておきましょう。` : 'まだバックアップがありません。ファイルに保存しておきましょう。';
  }
  function markBackup() { state.lastBackup = dateKey(today()); save(); }
  // 貼り付けでもファイルでも、同じ検査を通してから取り込む
  function importText(txt) {
    try {
      const raw = JSON.parse(String(txt).trim());
      if (!isObj(raw) || !isObj(raw.answers) || !isObj(raw.logs)) throw new Error('bad');
      const s = sanitize(raw);
      if (!s.answers || !usable(s)) throw new Error('unusable');
      if (!isObj(s.theme)) s.theme = state.theme;
      state = s; save();
      importMsg = { ok: true, text: `復元しました（記録 ${Object.keys(state.logs).filter((k) => !emptyLog(state.logs[k])).length}日分）。` };
    } catch (err) { importMsg = { ok: false, text: '読み込めませんでした。分割メーカーで保存したバックアップかどうか確かめてください。' }; }
    render();
  }
  async function saveBackupFile() {
    const name = `bunkatsu-backup-${dateKey(today())}.json`;
    const text = serialize();
    try {
      // iPhone などは共有シートから「ファイルに保存」できる
      if (typeof File === 'function' && navigator.canShare) {
        const file = new File([text], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          markBackup(); importMsg = { ok: true, text: 'バックアップを保存しました。' }; render(); return;
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 共有をやめた
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      markBackup(); importMsg = { ok: true, text: `${name} を保存しました。` };
    } catch (err) { importMsg = { ok: false, text: 'ファイルに保存できませんでした。「文字列でバックアップ」を使ってください。' }; }
    render();
  }

  // ---------- 小物 ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const wdIndex = (d) => (d.getDay() + 6) % 7; // 0=月
  const today = () => new Date();
  function mondayOf(d) { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - wdIndex(m)); return m; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  // ---------- プラン ----------
  function currentPlan() {
    if (!state.answers) return null;
    if (state.custom) return customPlan();
    const rec = L.recommend(state.answers, state.levelOverride);
    const chosen = rec.ranked.find((r) => r.tpl.id === state.choice) || rec.best;
    const fitted = state.fitTime === false ? null : L.fitToTime(chosen, state.answers.sessionMin);
    const swapped = L.applyExerciseSwaps(L.buildMenus(fitted || chosen, state.answers.goal), state.exSwap, state.answers.goal);
    const menus = applyOrder(swapped);
    const byWeekday = {};
    chosen.weekdays.forEach((d, i) => { byWeekday[d] = i; });
    return { rec, chosen, menus, byWeekday, fitted };
  }

  // 長押しで並び替えた順番（提案プラン用）。menus は元のメニュー番号の並び、items は元の種目名の並び
  function applyOrder(menus) {
    const o = state.order || {};
    const withSrc = menus.map((m, i) => {
      const names = (o.items || {})[i];
      if (!names) return { ...m, src: i };
      const pos = (it) => { const j = names.indexOf(it.original || it.name); return j < 0 ? 999 : j; };
      return { ...m, src: i, items: m.items.map((it, n) => [it, n]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).map((x) => x[0]) };
    });
    const perm = o.menus && o.menus.length === menus.length ? o.menus : null;
    return perm ? perm.map((j) => withSrc[j]) : withSrc;
  }

  function lastSessionIdx() {
    const keys = Object.keys(state.logs).sort();
    for (let i = keys.length - 1; i >= 0; i--) {
      const lg = state.logs[keys[i]];
      if (lg && lg.session >= 0 && doneSets(lg) > 0) return { idx: lg.session, key: keys[i] };
    }
    return null;
  }

  // その日に表示するセッション番号（-1 は休み）
  function sessionFor(plan, d) {
    const k = dateKey(d);
    // 記録が入った日は、記録したメニューを優先する
    if (state.logs[k] && doneSets(state.logs[k]) > 0) return state.logs[k].session;
    if (state.swap[k] !== undefined) return state.swap[k];
    if (state.answers.schedule === 'irregular' && !state.custom) {
      // 毎週バラバラのときは曜日が決まっていないので、今日だけ「次のメニュー」を出し、ほかの日は休み扱いにする
      if (k !== dateKey(today())) return -1;
      const last = lastSessionIdx();
      if (last && last.key === k) return last.idx;
      return last ? (last.idx + 1) % plan.menus.length : 0;
    }
    const i = plan.byWeekday[wdIndex(d)];
    return i === undefined ? -1 : i;
  }

  function doneSets(lg) {
    let n = 0;
    (lg.items || []).forEach((it) => it.sets.forEach((s) => { if (s.done) n++; }));
    return n;
  }

  // 種目の前回記録（今日より前で一番新しいもの）
  function previous(name, beforeKey) {
    const keys = Object.keys(state.logs).filter((k) => k < beforeKey).sort().reverse();
    for (const k of keys) {
      const it = (state.logs[k].items || []).find((x) => x.name === name);
      if (it && it.sets.some((s) => s.done && s.w)) return { date: k, sets: it.sets.filter((s) => s.done) };
    }
    return null;
  }

  // 前回の記録から今日の目標を作る（ダブルプログレッション。plan/copy-previous.md）
  // 全セットがレップ範囲の上限に届いていたら重量を上げて回数は下限に、届いていなければ回数を1つ上げる
  function progressTarget(prevSets, reps, muscle, kind) {
    const t = String(reps || '');
    const m = t.match(/(\d+)\s*[〜~～\-–ー]\s*(\d+)/) || t.match(/^\s*(\d+)\s*$/);
    const lo = m ? +m[1] : null;
    const hi = m ? +(m[2] || m[1]) : null;
    const inc = ['quads', 'hamstrings', 'glutes'].includes(muscle) && (kind === 'main' || kind === 'compound') ? 5 : 2.5;
    const up = hi !== null && prevSets.every((x) => +x.r >= hi);
    const round = (v) => Math.round(v * 100) / 100;
    const sets = prevSets.map((x) => (up
      ? { w: x.w === '' ? '' : round(+x.w + inc), r: lo }
      : { w: x.w, r: hi !== null ? Math.min(+x.r + 1, hi) : +x.r + 1 }));
    return { up, inc, sets };
  }

  // ---------- 画面の切り替え ----------
  let view = state.answers ? 'dash' : 'welcome';
  let quizStep = 0;
  let draft = null;
  let wdOrder = []; // 曜日を選んだ順番
  let pickOpen = false;
  let openDay = null;

  function go(v) { view = v; pickOpen = false; render(); window.scrollTo(0, 0); }

  function render() {
    const tabbed = ['dash', 'log', 'program', 'more'].includes(view);
    $tabs.hidden = !tabbed;
    $tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === view ? 'page' : 'false'));
    const fn = { welcome: vWelcome, quiz: vQuiz, result: vResult, dash: vDash, log: vLog, program: vProgram, more: vMore, checkin: vCheckin, builder: vBuilder }[view];
    if (window.BunkatsuTheme) window.BunkatsuTheme.apply(state.theme || {});
    try {
      $app.innerHTML = fn();
    } catch (err) {
      // 保存データが壊れていて描けないときは、真っ白にせず、データを書き出してから初期化できる画面を出す
      $tabs.hidden = true;
      let dump = '';
      try { dump = localStorage.getItem(KEY) || JSON.stringify(state); } catch (e) { dump = ''; }
      $app.innerHTML = `
      <section class="welcome">
        <h1 class="title">データを読み込めませんでした</h1>
        <p>保存されているデータの形がこわれているため、画面を表示できません。下の文字列はいまのデータです。必要ならコピーして残してから、初期化してください。</p>
        <textarea readonly rows="6" class="small">${esc(dump)}</textarea>
        <button class="btn primary" onclick="location.reload()">もう一度読み込む</button>
        <p class="muted small">アプリの更新の直後は、読み込み直すと直ることがあります。初期化すると記録がすべて消えます。</p>
        <button class="linkbtn small" data-act="reset-yes">記録を消して初期化する</button>
      </section>`;
    }
    $app.dataset.view = view;
  }

  $tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.v === 'log') logDate = null; exMenu = null; go(b.dataset.v); });

  // ---------- はじめに ----------
  function vWelcome() {
    return `
    <section class="welcome">
      <p class="eyebrow">分割メーカー</p>
      <h1 class="display">自分に合う分割で、<br>迷わず鍛える。</h1>
      <p class="lead">質問に答えて分割の提案を受けるか、自分で考えたプランを登録するかを選べます。どちらも、毎回の記録と週ごとの振り返りができます。</p>
      <div class="choices">
        <button class="choice" data-act="start">
          <span class="choice-t">質問に答えて提案を受ける</span>
          <span class="choice-d">通える日数・時間・回復・BIG3の重量など9問から、研究ベースの採点で分割を選びます。1分ほど。</span>
        </button>
        <button class="choice" data-act="custom-new">
          <span class="choice-t">自分のオリジナルプランを設定する</span>
          <span class="choice-d">曜日ごとの部位、種目、セット数、回数を自分で決めます。今やっている分割をそのまま登録できます。</span>
        </button>
      </div>
      <button class="btn ghost" data-act="sample">サンプルで試す</button>
      <p class="muted small">記録はこの端末のブラウザだけに保存されます。</p>
    </section>`;
  }

  // ---------- 質問 ----------
  const STEPS = [
    { key: 'days', q: '週に何日ジムに行けますか？', note: '理想ではなく、無理なく続けられる日数を選んでください。', type: 'single',
      opts: [[2, '2日'], [3, '3日'], [4, '4日'], [5, '5日'], [6, '6日']] },
    { key: 'weekdays', q: '行く曜日を選んでください', note: '', type: 'weekdays' },
    { key: 'sessionMin', q: '1回に使える時間は？', type: 'single',
      opts: [['le45', '45分以下'], ['m60', '60分'], ['m75', '75分'], ['ge90', '90分以上']] },
    { key: 'bodyweight', q: '体重は？', note: '経験レベルの判定（重量の体重比）に使います。', type: 'number', unit: 'kg' },
    { key: 'sex', q: '性別は？', note: '重量基準の補正に使います。', type: 'single',
      opts: [['male', '男性'], ['female', '女性'], ['none', '回答しない']] },
    { key: 'lifts', q: '最近扱った重量と回数は？', note: 'わかる種目だけで大丈夫です。やっていない種目は空欄のままにしてください。', type: 'lifts' },
    { key: 'years', q: 'トレーニングを続けている期間は？', note: '重量の入力がないので、期間で代わりに判定します。', type: 'single', when: (a) => !hasLifts(a),
      opts: [['lt1', '1年未満'], ['y1to3', '1〜3年'], ['gt3', '3年以上']] },
    { key: 'goal', q: '一番の目的は？', type: 'single',
      opts: [['hypertrophy', '筋肉を大きくする'], ['strength', '力を強くする'], ['health', '体型づくり・健康（減量含む）']] },
    { key: 'recovery', q: '睡眠・疲れの状態は？', type: 'single',
      opts: [['good', '良い', '7時間以上眠れて、疲れが残らない'], ['normal', '普通', ''], ['poor', '悪い', '睡眠6時間未満、仕事がきつい']] },
    { key: 'schedule', q: '行く曜日は決まっていますか？', type: 'single',
      opts: [['fixed', '固定できる'], ['sometimes', 'ときどきずれる'], ['irregular', '毎週バラバラ']] },
    { key: 'priority', q: '特に伸ばしたい部位は？', note: '任意・最大2つまで。', type: 'multi', max: 2,
      opts: [['chest', '胸'], ['back', '背中'], ['shoulders', '肩'], ['arms', '腕'], ['legs', '脚'], ['glutes', 'お尻']] },
  ];

  function hasLifts(a) { return ['bench', 'squat', 'deadlift'].some((k) => a.lifts && a.lifts[k] && a.lifts[k].w > 0 && a.lifts[k].r > 0); }
  function activeSteps() { return STEPS.filter((s) => !s.when || s.when(draft)); }

  function newDraft() {
    return { days: null, weekdays: [], sessionMin: null, bodyweight: '', sex: null, lifts: { bench: {}, squat: {}, deadlift: {} }, years: null, goal: null, recovery: null, schedule: null, priority: [] };
  }

  function stepValid(s) {
    const v = draft[s.key];
    if (s.type === 'single') return v !== null && v !== undefined;
    if (s.type === 'weekdays') return v.length === draft.days;
    if (s.type === 'number') return +v >= 30 && +v <= 250;
    if (s.type === 'lifts') return true;
    if (s.type === 'multi') return true;
    return false;
  }

  function vQuiz() {
    const steps = activeSteps();
    const s = steps[quizStep];
    const v = draft[s.key];
    let body = '';
    if (s.type === 'single') {
      body = `<div class="opts">${s.opts.map(([val, label, sub]) => `
        <button class="opt" data-act="pick" data-val="${esc(val)}" aria-pressed="${v === val}">
          <span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}
        </button>`).join('')}</div>`;
    } else if (s.type === 'multi') {
      body = `<div class="opts grid3">${s.opts.map(([val, label]) => `
        <button class="opt" data-act="toggle" data-val="${esc(val)}" aria-pressed="${v.includes(val)}"><span>${esc(label)}</span></button>`).join('')}</div>
        <p class="hint">${v.length ? `${v.length}つ選択中` : '選ばなければ「なし」として進みます'}</p>`;
    } else if (s.type === 'weekdays') {
      body = `<div class="wdpick">${L.WEEKDAYS.map((w, i) => `
        <button class="opt wd" data-act="wd" data-val="${i}" aria-pressed="${v.includes(i)}">${w}</button>`).join('')}</div>
        <p class="hint">${v.length} / ${draft.days} 日選択中</p>`;
    } else if (s.type === 'number') {
      body = `<label class="numfield"><input id="q-bw" type="number" inputmode="decimal" min="30" max="250" step="0.1" value="${esc(v)}" placeholder="70"><span>${s.unit}</span></label>`;
    } else if (s.type === 'lifts') {
      body = `<div class="lifts">${['bench', 'squat', 'deadlift'].map((k) => `
        <div class="liftrow">
          <span class="liftname">${L.LIFT_STD[k].name}</span>
          <label><input id="q-${k}-w" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(v[k].w || '')}" data-lift="${k}" data-f="w" placeholder="—"><span>kg</span></label>
          <span class="times">×</span>
          <label><input id="q-${k}-r" type="number" inputmode="numeric" min="1" max="30" step="1" value="${esc(v[k].r || '')}" data-lift="${k}" data-f="r" placeholder="—"><span>回</span></label>
        </div>`).join('')}</div>
        <p class="hint">推定1RM＝重量×(1＋回数÷30)。10回を超える入力は10回として計算します。</p>`;
    }
    const s0 = s.key === 'weekdays' && draft.days ? `週${draft.days}日分、選んでください。` : s.note || '';
    return `
    <section class="quiz">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${quizStep + 1}">
        <span style="width:${((quizStep + 1) / steps.length) * 100}%"></span>
      </div>
      <p class="eyebrow">質問 ${quizStep + 1} / ${steps.length}</p>
      <h2 class="q">${esc(s.q)}</h2>
      ${s0 ? `<p class="note">${esc(s0)}</p>` : ''}
      ${body}
      <div class="quiznav">
        <button class="btn ghost" data-act="back">${quizStep === 0 ? 'やめる' : '戻る'}</button>
        <button class="btn primary" data-act="next" ${stepValid(s) ? '' : 'disabled'}>${quizStep === steps.length - 1 ? '結果を見る' : '次へ'}</button>
      </div>
    </section>`;
  }

  function finishQuiz() {
    const a = JSON.parse(JSON.stringify(draft));
    a.bodyweight = +a.bodyweight;
    for (const k of ['bench', 'squat', 'deadlift']) {
      const l = a.lifts[k];
      a.lifts[k] = (+l.w > 0 && +l.r > 0) ? { w: +l.w, r: +l.r } : null;
    }
    if (hasLifts(a)) delete a.years;
    state.answers = a;
    state.choice = null;
    state.levelOverride = null;
    state.custom = null;
    save();
    go('result');
  }

  // ---------- 結果 ----------
  const COLOR_NAME = { full: 'full', upper: 'upper', push: 'push', pull: 'pull', legs: 'legs', arms: 'arms' };
  const pct = (x) => Math.round(x * 100);

  function weekStrip(r) {
    const map = {};
    r.weekdays.forEach((d, i) => { map[d] = r.sessions[i]; });
    return `<ol class="strip">${L.WEEKDAYS.map((w, d) => {
      const s = map[d];
      return `<li class="${s ? 'c-' + COLOR_NAME[s.color] : 'rest'}"><span class="w">${w}</span><span class="l">${s ? esc(s.label) : '休'}</span></li>`;
    }).join('')}</ol>`;
  }

  function vResult() {
    const p = currentPlan();
    const { rec, chosen } = p;
    const a = state.answers;
    const exp = rec.experience;
    const per = exp.per.map((x) => `${x.name}：${L.LEVEL_NAME[x.level]}（1RM ${Math.round(x.oneRM)}kg・体重比 ${x.ratio.toFixed(2)}）`).join('<br>');
    const levelSrc = exp.source === 'lifts' ? per : '重量の入力がないため、トレーニング期間で判定しました。';
    const over = chosen.detail.maxMin > chosen.detail.limit;
    const cut = p.fitted ? Object.keys(p.fitted.trimmed).map((m) => `${L.MUSCLES[m].name} −${p.fitted.trimmed[m]}`).join('、') : '';
    const time = !over ? '' : `
      <div class="card fit">
        <p class="eyebrow">時間の調整</p>
        <p class="small">目標どおりだと1回最長${chosen.detail.maxMin}分で、${chosen.detail.limit}分を超えます。</p>
        <label class="switch"><input id="fit-time" type="checkbox" data-act="fit" ${state.fitTime === false ? '' : 'checked'}><span>${chosen.detail.limit}分に収まるようにセット数を減らす</span></label>
        ${p.fitted && cut ? `<p class="muted small">週あたり ${esc(cut)} セット減らしています。時間に余裕がある日は目標まで足してください。</p>` : ''}
        ${p.fitted && p.fitted.over ? `<p class="small warn">この分割は部位が多いため、各部位を最低2セットにしても1回 ${p.fitted.minMinutes}分かかり、${p.fitted.limit}分には収まりません。時間を優先するなら、部位の少ない分割（上下分割など）を選んでください。</p>` : ''}
      </div>`;
    const reduced = chosen.reduced ? `<p class="badge-line"><span class="badge">週${chosen.tpl.days}日に減らす案</span></p>` : '';
    const rows = rec.ranked.map((r, i) => `
      <tr class="${r === chosen ? 'is-on' : ''}">
        <th scope="row">${i + 1}. ${esc(r.tpl.name)}${r.reduced ? '<small>（日数を減らす案）</small>' : ''}</th>
        <td class="num">${r.total.toFixed(2)}</td>
        <td class="num">${pct(r.parts.freq)}</td><td class="num">${pct(r.parts.time)}</td><td class="num">${pct(r.parts.vol)}</td><td class="num">${pct(r.parts.recv)}</td><td class="num">${pct(r.parts.sched)}</td>
        <td>${r === chosen ? '<span class="badge">使用中</span>' : `<button class="btn tiny" data-act="choose" data-id="${r.tpl.id}">これにする</button>`}</td>
      </tr>`).join('');
    const targets = L.MUSCLE_ORDER.map((m) => `<li><span>${L.MUSCLES[m].name}</span><b class="num">${rec.targets[m]}</b></li>`).join('');
    const alt = rec.ranked.find((r) => r !== chosen);
    return `
    <section class="result">
      <p class="eyebrow">あなたへの提案</p>
      <h1 class="display">${esc(chosen.tpl.name)}</h1>
      ${reduced}
      <ul class="reason">${chosen.reason.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${time}
      ${weekStrip(chosen)}
      <button class="btn primary" data-act="begin">このプランで始める</button>

      ${alt ? `<div class="card alt">
        <p class="eyebrow">別案</p>
        <h3>${esc(alt.tpl.name)}${alt.reduced ? '（日数を減らす案）' : ''}</h3>
        <p class="muted">${esc(alt.reason[0])}</p>
        ${weekStrip(alt)}
        <button class="btn ghost" data-act="choose" data-id="${alt.tpl.id}">別案に切り替える</button>
      </div>` : ''}

      <div class="card">
        <p class="eyebrow">経験レベル</p>
        <div class="levelrow">
          <h3>${L.LEVEL_NAME[rec.level]}${state.levelOverride ? '<small>（手動で変更）</small>' : ''}</h3>
          <label class="sel"><span class="sr">経験レベルを変更</span>
            <select id="level-override" data-act="level">
              <option value="">自動判定（${L.LEVEL_NAME[exp.level]}）</option>
              ${['beginner', 'intermediate', 'advanced'].map((k) => `<option value="${k}" ${state.levelOverride === k ? 'selected' : ''}>${L.LEVEL_NAME[k]}にする</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="muted small">${levelSrc}</p>
        ${exp.per.length >= 2 ? '<p class="muted small">種目ごとのレベルが違うときは、低いほう寄りを採用しています。</p>' : ''}
      </div>

      <div class="card">
        <p class="eyebrow">部位ごとの週セット目標</p>
        <ul class="targets">${targets}</ul>
        <p class="muted small">${a.recovery === 'good' ? '回復が良いので、目安の中央から始めます。' : '目安の下限から始めて、記録を見ながら増やします。'}</p>
      </div>

      <details class="card scores">
        <summary>全候補の点数を見る</summary>
        <div class="tablewrap"><table>
          <thead><tr><th>分割</th><th>合計</th><th>頻度</th><th>時間</th><th>量</th><th>回復</th><th>予定</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="muted small">各項目は0〜100点。目的（${esc(L.GOAL_NAME[a.goal])}）に応じた重みで合計しています。</p>
      </details>
    </section>`;
  }

  // ---------- オリジナルプラン ----------
  const G_UPPER = ['chest', 'back', 'shoulders', 'biceps', 'triceps'];
  const G_LOWER = ['quads', 'hamstrings', 'glutes', 'calves'];
  const PRESETS = [
    ['全身', G_UPPER.concat(G_LOWER)], ['上半身', G_UPPER], ['下半身', G_LOWER],
    ['プッシュ', ['chest', 'shoulders', 'triceps']], ['プル', ['back', 'biceps']], ['脚', G_LOWER],
  ];
  const PRESET_NAMES = PRESETS.map((x) => x[0]);

  // 部位の組み合わせからテーマ色を決める
  function colorFor(ms) {
    const up = ms.some((m) => G_UPPER.includes(m)), low = ms.some((m) => G_LOWER.includes(m));
    if (up && low) return 'full';
    if (low) return 'legs';
    if (ms.every((m) => ['chest', 'shoulders', 'triceps'].includes(m))) return ms.length === 1 && ms[0] === 'shoulders' ? 'arms' : 'push';
    if (ms.every((m) => ['back', 'biceps'].includes(m))) return 'pull';
    if (ms.every((m) => ['shoulders', 'biceps', 'triceps'].includes(m))) return 'arms';
    return 'upper';
  }

  // オリジナルプランを、提案プランと同じ形（rec / chosen / menus）にして返す
  function customPlan() {
    const c = state.custom;
    const menus = c.menus.map((m) => ({ ...m, minutes: m.items.reduce((a, b) => a + b.sets, 0) * 3 }));
    const targets = {};
    L.PICK_ORDER.forEach((m) => { targets[m] = 0; });
    menus.forEach((m) => m.items.forEach((it) => { targets[it.muscle] += it.sets; }));
    const chosen = { tpl: { id: 'custom', name: c.name || 'オリジナルプラン', days: menus.length, family: 'custom' }, weekdays: c.weekdays, sessions: menus, reason: [], detail: {} };
    const rec = { level: c.level, targets, experience: { level: c.level, per: [], source: 'custom' }, ranked: [chosen], best: chosen };
    const byWeekday = {};
    c.weekdays.forEach((d, i) => { byWeekday[d] = i; });
    return { rec, chosen, menus, byWeekday, fitted: null, custom: true };
  }

  // 目標セット数がある部位だけ（オリジナルプランで鍛えない部位は出さない）
  const planMuscles = (p) => L.PICK_ORDER.filter((m) => p.rec.targets[m] > 0);

  let bdraft = null;
  let bmsg = '';

  // 編集画面の下書き。今のプラン（提案でもオリジナルでも）から作る
  function newBuilderDraft(fromCurrent) {
    const d = { name: '', goal: (state.answers && state.answers.goal) || 'hypertrophy', level: 'intermediate', bodyweight: (state.answers && state.answers.bodyweight) || '', days: L.WEEKDAYS.map(() => ({ on: false, label: '', muscles: [] })) };
    if (fromCurrent && state.answers) {
      const p = currentPlan();
      d.name = state.custom ? state.custom.name : `${p.chosen.tpl.name}（自分用）`;
      d.level = p.rec.level;
      p.chosen.weekdays.forEach((wd, i) => { const m = p.menus[i]; d.days[wd] = { on: true, label: m.label, muscles: L.PICK_ORDER.filter((x) => m.items.some((it) => it.muscle === x)) }; });
      // 提案プランから作るときは、今のメニュー（差し替え・時間調整済み）をそのまま引き継ぐ
      if (!state.custom) d.seed = { weekdays: p.chosen.weekdays.slice(), menus: p.menus.map((m) => ({ label: m.label, color: m.color, muscles: L.PICK_ORDER.filter((x) => m.items.some((it) => it.muscle === x)), items: m.items.map(({ name, muscle, sets, reps, kind }) => ({ name, muscle, sets, reps, kind })) })) };
    } else {
      [[0, '上半身', G_UPPER], [1, '下半身', G_LOWER], [3, '上半身', G_UPPER], [4, '下半身', G_LOWER]].forEach(([wd, label, ms]) => { d.days[wd] = { on: true, label, muscles: ms.slice() }; });
    }
    return d;
  }

  function vBuilder() {
    const d = bdraft;
    const rows = d.days.map((day, wd) => `
      <li class="bday ${day.on ? 'is-on c-' + colorFor(day.muscles.length ? day.muscles : ['chest']) : ''}">
        <div class="bdayhead">
          <span class="w">${L.WEEKDAYS[wd]}</span>
          <button class="toggle" data-act="bday" data-wd="${wd}" aria-pressed="${day.on}">${day.on ? 'トレーニング' : '休み'}</button>
          ${day.on ? `<label class="blabel"><span class="sr">${L.WEEKDAYS[wd]}曜日のメニュー名</span><input id="bl-${wd}" type="text" maxlength="12" value="${esc(day.label)}" placeholder="メニュー名" data-blabel="${wd}"></label>` : ''}
        </div>
        ${day.on ? `
        <p class="blabel2">まとめて選ぶ</p>
        <div class="presets">${PRESETS.map(([nm, ms]) => `<button class="chip small" data-act="bpreset" data-wd="${wd}" data-p="${nm}" aria-pressed="${ms.length === day.muscles.length && ms.every((m) => day.muscles.includes(m))}">${nm}</button>`).join('')}</div>
        <p class="blabel2">部位を1つずつ選ぶ</p>
        <div class="mchips">${L.PICK_ORDER.map((m) => `<button class="chip mchip" data-act="bmuscle" data-wd="${wd}" data-m="${m}" aria-pressed="${day.muscles.includes(m)}">${L.MUSCLES[m].name}</button>`).join('')}</div>` : ''}
      </li>`).join('');
    const n = d.days.filter((x) => x.on).length;
    const editing = !!state.custom;
    return `
    <section class="builder">
      <header class="pagehead"><button class="linkbtn" data-act="bback">‹ 戻る</button></header>
      <p class="eyebrow">オリジナルプラン</p>
      <h1 class="title">${editing ? 'プランを編集' : '自分のプランを作る'}</h1>
      <p class="muted small">曜日ごとに、鍛える部位を選んでください。種目・セット数・回数は、次の画面で自由に変えられます。</p>
      <div class="card">
        <label class="field"><span class="eyebrow">プラン名</span><input id="b-name" type="text" maxlength="20" value="${esc(d.name)}" placeholder="例：自分流 上下分割"></label>
        <div class="field2">
          <label class="field"><span class="eyebrow">目的</span>
            <select id="b-goal">${Object.keys(L.GOAL_NAME).map((g) => `<option value="${g}" ${d.goal === g ? 'selected' : ''}>${L.GOAL_NAME[g]}</option>`).join('')}</select></label>
          <label class="field"><span class="eyebrow">セット数の目安</span>
            <select id="b-level">${['beginner', 'intermediate', 'advanced'].map((k) => `<option value="${k}" ${d.level === k ? 'selected' : ''}>${L.LEVEL_NAME[k]}向け</option>`).join('')}</select></label>
        </div>
        <label class="field"><span class="eyebrow">体重（任意・kg）</span><input id="b-bw" type="number" inputmode="decimal" min="30" max="250" step="0.1" value="${esc(d.bodyweight)}" placeholder="70"></label>
        <p class="muted small">目的は回数と休憩時間に、セット数の目安は最初のセット数に使います。</p>
      </div>
      <div class="card">
        <div class="cardhead"><p class="eyebrow">1週間の予定</p><span class="muted small num">週${n}日</span></div>
        <ol class="bdays">${rows}</ol>
      </div>
      ${bmsg ? `<p class="small warn">${esc(bmsg)}</p>` : ''}
      <button class="btn primary" data-act="bsave">${editing ? 'この内容で更新する' : 'このプランでメニューを作る'}</button>
      ${editing ? '<p class="muted small">部位を変えていない曜日は、種目やセット数の変更がそのまま残ります。</p>' : ''}
    </section>`;
  }

  function saveBuilder() {
    const d = bdraft;
    const on = d.days.map((x, wd) => ({ ...x, wd })).filter((x) => x.on);
    if (!on.length) { bmsg = 'トレーニングする曜日を1日以上選んでください。'; return false; }
    const empty = on.find((x) => !x.muscles.length);
    if (empty) { bmsg = `${L.WEEKDAYS[empty.wd]}曜日の部位を選んでください。`; return false; }
    bmsg = '';
    const sessions = on.map((x) => {
      const ms = L.PICK_ORDER.filter((m) => x.muscles.includes(m));
      return { label: x.label.trim() || PRESETS.find((p) => p[1].length === ms.length && p[1].every((m) => ms.includes(m)))?.[0] || '自由', muscles: ms, color: colorFor(ms) };
    });
    // 部位ごとの週セットの目安を、その部位を鍛える日に配分して種目を組む
    const used = new Set(sessions.flatMap((s) => s.muscles));
    const base = L.weeklyTargets(d.level, 'normal', []);
    const targets = {};
    used.forEach((m) => { targets[m] = base[m] != null ? base[m] : base.calves; });
    const sets = L.distribute(sessions, targets);
    const built = L.buildMenus({ sessions, sets, minutes: sets.map(() => 0) }, d.goal);
    // 部位が前と同じ曜日は、編集済みの種目を残す
    const old = state.custom || d.seed;
    const menus = built.map((m, i) => {
      const wd = on[i].wd;
      if (old) {
        const j = old.weekdays.indexOf(wd);
        const prev = j >= 0 ? old.menus[j] : null;
        if (prev && prev.muscles.length === m.muscles.length && prev.muscles.every((x) => m.muscles.includes(x))) return { ...prev, label: m.label, color: m.color };
      }
      return { label: m.label, color: m.color, muscles: m.muscles, items: m.items.map(({ name, muscle, sets: n, reps, kind }) => ({ name, muscle, sets: n, reps, kind })) };
    });
    state.custom = { name: d.name.trim(), goal: d.goal, level: d.level, weekdays: on.map((x) => x.wd), menus };
    const bw = +d.bodyweight;
    const prevA = state.answers || {};
    state.answers = Object.assign({ sessionMin: 'ge90', sex: 'none', lifts: {}, recovery: 'normal', priority: [] }, prevA, {
      goal: d.goal, days: on.length, weekdays: on.map((x) => x.wd), schedule: 'fixed', bodyweight: bw >= 30 ? bw : (prevA.bodyweight || null),
    });
    save();
    return true;
  }

  // プログラム画面：オリジナルプランのメニュー編集
  function customMenusHtml(p) {
    return p.menus.map((m, i) => `
      <details class="menu c-${m.color}" data-menu="${i}" data-sort-i="${i}" ${openMenus.has(i) ? 'open' : ''}>
        <summary data-grip><span class="pip"></span><b>${esc(m.label)}</b><span class="muted small">${L.WEEKDAYS[p.chosen.weekdays[i]]}曜・${m.items.length}種目・${m.minutes}分</span></summary>
        <ol class="citems" data-sort="items:${i}">${m.items.map((it, n) => {
          const names = exerciseNames(it.muscle);
          if (!names.includes(it.name)) names.push(it.name);
          const editing = customOpen === `${i}-${n}`;
          return `<li class="citem" data-sort-i="${n}">
            <div class="citemtop"><span class="grip" data-grip aria-hidden="true"></span>
              ${editing ? `<form class="customex" data-custom-sess="${i}" data-custom-n="${n}" data-custom-muscle="${it.muscle}">
                <label class="sr" for="cx-${i}-${n}">${esc(L.MUSCLES[it.muscle].name)}の種目名</label>
                <input id="cx-${i}-${n}" type="text" maxlength="30" placeholder="例：${esc(L.MUSCLES[it.muscle].name)}のマシン" autocomplete="off">
                <button class="btn tiny primary" type="submit">決定</button>
                <button class="btn tiny ghost" type="button" data-act="customcancel">やめる</button>
              </form>`
              : `<label class="exsel"><span class="sr">${esc(it.name)}を変更</span>
                <select id="cn-${i}-${n}" data-cname="${i}-${n}">
                  ${names.map((nm) => `<option value="${esc(nm)}" ${nm === it.name ? 'selected' : ''}>${esc(nm)}</option>`).join('')}
                  <option value="__custom__">＋ 候補にない種目を入力…</option>
                </select></label>`}
              <button class="iconbtn" data-act="cdel" data-i="${i}" data-n="${n}" aria-label="${esc(it.name)}を削除">✕</button>
            </div>
            <div class="citembottom">
              <span class="mtag">${L.MUSCLES[it.muscle].name}</span>
              <div class="stepper" role="group" aria-label="セット数">
                <button data-act="csets" data-i="${i}" data-n="${n}" data-d="-1" aria-label="1セット減らす">−</button>
                <span class="num">${it.sets}<small>セット</small></span>
                <button data-act="csets" data-i="${i}" data-n="${n}" data-d="1" aria-label="1セット増やす">＋</button>
              </div>
              <label class="repsfield"><span class="sr">回数</span><input id="cr-${i}-${n}" type="text" maxlength="8" value="${esc(it.reps)}" data-creps="${i}-${n}"><span>回</span></label>
            </div>
          </li>`;
        }).join('')}</ol>
        <div class="cadd">
          <label class="sr" for="cadd-${i}">追加する種目の部位</label>
          <select id="cadd-${i}">${L.PICK_ORDER.map((mm) => `<option value="${mm}" ${m.muscles[0] === mm ? 'selected' : ''}>${L.MUSCLES[mm].name}</option>`).join('')}</select>
          <button class="btn tiny ghost" data-act="cadd" data-i="${i}">＋ 種目を追加</button>
        </div>
      </details>`).join('');
  }

  // ---------- 共通の部品 ----------
  const REST_TIPS = ['7時間以上眠る', 'タンパク質を体重×1.6〜2gとる', '水分をこまめにとる', '20〜30分の軽いウォーキング', '張りが強い部位はストレッチだけにする'];
  const fmtDate = (d) => `${d.getMonth() + 1}月${d.getDate()}日（${L.WEEKDAYS[wdIndex(d)]}）`;
  const parseKey = (k) => { const [y, m, dd] = k.split('-').map(Number); return new Date(y, m - 1, dd); };

  // 円グラフ（完了 / 目標）。色は CSS のトークンから
  function ring(done, total, size, label) {
    const r = 42, c = 2 * Math.PI * r;
    const f = total ? Math.min(1, done / total) : 0;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${esc(label)}">
      <circle cx="50" cy="50" r="${r}" class="ring-bg"></circle>
      ${f > 0 ? '' : '<!--'}<circle cx="50" cy="50" r="${r}" class="ring-fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"></circle>${f > 0 ? '' : '-->'}
    </svg>`;
  }

  function samplePill() {
    return state.sample ? `<div class="samplebar"><span>サンプルを表示中</span><button class="btn tiny" data-act="start">自分の回答で始める</button></div>` : '';
  }

  function ensureLog(k, idx, menu) {
    let lg = state.logs[k];
    // 入力を始めた日（touched）は作り直さない。まだ何も触っていない日だけ、最新のメニューに合わせる
    const fresh = (it) => ({ name: it.name, muscle: it.muscle, sets: Array.from({ length: it.sets }, () => ({ w: '', r: '', done: false })) });
    if (!lg || lg.session !== idx || (doneSets(lg) === 0 && !lg.touched)) {
      const extra = lg && lg.session === idx ? lg.items.filter((it) => it.extra && !menu.items.some((x) => x.name === it.name)) : [];
      lg = state.logs[k] = { session: idx, label: menu.label, items: menu.items.map(fresh).concat(extra), note: (lg && lg.note) || '' };
      return lg;
    }
    // 入力済みの日でも、プログラムで増えた種目は空のセットで末尾に足す。プログラムから消えて何も入力していない種目は外す
    const blank = (it) => it.sets.every((x) => !x.done && x.w === '' && x.r === '');
    lg.items = lg.items.filter((it) => it.extra || !blank(it) || menu.items.some((x) => x.name === it.name));
    menu.items.forEach((it) => { if (!lg.items.some((x) => x.name === it.name) && !(lg.removed || []).includes(it.name)) lg.items.push(fresh(it)); });
    return lg;
  }

  function nextTraining(p, d) {
    if (state.answers.schedule === 'irregular' && !state.custom) {
      const last = lastSessionIdx();
      const j = last ? (last.idx + 1) % p.menus.length : 0;
      return { label: p.menus[j].label, when: '', color: p.menus[j].color };
    }
    for (let i = 1; i <= 7; i++) {
      const dd = addDays(d, i);
      const j = sessionFor(p, dd);
      if (j >= 0) return { label: p.menus[j].label, when: i === 1 ? '明日' : fmtDate(dd), color: p.menus[j].color };
    }
    return null;
  }

  function weekDone(mon) {
    const done = {};
    Object.keys(L.MUSCLES).forEach((m) => { done[m] = 0; });
    let sessions = 0;
    for (let i = 0; i < 7; i++) {
      const lg = state.logs[dateKey(addDays(mon, i))];
      if (!lg || !doneSets(lg)) continue;
      sessions++;
      (lg.items || []).forEach((it) => { done[it.muscle] += it.sets.filter((s) => s.done).length; });
    }
    return { done, sessions };
  }

  // 主要リフトの推定1RM（日ごとの最高値）
  const LIFT_NAMES = { bench: 'ベンチプレス', squat: 'スクワット', deadlift: 'デッドリフト' };
  function liftSeries(key) {
    const out = [];
    Object.keys(state.logs).sort().forEach((k) => {
      let best = 0;
      (state.logs[k].items || []).forEach((it) => {
        if (it.name !== LIFT_NAMES[key]) return;
        it.sets.forEach((s) => { if (s.done && +s.w > 0 && +s.r > 0) best = Math.max(best, L.epley1RM(+s.w, +s.r)); });
      });
      if (best) out.push({ k, v: Math.round(best * 10) / 10 });
    });
    return out;
  }

  function trendChart(series, minRange = 6) {
    const W = 320, H = 140, padL = 34, padR = 44, padT = 12, padB = 22;
    const vs = series.map((s) => s.v);
    const padV = minRange >= 6 ? 2 : 0.5;
    let lo = Math.floor(Math.min(...vs) - padV), hi = Math.ceil(Math.max(...vs) + padV);
    if (hi - lo < minRange) { const m = (hi + lo) / 2; lo = Math.floor(m - minRange / 2); hi = Math.ceil(m + minRange / 2); }
    const t0 = parseKey(series[0].k).getTime(), t1 = parseKey(series[series.length - 1].k).getTime();
    const x = (k) => padL + (t1 === t0 ? 0.5 : (parseKey(k).getTime() - t0) / (t1 - t0)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const ticks = [lo, Math.round((lo + hi) / 2), hi];
    const pts = series.map((s) => `${x(s.k).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ');
    const last = series[series.length - 1];
    const area = `${padL},${H - padB} ${pts} ${x(last.k).toFixed(1)},${H - padB}`;
    const d0 = parseKey(series[0].k), d1 = parseKey(last.k);
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="推定1RMの推移">
      ${ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"></line><text x="${padL - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${t}</text>`).join('')}
      <polygon points="${area}" class="area"></polygon>
      <polyline points="${pts}" class="line"></polyline>
      ${series.map((s) => `<circle cx="${x(s.k)}" cy="${y(s.v)}" r="2.5" class="pt"></circle>`).join('')}
      <circle cx="${x(last.k)}" cy="${y(last.v)}" r="5" class="end"></circle>
      <text x="${x(last.k) + 8}" y="${y(last.v) + 4}" class="endlabel">${last.v}</text>
      <text x="${padL}" y="${H - 4}" class="axis">${d0.getMonth() + 1}/${d0.getDate()}</text>
      <text x="${W - padR}" y="${H - 4}" class="axis" text-anchor="end">${d1.getMonth() + 1}/${d1.getDate()}</text>
    </svg>`;
  }

  // ---------- 体重（MacroFactor の傾向体重と同じく、日々の上下をならした値も出す） ----------
  function weightSeries() {
    const keys = Object.keys(state.weights || {}).sort();
    let t = null;
    return keys.map((k) => {
      const w = +state.weights[k];
      t = t === null ? w : t + 0.1 * (w - t);
      return { k, w, v: Math.round(t * 10) / 10 };
    });
  }
  function latestWeight() {
    const s = weightSeries();
    return s.length ? s[s.length - 1].w : (state.answers && state.answers.bodyweight) || null;
  }
  function weightCard() {
    const s = weightSeries();
    const tk = dateKey(today());
    const todayW = state.weights && state.weights[tk];
    let body = '<p class="muted small chartempty">体重を2日以上記録すると、日々の増減をならした「傾向体重」の推移が出ます。</p>';
    if (s.length >= 2) {
      const last = s[s.length - 1];
      const wk = s.filter((x) => x.k <= dateKey(addDays(today(), -7)));
      const base = wk.length ? wk[wk.length - 1].v : s[0].v;
      const diff = Math.round((last.v - base) * 10) / 10;
      body = `<p class="trendhead"><span class="num big2">${last.v}</span><span class="muted small">kg 傾向体重</span><span class="delta neutral num">${diff >= 0 ? '+' : ''}${diff}kg</span><span class="muted small">（${wk.length ? '1週間' : '記録開始から'}）</span></p>${trendChart(s.slice(-30), 2)}`;
    }
    return `
      <div class="card">
        <div class="cardhead"><p class="eyebrow">体重</p><span class="muted small">${todayW ? `今日 ${todayW}kg` : '今日は未記録'}</span></div>
        <div class="bwrow">
          <label class="bwfield"><span class="sr">今日の体重</span><input id="bw-today" type="number" inputmode="decimal" step="0.1" min="30" max="250" value="${todayW || ''}" placeholder="${esc(latestWeight() || '')}"><span>kg</span></label>
          <button class="btn tiny" data-act="bwsave">${todayW ? '更新' : '記録'}</button>
        </div>
        ${body}
      </div>`;
  }

  // ---------- 休憩タイマー ----------
  const $rest = document.getElementById('rest');
  let restEnd = 0, restTotal = 0, restTimer = null;
  const REST_SEC = {
    strength: { main: 180, compound: 150, iso: 90 },
    hypertrophy: { main: 120, compound: 90, iso: 60 },
    health: { main: 90, compound: 60, iso: 60 },
  };
  let restEx = null;
  const fmtSec = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  // 休憩時間：種目ごとの設定 → 自分で決めた初期値 → 目的と種目の種類から自動
  function restFor(name, kind) {
    if (state.restByEx && state.restByEx[name]) return state.restByEx[name];
    if (state.restDefault) return state.restDefault;
    return (REST_SEC[state.answers.goal] || REST_SEC.hypertrophy)[kind || 'compound'];
  }
  function startRest(name, kind) {
    if (state.restOn === false) return;
    restEx = { name, kind };
    restTotal = restFor(name, kind);
    restEnd = Date.now() + restTotal * 1000;
    $rest.hidden = false;
    tickRest();
    clearInterval(restTimer);
    restTimer = setInterval(tickRest, 250);
  }
  function stopRest() { clearInterval(restTimer); restTimer = null; $rest.hidden = true; }
  function tickRest() {
    const left = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
    $rest.querySelector('.rest-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $rest.querySelector('.rest-bar span').style.width = `${restTotal ? (1 - left / restTotal) * 100 : 100}%`;
    $rest.classList.toggle('is-over', left === 0);
    $rest.querySelector('.rest-label').textContent = left === 0 ? '休憩終了。次のセットへ' : '休憩中';
    if (left === 0 && restTimer) {
      clearInterval(restTimer); restTimer = null;
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* 振動できない端末 */ }
      setTimeout(() => { if (!restTimer) $rest.hidden = true; }, 6000);
    }
  }
  $rest.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rest]');
    if (!b) return;
    if (b.dataset.rest === 'stop') return stopRest();
    if (b.dataset.rest === 'pick') {
      if (!restEx) return;
      return openPicker(restFor(restEx.name, restEx.kind), `${restEx.name}の休憩時間`, (sec) => {
        state.restByEx = state.restByEx || {};
        state.restByEx[restEx.name] = sec; save();
        restTotal = sec; restEnd = Date.now() + sec * 1000;
        if (!restTimer) restTimer = setInterval(tickRest, 250);
        tickRest(); if (view === 'log') render();
      });
    }
    restEnd += (+b.dataset.rest) * 1000; restTotal += +b.dataset.rest;
    if (!restTimer) { restTimer = setInterval(tickRest, 250); }
    tickRest();
  });

  // ---------- 時間の回転式ピッカー（iPhone のタイマーと同じ操作） ----------
  const $picker = document.getElementById('picker');
  const ROW = 40;
  let pickerDone = null;
  function wheel(id, max, unit, val) {
    const items = Array.from({ length: max + 1 }, (_, i) => `<li data-v="${i}">${i}</li>`).join('');
    return `<div class="wheelcol"><ul class="wheel" id="${id}" tabindex="0" role="listbox" aria-label="${unit}">${items}</ul><span class="wunit">${unit}</span></div>`;
  }
  function openPicker(sec, title, onDone, extra) {
    pickerDone = onDone;
    $picker.querySelector('.picker-title').textContent = title;
    $picker.querySelector('.wheels').innerHTML = wheel('wh-m', 15, '分') + wheel('wh-s', 59, '秒');
    const ex = $picker.querySelector('.picker-extra');
    ex.innerHTML = extra || '';
    $picker.querySelector('.picker-msg').textContent = '';
    $picker.hidden = false;
    const m = Math.min(15, Math.floor(sec / 60)), s = sec % 60;
    requestAnimationFrame(() => {
      document.getElementById('wh-m').scrollTop = m * ROW;
      document.getElementById('wh-s').scrollTop = s * ROW;
      markWheels();
    });
  }
  function wheelValue(id) { const el = document.getElementById(id); return Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollTop / ROW))); }
  function markWheels() {
    ['wh-m', 'wh-s'].forEach((id) => {
      const el = document.getElementById(id); if (!el) return;
      const v = wheelValue(id);
      [...el.children].forEach((li, i) => li.classList.toggle('is-sel', i === v));
    });
  }
  function closePicker() { $picker.hidden = true; pickerDone = null; }
  $picker.addEventListener('scroll', () => markWheels(), true);
  $picker.addEventListener('click', (e) => {
    if (e.target === $picker) return closePicker();
    const li = e.target.closest('.wheel li');
    if (li) { li.parentElement.scrollTo({ top: +li.dataset.v * ROW, behavior: 'smooth' }); return; }
    const b = e.target.closest('[data-pk]');
    if (!b) return;
    if (b.dataset.pk === 'cancel') return closePicker();
    if (b.dataset.pk === 'auto') { const f = pickerDone; closePicker(); return f && f(null); }
    if (b.dataset.pk === 'ok') {
      const sec = wheelValue('wh-m') * 60 + wheelValue('wh-s');
      if (sec < 5) { $picker.querySelector('.picker-msg').textContent = '5秒以上にしてください。'; return; }
      const f = pickerDone; closePicker(); if (f) f(sec);
    }
  });
  $picker.addEventListener('keydown', (e) => {
    const w = e.target.closest && e.target.closest('.wheel');
    if (e.key === 'Escape') return closePicker();
    if (w && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); w.scrollTop += (e.key === 'ArrowDown' ? ROW : -ROW); }
  });

  // ---------- ダッシュボード ----------
  let liftTab = 'bench';
  function vDash() {
    const p = currentPlan();
    const d = today();
    const k = dateKey(d);
    const idx = sessionFor(p, d);
    const mon = mondayOf(d);

    // 今日
    let todayCard;
    if (idx === -1) {
      const nx = nextTraining(p, d);
      todayCard = `
      <div class="card todaycard rest">
        <div class="cardhead"><p class="eyebrow">今日</p><span class="muted small">${fmtDate(d)}</span></div>
        <h2 class="big">休養日</h2>
        ${nx ? `<p class="muted">次は <b class="c-${nx.color} cc">${nx.when ? `${esc(nx.when)}・` : ''}${esc(nx.label)}</b></p>` : ''}
        <ul class="tips small">${REST_TIPS.slice(0, 3).map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>`;
    } else {
      const menu = p.menus[idx];
      const lg = state.logs[k];
      const total = menu.items.reduce((a, b) => a + b.sets, 0);
      const done = lg && lg.session === idx ? doneSets(lg) : 0;
      todayCard = `
      <div class="card todaycard c-${menu.color}">
        <div class="cardhead"><p class="eyebrow">今日</p><span class="muted small">${fmtDate(d)}</span></div>
        <div class="todayrow">
          <div class="ringwrap">${ring(done, total, 92, `${done}/${total}セット`)}<span class="ringnum num">${done}<small>/${total}</small></span></div>
          <div class="todaytxt">
            <h2 class="big cc">${esc(menu.label)}</h2>
            <p class="muted small">${menu.items.length}種目・目安${menu.minutes}分</p>
          </div>
        </div>
        <button class="btn primary" data-act="openlog" data-k="${k}">${done ? '記録を続ける' : '記録をはじめる'}</button>
      </div>`;
    }

    // 週のボリューム
    const wk = weekDone(mon);
    const targets = p.rec.targets;
    const tTotal = planMuscles(p).reduce((a, m) => a + targets[m], 0);
    const dTotal = planMuscles(p).reduce((a, m) => a + wk.done[m], 0);
    const vol = planMuscles(p).map((m) => {
      const r = Math.min(1, wk.done[m] / targets[m]);
      return `<li class="${wk.done[m] >= targets[m] ? 'is-met' : ''}"><span class="vm">${L.MUSCLES[m].name}</span><span class="vbar"><span style="width:${r * 100}%"></span></span><span class="vn num">${wk.done[m]}<small> / ${targets[m]}</small></span></li>`;
    }).join('');

    // 今週の予定
    const strip = L.WEEKDAYS.map((w, i) => {
      const dd = addDays(mon, i);
      const kk = dateKey(dd);
      const lg = state.logs[kk];
      const did = lg && doneSets(lg) > 0;
      const j = did ? lg.session : sessionFor(p, dd);
      const m = j >= 0 ? p.menus[j] : null;
      const past = kk < k;
      const st = did ? 'done' : m ? (past ? 'missed' : 'planned') : 'rest';
      return `<li class="${m ? 'c-' + m.color : ''} st-${st} ${kk === k ? 'is-today' : ''}">
        <button data-act="openlog" data-k="${kk}" aria-label="${fmtDate(dd)} ${m ? esc(m.label) : '休み'}">
          <span class="w">${w}</span><span class="pip"></span><span class="l">${m ? esc(m.label) : '休'}</span>
        </button></li>`;
    }).join('');
    const planned = p.chosen.tpl.days;

    // 推移
    const series = liftSeries(liftTab);
    let trend = '<p class="muted small chartempty">この種目を2回以上記録すると、推定1RMの推移が出ます。</p>';
    if (series.length >= 2) {
      const first = series[0].v, last = series[series.length - 1].v;
      const diff = Math.round((last - first) * 10) / 10;
      trend = `<p class="trendhead"><span class="num big2">${last}</span><span class="muted small">kg</span><span class="delta num">${diff >= 0 ? '+' : ''}${diff}kg</span><span class="muted small">（${series.length}回の記録）</span></p>${trendChart(series)}`;
    }

    // 経過チェック
    const ck = checkinDue();

    return `
    <section class="dash">
      ${samplePill()}
      <header class="pagehead"><h1 class="title">ダッシュボード</h1><span class="planname">${esc(p.chosen.tpl.name)}</span></header>
      ${todayCard}
      <div class="card">
        <div class="cardhead"><p class="eyebrow">今週の予定</p><span class="muted small num">${wk.sessions} / ${planned} 回</span></div>
        <ol class="weekstrip">${strip}</ol>
      </div>
      <div class="card">
        <div class="cardhead"><p class="eyebrow">今週のボリューム</p><span class="muted small">完了 / 目標セット</span></div>
        <div class="volhead">
          <div class="ringwrap">${ring(dTotal, tTotal, 76, `今週${dTotal}/${tTotal}セット`)}<span class="ringnum small num">${tTotal ? Math.round((dTotal / tTotal) * 100) : 0}<small>%</small></span></div>
          <p><span class="num big2">${dTotal}</span><span class="muted"> / ${tTotal} セット</span><br><span class="muted small">月曜から集計しています</span></p>
        </div>
        <ul class="vol">${vol}</ul>
      </div>
      ${weightCard()}
      <div class="card">
        <div class="cardhead"><p class="eyebrow">推定1RMの推移</p></div>
        <div class="seg" role="tablist">${Object.keys(LIFT_NAMES).map((kk) => `<button role="tab" data-act="lifttab" data-k="${kk}" aria-selected="${liftTab === kk}">${LIFT_NAMES[kk]}</button>`).join('')}</div>
        ${trend}
      </div>
      <div class="card checkcard">
        <div class="cardhead"><p class="eyebrow">経過チェック</p><span class="muted small">${ck.last ? `前回 ${parseKey(ck.last).getMonth() + 1}/${parseKey(ck.last).getDate()}` : 'まだ実施していません'}</span></div>
        <p class="small">${ck.due ? '1週間分の記録がたまりました。先週の実績を見て、プログラムを見直します。' : `次の経過チェックは ${esc(ck.nextLabel)} です。`}</p>
        <button class="btn ${ck.due ? 'primary' : 'ghost'}" data-act="checkin">経過チェックを${ck.due ? 'はじめる' : '今すぐ行う'}</button>
      </div>
    </section>`;
  }

  // ---------- 記録（日付ごと） ----------
  let logDate = null;
  let rawOpen = false; // 「文字列でバックアップ」を開いているか
  const foldSet = new Map(); // 種目ごとの開閉（日付|番号 → たたむなら true）。なければ、全セット終わった種目だけたたむ
  // ---------- 今日のトレーニングを画像で共有 ----------
  // アプリ名と URL はここだけで持つ（名前が決まったら差し替える）
  const APP_NAME = '分割メーカー';
  const APP_URL = 'mikoto8917.github.io/bunkatsu-maker';

  // 完了したセットだけを「60kg × 10・10・9」の形にする。重量がセットごとに違えば「60×10・62.5×8」、重量なしは回数だけ
  function shareSetsText(sets) {
    const ws = sets.map((x) => (x.w === '' || x.w == null || +x.w === 0 ? '' : String(x.w)));
    const rs = sets.map((x) => (x.r === '' || x.r == null ? '-' : String(x.r)));
    if (ws.every((w) => w === '')) return `${rs.join('・')} 回`;
    if (ws.every((w) => w === ws[0])) return `${ws[0]}kg × ${rs.join('・')}`;
    return sets.map((x, i) => (ws[i] === '' ? rs[i] : `${ws[i]}×${rs[i]}`)).join('・');
  }
  function shareData(k) {
    const lg = state.logs[k];
    const items = lg.items.map((it) => ({ name: it.name, sets: it.sets.filter((x) => x.done) })).filter((it) => it.sets.length);
    const sets = items.reduce((a, it) => a + it.sets.length, 0);
    const volume = items.reduce((a, it) => a + it.sets.reduce((b, x) => b + (+x.w || 0) * (+x.r || 0), 0), 0);
    const d = parseKey(k);
    const p = currentPlan();
    const wk = weekDone(mondayOf(d));
    return { date: fmtDate(d), label: lg.label || (p.menus[lg.session] || {}).label || '', items, sets, volume: Math.round(volume * 10) / 10, week: wk.sessions, planned: p.chosen.tpl.days, thisDay: k === dateKey(today()) ? '今日' : 'この日', thisWeek: dateKey(mondayOf(d)) === dateKey(mondayOf(today())) };
  }
  // 1080×1350 の画像を canvas で描く（デザイン部 A案「大きな数字」）。背景はテーマ色のライト版から、それを黒に45%寄せた色への斜めグラデーション。文字は白
  function drawShareImage(data, iconImg) {
    const W = 1080, H = 1350, P = 72;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const T = window.BunkatsuTheme;
    const c = T ? (T.COLORS.find((x) => x.id === ((state.theme && state.theme.accent) || 'blue')) || T.COLORS[0]) : { id: 'blue', light: '#1f6feb' };
    const from = c.light;
    const n = parseInt(from.slice(1), 16);
    const to = '#' + [16, 8, 0].map((sh) => ('0' + Math.round(((n >> sh) & 255) * 0.55).toString(16)).slice(-2)).join('');
    // CSS の linear-gradient(160deg) と同じ向き・長さ
    const ang = 160 * Math.PI / 180, dx = Math.sin(ang), dy = -Math.cos(ang);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const bg = g.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
    bg.addColorStop(0, from); bg.addColorStop(1, to);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const font = getComputedStyle(document.body).fontFamily;
    const F = (size, w) => `${w || 400} ${size}px ${font}`;
    const fit = (text, max) => { if (g.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
    const round = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
    const WHITE = '#ffffff', SUB = 'rgba(255,255,255,.9)';
    // 字間をつめて書く（canvas の letterSpacing がない古い端末でも同じ見た目に）
    const spacedWidth = (t, sp) => [...t].reduce((a, ch) => a + g.measureText(ch).width + sp, 0) - sp;
    const drawSpaced = (t, x, y, sp) => { [...t].forEach((ch) => { g.fillText(ch, x, y); x += g.measureText(ch).width + sp; }); return x; };
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    // 1. 日付・メニュー名
    let y = P + 30;
    g.fillStyle = SUB; g.font = F(34, 700);
    g.fillText(fit(`${data.date}・${data.label}`, W - P * 2), P, y);
    // 2. 見出し
    const hasVol = data.volume > 0;
    y += 40 + 52;
    g.fillStyle = SUB; g.font = F(40, 700);
    g.fillText(hasVol ? `${data.thisDay}の総挙上量` : `${data.thisDay}のセット数`, P, y);
    // 3. 大きな数字（入らなければ縮める）
    const big = hasVol ? data.volume.toLocaleString('ja-JP') : String(data.sets);
    const unit = hasVol ? 'kg' : 'セット';
    let size = 200;
    const total = () => { g.font = F(size, 800); const bw = spacedWidth(big, -6 * size / 200); g.font = F(72 * size / 200, 700); return bw + 14 + g.measureText(unit).width; };
    while (total() > W - P * 2 && size > 80) size -= 4;
    y += 20 + Math.round(size * 0.86);
    g.fillStyle = WHITE; g.font = F(size, 800);
    const ex = drawSpaced(big, P - 4, y, -6 * size / 200);
    g.font = F(Math.round(72 * size / 200), 700); g.fillText(unit, ex + 14, y);
    // 4. 丸ラベル3つ
    y += 36 + 30;
    g.font = F(34, 700);
    let x = P;
    [hasVol ? `${data.sets} セット` : null, `${data.items.length} 種目`, `${data.thisWeek ? '今週' : 'この週'} ${data.week} / ${data.planned} 回`].filter(Boolean).forEach((t) => {
      const w = g.measureText(t).width + 60;
      g.fillStyle = 'rgba(255,255,255,.18)'; round(x, y, w, 76, 38); g.fill();
      g.fillStyle = WHITE; g.textBaseline = 'middle'; g.fillText(t, x + 30, y + 39); g.textBaseline = 'alphabetic';
      x += w + 16;
    });
    y += 76;
    // 6. いちばん下：アイコン・名前・URL（先に位置を決める）
    const is = 72, iy = H - P - is;
    // 5. 種目一覧のパネル（下の空きを埋める）
    const py = y + 56, ph = iy - 40 - py;
    g.fillStyle = 'rgba(0,0,0,.24)'; round(P, py, W - P * 2, ph, 36); g.fill();
    const inner = W - P * 2 - 80;
    const rows = data.items.slice(0, 8);
    const extra = data.items.length > 8 ? data.items.length - 8 : 0;
    const rowH = Math.min(63, (ph - 72) / (rows.length + (extra ? 1 : 0) || 1));
    let ry = py + 36 + 34;
    rows.forEach((it) => {
      g.font = F(32, 400); g.fillStyle = SUB;
      const st = shareSetsText(it.sets);
      const stt = fit(st, inner * 0.6);
      const stw = g.measureText(stt).width;
      g.textAlign = 'right'; g.fillText(stt, W - P - 40, ry); g.textAlign = 'left';
      g.font = F(32, 700); g.fillStyle = WHITE; g.fillText(fit(it.name, inner - stw - 24), P + 40, ry);
      ry += rowH;
    });
    if (extra) { g.font = F(32, 400); g.fillStyle = SUB; g.fillText(`ほか ${extra} 種目`, P + 40, ry); }
    // アイコン（テーマ色のもの。なければ簡単な形で描く）に白い縁取り
    g.save(); round(P, iy, is, is, 16); g.clip();
    if (iconImg) g.drawImage(iconImg, P, iy, is, is);
    else {
      g.fillStyle = from; g.fillRect(P, iy, is, is);
      g.strokeStyle = WHITE; g.lineWidth = 6; g.lineCap = 'round';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(P + is / 2, iy + is / 2, 23, i * Math.PI / 2 + 0.25, (i + 1) * Math.PI / 2 - 0.25); g.stroke(); }
      g.beginPath(); g.moveTo(P + 25, iy + 36); g.lineTo(P + 47, iy + 36); g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; round(P + 1, iy + 1, is - 2, is - 2, 15); g.stroke();
    g.fillStyle = WHITE; g.font = F(34, 700); g.fillText(APP_NAME, P + is + 22, iy + 32);
    g.fillStyle = 'rgba(255,255,255,.8)'; g.font = F(26, 400); g.fillText(APP_URL, P + is + 22, iy + 66);
    return cv;
  }
  async function shareToday() {
    const k = logKey();
    const data = shareData(k);
    // ホーム画面用のアイコン（スマホ版にだけある）を使う。読めなければ簡単な形で描く
    const iconImg = await new Promise((res) => {
      if (!document.querySelector('link[rel="apple-touch-icon"]')) { res(null); return; }
      const id = (state.theme && state.theme.accent) || 'blue';
      const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null);
      im.src = id === 'blue' ? 'icon-192.png' : `icons/icon-${id}-192.png`;
    });
    const cv = drawShareImage(data, iconImg);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return;
    const file = new File([blob], `training-${k}.png`, { type: 'image/png' });
    const text = `${APP_NAME}で記録しました #筋トレ\nhttps://${APP_URL}/`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    // 共有シートが使えない端末（主にPC）はダウンロード
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // 記録画面の「＋ 種目を追加」。その日の記録だけに足す（プログラムは変えない）
  let logAdd = null; // 開いているときは { muscle, msg }
  function logAddView(lg, menu) {
    if (!logAdd) return `<div class="logadd"><button class="btn ghost small" data-act="logaddopen">＋ 種目を追加</button></div>`;
    const m = logAdd.muscle;
    const names = L.exerciseOptions(m).map((o) => o.name).filter((nm) => !lg.items.some((x) => x.name === nm));
    return `
      <div class="card logadd is-open">
        <p class="eyebrow">この日に種目を追加</p>
        <div class="cadd">
          <label class="sr" for="la-m">部位</label>
          <select id="la-m">${L.PICK_ORDER.map((mm) => `<option value="${mm}" ${mm === m ? 'selected' : ''}>${L.MUSCLES[mm].name}</option>`).join('')}</select>
          <label class="sr" for="la-x">種目</label>
          <select id="la-x">${names.map((nm) => `<option>${esc(nm)}</option>`).join('')}<option value="">リストにない種目…</option></select>
        </div>
        <div class="cadd"><label class="sr" for="la-name">リストにない種目の名前</label><input id="la-name" type="text" maxlength="30" placeholder="リストにない種目はここに入力" autocomplete="off"></div>
        ${logAdd.msg ? `<p class="warn small">${esc(logAdd.msg)}</p>` : ''}
        <div class="cadd"><button class="btn tiny primary" data-act="logadd">追加する</button><button class="btn tiny ghost" data-act="logaddclose">やめる</button></div>
        <p class="muted small">この日の記録だけに追加されます。プログラムは変わりません。</p>
      </div>`;
  }

  // 記録の種目を長押ししたときのメニュー（削除）
  let exMenu = null;
  function exMenuView(li) {
    const n = li.sets.filter((x) => x.done || x.w !== '' || x.r !== '').length;
    return `
      <div class="exmenu" data-act="exmenuclose">
        <div class="sheet" role="dialog" aria-label="${esc(li.name)}のメニュー">
          <p class="exmenu-title">${esc(li.name)}</p>
          ${n ? `<p class="muted small">入力した${n}セット分の記録も消えます。</p>` : ''}
          <button class="btn danger" data-act="exdel">この種目を削除</button>
          <button class="btn ghost" data-act="exmenuclose">やめる</button>
        </div>
      </div>`;
  }

  function vLog() {
    const p = currentPlan();
    const d = logDate ? parseKey(logDate) : today();
    const k = dateKey(d);
    const isToday = k === dateKey(today());
    const idx = sessionFor(p, d);
    const nav = `
      <nav class="datenav" aria-label="日付">
        <button class="navbtn" data-act="logday" data-k="${dateKey(addDays(d, -1))}" aria-label="前の日">‹</button>
        <div class="datelabel"><b>${isToday ? '今日' : fmtDate(d)}</b>${isToday ? `<span class="muted small">${fmtDate(d)}</span>` : (`<button class="linkbtn small" data-act="logday" data-k="${dateKey(today())}">今日に戻る</button>`)}</div>
        <button class="navbtn" data-act="logday" data-k="${dateKey(addDays(d, 1))}" aria-label="次の日">›</button>
      </nav>`;
    const picker = `
      <div class="picker" ${pickOpen ? '' : 'hidden'}>
        <p class="eyebrow">この日のメニューを変更</p>
        ${state.logs[k] && doneSets(state.logs[k]) > 0 ? '<p class="muted small">この日はすでに記録があるので、変更できません。</p>' : ''}
        <div class="chips">
          ${p.menus.map((m, i) => `<button class="chip c-${m.color}" data-act="swap" data-i="${i}" aria-pressed="${i === idx}">${esc(m.label)}</button>`).join('')}
          <button class="chip" data-act="swap" data-i="-1" aria-pressed="${idx === -1}">休み</button>
          ${state.swap[k] !== undefined ? '<button class="chip" data-act="unswap">予定どおりに戻す</button>' : ''}
        </div>
      </div>`;
    const changeBtn = `<button class="btn tiny ghost" data-act="pickopen" aria-expanded="${pickOpen}">変更</button>`;

    if (idx === -1) {
      const nx = nextTraining(p, d);
      return `
      <section class="today rest">
        ${samplePill()}
        ${nav}
        <div class="titlerow"><h1 class="display">休養日</h1>${changeBtn}</div>
        ${picker}
        ${nx ? `<p class="next">次は <b>${nx.when ? `${esc(nx.when)}：` : ''}${esc(nx.label)}</b></p>` : ''}
        <ul class="tips">${REST_TIPS.map((t) => `<li>${t}</li>`).join('')}</ul>
      </section>`;
    }

    const menu = p.menus[idx];
    const lg = ensureLog(k, idx, menu);
    const total = lg.items.reduce((a, b) => a + b.sets.length, 0);
    const done = doneSets(lg);
    const items = lg.items.map((li, n) => {
      const it = menu.items.find((x) => x.name === li.name) || { name: li.name, muscle: li.muscle, sets: li.sets.length, reps: '' };
      const prev = previous(it.name, k);
      const prevTxt = prev ? `前回 ${prev.sets.map((s) => `${s.w}×${s.r}`).join('・')}` : '前回の記録なし';
      const allDone = li.sets.every((s) => s.done);
      // 全セット終わった種目は1行にたたむ（タップで開ける）。今やる種目に集中できるように
      // 種目名の行を押すと開閉する
      const fkey = `${k}|${n}`;
      const folded = foldSet.has(fkey) ? foldSet.get(fkey) : allDone;
      const nDone = li.sets.filter((s) => s.done).length;
      const head = (open) => `
        <div class="exhead" data-grip data-act="exfold" data-k="${esc(fkey)}" data-fold="${open}">
          <h3>${esc(it.name)}</h3>
          <button class="foldbtn num" data-act="exfold" data-k="${esc(fkey)}" data-fold="${open}" aria-expanded="${!open}" aria-label="${esc(it.name)}のセットを${open ? 'たたむ' : '表示'}">${open
            ? (allDone ? 'たたむ' : `${li.sets.length}${it.reps ? `×${esc(it.reps)}` : 'セット'}`)
            : (allDone ? `✓ ${li.sets.length}セット完了` : `${nDone}/${li.sets.length}セット`)}<span class="foldarr" aria-hidden="true">${open ? '▴' : '▾'}</span></button>
        </div>`;
      if (folded) {
        return `
      <li class="ex ${allDone ? 'is-done' : ''} is-folded" data-sort-i="${n}">${head(false)}
      </li>`;
      }
      return `
      <li class="ex ${allDone ? 'is-done' : ''}" data-sort-i="${n}">${head(true)}
        <p class="exmeta"><span class="mtag">${L.MUSCLES[it.muscle].name}</span><span class="prev num">${esc(prevTxt)}</span>
          ${prev && !allDone ? (() => { const g = progressTarget(prev.sets, it.reps, it.muscle, it.kind); return `<button class="copyprev" data-act="copyprev" data-ex="${n}" aria-label="${esc(it.name)}の前回の値から目標を入れる">目標をコピー ${g.up ? `↑${g.inc}kg` : '＋1回'}</button>`; })() : ''}
          ${state.restOn === false ? '' : `<button class="restchip num" data-act="restpick" data-name="${esc(it.name)}" data-kind="${it.kind || 'compound'}" aria-label="${esc(it.name)}の休憩時間を変更">休憩 ${fmtSec(restFor(it.name, it.kind))}</button>`}</p>
        <ol class="sets">
          ${li.sets.map((s, si) => {
            const ph = prev && prev.sets[si] ? prev.sets[si] : (prev ? prev.sets[prev.sets.length - 1] : (si > 0 && li.sets[si - 1].w !== '' ? li.sets[si - 1] : null));
            return `<li class="${s.done ? 'is-done' : ''}">
              <span class="setno num">${si + 1}</span>
              <label><input id="s-${n}-${si}-w" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(s.w)}" placeholder="${ph ? esc(ph.w) : ''}" data-ex="${n}" data-set="${si}" data-f="w" aria-label="${esc(it.name)} ${si + 1}セット目の重量"><span>kg</span></label>
              <label><input id="s-${n}-${si}-r" type="number" inputmode="numeric" step="1" min="0" value="${esc(s.r)}" placeholder="${ph ? esc(ph.r) : ''}" data-ex="${n}" data-set="${si}" data-f="r" aria-label="${esc(it.name)} ${si + 1}セット目の回数"><span>回</span></label>
              <button class="check" data-act="done" data-ex="${n}" data-set="${si}" aria-pressed="${s.done}" aria-label="${si + 1}セット目を完了"></button>
            </li>`;
          }).join('')}
        </ol>
        <div class="setbtns"><button class="linkbtn small" data-act="addset" data-ex="${n}">＋ セットを追加</button>${li.sets.length > 1 && !li.sets[li.sets.length - 1].done ? `<button class="delset" data-act="delset" data-ex="${n}">最後のセットを削除</button>` : ''}</div>
      </li>`;
    }).join('');
    return `
    <section class="today c-${menu.color}">
      ${samplePill()}
      ${nav}
      <div class="card loghead">
        <div class="todayrow">
          <div class="ringwrap">${ring(done, total, 72, `${done}/${total}セット`)}<span class="ringnum small num">${done}<small>/${total}</small></span></div>
          <div class="todaytxt"><h1 class="big cc">${esc(menu.label)}</h1><p class="muted small">目安 ${menu.minutes}分</p></div>
          ${changeBtn}
        </div>
        ${picker}
      </div>
      <ol class="exlist" data-sort="log">${items}</ol>
      ${lg.items.length ? `<p class="muted small sorthint">種目名を押すと開閉、${lg.items.length > 1 ? '長押ししたまま動かすと並び替え、' : ''}長押しして離すと削除できます。</p>` : ''}
      ${done > 0 && !state.sample ? `<button class="btn ${done === total ? 'primary' : 'outline'} sharebtn" data-act="share">${isToday ? '今日' : 'この日'}のトレーニングを共有</button>` : ''}
      ${logAddView(lg, menu)}
      ${exMenu !== null && lg.items[exMenu] ? exMenuView(lg.items[exMenu]) : ''}
      <label class="notefield"><span class="eyebrow">この日のメモ</span>
        <textarea id="day-note" rows="2" placeholder="腰の調子、眠気など">${esc(lg.note || '')}</textarea>
      </label>
    </section>`;
  }

  // ---------- プログラム ----------
  function bestFromLogs() {
    const best = {};
    for (const k of Object.keys(state.logs)) {
      (state.logs[k].items || []).forEach((it) => {
        const key = Object.keys(LIFT_NAMES).find((x) => LIFT_NAMES[x] === it.name);
        if (!key) return;
        it.sets.forEach((s) => {
          if (!s.done || !(+s.w > 0) || !(+s.r > 0)) return;
          const e = L.epley1RM(+s.w, +s.r);
          if (!best[key] || e > best[key].e) best[key] = { e, w: +s.w, r: +s.r, date: k };
        });
      });
    }
    return best;
  }

  const openMenus = new Set();
  let customOpen = null;
  // 部位ごとに選べる種目名（標準・差し替え候補・自分で入力した種目）
  function exerciseNames(muscle) {
    const names = L.exerciseOptions(muscle).map((o) => o.name);
    ((state.customEx || {})[muscle] || []).forEach((nm) => { if (!names.includes(nm)) names.push(nm); });
    return names;
  }
  function vProgram() {
    const p = currentPlan();
    const { rec, chosen } = p;
    const targets = planMuscles(p).map((m) => `<li><span>${L.MUSCLES[m].name}</span><b class="num">${rec.targets[m]}</b></li>`).join('');
    const menus = p.menus.map((m, i) => `
      <details class="menu c-${m.color}" data-menu="${i}" data-sort-i="${i}" ${openMenus.has(i) ? 'open' : ''}>
        <summary data-grip><span class="pip"></span><b>${esc(m.label)}</b><span class="muted small">${chosen.weekdays[i] !== undefined ? L.WEEKDAYS[chosen.weekdays[i]] + '曜' : ''}・${m.minutes}分</span></summary>
        <ul class="daymenu swaplist" data-sort="items:${i}">${m.items.map((it, n) => {
          const orig = it.original || it.name;
          const names = exerciseNames(it.muscle);
          if (!names.includes(it.name)) names.push(it.name);
          const editing = customOpen === `${i}-${n}`;
          return `<li data-sort-i="${n}"><span class="grip" data-grip aria-hidden="true"></span>
          ${editing ? `<form class="customex" data-custom-sess="${m.src}" data-custom-orig="${esc(orig)}" data-custom-muscle="${it.muscle}">
              <label class="sr" for="cx-${i}-${n}">${esc(L.MUSCLES[it.muscle].name)}の種目名</label>
              <input id="cx-${i}-${n}" type="text" maxlength="30" placeholder="例：${esc(L.MUSCLES[it.muscle].name)}のマシン" autocomplete="off">
              <button class="btn tiny primary" type="submit">決定</button>
              <button class="btn tiny ghost" type="button" data-act="customcancel">やめる</button>
            </form>`
          : `<label class="exsel"><span class="sr">${esc(it.name)}を差し替える</span>
            <select id="sw-${i}-${n}" data-swap-sess="${m.src}" data-swap-orig="${esc(orig)}" data-swap-n="${n}" data-pos="${i}">
              ${names.map((nm) => `<option value="${esc(nm)}" ${nm === it.name ? 'selected' : ''}>${esc(nm)}${nm === orig && it.original ? '（元の種目）' : ''}</option>`).join('')}
              <option value="__custom__">＋ 候補にない種目を入力…</option>
            </select></label>`}
          </li>`;
        }).join('')}</ul>
      </details>`).join('');

    const best = bestFromLogs();
    const a = state.answers;
    let rejudge = '<p class="muted small">ベンチプレス・スクワット・デッドリフトを記録すると、記録から経験レベルを判定し直します。</p>';
    const lifts = {};
    Object.keys(best).forEach((k) => { lifts[k] = { w: best[k].w, r: best[k].r }; });
    if (Object.keys(lifts).length && latestWeight()) {
      const j = L.judgeExperience({ bodyweight: latestWeight(), sex: a.sex, lifts });
      rejudge = `
        <p class="small">記録からの判定：<b>${L.LEVEL_NAME[j.level]}</b>${j.level !== rec.level ? `（今のプランは${L.LEVEL_NAME[rec.level]}）` : '（今のプランと同じ）'}</p>
        <p class="muted small">${j.per.map((x) => `${x.name} 推定1RM ${Math.round(x.oneRM)}kg → ${L.LEVEL_NAME[x.level]}`).join('<br>')}</p>
        ${j.level !== rec.level && !p.custom ? `<button class="btn ghost" data-act="applylevel" data-level="${j.level}">${L.LEVEL_NAME[j.level]}でプランを作り直す</button>` : ''}`;
    }
    const hist = (state.checkins || []).slice().reverse().slice(0, 6).map((c) => `<li><span class="num">${parseKey(c.date).getMonth() + 1}/${parseKey(c.date).getDate()}</span><span>消化 ${c.rate}%</span><span class="muted">${esc(c.summary)}</span></li>`).join('');

    return `
    <section class="program">
      ${samplePill()}
      <header class="pagehead"><h1 class="title">プログラム</h1></header>
      <div class="card">
        <p class="eyebrow">いまの分割</p>
        <h2 class="big">${esc(chosen.tpl.name)}</h2>
        <p class="muted small">${p.custom ? 'オリジナルプラン' : L.LEVEL_NAME[rec.level]}・${esc(L.GOAL_NAME[a.goal])}・週${chosen.tpl.days}日</p>
        ${weekStrip(chosen)}
        ${p.custom ? `<div class="stack">
          <button class="btn ghost" data-act="custom-edit">曜日と部位を編集</button>
          <button class="linkbtn small" data-act="start">質問に答えて提案を受ける</button>
        </div>` : `<div class="stack">
          <button class="btn ghost" data-act="showresult">提案の理由と別案を見る</button>
          <button class="btn ghost" data-act="custom-from">自分用に編集する</button>
        </div>`}
      </div>
      <div class="card">
        <p class="eyebrow">メニュー</p>
        <p class="hint"><small>タップで種目を変更・長押しで並び替え</small></p>
        <div class="menus" data-sort="menus">${p.custom ? customMenusHtml(p) : menus}</div>
      </div>
      <div class="card">
        <p class="eyebrow">部位ごとの週セット${p.custom ? '（プランの合計）' : '目標'}</p>
        <ul class="targets">${targets}</ul>
      </div>
      <div class="card">
        <p class="eyebrow">経験レベル</p>
        ${rejudge}
      </div>
      <div class="card">
        <div class="cardhead"><p class="eyebrow">経過チェックの履歴</p></div>
        ${hist ? `<ul class="ckhist">${hist}</ul>` : '<p class="muted small">まだありません。ダッシュボードから経過チェックを行うと、ここに残ります。</p>'}
        <button class="btn ghost" data-act="checkin">経過チェックを行う</button>
      </div>
    </section>`;
  }

  // ---------- 経過チェック ----------
  function checkinDue() {
    const list = state.checkins || [];
    const last = list.length ? list[list.length - 1].date : null;
    const keys = Object.keys(state.logs).filter((k) => doneSets(state.logs[k]) > 0).sort();
    const tk = dateKey(today());
    const ref = last || keys[0];
    let due = false, nextLabel = '1週間分の記録がたまったあと';
    if (ref) {
      const nd = addDays(parseKey(ref), 7);
      due = dateKey(nd) <= tk;
      nextLabel = fmtDate(nd);
    }
    return { due, last, nextLabel };
  }

  // 直近の1週間（昨日まで7日間）を振り返る
  function checkinData() {
    const p = currentPlan();
    const end = addDays(today(), -1);
    const start = addDays(end, -6);
    let plannedN = 0, doneN = 0;
    const done = {};
    Object.keys(L.MUSCLES).forEach((m) => { done[m] = 0; });
    const missedDays = [];
    for (let i = 0; i < 7; i++) {
      const dd = addDays(start, i);
      const k = dateKey(dd);
      const lg = state.logs[k];
      const did = lg && doneSets(lg) > 0;
      const planned = state.answers.schedule === 'irregular' ? false : p.byWeekday[wdIndex(dd)] !== undefined;
      if (planned) plannedN++;
      if (did) { doneN++; lg.items.forEach((it) => { done[it.muscle] += it.sets.filter((s) => s.done).length; }); }
      else if (planned) missedDays.push(wdIndex(dd));
    }
    if (state.answers.schedule === 'irregular') plannedN = p.chosen.tpl.days;
    const rate = plannedN ? Math.round(Math.min(1, doneN / plannedN) * 100) : 0;
    const short = planMuscles(p).filter((m) => done[m] < p.rec.targets[m] * 0.7);
    const lifts = Object.keys(LIFT_NAMES).map((k) => {
      const s = liftSeries(k);
      if (s.length < 2) return null;
      return { name: LIFT_NAMES[k], first: s[0].v, last: s[s.length - 1].v };
    }).filter(Boolean);
    // 見直しの提案（split-logic.md 7章のうち、1週間で判断できるもの）
    const advice = [];
    if (rate < 70) advice.push(state.answers.days > 2 ? `予定の消化率が7割未満です。週${state.answers.days - 1}日に減らすか、1日抜けても困らない全身法寄りの分割にすると続けやすくなります。` : '予定の消化率が7割未満です。予定を組みやすい曜日に変えてみてください。');
    if (rate >= 70 && short.length) advice.push(`${short.map((m) => L.MUSCLES[m].name).join('・')}が目標の7割に届いていません。時間が足りないなら、この部位を各日の最初に回してください。`);
    if (!advice.length) advice.push('予定どおりこなせています。このままのプログラムで続けましょう。');
    advice.push('重量の停滞や疲労にもとづく見直し（ボリューム増減・デロード）は、3〜6週間の記録がたまってから判断します。');
    return { start, end, plannedN, doneN, rate, done, short, lifts, advice, missedDays, p };
  }

  function vCheckin() {
    const c = checkinData();
    const p = c.p;
    const vol = planMuscles(p).map((m) => {
      const r = Math.min(1, c.done[m] / p.rec.targets[m]);
      return `<li class="${c.done[m] >= p.rec.targets[m] ? 'is-met' : ''}"><span class="vm">${L.MUSCLES[m].name}</span><span class="vbar"><span style="width:${r * 100}%"></span></span><span class="vn num">${c.done[m]}<small> / ${p.rec.targets[m]}</small></span></li>`;
    }).join('');
    return `
    <section class="checkin">
      <header class="pagehead"><button class="linkbtn" data-act="back-dash">‹ 戻る</button></header>
      <p class="eyebrow">経過チェック</p>
      <h1 class="title">${c.start.getMonth() + 1}/${c.start.getDate()}〜${c.end.getMonth() + 1}/${c.end.getDate()} の振り返り</h1>
      <ol class="steps">
        <li class="card">
          <p class="eyebrow">1. 予定の消化率</p>
          <div class="volhead">
            <div class="ringwrap">${ring(c.doneN, c.plannedN, 76, `消化率${c.rate}%`)}<span class="ringnum small num">${c.rate}<small>%</small></span></div>
            <p><span class="num big2">${c.doneN}</span><span class="muted"> / ${c.plannedN} 回</span>${c.missedDays.length ? `<br><span class="muted small">できなかった曜日：${c.missedDays.map((i) => L.WEEKDAYS[i]).join('・')}</span>` : ''}</p>
          </div>
        </li>
        <li class="card">
          <p class="eyebrow">2. 部位ごとのボリューム</p>
          <ul class="vol">${vol}</ul>
        </li>
        <li class="card">
          <p class="eyebrow">3. 主要リフト（推定1RM）</p>
          ${c.lifts.length ? `<ul class="kv">${c.lifts.map((l) => `<li><span>${l.name}</span><b class="num">${l.first} → ${l.last}kg</b></li>`).join('')}</ul>` : '<p class="muted small">BIG3の記録が2回以上たまると表示されます。</p>'}
        </li>
        <li class="card">
          <p class="eyebrow">4. 見直しの提案</p>
          <ul class="advice">${c.advice.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </li>
      </ol>
      <button class="btn primary" data-act="checkin-done">チェックを完了する</button>
      ${c.rate < 70 && state.answers.days > 2 ? (p.custom ? '<button class="btn ghost" data-act="custom-edit">曜日と部位を編集する</button>' : '<button class="btn ghost" data-act="redo">日数を変えて答え直す</button>') : ''}
    </section>`;
  }

  // ---------- その他 ----------
  function historyList() {
    const keys = Object.keys(state.logs).filter((k) => doneSets(state.logs[k]) > 0).sort().reverse();
    if (!keys.length) return '<p class="muted small">まだ記録がありません。</p>';
    return `<ol class="histlist">${keys.slice(0, 30).map((k) => {
      const lg = state.logs[k];
      const dt = parseKey(k);
      return `<li><button class="histrow" data-act="openlog" data-k="${k}"><span class="num">${dt.getMonth() + 1}/${dt.getDate()}（${L.WEEKDAYS[wdIndex(dt)]}）</span><b>${esc(lg.label || '')}</b><span class="num muted">${doneSets(lg)}セット ›</span></button></li>`;
    }).join('')}</ol>`;
  }

  let confirmReset = false;
  let exportOpen = false;
  let importMsg = '';
  // テーマ：アクセント色10色と、外観（自動・ライト・ダーク）
  function themeCard() {
    const T = window.BunkatsuTheme;
    if (!T) return '';
    const t = { accent: 'blue', mode: 'auto', ...(state.theme || {}) };
    const dark = T.isDark();
    return `
      <div class="card themecard">
        <p class="eyebrow">テーマ</p>
        <ul class="swatches">${T.COLORS.map((c) => `<li><button class="swatch" style="--sw:${dark ? c.dark : c.light}" data-act="theme" data-accent="${c.id}" aria-pressed="${t.accent === c.id}" aria-label="${c.name}" title="${c.name}"></button></li>`).join('')}</ul>
        <p class="eyebrow">外観</p>
        <div class="seg" role="radiogroup" aria-label="外観">${[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([k, nm]) => `<button role="radio" data-act="theme" data-mode="${k}" aria-checked="${t.mode === k}" aria-selected="${t.mode === k}">${nm}</button>`).join('')}</div>
        <p class="muted small">ホーム画面のアイコンは、追加したときの色になります。</p>
      </div>`;
  }

  function vMore() {
    const a = state.answers;
    const pc = state.custom ? currentPlan() : null;
    const sum = (pc ? [
      ['プラン', pc.chosen.tpl.name],
      ['週の日数', `${a.days}日（${a.weekdays.map((i) => L.WEEKDAYS[i]).join('・')}）`],
      ['目的', L.GOAL_NAME[a.goal]],
      ['体重', a.bodyweight ? `${a.bodyweight}kg` : '未入力'],
    ] : [
      ['週の日数', `${a.days}日（${a.weekdays.map((i) => L.WEEKDAYS[i]).join('・')}）`],
      ['1回の時間', { le45: '45分以下', m60: '60分', m75: '75分', ge90: '90分以上' }[a.sessionMin]],
      ['体重', a.bodyweight ? `${a.bodyweight}kg` : '未入力'],
      ['目的', L.GOAL_NAME[a.goal]],
      ['回復', { good: '良い', normal: '普通', poor: '悪い' }[a.recovery]],
      ['予定', { fixed: '固定できる', sometimes: 'ときどきずれる', irregular: '毎週バラバラ' }[a.schedule]],
    ]).map(([k, v]) => `<li><span>${k}</span><b>${esc(v)}</b></li>`).join('');
    return `
    <section class="settings">
      <header class="pagehead"><h1 class="title">その他</h1></header>
      <div class="card">
        <p class="eyebrow">${pc ? 'オリジナルプラン' : '回答'}</p>
        <ul class="kv">${sum}</ul>
        ${pc ? `<div class="stack">
          <button class="btn primary" data-act="custom-edit">プランを編集する</button>
          <button class="btn ghost" data-act="start">質問に答えて提案を受ける</button>
        </div>
        <p class="muted small">提案に切り替えても、これまでの記録は残ります。</p>` : `<div class="stack">
          <button class="btn primary" data-act="showresult">提案の内容を見る</button>
          <button class="btn ghost" data-act="redo">質問に答え直す</button>
          <button class="btn ghost" data-act="custom-from">自分のオリジナルプランにする</button>
        </div>
        <p class="muted small">答え直しても、これまでの記録は残ります。</p>`}
      </div>
      ${themeCard()}
      <div class="card">
        <p class="eyebrow">休憩タイマー</p>
        <p class="muted small">セットに完了の印をつけると、休憩時間を数えます。種目ごとの時間は、記録画面の「休憩」をタップして変えられます。</p>
        <ul class="kv">
          <li><span>初期値</span><b>${state.restDefault ? fmtSec(state.restDefault) : '自動（目的と種目で決める）'}</b></li>
          <li><span>種目ごとの設定</span><b>${Object.keys(state.restByEx || {}).length}種目</b></li>
        </ul>
        <div class="stack">
          <button class="btn ghost" data-act="restdefault">初期値の休憩時間を設定</button>
          ${Object.keys(state.restByEx || {}).length ? '<button class="linkbtn small" data-act="restclear">種目ごとの設定をすべて消す</button>' : ''}
          <button class="btn ghost" data-act="resttoggle">${state.restOn === false ? '休憩タイマーをオンにする' : '休憩タイマーをオフにする'}</button>
        </div>
      </div>
      <div class="card">
        <p class="eyebrow">これまでの記録</p>
        ${historyList()}
      </div>
      <div class="card">
        <p class="eyebrow">バックアップ</p>
        <p class="muted small">記録はこの端末のブラウザにだけ保存されています。ブラウザのデータを消すと記録も消えるので、ときどきファイルに保存してください。</p>
        ${backupNag() ? `<p class="small warn">${esc(backupNag())}</p>` : (state.lastBackup ? `<p class="muted small">最後のバックアップ：${esc(fmtDate(parseKey(state.lastBackup)))}</p>` : '')}
        <div class="stack">
          <button class="btn primary" data-act="savefile">ファイルに保存</button>
          <button class="btn ghost" data-act="loadfile">ファイルから復元</button>
          <input id="import-file" type="file" accept=".json,application/json,text/plain" hidden>
        </div>
        <details class="rawbackup" ${exportOpen || rawOpen ? 'open' : ''}>
          <summary class="small">文字列でバックアップ・復元する</summary>
          <div class="stack">
            <button class="btn ghost" data-act="export">${exportOpen ? 'バックアップを閉じる' : 'バックアップを表示'}</button>
            ${exportOpen ? `<textarea id="export-box" rows="5" readonly>${esc(serialize())}</textarea>
              <button class="btn tiny" data-act="copy">コピー</button>` : ''}
            <label class="notefield"><span class="eyebrow">復元</span>
              <textarea id="import-box" rows="3" placeholder="保存しておいた文字列を貼り付け"></textarea>
            </label>
            <button class="btn tiny" data-act="import">この内容で復元する</button>
          </div>
        </details>
        ${importMsg ? `<p class="small ${importMsg.ok ? 'ok' : 'warn'}">${esc(importMsg.text)}</p>` : ''}
      </div>
      <div class="card danger">
        <p class="eyebrow">すべて削除</p>
        ${confirmReset ? `<p class="small warn">回答と記録がすべて消えます。元に戻せません。</p>
          <div class="stack row"><button class="btn danger" data-act="reset-yes">削除する</button><button class="btn ghost" data-act="reset-no">やめる</button></div>`
        : '<button class="btn ghost" data-act="reset">回答と記録を削除…</button>'}
      </div>
    </section>`;
  }

  // ---------- 操作 ----------
  const logKey = () => logDate || dateKey(today());

  // サンプル：回答と、過去3週間ぶんの記録（少しずつ重量が伸びる）
  const BASE_W = { 'ベンチプレス': 60, 'スクワット': 80, 'デッドリフト': 100, 'オーバーヘッドプレス': 37.5, 'ベントオーバーロウ': 55, 'ラットプルダウン': 50, 'シーテッドケーブルロウ': 50, 'レッグプレス': 120, 'ルーマニアンデッドリフト': 70, 'ヒップスラスト': 80, 'インクラインダンベルプレス': 22, 'スタンディングカーフレイズ': 60 };
  function loadSample() {
    state = { ...blank(), theme: state.theme };
    state.answers = JSON.parse(JSON.stringify(SAMPLE));
    state.sample = true;
    const p = currentPlan();
    state.choice = p.chosen.tpl.id;
    const start = addDays(mondayOf(today()), -21);
    const tk = dateKey(today());
    for (let i = 0; i < 28; i++) {
      const d = addDays(start, i);
      const k = dateKey(d);
      if (k >= tk) break;
      const idx = p.byWeekday[wdIndex(d)];
      if (idx === undefined || i === 10) continue; // 1日だけ休んだ想定
      const wk = Math.floor(i / 7);
      const menu = p.menus[idx];
      state.logs[k] = { session: idx, label: menu.label, note: '', items: menu.items.map((it) => {
        const base = BASE_W[it.name] || (it.kind === 'iso' ? 12 : 40);
        const w = base + wk * (base >= 30 ? 2.5 : 1);
        return { name: it.name, muscle: it.muscle, sets: Array.from({ length: it.sets }, (_, si) => ({ w, r: Math.max(5, 9 - si), done: true })) };
      }) };
    }
    state.checkins = [{ date: dateKey(addDays(start, 7)), rate: 100, summary: '予定どおりこなせています。' }];
    // 体重：少しずつ増えつつ、日々 ±0.6kg ほど上下する
    const noise = [0.3, -0.4, 0.5, -0.1, 0.6, -0.5, 0.2, -0.3, 0.4, 0, -0.6, 0.3, 0.5, -0.2, 0.1, -0.4, 0.6, -0.1, 0.2, -0.5, 0.4];
    for (let i = 0; i < 21; i++) state.weights[dateKey(addDays(start, i))] = Math.round((70 + i * 0.04 + noise[i]) * 10) / 10;
    save();
  }
  const SAMPLE = { days: 4, weekdays: [0, 1, 3, 4], sessionMin: 'm60', bodyweight: 70, sex: 'male', lifts: { bench: { w: 70, r: 8 }, squat: { w: 80, r: 5 }, deadlift: null }, goal: 'hypertrophy', recovery: 'good', schedule: 'fixed', priority: [] };

  $app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'TEXTAREA') return;
    const act = b.dataset.act;
    const p = () => currentPlan();
    switch (act) {
      case 'start': if (state.sample) { state = { ...blank(), theme: state.theme }; save(); }
        draft = state.answers ? JSON.parse(JSON.stringify(state.answers)) : newDraft(); normalizeDraft(); quizStep = 0; go('quiz'); break;
      case 'sample': loadSample(); go('dash'); break;
      case 'pick': {
        const s = activeSteps()[quizStep];
        const raw = b.dataset.val;
        draft[s.key] = s.key === 'days' ? +raw : raw;
        if (s.key === 'days' && draft.weekdays.length !== draft.days) draft.weekdays = L.DEFAULT_WEEKDAYS[draft.days].slice();
        render();
        break;
      }
      case 'toggle': {
        const v = b.dataset.val; const arr = draft.priority;
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else if (arr.length < 2) arr.push(v);
        render(); break;
      }
      case 'wd': {
        const v = +b.dataset.val; const arr = draft.weekdays;
        const i = arr.indexOf(v);
        // 選んだ順番を覚えておく（最初から選ばれていた曜日は古い扱い）
        wdOrder = arr.filter((x) => !wdOrder.includes(x)).concat(wdOrder.filter((x) => arr.includes(x)));
        if (i >= 0) { arr.splice(i, 1); wdOrder = wdOrder.filter((x) => x !== v); }
        else {
          // もう日数分選んでいるときは、いちばん前に選んだ曜日と入れ替える
          if (arr.length >= draft.days) { const old = wdOrder.shift(); arr.splice(arr.indexOf(old), 1); }
          arr.push(v); wdOrder.push(v);
        }
        arr.sort((x, y) => x - y);
        render(); break;
      }
      case 'next': {
        const steps = activeSteps();
        if (!stepValid(steps[quizStep])) return;
        if (quizStep >= steps.length - 1) finishQuiz();
        else { quizStep++; render(); }
        break;
      }
      case 'back':
        if (quizStep === 0) go(state.answers ? 'settings' : 'welcome');
        else { quizStep--; render(); }
        break;
      case 'choose': state.choice = b.dataset.id; save(); render(); break;
      case 'begin': state.choice = p().chosen.tpl.id; save(); go('dash'); break;
      case 'bwsave': {
        const v = +document.getElementById('bw-today').value;
        if (v >= 30 && v <= 250) { state.weights = state.weights || {}; state.weights[dateKey(today())] = Math.round(v * 10) / 10; save(); render(); }
        break;
      }
      case 'addset': {
        const lg = state.logs[logKey()];
        const it = lg.items[+b.dataset.ex];
        const last = it.sets[it.sets.length - 1] || {};
        it.sets.push({ w: '', r: '', done: false, _ph: last.w });
        lg.touched = true; save(); render(); break;
      }
      case 'logaddopen': {
        const p0 = currentPlan(); const menu = p0.menus[sessionFor(p0, parseKey(logKey()))];
        logAdd = { muscle: (menu && menu.muscles && menu.muscles[0]) || 'chest', msg: '' }; render(); break;
      }
      case 'exmenuclose': if (e.target.closest('.sheet') && b.classList.contains('exmenu')) break; exMenu = null; render(); break;
      case 'exdel': {
        const lg = state.logs[logKey()];
        const it = lg.items[exMenu];
        if (it) {
          lg.items.splice(exMenu, 1);
          // プログラムにある種目は、消したことを覚えておき、記録に足し直さない
          lg.removed = (lg.removed || []).filter((nm) => nm !== it.name).concat(it.name);
          lg.touched = true;
          [...foldSet.keys()].filter((key) => key.startsWith(logKey() + '|')).forEach((key) => foldSet.delete(key));
        }
        exMenu = null; save(); render(); break;
      }
      case 'share': shareToday(); break;
      case 'logaddclose': logAdd = null; render(); break;
      case 'logadd': {
        const lg = state.logs[logKey()];
        const typed = document.getElementById('la-name').value.trim();
        const name = typed || document.getElementById('la-x').value;
        if (!name) { logAdd.msg = '種目を選ぶか、名前を入力してください。'; render(); break; }
        if (lg.items.some((x) => x.name === name)) { logAdd.msg = `「${name}」はすでにあります。`; render(); break; }
        if (lg.removed) lg.removed = lg.removed.filter((nm) => nm !== name);
        lg.items.push({ name, muscle: logAdd.muscle, extra: true, sets: Array.from({ length: 3 }, () => ({ w: '', r: '', done: false })) });
        lg.touched = true; logAdd = null; save(); render(); break;
      }
      case 'delset': {
        const lg = state.logs[logKey()];
        const it = lg.items[+b.dataset.ex];
        if (it.sets.length > 1 && !it.sets[it.sets.length - 1].done) it.sets.pop();
        lg.touched = true; save(); render(); break;
      }
      case 'customcancel': customOpen = null; render(); break;
      case 'custom-new': if (state.sample) { state = { ...blank(), theme: state.theme }; save(); } bdraft = newBuilderDraft(false); bmsg = ''; go('builder'); break;
      case 'custom-from': case 'custom-edit': bdraft = newBuilderDraft(true); bmsg = ''; go('builder'); break;
      case 'bback': go(state.answers ? 'program' : 'welcome'); break;
      case 'bday': { const d = bdraft.days[+b.dataset.wd]; d.on = !d.on; if (d.on && !d.muscles.length) { d.muscles = G_UPPER.slice(); d.label = d.label || '上半身'; } render(); break; }
      case 'bpreset': {
        const d = bdraft.days[+b.dataset.wd];
        const pr = PRESETS.find((x) => x[0] === b.dataset.p);
        d.muscles = pr[1].slice();
        if (!d.label || PRESET_NAMES.includes(d.label)) d.label = pr[0];
        render(); break;
      }
      case 'bmuscle': {
        const d = bdraft.days[+b.dataset.wd];
        const m = b.dataset.m; const i = d.muscles.indexOf(m);
        if (i >= 0) d.muscles.splice(i, 1); else d.muscles.push(m);
        render(); break;
      }
      case 'bsave': if (saveBuilder()) { openMenus.clear(); openMenus.add(0); go('program'); } else render(); break;
      case 'csets': {
        const it = state.custom.menus[+b.dataset.i].items[+b.dataset.n];
        it.sets = Math.max(1, Math.min(10, it.sets + (+b.dataset.d)));
        save(); render(); break;
      }
      case 'cdel': {
        const menu = state.custom.menus[+b.dataset.i];
        menu.items.splice(+b.dataset.n, 1);
        syncMuscles(menu); customOpen = null; save(); render(); break;
      }
      case 'cadd': {
        const menu = state.custom.menus[+b.dataset.i];
        const m = document.getElementById(`cadd-${b.dataset.i}`).value;
        const opt = L.exerciseOptions(m)[0];
        const reps = { hypertrophy: { main: '6〜10', compound: '8〜12', iso: '10〜15' }, strength: { main: '3〜5', compound: '6〜10', iso: '10〜12' }, health: { main: '8〜12', compound: '10〜12', iso: '12〜15' } }[state.custom.goal || 'hypertrophy'][opt.kind];
        menu.items.push({ name: opt.name, muscle: m, sets: 3, reps, kind: opt.kind });
        syncMuscles(menu); save(); render(); break;
      }
      case 'restpick': {
        const name = b.dataset.name, kind = b.dataset.kind;
        const has = state.restByEx && state.restByEx[name];
        openPicker(restFor(name, kind), `${name}の休憩時間`, (sec) => {
          state.restByEx = state.restByEx || {};
          if (sec === null) delete state.restByEx[name]; else state.restByEx[name] = sec;
          save(); render();
        }, has ? '<button class="linkbtn small" data-pk="auto">この種目の設定を消して初期値に戻す</button>' : '');
        break;
      }
      case 'restdefault':
        openPicker(state.restDefault || 90, '休憩時間の初期値', (sec) => { state.restDefault = sec; save(); render(); },
          state.restDefault ? '<button class="linkbtn small" data-pk="auto">自動（目的と種目で決める）に戻す</button>' : '');
        break;
      case 'restclear': state.restByEx = {}; save(); render(); break;
      case 'resttoggle': state.restOn = state.restOn === false; save(); render(); break;
      case 'openlog': logDate = b.dataset.k; go('log'); break;
      case 'logday': logDate = b.dataset.k; pickOpen = false; exMenu = null; render(); break;
      case 'lifttab': liftTab = b.dataset.k; render(); break;
      case 'checkin': go('checkin'); break;
      case 'back-dash': go('dash'); break;
      case 'checkin-done': {
        const c = checkinData();
        state.checkins = state.checkins || [];
        state.checkins.push({ date: dateKey(today()), rate: c.rate, summary: c.advice[0].slice(0, 40) });
        save(); go('dash'); break;
      }
      case 'pickopen': pickOpen = !pickOpen; render(); break;
      case 'copyprev': {
        // 前回の値から作った目標を、まだ完了していないセットに入れる（完了の印はつけない）
        const k = logKey();
        const lg = state.logs[k];
        const li = lg.items[+b.dataset.ex];
        const p = currentPlan();
        const menu = p.menus[lg.session] || { items: [] };
        const it = menu.items.find((x) => x.name === li.name) || { reps: '', muscle: li.muscle, kind: 'compound' };
        const prev = previous(li.name, k);
        if (!prev) break;
        const g = progressTarget(prev.sets, it.reps, it.muscle || li.muscle, it.kind);
        li.sets.forEach((x, si) => {
          if (x.done) return;
          const t = g.sets[Math.min(si, g.sets.length - 1)];
          x.w = t.w; x.r = t.r;
        });
        lg.touched = true; save(); render(); break;
      }
      case 'exfold': foldSet.set(b.dataset.k, b.dataset.fold === 'true'); render(); break;
      case 'swap': {
        const k = logKey();
        const i = +b.dataset.i;
        const lg = state.logs[k];
        if (lg && doneSets(lg) === 0) delete state.logs[k];
        state.swap[k] = i; pickOpen = false; save(); render(); break;
      }
      case 'unswap': {
        const k = logKey(); delete state.swap[k];
        if (state.logs[k] && doneSets(state.logs[k]) === 0) delete state.logs[k];
        pickOpen = false; save(); render(); break;
      }
      case 'done': {
        const lg = state.logs[logKey()];
        const s = lg.items[+b.dataset.ex].sets[+b.dataset.set];
        if (!s.done) {
          // 空欄なら前回（またはプレースホルダ）の値で埋める
          const row = b.closest('li');
          row.querySelectorAll('input').forEach((inp) => { if (inp.value === '' && inp.placeholder && /^[\d.]+$/.test(inp.placeholder)) s[inp.dataset.f] = +inp.placeholder; });
        }
        s.done = !s.done; lg.touched = true; save(); render();
        if (s.done) {
          const p2 = currentPlan();
          const menu = p2.menus[lg.session];
          const mi = menu && menu.items.find((x) => x.name === lg.items[+b.dataset.ex].name);
          startRest(lg.items[+b.dataset.ex].name, mi ? mi.kind : 'compound');
        }
        break;
      }
      case 'applylevel': state.levelOverride = b.dataset.level; save(); go('result'); break;
      case 'showresult': if (state.custom) { bdraft = newBuilderDraft(true); bmsg = ''; go('builder'); } else go('result'); break;
      case 'redo': draft = JSON.parse(JSON.stringify(state.answers)); normalizeDraft(); quizStep = 0; go('quiz'); break;
      case 'export': exportOpen = !exportOpen; render(); break;
      case 'copy': {
        const box = document.getElementById('export-box');
        const fallback = () => { box.focus(); box.select(); b.textContent = '選択しました。長押しでコピーしてください'; };
        try { navigator.clipboard.writeText(box.value).then(() => { b.textContent = 'コピーしました'; state.lastBackup = dateKey(today()); save(); }, fallback); } catch (err) { fallback(); }
        break;
      }
      case 'import': importText(document.getElementById('import-box').value); break;
      case 'savefile': saveBackupFile(); break;
      case 'loadfile': document.getElementById('import-file').click(); break;
      case 'reset': confirmReset = true; render(); break;
      case 'reset-no': confirmReset = false; render(); break;
      case 'theme': {
        const t = { accent: 'blue', mode: 'auto', ...(state.theme || {}) };
        if (b.dataset.accent) t.accent = b.dataset.accent;
        if (b.dataset.mode) t.mode = b.dataset.mode;
        state.theme = t; save(); render(); break;
      }
      case 'reset-yes': state = blank(); save(); confirmReset = false; go('welcome'); break;
    }
  });

  function normalizeDraft() {
    const l = draft.lifts || {};
    draft.lifts = { bench: l.bench || {}, squat: l.squat || {}, deadlift: l.deadlift || {} };
    draft.priority = draft.priority || [];
    draft.weekdays = draft.weekdays || [];
    if (draft.years === undefined) draft.years = null;
  }

  $app.addEventListener('input', (e) => {
    const t = e.target;
    if (view === 'builder') {
      if (t.id === 'b-name') bdraft.name = t.value;
      if (t.id === 'b-bw') bdraft.bodyweight = t.value;
      if (t.dataset.blabel !== undefined) bdraft.days[+t.dataset.blabel].label = t.value;
      return;
    }
    if (view === 'program' && t.dataset.creps) {
      const [i, n] = t.dataset.creps.split('-').map(Number);
      state.custom.menus[i].items[n].reps = t.value.trim();
      save(); return;
    }
    if (view === 'quiz') {
      if (t.id === 'q-bw') draft.bodyweight = t.value;
      if (t.dataset.lift) draft.lifts[t.dataset.lift][t.dataset.f] = t.value;
      const btn = $app.querySelector('[data-act="next"]');
      if (btn) btn.disabled = !stepValid(activeSteps()[quizStep]);
      return;
    }
    if (view === 'log') {
      const lg = state.logs[logKey()];
      if (!lg) return;
      if (t.id === 'day-note') { lg.note = t.value; lg.touched = true; save(); return; }
      if (t.dataset.ex !== undefined) {
        const v = t.value === '' ? '' : +t.value;
        lg.items[+t.dataset.ex].sets[+t.dataset.set][t.dataset.f] = v;
        lg.touched = true;
        save();
      }
    }
  });

  $app.addEventListener('change', (e) => {
    if (e.target.id === 'import-file') {
      const f = e.target.files && e.target.files[0];
      if (f) f.text().then(importText, () => { importMsg = { ok: false, text: 'ファイルを読み込めませんでした。' }; render(); });
      return;
    }
    if (e.target.dataset.cname) {
      const [i, n] = e.target.dataset.cname.split('-').map(Number);
      if (e.target.value === '__custom__') { customOpen = `${i}-${n}`; render(); const inp = document.getElementById(`cx-${i}-${n}`); if (inp) inp.focus(); return; }
      const it = state.custom.menus[i].items[n];
      it.name = e.target.value;
      const opt = L.exerciseOptions(it.muscle).find((o) => o.name === it.name);
      if (opt) it.kind = opt.kind;
      save(); render(); return;
    }
    if (e.target.id === 'la-m' && logAdd) { logAdd.muscle = e.target.value; logAdd.msg = ''; render(); return; }
    if (e.target.id === 'la-x' && e.target.value === '') { const inp = document.getElementById('la-name'); if (inp) inp.focus(); return; }
    if (view === 'builder') {
      if (e.target.id === 'b-goal') bdraft.goal = e.target.value;
      if (e.target.id === 'b-level') bdraft.level = e.target.value;
      return;
    }
    if (e.target.dataset.swapSess !== undefined && e.target.value === '__custom__') {
      customOpen = `${e.target.dataset.pos}-${e.target.dataset.swapN}`;
      render();
      const inp = document.getElementById(`cx-${customOpen}`);
      if (inp) inp.focus();
      return;
    }
    if (e.target.dataset.swapSess !== undefined) {
      const key = `${e.target.dataset.swapSess}|${e.target.dataset.swapOrig}`;
      state.exSwap = state.exSwap || {};
      if (e.target.value === e.target.dataset.swapOrig) delete state.exSwap[key]; else state.exSwap[key] = e.target.value;
      save(); render(); return;
    }
    if (e.target.id === 'fit-time') { state.fitTime = e.target.checked; save(); render(); return; }
    if (e.target.id === 'level-override') { state.levelOverride = e.target.value || null; state.choice = null; save(); render(); }
  });

  function syncMuscles(menu) {
    const ms = L.PICK_ORDER.filter((m) => menu.items.some((it) => it.muscle === m));
    if (ms.length) { menu.muscles = ms; menu.color = colorFor(ms); }
  }

  // 候補にない種目を自分で入力する
  $app.addEventListener('submit', (e) => {
    const f = e.target.closest('form.customex');
    if (!f) return;
    e.preventDefault();
    const name = f.querySelector('input').value.trim().replace(/\s+/g, ' ');
    if (!name) { f.querySelector('input').focus(); return; }
    const m = f.dataset.customMuscle;
    state.customEx = state.customEx || {};
    state.customEx[m] = state.customEx[m] || [];
    if (!state.customEx[m].includes(name)) state.customEx[m].push(name);
    if (f.dataset.customN !== undefined) {
      state.custom.menus[+f.dataset.customSess].items[+f.dataset.customN].name = name;
      customOpen = null; save(); render(); return;
    }
    state.exSwap = state.exSwap || {};
    const key = `${f.dataset.customSess}|${f.dataset.customOrig}`;
    if (name === f.dataset.customOrig) delete state.exSwap[key]; else state.exSwap[key] = name;
    customOpen = null;
    save(); render();
  });

  // ---------- 長押しで並び替え ----------
  // [data-sort] の中の [data-sort-i] を、[data-grip] を長押ししてから指を動かして入れ替える
  const HOLD_MS = 450;
  let drag = null;
  let holdTimer = null;
  let suppressClick = false;

  let holdItem = null;
  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; if (holdItem) { holdItem.classList.remove('is-holding'); holdItem = null; } }

  $app.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const touch = e.pointerType !== 'mouse';
    // 指で操作するときは、プログラムの種目名（選択欄）を長押ししても動かせる（記録の種目名と同じ感覚）
    const selGrip = touch && e.target.closest('select') && e.target.closest('[data-sort^="items:"] > [data-sort-i]');
    const grip = selGrip || e.target.closest('[data-grip]');
    if (!grip || (!selGrip && e.target.closest('input, select, textarea, button, form'))) return;
    const item = grip.closest('[data-sort-i]');
    const list = item && item.parentElement.closest('[data-sort]');
    if (!list || item.parentElement !== list || (list.children.length < 2 && list.dataset.sort !== 'log')) return;
    const x0 = e.clientX, y0 = e.clientY;
    cancelHold();
    holdItem = item; item.classList.add('is-holding');
    holdTimer = setTimeout(() => {
      holdTimer = null;
      item.classList.remove('is-holding'); holdItem = null;
      // メニューを動かすときは、開いているメニューを閉じて短くしてから持ち上げる
      if (item.tagName === 'DETAILS') list.querySelectorAll(':scope > details[open]').forEach((d) => { d.open = false; });
      // 記録の種目はセットの欄を隠して、短くしてから動かす（CSS の .is-sorting）
      list.classList.add('is-sorting');
      // iPhone の並び替えのように、押した項目そのものが指についてきて、ほかの項目がよけて場所をあける
      drag = { item, list, y0, touch, moved: false, ins: null };
      item.classList.add('is-lifted');
      const rr = item.getBoundingClientRect();
      const sibs = [...list.children].filter((c) => c !== item && c.dataset.sortI !== undefined);
      const all = [...list.children].filter((c) => c.dataset.sortI !== undefined);
      const cur = all.indexOf(item);
      const next = all[cur + 1] || all[cur - 1];
      // 1つ分ずらす量（項目の高さ＋すき間）
      const step = next ? Math.abs(next.getBoundingClientRect().top - rr.top) : rr.height;
      drag.sibs = sibs; drag.cur = cur; drag.step = step;
      drag.mids = sibs.map((c) => { const r = c.getBoundingClientRect(); return r.top + scrollY + r.height / 2; });
      drag.top0 = rr.top + scrollY;
      drag.offY = y0 >= rr.top && y0 <= rr.bottom ? y0 - rr.top : Math.min(24, rr.height / 2);
      sibs.forEach((c) => c.classList.add('is-shifting'));
      dragMove(y0);
    }, HOLD_MS);
    const moveBeforeHold = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancelHold(); };
    const stop = () => { cancelHold(); window.removeEventListener('pointermove', moveBeforeHold); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
    window.addEventListener('pointermove', moveBeforeHold);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });

  function dragMove(y) {
    const { item, sibs, cur, step } = drag;
    if (Math.abs(y - drag.y0) > 10) drag.moved = true;
    // 押した項目は指の位置へ
    item.style.transform = `translateY(${y + scrollY - drag.offY - drag.top0}px)`;
    // 指の位置から入る場所（ほかの項目の何番目の前か）を決め、そのあいだの項目を1つ分ずらす
    const docY = y + scrollY;
    let ins = sibs.length;
    for (let i = 0; i < sibs.length; i++) { if (docY < drag.mids[i]) { ins = i; break; } }
    drag.ins = ins;
    sibs.forEach((c, i) => {
      const dy = i < cur && i >= ins ? step : (i >= cur && i < ins ? -step : 0);
      c.style.transform = dy ? `translateY(${dy}px)` : '';
    });
    // 画面の端に来たらスクロール
    if (y < 70) window.scrollBy(0, -8); else if (y > innerHeight - 130) window.scrollBy(0, 8);
  }
  // マウスは pointer イベント、指は touch イベントで動かす（iPhone は途中で pointercancel が来ることがあるため）
  window.addEventListener('pointermove', (e) => { if (drag && !drag.touch) { e.preventDefault(); dragMove(e.clientY); } }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!drag) return;
    e.preventDefault(); // 持ち上げている間は画面をスクロールさせない
    if (e.touches[0]) dragMove(e.touches[0].clientY);
  }, { passive: false });
  const touchEnd = (e) => { if (drag) { if (e.cancelable) e.preventDefault(); endDrag(); } };
  window.addEventListener('touchend', touchEnd, { passive: false });
  window.addEventListener('touchcancel', touchEnd, { passive: false });
  $app.addEventListener('contextmenu', (e) => { if (drag || holdTimer || e.target.closest('[data-grip]')) e.preventDefault(); });

  function endDrag() {
    if (!drag) return;
    const { item, list, sibs, ins, moved } = drag;
    drag = null;
    item.classList.remove('is-lifted'); list.classList.remove('is-sorting');
    [item, ...sibs].forEach((c) => { c.classList.remove('is-shifting'); c.style.transform = ''; });
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 350);
    // 記録の種目を長押しして、動かさずに離したときは、削除のメニューを出す
    if (!moved && list.dataset.sort === 'log') { exMenu = +item.dataset.sortI; render(); return; }
    const others = [...list.children].filter((c) => c !== item && c.dataset.sortI !== undefined).map((c) => +c.dataset.sortI);
    if (ins === null) return;
    const order = others.slice(0, ins).concat(+item.dataset.sortI, others.slice(ins));
    if (order.every((v, i) => v === i)) return;
    applySort(list.dataset.sort, order);
  }
  window.addEventListener('pointerup', () => { if (drag && !drag.touch) endDrag(); });
  window.addEventListener('pointercancel', () => { if (drag && !drag.touch) endDrag(); });
  // 並び替えのあとに続くタップ（メニューの開閉など）は無視する
  $app.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } }, true);

  // order は「新しい並びの i 番目に、元の何番目が来るか」
  function applySort(kind, order) {
    if (kind === 'log') {
      const lg = state.logs[logKey()];
      lg.items = order.map((j) => lg.items[j]);
      lg.touched = true;
    } else if (kind === 'menus') {
      if (state.custom) state.custom.menus = order.map((j) => state.custom.menus[j]);
      else {
        state.order = state.order || {};
        const cur = state.order.menus && state.order.menus.length === order.length ? state.order.menus : order.map((_, i) => i);
        state.order.menus = order.map((j) => cur[j]);
      }
      // これまでの記録と「この日のメニュー変更」を、新しい番号に付け替える
      const to = (old) => (old >= 0 ? order.indexOf(old) : old);
      Object.values(state.logs).forEach((lg) => { if (lg && lg.session >= 0 && order.indexOf(lg.session) >= 0) lg.session = to(lg.session); });
      Object.keys(state.swap).forEach((k) => { state.swap[k] = to(state.swap[k]); });
      const open = [...openMenus]; openMenus.clear(); open.forEach((i) => openMenus.add(order.indexOf(i)));
      customOpen = null;
    } else if (kind.startsWith('items:')) {
      const i = +kind.slice(6);
      if (state.custom) {
        const m = state.custom.menus[i];
        m.items = order.map((j) => m.items[j]);
      } else {
        const m = currentPlan().menus[i];
        state.order = state.order || {};
        state.order.items = state.order.items || {};
        state.order.items[m.src] = order.map((j) => m.items[j].original || m.items[j].name);
      }
      customOpen = null;
    }
    save(); render();
  }

  // 開いているメニューを覚えておく（描画し直しても閉じないように）
  $app.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.classList && d.classList.contains('rawbackup')) { rawOpen = d.open; return; }
    if (!d.dataset || d.dataset.menu === undefined) return;
    if (d.open) openMenus.add(+d.dataset.menu); else openMenus.delete(+d.dataset.menu);
  }, true);

  // 日付が変わったら表示を更新
  let lastKey = dateKey(today());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dateKey(today()) !== lastKey) { lastKey = dateKey(today()); if (view === 'dash' || view === 'log') render(); }
  });

  render();
})();
