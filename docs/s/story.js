// A shared story: who sent it, the whole story to play, and the waitlist. The page is the same for
// every story; the address says which story, and ?r= says who shared it.
(function () {
  var API = 'https://ctssexvgotcdbuvlkrou.supabase.co/functions/v1/site';
  var $ = function (id) { return document.getElementById(id); };
  var slug = (location.pathname.match(/^\/s\/([a-z0-9-]+)/) || [])[1] || '';
  var code = (new URLSearchParams(location.search).get('r') || '').toLowerCase();
  var story = null, at = 0, audio = new Audio(), wanted = false, finished = false, poll = null;
  var picked = [];

  // ---------- Showing the story ----------

  function paintArt(box, index) {
    var art = (window.PLINY_ART || [])[index || 0];
    if (!art || !box) return;
    box.style.background = art.bg;
    box.innerHTML = art.svg;
  }
  function seconds() { return story.chapters.reduce(function (sum, c) { return sum + c.seconds; }, 0); }
  function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function show(id) { ['landing', 'player'].forEach(function (k) { $(k).hidden = k !== id; }); }
  function setTag(el) { if (story.tag) { el.textContent = story.tag; el.hidden = false; } }

  function fill() {
    document.title = story.title + '. A story from Pliny';
    if (story.sharer) {
      $('sent').innerHTML = '';
      $('sent').append(story.sharer + ' sent you ');
      var em = document.createElement('em'); em.textContent = 'a story.'; $('sent').append(em);
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
    var done = finished ? seconds() : before + (audio.currentTime || 0);
    var pct = Math.min(100, (done / Math.max(1, seconds())) * 100);
    $('fill').style.width = pct + '%';
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
  $('chapters-toggle').addEventListener('click', function () {
    var open = $('chapter-list').hidden;
    $('chapter-list').hidden = !open;
    $('chapters-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  function playChapter(i) {
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

  audio.addEventListener('ended', function () { playChapter(at + 1); });
  ['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach(function (e) { audio.addEventListener(e, paint); });
  audio.addEventListener('error', function () {
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
  function toast(text) { var t = $('toast'); t.textContent = text; t.hidden = false; setTimeout(function () { t.hidden = true; }, 2200); }

  function joined() {
    audio.pause(); wanted = false;
    $('ended').hidden = true;
    $('joined').hidden = false;
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

  $('share').addEventListener('click', function () {
    var data = { title: story.title + '. A story from Pliny', url: myLink() };
    if (navigator.share) navigator.share(data).catch(function () {});
    else navigator.clipboard.writeText(myLink()).then(function () { toast('Link copied'); });
  });
  // Passing the story on from the page: the link names nobody, unless this visitor has joined
  // and has a code of their own, so the next person does not see "Jeff sent you a story".
  $('share-top').addEventListener('click', function () {
    var data = { title: story.title + '. A story from Pliny', url: myLink() };
    if (navigator.share) navigator.share(data).catch(function () {});
    else navigator.clipboard.writeText(myLink()).then(function () { toast('Link copied'); }, function () { prompt('Copy the link', myLink()); });
  });
  $('copy').addEventListener('click', function () {
    navigator.clipboard.writeText(myLink()).then(function () { toast('Link copied'); }, function () { prompt('Copy your link', myLink()); });
  });

  // ---------- Start ----------

  // The cover is drawn straight away from the page itself, before the story has loaded.
  var early = parseInt(document.body.getAttribute('data-art') || '', 10);
  if (!isNaN(early)) { paintArt($('cover'), early); paintArt($('thumb'), early); }

  if (!slug) return missing();
  load().then(function (r) {
    if (!r.ok) return missing();
    story = r.d;
    fill();
    paint();
  }).catch(missing);
})();
