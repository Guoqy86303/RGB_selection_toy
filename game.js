"use strict";

(function () {
  const ROUNDS = 5;
  const STORAGE_KEY = "rgb-fader-toy-v1";
  const HIDDEN = "–";
  const DIFF = {
    casual: { label: "休闲", seconds: null, showValues: true },
    normal: { label: "标准", seconds: 30, showValues: false },
    hard: { label: "挑战", seconds: 15, showValues: false },
  };

  const state = {
    screen: "start",
    difficulty: "normal",
    round: 0,
    scores: [],
    deltas: [],
    target: [0, 0, 0],
    current: [128, 128, 128],
    phase: "idle",
    timer: null,
    deadline: null,
    durationMs: 0,
    remainingMs: null,
    playAccum: 0,
    playMark: null,
    paused: false,
    dragging: null,
    muted: false,
    lastReason: "",
    best: { casual: 0, normal: 0, hard: 0 },
    copyTimer: 0,
  };

  let audioCtx = null;
  let exitTimer = 0;
  let scoreAnim = 0;
  let burstToken = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function cssRgb(rgb) {
    return "rgb(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ")";
  }

  function hex(rgb) {
    return "#" + rgb.map(function (n) {
      return n.toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }

  function formatRgb(rgb) {
    return "R " + rgb[0] + "   G " + rgb[1] + "   B " + rgb[2];
  }

  function randomChannel() {
    return Math.floor(Math.random() * 256);
  }

  function randomTarget(difficulty) {
    if (difficulty === "hard" && Math.random() < 0.65) {
      const base = 25 + Math.random() * 190;
      const spread = 16 + Math.random() * 36;
      return [0, 1, 2].map(function () {
        return clamp(Math.round(base + (Math.random() - 0.5) * spread), 0, 255);
      });
    }
    return [randomChannel(), randomChannel(), randomChannel()];
  }

  function randomStart(target) {
    let best = [128, 128, 128];
    for (let i = 0; i < 24; i += 1) {
      const guess = [randomChannel(), randomChannel(), randomChannel()];
      if (ColorMath.deltaE(guess, target) >= 18) return guess;
      best = guess;
    }
    best = best.slice();
    best[0] = (target[0] + 128) % 256;
    return best;
  }

  function valueFromPointer(clientY, rect, knobH) {
    const travel = rect.height - knobH;
    if (!(travel > 0)) return 0;
    const y = clientY - rect.top - knobH / 2;
    const t = 1 - clamp(y / travel, 0, 1);
    return clamp(Math.round(t * 255), 0, 255);
  }

  function knobHeight(track) {
    const knob = track.querySelector(".knob");
    const height = knob ? knob.offsetHeight : 0;
    return height || 36;
  }

  function captionFor(score) {
    if (score >= 100) return "完美复刻";
    if (score >= 96) return "几乎分不出来";
    if (score >= 88) return "非常接近";
    if (score >= 75) return "挺接近";
    if (score >= 60) return "大方向对了";
    if (score >= 40) return "还能再准一点";
    return "差得比较远";
  }

  function rankTitle(total) {
    if (total >= 475) return "调色宗师";
    if (total >= 440) return "色彩达人";
    if (total >= 375) return "眼力很好";
    if (total >= 300) return "渐入佳境";
    return "初识颜色";
  }

  function rankNote(total) {
    if (total >= 475) return "这眼睛可以去对色卡了。";
    if (total >= 440) return "大部分轮次都贴得很近。";
    if (total >= 375) return "颜色关系抓得很稳。";
    if (total >= 300) return "再抠一抠明暗，分数会明显上去。";
    return "先看明暗，再调色相。多玩几局就会准很多。";
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes <= 0) return seconds + " 秒";
    return minutes + " 分 " + seconds + " 秒";
  }

  function readStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function writeStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        muted: state.muted,
        best: state.best,
      }));
    } catch (err) {
      /* private mode */
    }
  }

  function loadSave() {
    const data = readStorage();
    state.muted = Boolean(data.muted);
    const best = data.best || {};
    Object.keys(DIFF).forEach(function (key) {
      const n = Number(best[key]);
      state.best[key] = Number.isFinite(n) ? clamp(Math.round(n), 0, ROUNDS * 100) : 0;
    });
  }

  function showScreen(name) {
    state.screen = name;
    document.body.dataset.screen = name;
    document.querySelectorAll(".screen").forEach(function (el) {
      el.classList.toggle("active", el.dataset.screen === name);
    });
    if (name !== "play") document.title = "调色推杆";
  }

  function renderMute() {
    const btn = $("mute-btn");
    btn.textContent = state.muted ? "音效关" : "音效开";
    btn.setAttribute("aria-label", state.muted ? "打开音效" : "关闭音效");
    btn.setAttribute("aria-pressed", state.muted ? "true" : "false");
  }

  function renderDifficulties() {
    document.querySelectorAll(".diff").forEach(function (btn) {
      const on = btn.dataset.difficulty === state.difficulty;
      btn.setAttribute("aria-checked", on ? "true" : "false");
      btn.classList.toggle("is-selected", on);
    });
  }

  function renderBest() {
    const wrap = $("best-list");
    wrap.replaceChildren();
    ["casual", "normal", "hard"].forEach(function (key) {
      const item = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = DIFF[key].label;
      const val = document.createElement("strong");
      const best = state.best[key] || 0;
      val.textContent = best > 0 ? String(best) : "—";
      item.append(name, val);
      wrap.appendChild(item);
    });
  }

  function renderDots() {
    const wrap = $("round-dots");
    wrap.replaceChildren();
    for (let i = 0; i < ROUNDS; i += 1) {
      const dot = document.createElement("span");
      if (i < state.scores.length) dot.className = "done";
      else if (i === state.round - 1) dot.className = "current";
      wrap.appendChild(dot);
    }
  }

  function renderMixer() {
    const showNum = state.phase === "reveal" || DIFF[state.difficulty].showValues;
    $("your-swatch").style.setProperty("--c", cssRgb(state.current));
    document.querySelectorAll(".fader").forEach(function (fader) {
      const index = Number(fader.dataset.index);
      const value = state.current[index];
      fader.style.setProperty("--v", String(value / 255));
      const track = fader.querySelector(".track");
      track.setAttribute("aria-valuenow", String(value));
      track.setAttribute("aria-valuetext", showNum ? String(value) : "已隐藏");
      track.setAttribute("aria-disabled", state.phase === "play" ? "false" : "true");
      fader.querySelector(".fader-value").textContent = showNum ? String(value) : HIDDEN;
      fader.classList.toggle("is-active", state.dragging === index);
    });
    if (state.phase === "play" && DIFF[state.difficulty].showValues) {
      $("your-meta").textContent = formatRgb(state.current);
    }
  }

  function renderMetas() {
    const showYours = state.phase === "reveal" || DIFF[state.difficulty].showValues;
    $("target-meta").textContent = state.phase === "reveal"
      ? hex(state.target) + "\n" + formatRgb(state.target)
      : "锁定后公布";
    $("your-meta").textContent = state.phase === "reveal"
      ? hex(state.current) + "\n" + formatRgb(state.current)
      : (showYours ? formatRgb(state.current) : "凭眼睛判断");
  }

  function renderDiff() {
    const line = $("diff-line");
    line.replaceChildren();
    if (state.phase !== "reveal") {
      line.textContent = "往上是加这个颜色，往下是减。";
      return;
    }
    const lead = document.createElement("span");
    lead.className = "prefix";
    lead.textContent = "你比题目";
    line.appendChild(lead);
    ["红", "绿", "蓝"].forEach(function (name, index) {
      const delta = state.current[index] - state.target[index];
      const chip = document.createElement("span");
      const distance = Math.abs(delta);
      chip.className = "chip " + (distance <= 8 ? "ok" : distance <= 25 ? "mid" : "bad");
      chip.textContent = name + " " + (delta > 0 ? "+" + delta : String(delta));
      line.appendChild(chip);
    });
  }

  function renderAction() {
    const btn = $("action-btn");
    if (state.phase === "play") btn.textContent = "锁定答案";
    else if (state.scores.length >= ROUNDS) btn.textContent = "看总成绩";
    else btn.textContent = "下一轮";
  }

  function renderKeyhint() {
    if (state.phase === "play") {
      $("keyhint").textContent = "1 2 3 选推杆 · 方向键微调 · Shift 加速 · 滚轮可拨 · Enter 锁定";
    } else if (state.scores.length >= ROUNDS) {
      $("keyhint").textContent = "Enter 看总成绩";
    } else {
      $("keyhint").textContent = "Enter 下一轮";
    }
  }

  function renderScore() {
    const num = $("score-num");
    if (state.phase !== "reveal") {
      num.textContent = "0";
      num.removeAttribute("data-score");
      return;
    }
    const score = state.scores[state.scores.length - 1];
    const de = state.deltas[state.deltas.length - 1];
    const cap = captionFor(score);
    $("score-caption").textContent = state.lastReason ? state.lastReason + " · " + cap : cap;
    $("score-delta").textContent = "色差 " + de.toFixed(1) + "，越小越接近";
    num.dataset.score = String(score);
  }

  function renderRound() {
    const screen = $("screen-play");
    screen.classList.toggle("is-reveal", state.phase === "reveal");
    screen.classList.toggle("is-casual", state.difficulty === "casual");
    $("play-round").textContent = "第 " + state.round + " / " + ROUNDS + " 轮";
    document.title = "调色推杆 · 第 " + state.round + " 轮";
    const total = state.scores.reduce(function (sum, score) { return sum + score; }, 0);
    $("play-total").textContent = "累计 " + total;
    $("target-swatch").style.setProperty("--c", cssRgb(state.target));
    renderDots();
    renderMixer();
    renderMetas();
    renderDiff();
    renderAction();
    renderKeyhint();
    renderScore();
  }

  function setChannel(index, value) {
    if (state.phase !== "play") return;
    const next = clamp(Math.round(value), 0, 255);
    if (next === state.current[index]) return;
    state.current[index] = next;
    renderMixer();
  }

  function audio(fromGesture) {
    try {
      if (!audioCtx) {
        if (!fromGesture) return null;
        audioCtx = new AudioContext();
      }
      if (audioCtx.state === "suspended") {
        if (!fromGesture) return null;
        audioCtx.resume();
      }
      return audioCtx;
    } catch (err) {
      return null;
    }
  }

  function tone(ctx, freq, time, dur, gain) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function playTick() {
    if (state.muted) return;
    const ctx = audio(true);
    if (!ctx) return;
    tone(ctx, 740, ctx.currentTime, 0.03, 0.02);
  }

  function playScoreSound(score, fromGesture) {
    if (state.muted) return;
    const ctx = audio(fromGesture);
    if (!ctx) return;
    const base = score >= 90 ? 523.25 : score >= 75 ? 392 : 262;
    const notes = score >= 90 ? [base, base * 1.25, base * 1.5] : score >= 60 ? [base, base * 1.25] : [base];
    const now = ctx.currentTime;
    notes.forEach(function (freq, index) {
      tone(ctx, freq, now + index * 0.09, 0.18, 0.04);
    });
  }

  function clearBurst() {
    burstToken += 1;
    const canvas = $("confetti");
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function burst(colors) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = $("confetti");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const token = ++burstToken;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const parts = [];
    for (let i = 0; i < 72; i += 1) {
      parts.push({
        x: window.innerWidth / 2,
        y: window.innerHeight * 0.4,
        vx: (Math.random() - 0.5) * 13,
        vy: Math.random() * -11 - 3,
        s: 4 + Math.random() * 4,
        c: colors[i % colors.length],
        a: 1,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.24,
      });
    }
    let frame = 0;
    function step() {
      if (token !== burstToken) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parts.forEach(function (part) {
        part.vy += 0.28;
        part.x += part.vx;
        part.y += part.vy;
        part.r += part.vr;
        part.a *= 0.985;
        ctx.save();
        ctx.translate(part.x, part.y);
        ctx.rotate(part.r);
        ctx.globalAlpha = Math.max(0, part.a);
        ctx.fillStyle = part.c;
        ctx.fillRect(-part.s / 2, -part.s / 2, part.s, part.s * 0.62);
        ctx.restore();
      });
      frame += 1;
      if (frame < 86) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    requestAnimationFrame(step);
  }

  function animateScore(score) {
    const token = ++scoreAnim;
    const el = $("score-num");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      el.textContent = String(score);
      return;
    }
    const started = performance.now();
    function step(now) {
      if (token !== scoreAnim) return;
      const p = Math.min(1, (now - started) / 420);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(score * eased));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function updateTimerDisplay() {
    if (state.deadline == null || state.phase !== "play") return;
    const left = Math.max(0, state.deadline - performance.now());
    const sec = Math.ceil(left / 1000);
    $("timer-text").textContent = String(sec);
    const ratio = state.durationMs ? left / state.durationMs : 0;
    $("timer-bar").style.transform = "scaleX(" + ratio + ")";
    $("timer-wrap").classList.toggle("is-urgent", sec <= 5 && left > 0);
    if (left <= 0) lockAnswer("时间到");
  }

  function beginCountdown() {
    clearInterval(state.timer);
    state.timer = null;
    state.deadline = null;
    state.remainingMs = null;
    $("timer-wrap").classList.remove("is-urgent");
    const seconds = DIFF[state.difficulty].seconds;
    if (seconds == null) return;
    state.durationMs = seconds * 1000;
    state.deadline = performance.now() + state.durationMs;
    updateTimerDisplay();
    state.timer = setInterval(updateTimerDisplay, 100);
  }

  function cleanupRound() {
    clearInterval(state.timer);
    state.timer = null;
    state.deadline = null;
    state.remainingMs = null;
    state.playMark = null;
    state.paused = false;
    state.dragging = null;
    state.phase = "idle";
    document.body.classList.remove("is-dragging");
    clearTimeout(exitTimer);
  }

  function lockAnswer(reason) {
    if (state.screen !== "play" || state.phase !== "play") return;
    if (state.playMark != null) {
      state.playAccum += performance.now() - state.playMark;
      state.playMark = null;
    }
    clearInterval(state.timer);
    state.timer = null;
    state.deadline = null;
    state.phase = "reveal";
    state.dragging = null;
    document.body.classList.remove("is-dragging");
    state.lastReason = reason || "";
    const de = ColorMath.deltaE(state.current, state.target);
    const score = ColorMath.scoreFromDeltaE(de);
    state.scores.push(score);
    state.deltas.push(de);
    renderRound();
    const num = $("score-num");
    num.textContent = "0";
    num.classList.remove("pop");
    void num.offsetWidth;
    num.classList.add("pop");
    animateScore(score);
    playScoreSound(score, !reason);
    $("live").textContent = "第" + state.round + "轮，" + score + "分，" + captionFor(score);
  }

  function startRound() {
    state.round += 1;
    state.phase = "play";
    state.lastReason = "";
    state.target = randomTarget(state.difficulty);
    state.current = randomStart(state.target);
    state.paused = false;
    state.dragging = null;
    showScreen("play");
    renderRound();
    beginCountdown();
    state.playMark = performance.now();
    const exitBtn = $("exit-btn");
    exitBtn.dataset.armed = "0";
    exitBtn.textContent = "退出";
  }

  function startGame() {
    cleanupRound();
    clearBurst();
    state.round = 0;
    state.scores = [];
    state.deltas = [];
    state.playAccum = 0;
    state.lastReason = "";
    startRound();
  }

  function resultText() {
    const total = state.scores.reduce(function (sum, score) { return sum + score; }, 0);
    const rounds = state.scores.map(function (score, index) {
      return (index + 1) + ":" + score;
    }).join(" ");
    return "调色推杆 " + DIFF[state.difficulty].label + " " + total + "/" + (ROUNDS * 100) + " " + rankTitle(total) + " （" + rounds + "）";
  }

  function renderFinal() {
    const total = state.scores.reduce(function (sum, score) { return sum + score; }, 0);
    const prev = state.best[state.difficulty] || 0;
    const isNew = total > prev;
    if (isNew) {
      state.best[state.difficulty] = total;
      writeStorage();
    }
    $("final-mode").textContent = DIFF[state.difficulty].label + " · " + ROUNDS + " 轮";
    $("final-rank").textContent = rankTitle(total);
    $("final-score").textContent = String(total);
    $("final-max").textContent = "/ " + (ROUNDS * 100);
    $("final-record").classList.toggle("show", isNew);
    $("final-note").textContent = rankNote(total);
    $("final-time").textContent = "调色用时 " + formatDuration(state.playAccum);
    $("final-best").textContent = "本难度最佳 " + Math.max(prev, total);
    $("copy-status").textContent = "";
    const list = $("final-list");
    list.replaceChildren();
    state.scores.forEach(function (score, index) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = "第 " + (index + 1) + " 轮";
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = score + "%";
      bar.appendChild(fill);
      const num = document.createElement("span");
      num.className = "num" + (score >= 90 ? " great" : "");
      num.textContent = String(score);
      li.append(label, bar, num);
      list.appendChild(li);
    });
    showScreen("final");
    if (total >= 440) burst(["#f0c14d", "#d4653a", "#241f1c", "#1fbe6a"]);
  }

  function onAction() {
    if (state.phase === "play") {
      lockAnswer();
      return;
    }
    if (state.scores.length >= ROUNDS) renderFinal();
    else startRound();
  }

  function goHome() {
    cleanupRound();
    clearBurst();
    state.playAccum = 0;
    const exitBtn = $("exit-btn");
    exitBtn.dataset.armed = "0";
    exitBtn.textContent = "退出";
    renderBest();
    renderMute();
    renderDifficulties();
    showScreen("start");
  }

  function armExit() {
    const btn = $("exit-btn");
    if (btn.dataset.armed === "1") {
      goHome();
      return;
    }
    btn.dataset.armed = "1";
    btn.textContent = "再按退出";
    clearTimeout(exitTimer);
    exitTimer = setTimeout(function () {
      btn.dataset.armed = "0";
      btn.textContent = "退出";
    }, 1800);
  }

  function copyResult() {
    const text = resultText();
    const status = $("copy-status");
    function done(ok) {
      status.textContent = ok ? "已复制" : text;
      clearTimeout(state.copyTimer);
      state.copyTimer = setTimeout(function () {
        if (status.textContent === "已复制") status.textContent = "";
      }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  function onFaderKey(event, index) {
    if (state.phase !== "play") return;
    const step = event.shiftKey ? 10 : 1;
    const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 16, PageDown: -16 };
    if (event.key === "Home") {
      setChannel(index, 0);
      event.preventDefault();
      return;
    }
    if (event.key === "End") {
      setChannel(index, 255);
      event.preventDefault();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(map, event.key)) {
      setChannel(index, state.current[index] + map[event.key]);
      event.preventDefault();
    }
  }

  function onFaderWheel(event, index) {
    if (state.screen !== "play" || state.phase !== "play") return;
    event.preventDefault();
    let step = 1;
    if (event.shiftKey) step = 8;
    else if (Math.abs(event.deltaY) >= 80) step = 3;
    const dir = event.deltaY < 0 ? 1 : -1;
    setChannel(index, state.current[index] + dir * step);
  }

  function onGlobalKey(event) {
    if (event.key === "Escape") {
      if (state.screen === "play") armExit();
      else if (state.screen === "final") goHome();
      return;
    }
    if (state.screen === "play" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey &&
      (event.key === "1" || event.key === "2" || event.key === "3")) {
      const tracks = document.querySelectorAll(".fader .track");
      tracks[Number(event.key) - 1].focus();
      event.preventDefault();
      return;
    }
    if (event.target.closest && event.target.closest("button")) return;
    if (event.key !== "Enter" || event.repeat) return;
    if (state.screen === "start") startGame();
    else if (state.screen === "play") onAction();
    else if (state.screen === "final") startGame();
  }

  function onVisibility() {
    if (state.screen !== "play" || state.phase !== "play") return;
    if (document.hidden) {
      if (state.deadline != null) {
        state.remainingMs = Math.max(0, state.deadline - performance.now());
        state.deadline = null;
        clearInterval(state.timer);
        state.timer = null;
      }
      if (state.playMark != null) {
        state.playAccum += performance.now() - state.playMark;
        state.playMark = null;
      }
      state.paused = true;
      return;
    }
    if (!state.paused) return;
    state.paused = false;
    state.playMark = performance.now();
    if (DIFF[state.difficulty].seconds != null && state.remainingMs != null) {
      state.deadline = performance.now() + state.remainingMs;
      clearInterval(state.timer);
      state.timer = setInterval(updateTimerDisplay, 100);
    }
  }

  function bind() {
    $("start-btn").addEventListener("click", startGame);
    document.querySelectorAll(".diff").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.difficulty = btn.dataset.difficulty;
        renderDifficulties();
      });
    });
    $("action-btn").addEventListener("click", onAction);
    $("exit-btn").addEventListener("click", armExit);
    $("mute-btn").addEventListener("click", function () {
      state.muted = !state.muted;
      writeStorage();
      renderMute();
      if (!state.muted) playTick();
    });
    $("again-btn").addEventListener("click", startGame);
    $("home-btn").addEventListener("click", goHome);
    $("copy-btn").addEventListener("click", copyResult);
    document.querySelectorAll(".fader").forEach(function (fader) {
      const index = Number(fader.dataset.index);
      const track = fader.querySelector(".track");
      track.addEventListener("pointerdown", function (event) {
        if (state.phase !== "play") return;
        if (event.cancelable) event.preventDefault();
        try { track.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        state.dragging = index;
        document.body.classList.add("is-dragging");
        fader.classList.add("is-active");
        track.focus();
        playTick();
        setChannel(index, valueFromPointer(event.clientY, track.getBoundingClientRect(), knobHeight(track)));
      });
      track.addEventListener("pointermove", function (event) {
        if (state.dragging !== index || state.phase !== "play") return;
        setChannel(index, valueFromPointer(event.clientY, track.getBoundingClientRect(), knobHeight(track)));
      });
      function endDrag() {
        if (state.dragging === index) state.dragging = null;
        fader.classList.remove("is-active");
        if (state.dragging == null) document.body.classList.remove("is-dragging");
      }
      track.addEventListener("pointerup", endDrag);
      track.addEventListener("pointercancel", endDrag);
      track.addEventListener("lostpointercapture", endDrag);
      track.addEventListener("keydown", function (event) { onFaderKey(event, index); });
      track.addEventListener("wheel", function (event) { onFaderWheel(event, index); }, { passive: false });
    });
    document.addEventListener("keydown", onGlobalKey);
    document.addEventListener("visibilitychange", onVisibility);
  }

  function boot() {
    loadSave();
    bind();
    renderDifficulties();
    renderBest();
    renderMute();
    showScreen("start");
  }

  try {
    boot();
  } catch (err) {
    const note = document.createElement("p");
    note.className = "noscript";
    note.textContent = "游戏没有启动：" + err.message;
    document.body.prepend(note);
  }
})();
