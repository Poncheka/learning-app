// A shared story: who sent it, the whole story to play, and the waitlist. The page is the same for
// every story; the address says which story, and ?r= says who shared it.
(function () {
  var API = 'https://ctssexvgotcdbuvlkrou.supabase.co/functions/v1/site';
  var $ = function (id) { return document.getElementById(id); };
  var slug = (location.pathname.match(/^\/s\/([a-z0-9-]+)/) || [])[1] || '';
  var code = (new URLSearchParams(location.search).get('r') || '').toLowerCase();
  var story = null, at = 0, audio = new Audio(), wanted = false, finished = false, poll = null;
  // The same short sting of music the app plays after the opening and at the very end. While it
  // plays, stingNext is the chapter that comes after it (the chapter count when it closes the story).
  var STING = '/s/sting.mp3', stingNext = -1;
  var picked = [];

  // ---------- Showing the story ----------

  function paintArt(box, index) {
    var art = (window.PLINY_ART || [])[index || 0];
    if (!art || !box) return;
    box.style.background = art.bg;
    box.innerHTML = art.svg;
  }
  function seconds() { return story.chapters.reduce(function (sum, c) { return sum + c.seconds; }, 0); }
  function showSender(name) {
    $('sent').innerHTML = '';
    $('sent').append(name + ' sent you ');
    var em = document.createElement('em'); em.textContent = 'a story.'; $('sent').append(em);
  }
  // The sender's name, asked for in the page's head, usually arrives before the story itself.
  function senderShown() { document.documentElement.className = document.documentElement.className.replace(/\s*who-pending/g, ''); }
  if (window.PLINY_WHO) {
    window.PLINY_WHO.then(function (w) { if (w && w.name) showSender(w.name); }).catch(function () {}).then(senderShown);
    setTimeout(senderShown, 2500);
  }

  function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function show(id) { ['landing', 'player'].forEach(function (k) { $(k).hidden = k !== id; }); }
  function setTag(el) { if (story.tag) { el.textContent = story.tag; el.hidden = false; } }

  function fill() {
    document.title = story.title + '. A story from Pliny';
    if (story.sharer) {
      showSender(story.sharer);
      $('sent-by').textContent = 'Sent by ' + story.sharer;
      $('sent-by').hidden = false;
    }
    $('big-title').textContent = story.title + '.';
    $('title').textContent = story.title + '.';
    setTag($('tag')); setTag($('tag2'));
    $('minutes').textContent = story.minutes + ' min';
    paintArt($('cover'), story.art);
    paintArt($('thumb'), story.art);
    $('sources').innerHTML = '';
    $('src-box').hidden = !story.sources.length;
    story.sources.forEach(function (s) {
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Wikipedia: ' + s.title;
      li.append(a); $('sources').append(li);
    });
    var choices = [story.tag, 'Weird history', 'Space', 'Mythology', 'Unsolved mysteries'].filter(function (t, i, all) {
      return t && all.findIndex(function (o) { return o && o.toLowerCase() === t.toLowerCase(); }) === i;
    }).slice(0, 4);
    picked = story.tag ? [story.tag] : [];
    $('chips').innerHTML = '';
    choices.forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = label;
      b.setAttribute('aria-pressed', picked.indexOf(label) >= 0 ? 'true' : 'false');
      b.addEventListener('click', function () {
        var on = picked.indexOf(label) >= 0;
        picked = on ? picked.filter(function (p) { return p !== label; }) : picked.concat(label);
        b.setAttribute('aria-pressed', on ? 'false' : 'true');
      });
      $('chips').append(b);
    });
  }

  function missing() {
    document.body.innerHTML = '<main class="page missing"><a href="/" class="logo">pliny.</a><h1 class="serif">This story is not ready yet.</h1><p>Try the link again in a few minutes, or <a href="/">hear a sample on the home page</a>.</p></main>';
  }

  function load() {
    return fetch(API + '?story=' + encodeURIComponent(slug) + (code ? '&r=' + encodeURIComponent(code) : ''))
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); });
  }

  // ---------- Playing, chapter after chapter ----------

  function paint() {
    if (!story) return;
    var playing = !audio.paused && !audio.ended;
    // Pause shows while playing, and while a chapter the listener asked for is on its way.
    $('ic-pause').hidden = !(playing || wanted);
    $('ic-play').hidden = !$('ic-pause').hidden;
    $('play').setAttribute('aria-label', $('ic-pause').hidden ? 'Play' : 'Pause');
    var before = story.chapters.slice(0, at).reduce(function (s, c) { return s + c.seconds; }, 0);
    var done = finished ? seconds() : stingNext >= 0 ? story.chapters.slice(0, stingNext).reduce(function (s, c) { return s + c.seconds; }, 0) : before + (audio.currentTime || 0);
    var pct = Math.min(100, (done / Math.max(1, seconds())) * 100);
    if (!dragging) $('fill').style.width = pct + '%';
    $('bar').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('left').textContent = finished ? 'Finished' : clock(seconds() - done) + ' left';
    paintChapters();
  }

  // ---------- Chapters ----------

  var drawn = '';
  function paintChapters() {
    var list = story.chapters;
    $('chapter-count').textContent = 'Chapter ' + (at + 1) + ' of ' + list.length;
    $('chapter-now').textContent = list[at] ? list[at].title : '';
    // Redrawn only when something it shows has changed, not on every tick of the clock.
    var key = at + '|' + (wanted ? 1 : 0) + '|' + list.map(function (c) { return c.ready ? 1 : 0; }).join('');
    if (key === drawn) return;
    drawn = key;
    var ol = $('chapter-list');
    ol.innerHTML = '';
    list.forEach(function (c, i) {
      var li = document.createElement('li'), b = document.createElement('button');
      if (i === at) li.className = 'on';
      b.type = 'button';
      b.disabled = !c.ready;
      var n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
      var t = document.createElement('span'); t.className = 't'; t.textContent = c.title;
      var d = document.createElement('span'); d.className = 'd';
      d.textContent = i === at ? (wanted ? 'Playing' : 'Paused') : c.ready ? Math.max(1, Math.round(c.seconds / 60)) + ' min' : 'Coming';
      b.append(n, t, d);
      b.addEventListener('click', function () {
        if (!c.ready) return;
        finished = false; wanted = true;
        playChapter(i);
      });
      li.append(b); ol.append(li);
    });
  }
  function showChapters(open) {
    $('chapter-list').hidden = !open;
    $('chapters-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('chapters-toggle').addEventListener('click', function () { showChapters($('chapter-list').hidden); });
  // A tap anywhere outside the list folds it away again.
  document.addEventListener('click', function (e) {
    if (!$('chapter-list').hidden && !$('chapters').contains(e.target)) showChapters(false);
  });

  function playChapter(i) {
    stingNext = -1;
    var chapter = story.chapters[i];
    if (!chapter) return end();
    at = i;
    if (!chapter.ready || !chapter.url) return wait();
    $('waiting').hidden = true;
    audio.src = chapter.url;
    audio.play().catch(function () { wanted = false; paint(); });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: chapter.title, artist: 'Pliny', album: story.title });
    }
  }

  // The next chapter is still being finished. Ask again every 15 seconds and carry on when it is in.
  function wait() {
    $('waiting').hidden = false;
    paint();
    if (poll) return;
    poll = setInterval(function () {
      load().then(function (r) {
        if (!r.ok) return;
        story.chapters = r.d.chapters;
        if (story.chapters[at] && story.chapters[at].ready) {
          clearInterval(poll); poll = null;
          if (wanted) playChapter(at);
        }
      }).catch(function () {});
    }, 15000);
  }

  function end() {
    finished = true; wanted = false; paint();
    $('ended').hidden = false;
  }

  // ---------- Scrubbing ----------
  // Dragging along the bar moves through the whole story, across chapters. Only finished chapters
  // can be reached: a drag past them stops at the end of the last one ready.
  var seekTo = null, dragging = false;
  function seconds_at(fraction) {
    var total = seconds(), target = fraction * total, i = 0, before = 0;
    while (i < story.chapters.length - 1 && before + story.chapters[i].seconds <= target) { before += story.chapters[i].seconds; i++; }
    var last = -1;
    story.chapters.forEach(function (c, n) { if (c.ready) last = n; });
    if (last < 0) return null;
    // Keep within what has been made.
    var firstGap = story.chapters.findIndex(function (c) { return !c.ready; });
    if (firstGap >= 0 && i >= firstGap) { i = firstGap - 1; if (i < 0) return null; before = story.chapters.slice(0, i).reduce(function (s, c) { return s + c.seconds; }, 0); target = before + story.chapters[i].seconds - 1; }
    return { chapter: i, offset: Math.max(0, target - before) };
  }
  function fractionAt(x) {
    var r = $('bar').getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  }
  function preview(f) { $('fill').style.width = (f * 100) + '%'; }
  function commit(f) {
    var spot = seconds_at(f);
    dragging = false;
    if (!spot) return paint();
    finished = false; wanted = true;
    if (spot.chapter === at && audio.src && stingNext < 0) {
      audio.currentTime = spot.offset;
      audio.play().catch(function () {});
    } else {
      seekTo = spot.offset;
      playChapter(spot.chapter);
    }
    paint();
  }
  $('bar').addEventListener('pointerdown', function (e) {
    if (!story) return;
    dragging = true;
    $('bar').setPointerCapture(e.pointerId);
    preview(fractionAt(e.clientX));
  });
  $('bar').addEventListener('pointermove', function (e) { if (dragging) preview(fractionAt(e.clientX)); });
  $('bar').addEventListener('pointerup', function (e) { if (dragging) commit(fractionAt(e.clientX)); });
  $('bar').addEventListener('pointercancel', function () { dragging = false; paint(); });
  audio.addEventListener('loadedmetadata', function () {
    if (seekTo !== null) { audio.currentTime = Math.min(seekTo, Math.max(0, (audio.duration || seekTo + 1) - 1)); seekTo = null; }
  });

  audio.addEventListener('ended', function () {
    // After the sting, carry on to the chapter it introduces, or finish the story.
    if (stingNext >= 0) { var n = stingNext; stingNext = -1; return n >= story.chapters.length ? end() : playChapter(n); }
    // The sting plays between the opening and the next chapter, and after the last chapter.
    var last = at === story.chapters.length - 1;
    if ((at === 0 && story.chapters.length > 1) || last) {
      stingNext = at + 1;
      if (!last) at = at + 1;
      audio.src = STING;
      audio.play().catch(function () { var n = stingNext; stingNext = -1; n >= story.chapters.length ? end() : playChapter(n); });
      return paint();
    }
    playChapter(at + 1);
  });
  ['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach(function (e) { audio.addEventListener(e, paint); });
  audio.addEventListener('error', function () {
    // If the sting will not load, skip straight past it.
    if (stingNext >= 0) { var n = stingNext; stingNext = -1; return n >= story.chapters.length ? end() : playChapter(n); }
    // A link may have expired after hours on the page: fetch fresh ones and try the same chapter.
    load().then(function (r) { if (r.ok) { story.chapters = r.d.chapters; if (wanted) playChapter(at); } });
  });

  $('start').addEventListener('click', function () {
    show('player');
    $('player').scrollTop = 0;
    wanted = true;
    playChapter(0);
  });
  $('play').addEventListener('click', function () {
    if (finished) { finished = false; wanted = true; return playChapter(0); }
    if (!audio.paused) { wanted = false; audio.pause(); }
    else { wanted = true; if (audio.src) audio.play().catch(function () {}); else playChapter(at); }
    paint();
  });
  $('close-ended').addEventListener('click', function () { $('ended').hidden = true; });

  // ---------- The waitlist ----------

  var mine = null;
  function myLink() { return location.origin + '/s/' + slug + (mine ? '?r=' + mine : ''); }
  // Sharing from the website copies the link alone, and says so.
  function copyLink() {
    var done = function () { toast('Copied to clipboard'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(myLink()).then(done, function () { prompt('Copy the link', myLink()); });
    else prompt('Copy the link', myLink());
  }
  function toast(text) { var t = $('toast'); t.textContent = text; t.hidden = false; setTimeout(function () { t.hidden = true; }, 2200); }

  // Joining does not stop the story: a panel rises over the page and is put away again.
  function joined() {
    $('ended').hidden = true;
    var panel = $('joined-panel');
    panel.style.transform = '';
    $('joined').classList.remove('leaving');
    $('joined').hidden = false;
    // The email box at the foot of the player has done its job.
    $('to-join').hidden = true;
    $('dock-form').innerHTML = '<p class="joined-line">You\u2019re on the list. Keep listening.</p>';
    if (story.sharer) $('joined-note').textContent = 'You came through ' + story.sharer + ', so you’re ahead of the general list. ' + story.sharer + ' moves up too.';
  }

  // Draws the eye to an email box: a short shake and a red ring, then focus so the keyboard opens.
  function nudge(input) {
    input.classList.remove('nudge');
    void input.offsetWidth;
    input.classList.add('nudge');
    setTimeout(function () { input.classList.remove('nudge'); }, 1400);
    input.focus();
  }
  // "Join waitlist" at the top points at the email box at the foot of the screen, which is always
  // in view, so following the link would do nothing.
  $('to-join').addEventListener('click', function (e) {
    e.preventDefault();
    nudge($('dock-email'));
  });

  function hook(form, source, withInterests) {
    var error = form.querySelector('.error'), button = form.querySelector('button[type=submit]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim();
      var fail = function (text) { error.textContent = text; error.hidden = false; };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { nudge(form.elements.email); return fail(email ? 'Enter a valid email address.' : 'Add your email to join.'); }
      error.hidden = true; button.disabled = true;
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: source, ref: code || null, interests: withInterests ? picked : (story.tag ? [story.tag] : []), story: slug, website: form.elements.website.value })
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          if (!r.ok) return fail(r.d.error || 'That did not save. Please try again.');
          mine = r.d.code || null;
          joined();
        })
        .catch(function () { fail('That did not save. Check your connection and try again.'); })
        .then(function () { button.disabled = false; });
    });
  }
  hook($('dock-form'), 'share-player', false);
  hook($('end-form'), 'share-end', true);

  function closeJoined() {
    var box = $('joined'), panel = $('joined-panel');
    if (box.hidden) return;
    box.classList.add('leaving');
    panel.style.transform = 'translateY(100%)';
    setTimeout(function () { box.hidden = true; box.classList.remove('leaving'); panel.style.transform = ''; }, 220);
  }
  $('close-joined').addEventListener('click', closeJoined);
  $('joined-scrim').addEventListener('click', closeJoined);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeJoined(); });
  // A swipe down from the top of the panel puts it away.
  (function () {
    var panel = $('joined-panel'), startY = null, dy = 0;
    panel.addEventListener('touchstart', function (e) { if (panel.scrollTop <= 0) { startY = e.touches[0].clientY; dy = 0; panel.classList.add('dragging'); } }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      panel.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    panel.addEventListener('touchend', function () {
      if (startY === null) return;
      startY = null; panel.classList.remove('dragging');
      if (dy > 90) closeJoined(); else panel.style.transform = '';
    });
  })();

  $('share').addEventListener('click', function () {
    copyLink();
  });
  // Passing the story on from the page: the link names nobody, unless this visitor has joined
  // and has a code of their own, so the next person does not see "Jeff sent you a story".
  $('share-top').addEventListener('click', function () {
    copyLink();
  });
  $('copy').addEventListener('click', copyLink);

  // ---------- Start ----------

  // The cover is drawn straight away from the page itself, before the story has loaded.
  var early = parseInt(document.body.getAttribute('data-art') || '', 10);
  if (!isNaN(early)) { paintArt($('cover'), early); paintArt($('thumb'), early); }

  if (!slug) return missing();
  (window.PLINY_FIRST ? window.PLINY_FIRST.catch(load) : load()).then(function (r) {
    if (!r.ok) return missing();
    story = r.d;
    fill();
    senderShown();
    paint();
  }).catch(missing);
})();
