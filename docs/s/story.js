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
  }

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
    window.scrollTo(0, 0);
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

  function hook(form, source, withInterests) {
    var error = form.querySelector('.error'), button = form.querySelector('button[type=submit]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim();
      var fail = function (text) { error.textContent = text; error.hidden = false; };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Enter a valid email address.');
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
  $('copy').addEventListener('click', function () {
    navigator.clipboard.writeText(myLink()).then(function () { toast('Link copied'); }, function () { prompt('Copy your link', myLink()); });
  });

  // ---------- Start ----------

  if (!slug) return missing();
  load().then(function (r) {
    if (!r.ok) return missing();
    story = r.d;
    fill();
    paint();
  }).catch(missing);
})();
