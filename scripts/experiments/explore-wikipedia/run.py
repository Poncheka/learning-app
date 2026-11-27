import json, random, re, sys, time, unicodedata, urllib.request
TOKEN=open('token').read().strip()  # the lab token is not kept in the repo
URL="https://ctssexvgotcdbuvlkrou.supabase.co/functions/v1/idea-lab"
def lab(body):
    req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={"Content-Type":"application/json","x-lab-token":TOKEN})
    with urllib.request.urlopen(req,timeout=180) as r: return json.load(r)
STOP={"the","a","an","of","and","in","on","at","to","for","by","with","from","s"}
def words(s):
    p=unicodedata.normalize('NFD',str(s).lower()); p=re.sub(r'[̀-ͯ]','',p); p=re.sub(r'[^a-z0-9]+',' ',p)
    return {w[:-1] if len(w)>3 and w.endswith('s') and not w.endswith('ss') else w for w in p.split() if w and w not in STOP}
def same(a,b):
    x,y=words(a),words(b)
    if not x or not y: return False
    sm,bg=(x,y) if len(x)<=len(y) else (y,x)
    return all(w in bg for w in sm) and (len(sm)>=2 or len(sm)==len(bg))
def plain(t): return re.sub(r'^the ','',re.sub(r'[^a-z0-9]+',' ',re.sub(r'\([^)]*\)',' ',str(t).lower()))).strip()
def parse(text):
    return json.loads(text[text.index('['):text.rindex(']')+1])
ctx=lab({"action":"context","user_id":"e3c56c32-2d9d-42d8-a2af-750150b661f9"})
json.dump(ctx,open('context.json','w'))
interests=ctx['interests']; print('interests',interests, 'liked',len(ctx['liked']),'disliked',len(ctx['disliked']),'offered',len(ctx['offered']),'subjects',len(ctx['subjects']))
offered_set={plain(o) for o in ctx['offered']}|{plain(o.split(' (')[0]) for o in ctx['offered']}
made=ctx['subjects']
chosen=[]   # all accepted items across arms
calls=[]
def head(slots):
    return (f"Interests: {', '.join(interests)}\nLoved: {'; '.join(ctx['liked']) or 'nothing rated yet'}\n"
            f"Turned down or swiped away: {'; '.join(ctx['disliked']) or 'nothing yet'}\n"
            f"Already offered: {'; '.join(ctx['offered'] + [c['subject']+' ('+c['headline']+')' for c in chosen])}\n")
def accept(arm, entry, slot, extra):
    title=str(entry.get('title','')).strip(); card=str(entry.get('card','')).strip().rstrip('. ')
    if not title or not card: return 'empty'
    if len(card)>56: return 'too_long'
    if plain(title) in offered_set: return 'repeat'
    if any(same(m,title) for m in made) or any(same(c['subject'],title) for c in chosen): return 'same_subject'
    chosen.append({"arm":arm,"subject":title,"headline":card,"interest":slot,**extra}); return 'kept'
# ---- AI arm: the v2 idea writer, 50 headlines, interest lines in the production rotation
def run_ai(target=50):
    order=interests+["Off the map"]
    i=0; rounds=0
    while sum(1 for c in chosen if c['arm']=='ai')<target and rounds<14:
        rounds+=1
        slots=[order[(i+k)%len(order)] for k in range(6)]; i+=6
        inp=head(slots)+"One entry for each of these lines, in this order:\n"+"\n".join(f"{n+1}. {s}" for n,s in enumerate(slots))
        r=lab({"arm":"ai","input":inp}); calls.append({"arm":"ai","usage":r.get('usage'),"error":r.get('error')})
        if 'text' not in r: print('error',r); break
        try: arr=parse(r['text'])
        except Exception as e: print('unreadable'); continue
        res=[]
        for n,e in enumerate(arr):
            if isinstance(e,dict) and e.get('skip'): res.append('skip'); continue
            if sum(1 for c in chosen if c['arm']=='ai')>=target: break
            res.append(accept('ai',e,slots[n] if n<len(slots) else 'Off the map',{"method":"v2 idea writer, model chose the subject"}))
        print('ai round',rounds,res,flush=True)
# ---- Wikipedia arms: the same writer chooses one listed article per line and writes its headline
def run_wiki(src):
    slots=[s for s in json.load(open('candidates.json')) if s['source']==src]
    todo=list(range(len(slots))); tries=0
    while todo and tries<8:
        tries+=1
        batch=todo[:6]; todo=todo[6:]
        lines=[]
        for n,k in enumerate(batch):
            s=slots[k]; cs=[c for c in s['candidates'] if not any(same(m,c['subject']) for m in made) and not any(same(x['subject'],c['subject']) for x in chosen)]
            s['live']=cs
            lines.append(f"{n+1}. {s['interest']}. Choose one of these Wikipedia articles: "+" | ".join(f"{c['subject']}: {c['gist']}" for c in cs))
        inp=(head([slots[k]['interest'] for k in batch])+
             "For each line below, choose the one listed Wikipedia article that best passes the test, use exactly its name as the title, "
             "and write its card. Always choose one of the listed articles; do not skip.\n"
             "One entry for each of these lines, in this order:\n"+"\n".join(lines))
        r=lab({"arm":src,"input":inp}); calls.append({"arm":src,"usage":r.get('usage'),"error":r.get('error')})
        if 'text' not in r: print('error',r); break
        try: arr=parse(r['text'])
        except Exception: print('unreadable'); todo=batch+todo; continue
        res=[]
        for n,k in enumerate(batch):
            e=arr[n] if n<len(arr) and isinstance(arr[n],dict) else {}
            s=slots[k]; t=str(e.get('title','')).strip()
            match=next((c for c in s['live'] if c['subject'].lower()==t.lower()),None) or next((c for c in s['live'] if same(c['subject'],t)),None)
            if not match: res.append('not_listed'); todo.append(k); continue
            e['title']=match['subject']
            out=accept(src,e,s['interest'],{"method":"v2 idea writer chose 1 of up to 8 listed articles","source_gist":match['gist'],"candidates":[c['subject'] for c in s['live']]})
            res.append(out)
            if out!='kept': todo.append(k)
        print(src,'round',tries,res,flush=True)
arm=sys.argv[1]
import glob
for f in glob.glob('out_*.json'):
    if f!=f'out_{arm}.json': chosen.extend(json.load(open(f))['chosen'])
others=len(chosen)
if arm=='ai': run_ai()
else: run_wiki(arm)
json.dump({"chosen":chosen[others:],"calls":calls},open(f'out_{arm}.json','w'),ensure_ascii=False,indent=1)
print('spent',lab({"action":"spent"}))
