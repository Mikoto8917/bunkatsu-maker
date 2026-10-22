/* 分割提案ロジック（plan/split-logic.md の実装）
 * 画面に依存しない純粋な関数だけを置く。node からも読み込んでテストできる。 */
(function (root) {
  'use strict';

  // ---- 部位 ----
  const MUSCLES = {
    chest:      { name: '胸',       size: 'large' },
    back:       { name: '背中',     size: 'large' },
    shoulders:  { name: '肩',       size: 'small' },
    biceps:     { name: '腕（二頭）', size: 'small' },
    triceps:    { name: '腕（三頭）', size: 'small' },
    quads:      { name: '脚（前もも）', size: 'large' },
    hamstrings: { name: '脚（もも裏）', size: 'large' },
    glutes:     { name: 'お尻',     size: 'small' },
    calves:     { name: 'ふくらはぎ', size: 'small' },
  };
  const MUSCLE_ORDER = ['quads', 'hamstrings', 'chest', 'back', 'glutes', 'shoulders', 'triceps', 'biceps', 'calves'];

  const UPPER = ['chest', 'back', 'shoulders', 'biceps', 'triceps'];
  const LOWER = ['quads', 'hamstrings', 'glutes', 'calves'];
  const PUSH = ['chest', 'shoulders', 'triceps'];
  const PULL = ['back', 'biceps'];
  const FULL = UPPER.concat(LOWER);

  // 質問の「特に伸ばしたい部位」→ 部位キー
  const PRIORITY_MAP = {
    chest: ['chest'], back: ['back'], shoulders: ['shoulders'],
    arms: ['biceps', 'triceps'], legs: ['quads', 'hamstrings'], glutes: ['glutes'],
  };

  // ---- 分割テンプレート（color は画面のテーマ色キー）----
  const S = (label, muscles, color) => ({ label, muscles, color });
  const fullA = (l) => S(l, FULL, 'full');
  const up = (l) => S(l, UPPER, 'upper');
  const low = (l) => S(l, LOWER, 'legs');
  const push = (l) => S(l, PUSH, 'push');
  const pull = (l) => S(l, PULL, 'pull');
  const legs = (l) => S(l, LOWER, 'legs');

  const TEMPLATES = [
    { id: 'fb2', name: '全身法 A/B', days: 2, family: 'fullbody', sessions: [fullA('全身A'), fullA('全身B')] },
    { id: 'fb3', name: '全身法 A/B/C', days: 3, family: 'fullbody', sessions: [fullA('全身A'), fullA('全身B'), fullA('全身C')] },
    { id: 'ulfb3', name: '上下＋全身', days: 3, family: 'hybrid', sessions: [up('上半身'), low('下半身'), fullA('全身')] },
    { id: 'ppl3', name: 'PPL（プッシュ／プル／脚）', days: 3, family: 'ppl', sessions: [push('プッシュ'), pull('プル'), legs('脚')] },
    { id: 'ul4', name: '上半身／下半身 ×2', days: 4, family: 'upper_lower', sessions: [up('上半身A'), low('下半身A'), up('上半身B'), low('下半身B')] },
    { id: 'fb4', name: '全身法 ×4（短時間）', days: 4, family: 'fullbody', sessions: [fullA('全身A'), fullA('全身B'), fullA('全身C'), fullA('全身D')] },
    { id: 'pplu4', name: 'PPL＋上半身', days: 4, family: 'ppl', sessions: [push('プッシュ'), pull('プル'), legs('脚'), up('上半身')] },
    { id: 'ulppl5', name: '上下＋PPL（ULPPL）', days: 5, family: 'ulppl', sessions: [up('上半身'), low('下半身'), push('プッシュ'), pull('プル'), legs('脚')] },
    { id: 'ulw5', name: '上下 ×2＋弱点日', days: 5, family: 'upper_lower', weakDay: true, sessions: [up('上半身A'), low('下半身A'), up('上半身B'), low('下半身B'), S('弱点日', ['shoulders', 'biceps', 'triceps'], 'arms')] },
    { id: 'bro5', name: '部位別5分割', days: 5, family: 'bro', sessions: [S('胸', ['chest'], 'push'), S('背中', ['back'], 'pull'), S('肩', ['shoulders'], 'arms'), S('脚', LOWER, 'legs'), S('腕', ['biceps', 'triceps'], 'arms')] },
    { id: 'ppl6', name: 'PPL ×2', days: 6, family: 'ppl', sessions: [push('プッシュA'), pull('プルA'), legs('脚A'), push('プッシュB'), pull('プルB'), legs('脚B')] },
    { id: 'ul6', name: '上半身／下半身 ×3', days: 6, family: 'upper_lower', sessions: [up('上半身A'), low('下半身A'), up('上半身B'), low('下半身B'), up('上半身C'), low('下半身C')] },
    { id: 'bro6', name: '部位別6分割', days: 6, family: 'bro', sessions: [S('胸', ['chest'], 'push'), S('背中', ['back'], 'pull'), S('脚（前）', ['quads', 'calves'], 'legs'), S('肩', ['shoulders'], 'arms'), S('腕', ['biceps', 'triceps'], 'arms'), S('脚（後）', ['hamstrings', 'glutes', 'calves'], 'legs')] },
  ];

  // 曜日 0=月 … 6=日
  const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
  const DEFAULT_WEEKDAYS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };

  const SESSION_MIN = { le45: 45, m60: 60, m75: 75, ge90: 90 };
  const SET_MINUTES = 3; // 1セット約3分（休憩込み）

  const WEIGHTS = {
    hypertrophy: { freq: 0.25, time: 0.20, vol: 0.20, recv: 0.15, sched: 0.20 },
    strength:    { freq: 0.35, time: 0.15, vol: 0.10, recv: 0.20, sched: 0.20 },
    health:      { freq: 0.15, time: 0.25, vol: 0.10, recv: 0.20, sched: 0.30 },
  };

  const SCHED_SCORE = {
    fixed:     { fullbody: 1, hybrid: 1, upper_lower: 1, ppl: 1, ulppl: 1, bro: 1 },
    sometimes: { fullbody: 1, hybrid: 0.9, upper_lower: 0.85, ppl: 0.7, ulppl: 0.7, bro: 0.5 },
    irregular: { fullbody: 1, hybrid: 0.8, upper_lower: 0.7, ppl: 0.5, ulppl: 0.5, bro: 0.2 },
  };

  // 4-4 部位ごとの週セット数 [下限, 上限] と優先部位の加算
  const VOLUME = {
    beginner:     { large: [8, 10], small: [6, 8], prio: 2 },
    intermediate: { large: [10, 14], small: [8, 12], prio: 4 },
    advanced:     { large: [12, 18], small: [10, 14], prio: 5 },
  };

  const LEVEL_NAME = { beginner: '初心者', intermediate: '中級', advanced: '上級' };
  const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };
  const GOAL_NAME = { hypertrophy: '筋肉を大きくする', strength: '力を強くする', health: '体型づくり・健康' };

  // ---- 4-1a 経験レベル（体重比の推定1RM）----
  const LIFT_STD = { // 男性基準 [中級の下限, 上級の下限]
    bench: { name: 'ベンチプレス', t: [0.75, 1.25], female: 0.6 },
    squat: { name: 'スクワット', t: [1.0, 1.75], female: 0.75 },
    deadlift: { name: 'デッドリフト', t: [1.25, 2.0], female: 0.75 },
  };

  function epley1RM(weight, reps) {
    const r = Math.min(Math.max(1, reps), 10);
    return reps === 1 ? weight : weight * (1 + r / 30);
  }

  function liftLevel(key, oneRM, bodyweight, sex) {
    const std = LIFT_STD[key];
    const mul = sex === 'female' ? std.female : 1;
    const ratio = oneRM / bodyweight;
    const level = ratio >= std.t[1] * mul ? 'advanced' : ratio >= std.t[0] * mul ? 'intermediate' : 'beginner';
    return { key, name: std.name, oneRM, ratio, level };
  }

  // lifts: { bench: {w, r}, squat: {...}, deadlift: {...} }
  function judgeExperience(a) {
    const per = [];
    for (const key of ['bench', 'squat', 'deadlift']) {
      const l = a.lifts && a.lifts[key];
      if (l && l.w > 0 && l.r > 0 && a.bodyweight > 0) per.push(liftLevel(key, epley1RM(l.w, l.r), a.bodyweight, a.sex));
    }
    if (!per.length) {
      const level = { lt1: 'beginner', y1to3: 'intermediate', gt3: 'advanced' }[a.years] || 'beginner';
      return { level, per, source: 'years' };
    }
    const ranks = per.map((p) => LEVEL_RANK[p.level]).sort((x, y) => x - y);
    // 2種目なら低いほう、3種目なら中央値（＝低いほう寄り）
    const pick = ranks.length === 3 ? ranks[1] : ranks[0];
    const level = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === pick);
    return { level, per, source: 'lifts' };
  }

  // ---- 4-4 週セット数の目標 ----
  function weeklyTargets(level, recovery, priority) {
    const v = VOLUME[level];
    const prio = new Set();
    (priority || []).forEach((p) => (PRIORITY_MAP[p] || []).forEach((m) => prio.add(m)));
    const t = {};
    for (const m of Object.keys(MUSCLES)) {
      const [lo, hi] = v[MUSCLES[m].size];
      let n = recovery === 'good' ? Math.round((lo + hi) / 2) : lo;
      if (prio.has(m)) n += v.prio;
      t[m] = n;
    }
    return t;
  }

  // ---- テンプレートの展開 ----
  function resolveSessions(tpl, priority) {
    return tpl.sessions.map((s) => {
      if (tpl.weakDay && s.label === '弱点日') {
        const ms = [];
        (priority || []).forEach((p) => (PRIORITY_MAP[p] || []).forEach((m) => ms.includes(m) || ms.push(m)));
        if (ms.length) return { ...s, muscles: ms };
      }
      return s;
    });
  }

  // 部位ごとの目標セット数を、その部位が入るセッションに均等配分する
  function distribute(sessions, targets) {
    const per = sessions.map(() => ({}));
    for (const m of Object.keys(targets)) {
      const idx = sessions.map((s, i) => (s.muscles.includes(m) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const base = Math.floor(targets[m] / idx.length);
      let rem = targets[m] - base * idx.length;
      idx.forEach((i) => { per[i][m] = base + (rem-- > 0 ? 1 : 0); });
    }
    return per;
  }

  function sum(obj) { return Object.values(obj).reduce((a, b) => a + b, 0); }

  // ---- 4-3 スコアリング ----
  const HIGH_VOLUME = (tpl) => tpl.family === 'bro' || tpl.family === 'ulppl' || tpl.id === 'ppl6';

  function scoreTemplate(tpl, a, ctx) {
    const sessions = resolveSessions(tpl, a.priority);
    const weekdays = (a.weekdays && a.weekdays.length === tpl.days) ? a.weekdays.slice().sort() : DEFAULT_WEEKDAYS[tpl.days];
    const sets = distribute(sessions, ctx.targets);

    // ① 頻度（部位ごとの週あたり回数の平均）
    const freqs = Object.keys(MUSCLES).map((m) => sessions.filter((s) => s.muscles.includes(m)).length);
    const avgFreq = freqs.reduce((x, y) => x + y, 0) / freqs.length;
    const freq = avgFreq >= 2 ? 1 : avgFreq >= 1.5 ? 0.6 : 0.3;

    // ② 時間（最も長い日の見積もり）
    const minutes = sets.map((s) => sum(s) * SET_MINUTES);
    const maxMin = Math.max(...minutes);
    const limit = SESSION_MIN[a.sessionMin] || 60;
    // 上級者の高ボリューム分割（PPL×2・ULPPL・部位別）は、1回に収める工夫ができる前提で15分の超過まで許容する（4-3 経験による補正）
    const tol = ctx.level === 'advanced' && HIGH_VOLUME(tpl) ? 15 : 0;
    const time = maxMin <= limit + tol ? 1 : maxMin <= limit + tol + 15 ? 0.5 : 0;

    // ③ 1セッション1部位のセット数
    const maxPerMuscle = Math.max(...sets.map((s) => Math.max(0, ...Object.values(s))));
    const vol = maxPerMuscle <= 8 ? 1 : maxPerMuscle <= 10 ? 0.7 : 0.3;

    // ④ 回復（同じ部位が連日になる回数、休みの日数）
    const restDays = 7 - tpl.days;
    // 連日で同じ部位が重なるとき、前日のその部位のセット数が多いほど大きく減点する
    // （6セット以上で −0.3。全身法の2〜3セットなら −0.15 程度）
    let consecutive = 0, penalty = 0;
    const byDay = {};
    weekdays.forEach((d, i) => { byDay[d] = i; });
    for (const d of weekdays) {
      const n = byDay[(d + 1) % 7];
      if (n === undefined) continue;
      const i = byDay[d];
      const overlap = sessions[i].muscles.filter((m) => sessions[n].muscles.includes(m));
      if (!overlap.length) continue;
      consecutive++;
      const heaviest = Math.max(...overlap.map((m) => sets[i][m] || 0));
      penalty += 0.3 * Math.min(1, heaviest / 6);
    }
    const recv = a.recovery === 'poor' && restDays <= 1 ? 0.2 : Math.max(0, Math.round((1 - penalty) * 100) / 100);

    // ⑤ 予定の崩れにくさ
    const sched = (SCHED_SCORE[a.schedule] || SCHED_SCORE.fixed)[tpl.family];

    const w = WEIGHTS[a.goal] || WEIGHTS.hypertrophy;
    let total = w.freq * freq + w.time * time + w.vol * vol + w.recv * recv + w.sched * sched;

    // 経験による補正
    let adj = 0;
    if (ctx.level === 'beginner' && ['fullbody', 'upper_lower', 'hybrid'].includes(tpl.family)) adj += 0.1;
    if (ctx.level === 'beginner' && HIGH_VOLUME(tpl)) adj -= 0.1;
    total += adj;

    return {
      tpl, sessions, weekdays, sets, minutes,
      parts: { freq, time, vol, recv, sched, adj },
      detail: { avgFreq, maxMin, limit, maxPerMuscle, consecutive, restDays },
      total: Math.round(total * 1000) / 1000,
    };
  }

  // 4-2 候補（日数で決まる）。回復が悪く5日以上なら、1日減らした案も候補に入れる
  function candidates(days, recovery) {
    let list = TEMPLATES.filter((t) => t.days === days).map((t) => ({ t, reduced: false }));
    if (recovery === 'poor' && days >= 5) {
      list = list.concat(TEMPLATES.filter((t) => t.days === days - 1).map((t) => ({ t, reduced: true })));
    }
    return list;
  }

  function recommend(a, levelOverride) {
    const exp = judgeExperience(a);
    const level = levelOverride || exp.level;
    const targets = weeklyTargets(level, a.recovery, a.priority);
    const ctx = { level, targets };
    const ranked = candidates(a.days, a.recovery).map(({ t, reduced }) => {
      const wd = reduced ? DEFAULT_WEEKDAYS[t.days] : a.weekdays;
      const r = scoreTemplate(t, { ...a, weekdays: wd }, ctx);
      r.reduced = reduced;
      return r;
    }).map((r, order) => ({ r, order }))
      // 同点なら、部位ごとの頻度が週2回に近いほうを優先（R2：ボリュームが同じなら2回を超える上積みは小さい）。それでも同じなら候補の並び順
      .sort((x, y) => (y.r.total - x.r.total) || (Math.abs(x.r.detail.avgFreq - 2) - Math.abs(y.r.detail.avgFreq - 2)) || (x.order - y.order))
      .map((x) => x.r);
    ranked.forEach((r) => { r.reason = explain(r, a); });
    return { experience: exp, level, targets, ranked, best: ranked[0], alt: ranked[1] };
  }

  // 4-5 理由（3行以内）
  function explain(r, a) {
    const lines = [];
    const d = r.detail;
    if (r.reduced) lines.push(`回復に不安があるので、週${a.days}日から${r.tpl.days}日に減らして休みを${d.restDays}日確保する案です。`);
    const f = d.avgFreq;
    lines.push(f >= 2 ? `各部位を週${Math.round(f * 10) / 10 >= 3 ? '3回以上' : '2回以上'}鍛えられ、${d.maxMin <= d.limit ? `1回${d.maxMin}分ほどで${d.limit}分に収まります。` : `1回の見積もりは${d.maxMin}分です。`}`
      : `部位ごとの頻度は週${Math.round(f * 10) / 10}回です。1回の見積もりは${d.maxMin}分です。`);
    if (a.schedule === 'irregular') lines.push(r.tpl.family === 'fullbody' ? '1日抜けても全部位が残るので、予定がバラバラでも崩れません。' : '予定がずれると部位が抜けやすいので、抜けた日は次回に回してください。');
    else if (a.schedule === 'sometimes') lines.push(['fullbody', 'hybrid', 'upper_lower'].includes(r.tpl.family) ? 'ときどき予定がずれても、部位の抜けが小さい構成です。' : '予定がずれた週は、抜けた日を次回に回してください。');
    else lines.push('曜日を固定できるので、この並びのまま回せます。');
    return lines.slice(0, 3);
  }

  // ---- 種目 ----
  // kind: main（主要リフト）/ compound / iso
  const EXERCISES = {
    chest: [['ベンチプレス', 'main'], ['インクラインダンベルプレス', 'compound'], ['ケーブルフライ', 'iso'], ['ディップス', 'compound']],
    back: [['ラットプルダウン', 'compound'], ['ベントオーバーロウ', 'main'], ['シーテッドケーブルロウ', 'compound'], ['懸垂', 'compound']],
    shoulders: [['オーバーヘッドプレス', 'main'], ['サイドレイズ', 'iso'], ['リアデルトフライ', 'iso']],
    biceps: [['バーベルカール', 'iso'], ['インクラインダンベルカール', 'iso'], ['ハンマーカール', 'iso']],
    triceps: [['ケーブルプッシュダウン', 'iso'], ['オーバーヘッドエクステンション', 'iso'], ['ナローベンチプレス', 'compound']],
    quads: [['スクワット', 'main'], ['レッグプレス', 'compound'], ['ブルガリアンスクワット', 'compound'], ['レッグエクステンション', 'iso']],
    hamstrings: [['ルーマニアンデッドリフト', 'compound'], ['レッグカール', 'iso'], ['デッドリフト', 'main']],
    glutes: [['ヒップスラスト', 'compound'], ['ケーブルキックバック', 'iso']],
    calves: [['スタンディングカーフレイズ', 'iso'], ['シーテッドカーフレイズ', 'iso']],
  };

  // 差し替え用の候補（自動で組むメニューには使わない。器具がない・苦手なときに選ぶ）
  const ALT_EXERCISES = {
    chest: [['ダンベルベンチプレス', 'compound'], ['マシンチェストプレス', 'compound'], ['腕立て伏せ', 'compound'], ['ペックデック', 'iso']],
    back: [['ワンハンドダンベルロウ', 'compound'], ['マシンロウ', 'compound'], ['アシスト懸垂', 'compound'], ['ストレートアームプルダウン', 'iso']],
    shoulders: [['ダンベルショルダープレス', 'compound'], ['マシンショルダープレス', 'compound'], ['ケーブルサイドレイズ', 'iso'], ['フェイスプル', 'iso']],
    biceps: [['ケーブルカール', 'iso'], ['プリーチャーカール', 'iso'], ['ダンベルカール', 'iso']],
    triceps: [['ディップス', 'compound'], ['スカルクラッシャー', 'iso'], ['ダンベルキックバック', 'iso']],
    quads: [['ハックスクワット', 'compound'], ['ゴブレットスクワット', 'compound'], ['スミスマシンスクワット', 'compound'], ['ランジ', 'compound']],
    hamstrings: [['シーテッドレッグカール', 'iso'], ['グッドモーニング', 'compound'], ['ダンベルルーマニアンデッドリフト', 'compound']],
    glutes: [['ブルガリアンスクワット', 'compound'], ['グルートブリッジ', 'iso'], ['ヒップアブダクション', 'iso']],
    calves: [['レッグプレスカーフレイズ', 'iso'], ['ドンキーカーフレイズ', 'iso']],
  };

  // 部位ごとに選べる種目（標準＋差し替え候補）
  function exerciseOptions(muscle) {
    return EXERCISES[muscle].concat(ALT_EXERCISES[muscle] || []).map(([name, kind]) => ({ name, kind }));
  }

  // 種目の差し替えを反映する。swaps は { 'セッション番号|元の種目名': 新しい種目名 }
  function applyExerciseSwaps(menus, swaps, goal) {
    if (!swaps) return menus;
    return menus.map((m, i) => ({
      ...m,
      items: m.items.map((it) => {
        const to = swaps[`${i}|${it.name}`];
        if (!to) return it;
        const opt = exerciseOptions(it.muscle).find((o) => o.name === to);
        const kind = opt ? opt.kind : it.kind;
        return { ...it, name: to, original: it.name, kind, reps: REPS[goal || 'hypertrophy'][kind] };
      }),
    }));
  }

  const REPS = {
    hypertrophy: { main: '6〜10', compound: '8〜12', iso: '10〜15' },
    strength: { main: '3〜5', compound: '6〜10', iso: '10〜12' },
    health: { main: '8〜12', compound: '10〜12', iso: '12〜15' },
  };

  // セッションごとの種目メニューを作る
  function buildMenus(plan, goal) {
    const seen = {};
    return plan.sessions.map((s, i) => {
      const sets = plan.sets[i];
      const items = [];
      for (const m of MUSCLE_ORDER) {
        const n = sets[m];
        if (!n) continue;
        const v = seen[m] = (seen[m] === undefined ? 0 : seen[m] + 1);
        const lib = EXERCISES[m];
        const parts = n <= 4 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
        parts.forEach((cnt, k) => {
          const [name, kind] = lib[(v + k) % lib.length];
          items.push({ name, muscle: m, sets: cnt, reps: REPS[goal || 'hypertrophy'][kind], kind });
        });
      }
      // 主要リフト→複合→単関節の順に並べる
      const order = { main: 0, compound: 1, iso: 2 };
      items.sort((x, y) => order[x.kind] - order[y.kind]);
      return { label: s.label, color: s.color, muscles: s.muscles, items, minutes: plan.minutes[i] };
    });
  }

  // 1回の時間に収まるように、セット数の多い部位から1セットずつ減らす（小筋群を先に、各部位2セットまで）
  function fitToTime(plan, sessionMin) {
    const limit = SESSION_MIN[sessionMin] || 60;
    const cap = Math.floor(limit / SET_MINUTES);
    const sets = plan.sets.map((s) => ({ ...s }));
    const trimmed = {};
    sets.forEach((s) => {
      let total = sum(s);
      while (total > cap) {
        const ms = Object.keys(s).filter((m) => s[m] > 2);
        if (!ms.length) break;
        ms.sort((x, y) => (s[y] - s[x]) || ((MUSCLES[x].size === 'small' ? 0 : 1) - (MUSCLES[y].size === 'small' ? 0 : 1)));
        s[ms[0]]--; total--;
        trimmed[ms[0]] = (trimmed[ms[0]] || 0) + 1;
      }
    });
    const minutes = sets.map((s) => sum(s) * SET_MINUTES);
    // 部位ごと最低2セットまで減らしても収まらないとき（全身法の45分など）は、そのことを返す
    const over = Math.max(...minutes) > limit;
    return { ...plan, sets, minutes, trimmed, over, limit, minMinutes: Math.max(...minutes) };
  }

  const api = {
    MUSCLES, MUSCLE_ORDER, TEMPLATES, WEEKDAYS, DEFAULT_WEEKDAYS, LEVEL_NAME, GOAL_NAME, LIFT_STD, PRIORITY_MAP,
    epley1RM, liftLevel, judgeExperience, weeklyTargets, scoreTemplate, recommend, buildMenus, fitToTime, exerciseOptions, applyExerciseSwaps, resolveSessions, distribute,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitLogic = api;
})(typeof window !== 'undefined' ? window : this);
