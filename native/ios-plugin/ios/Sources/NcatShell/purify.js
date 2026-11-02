// purify.js — NcatShell 净化脚本（审查修订版）。
// 由原生插件以 WKUserScript(atDocumentStart, forMainFrameOnly: false) 注入，
// 主帧与每个子帧（播放器 iframe）都会执行一份。
// 设计原则：全程 try/catch、幂等、不碰 window.Capacitor、不覆写 fetch/XHR，
// 净化失败必须降级为「不净化但能播」，绝不让脚本异常拖垮页面；
// 一切隐藏动作都可恢复，绝不永久废掉任何元素（审查 Major 1）。
(function () {
  try {
    if (window.__ncatCore) return;
    window.__ncatCore = true;

    var host = location.hostname || '';
    // 本地引导页（Capacitor 本地服务）不处理。
    if (host === 'localhost' || host === '') return;

    var IS_MAIN = window.top === window;
    var RULES_URL = 'https://raw.githubusercontent.com/cyber-812/ncat-ios/main/rules.json';
    var DEFAULT_RULES = {
      hideSelectors: ['a[href*="dl.ncat1.app"]', 'a[href*="dl.ncat"]', '.download-app', '.app-download', '#downloadApp'],
      blockHosts: ['dl.ncat1.app', 'dl.ncat33.com'],
      skipTexts: ['跳过广告', '跳过', 'Skip Ad', 'Skip']
    };
    // 远程/缓存规则与默认规则「合并」而非整体替换：远程少给某个字段时，
    // 对应能力回落到默认值，绝不静默失效（审查 Minor）。
    var rules = DEFAULT_RULES;
    try {
      var cached = localStorage.getItem('ncat-rules');
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed) rules = Object.assign({}, DEFAULT_RULES, parsed);
      }
    } catch (e) {}

    function applyCss(r) {
      try {
        if (!r.hideSelectors || !r.hideSelectors.length) return;
        var old = document.getElementById('ncat-hide-css');
        if (old) old.remove();
        var st = document.createElement('style');
        st.id = 'ncat-hide-css';
        // 每个选择器单独成一条规则：某条在 WebKit 里不合法时不连累其余（审查 Minor）。
        st.textContent = r.hideSelectors.map(function (s) {
          return s + '{display:none!important}';
        }).join('');
        (document.head || document.documentElement).appendChild(st);
      } catch (e) {}
    }
    applyCss(rules);
    document.addEventListener('DOMContentLoaded', function () {
      applyCss(rules);
      // 远程规则拉取只在主帧做一次，避免每帧每次导航都发请求（审查 Minor）。
      if (!IS_MAIN) return;
      try {
        fetch(RULES_URL, { cache: 'no-store' }).then(function (resp) { return resp.json(); }).then(function (j) {
          if (j && typeof j === 'object') {
            rules = Object.assign({}, DEFAULT_RULES, j);
            try { localStorage.setItem('ncat-rules', JSON.stringify(j)); } catch (e) {}
            applyCss(rules);
          }
        }).catch(function () {});
      } catch (e) {}
    });

    // ---- 外跳拦截：只拦明确的黑名单域名（官方 APP 下载站等），其余放行 ----
    function hostBlocked(h) {
      if (!h) return false;
      return (rules.blockHosts || []).some(function (b) {
        return h === b || h.slice(-(b.length + 1)) === '.' + b;
      });
    }
    var origOpen = window.open;
    window.open = function (url) {
      try {
        if (url) {
          var u = new URL(String(url), location.href);
          if (hostBlocked(u.hostname)) return null;
        }
      } catch (e) {}
      return origOpen ? origOpen.apply(window, arguments) : null;
    };
    document.addEventListener('click', function (ev) {
      try {
        var t = ev.target;
        var a = t && t.closest ? t.closest('a') : null;
        if (a && a.href) {
          var u = new URL(a.href);
          if (hostBlocked(u.hostname)) {
            ev.preventDefault();
            ev.stopPropagation();
          }
        }
      } catch (e) {}
    }, true);

    // ---- 视频相关助手 ----
    function videos() {
      return Array.prototype.slice.call(document.querySelectorAll('video'));
    }
    function mainVideo() {
      var vs = videos();
      if (!vs.length) return null;
      var best = null, bestArea = -1;
      vs.forEach(function (v) {
        var r = v.getBoundingClientRect();
        var a = r.width * r.height;
        if (a > bestArea) { bestArea = a; best = v; }
      });
      return best;
    }
    function isOverlayEl(v) {
      // 只有悬浮层（自身或近层祖先 fixed/absolute）才可能是盖屏广告，
      // 正常排版里的视频（短剧、正片预览）一律不碰（审查 Major 1）。
      var el = v;
      for (var i = 0; i < 3 && el; i++) {
        var pos = window.getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'absolute') return true;
        el = el.parentElement;
      }
      return false;
    }

    // ---- 悬浮广告视频守望（可恢复版）----
    // 命中：非主视频 + 悬浮层 + 正在播 + 时长 <=90s → 暂停并隐藏，记下当时的 src。
    // 恢复：被标记的元素成了主视频、或 src 换了（播放器复用元素播正片）→ 立刻还原。
    setInterval(function () {
      try {
        var vs = videos();
        if (!vs.length) return;
        var main = mainVideo();
        vs.forEach(function (v) {
          if (v.dataset.ncatAd === '1') {
            var srcNow = v.currentSrc || v.src || '';
            if (v === main || (srcNow && srcNow !== v.dataset.ncatAdSrc)) {
              delete v.dataset.ncatAd;
              delete v.dataset.ncatAdSrc;
              v.style.removeProperty('display');
            }
            return;
          }
          if (v === main) return;
          if (!v.paused && v.duration > 0 && v.duration <= 90 && isOverlayEl(v)) {
            v.dataset.ncatAd = '1';
            v.dataset.ncatAdSrc = v.currentSrc || v.src || '';
            try { v.pause(); } catch (e) {}
            v.style.setProperty('display', 'none', 'important');
          }
        });
      } catch (e) {}
    }, 800);

    // ---- 「跳过广告」按钮自动点 ----
    // 按词表优先级逐词找；只点最内层元素（父元素包着同文案子元素时跳过父），
    // 避免一次点两下把控件点回去（审查 Minor）。
    var clickedSkip = new WeakSet();
    setInterval(function () {
      try {
        if (!videos().length) return;
        var texts = rules.skipTexts || [];
        if (!texts.length) return;
        var els = document.querySelectorAll('button, a, div, span');
        for (var ti = 0; ti < texts.length; ti++) {
          var want = texts[ti];
          var hit = null;
          for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (clickedSkip.has(el)) continue;
            var t = (el.textContent || '').trim();
            if (t !== want) continue;
            var hasInnerSame = false;
            var kids = el.children;
            for (var k = 0; k < kids.length; k++) {
              if ((kids[k].textContent || '').trim() === want) { hasInnerSame = true; break; }
            }
            if (hasInnerSame) continue;
            var r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || r.width > 160 || r.height > 60) continue;
            hit = el;
            break;
          }
          if (hit) {
            clickedSkip.add(hit);
            hit.click();
            break;
          }
        }
      } catch (e) {}
    }, 800);

    // ---- 续播兜底（仅主帧、仅播放页）：本地记进度，下次打开同一集自动定位 ----
    var isPlayPage = location.pathname.indexOf('/play/') >= 0;
    if (IS_MAIN && isPlayPage) {
      setInterval(function () {
        try {
          var v = mainVideo();
          if (!v || !v.duration || v.currentTime <= 15) return;
          var map = {};
          try { map = JSON.parse(localStorage.getItem('ncat-prog') || '{}'); } catch (e) {}
          map[location.pathname] = { t: v.currentTime, ts: Date.now() };
          // 清理：30 天前的丢弃，总量上限 100 条（审查 Minor）。
          var cutoff = Date.now() - 30 * 24 * 3600 * 1000;
          var keys = Object.keys(map);
          keys.forEach(function (key) {
            if (!map[key].ts || map[key].ts < cutoff) delete map[key];
          });
          keys = Object.keys(map);
          if (keys.length > 100) {
            keys.sort(function (a, b) { return (map[a].ts || 0) - (map[b].ts || 0); });
            keys.slice(0, keys.length - 100).forEach(function (key) { delete map[key]; });
          }
          localStorage.setItem('ncat-prog', JSON.stringify(map));
        } catch (e) {}
      }, 5000);

      var resumed = false;
      window.addEventListener('loadedmetadata', function (ev) {
        try {
          if (resumed) return;
          var v = ev.target;
          if (!v || v.tagName !== 'VIDEO') return;
          var map = JSON.parse(localStorage.getItem('ncat-prog') || '{}');
          var ent = map[location.pathname];
          if (ent && ent.t > 15 && v.duration && ent.t < v.duration - 20) {
            v.currentTime = ent.t;
            resumed = true;
          }
        } catch (e) {}
      }, true);
    }

    // ---- 白屏自愈（仅主帧！子帧被内容规则掐空是预期行为，
    //      在子帧里重载/弹恢复条会形成死循环 —— 审查 Major 2）----
    if (IS_MAIN) {
      window.addEventListener('load', function () {
        setTimeout(function () {
          try {
            var text = ((document.body && document.body.innerText) || '').trim();
            // 只认 <video> 是媒体内容；iframe（可能是广告框）不算（审查 Major 2）。
            var hasMedia = !!document.querySelector('video');
            if (text.length >= 30 || hasMedia) {
              sessionStorage.removeItem('ncat-heal');
              return;
            }
            var n = parseInt(sessionStorage.getItem('ncat-heal') || '0', 10);
            if (n < 1) {
              sessionStorage.setItem('ncat-heal', String(n + 1));
              location.reload();
            } else {
              showHealBar();
            }
          } catch (e) {}
        }, 6000);
      });
    }
    function showHealBar() {
      try {
        if (document.getElementById('ncat-heal')) return;
        var bar = document.createElement('div');
        bar.id = 'ncat-heal';
        bar.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(20,20,26,.92);color:#fff;border-radius:12px;padding:10px 12px;font-size:13px;display:flex;gap:8px;align-items:center;box-shadow:0 2px 12px rgba(0,0,0,.45)';
        var label = document.createElement('span');
        label.textContent = '页面空白';
        bar.appendChild(label);
        [['刷新', function () { location.reload(); }],
         ['换域名', function () { location.href = 'https://localhost/index.html'; }]].forEach(function (b) {
          var btn = document.createElement('button');
          btn.textContent = b[0];
          btn.style.cssText = 'border:0;border-radius:8px;background:#d81e26;color:#fff;padding:6px 12px;font-size:13px';
          btn.addEventListener('click', function (ev) { ev.preventDefault(); b[1](); });
          bar.appendChild(btn);
        });
        document.body.appendChild(bar);
      } catch (e) {}
    }

    // ---- 注入式底部导航条（仅主帧）----
    function buildNavBar() {
      try {
        if (!IS_MAIN) return;
        if (document.getElementById('ncat-nav')) return;
        var bar = document.createElement('div');
        bar.id = 'ncat-nav';
        bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483646;display:flex;gap:2px;background:rgba(20,20,26,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border-radius:999px;padding:4px;box-shadow:0 2px 12px rgba(0,0,0,.4);transition:opacity .4s';
        var btns = [
          ['‹', function () { history.back(); }],
          ['›', function () { history.forward(); }],
          ['⟳', function () { location.reload(); }],
          ['⌂', function () { location.href = 'https://localhost/index.html'; }]
        ];
        btns.forEach(function (b) {
          var btn = document.createElement('button');
          btn.textContent = b[0];
          btn.style.cssText = 'width:40px;height:32px;border:0;border-radius:999px;background:transparent;color:#fff;font-size:17px;line-height:1;padding:0';
          btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            b[1]();
          });
          bar.appendChild(btn);
        });
        document.body.appendChild(bar);
        document.addEventListener('fullscreenchange', function () {
          bar.style.display = document.fullscreenElement ? 'none' : 'flex';
        });
        // 空闲自隐：普通页变淡；播放页全隐且不拦截触摸，触摸即恢复（审查 Minor）。
        var idleTimer = null;
        function armIdle() {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(function () {
            if (isPlayPage) {
              bar.style.opacity = '0';
              bar.style.pointerEvents = 'none';
            } else {
              bar.style.opacity = '0.45';
            }
          }, 3500);
        }
        document.addEventListener('touchstart', function () {
          bar.style.opacity = '1';
          bar.style.pointerEvents = 'auto';
          armIdle();
        }, { passive: true });
        armIdle();
      } catch (e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildNavBar);
    } else {
      buildNavBar();
    }
  } catch (e) {
    // 顶层兜底：净化脚本自身绝不许抛错影响页面
  }
})();
