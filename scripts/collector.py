#!/usr/bin/env python3
"""Read subscription quotas only; never run an agent turn or persist credentials."""
import concurrent.futures, datetime, fcntl, json, math, os, pathlib, queue, shutil, subprocess, tempfile, threading, time, urllib.request, urllib.error
STATE=pathlib.Path(os.environ.get('XDG_CACHE_HOME',pathlib.Path.home()/'.cache'))/'osaka-ai-usage'
def window(label,used,reset):
    if not isinstance(used,(int,float)) or isinstance(used,bool) or not math.isfinite(used):return None
    if isinstance(reset,str):
        try:reset=datetime.datetime.fromisoformat(reset.replace('Z','+00:00')).timestamp()
        except ValueError:reset=None
    return dict(label=label,remaining=round(max(0,min(100,100-used)),1),resetsAt=reset)
def codex_windows(data):
    limits=data.get('rateLimitsByLimitId') or {'codex':data.get('rateLimits',{})};windows=[]
    for key,group in limits.items():
        if key!='codex' or not group:continue
        for field in ['primary','secondary']:
            w=group.get(field)
            if not w:continue
            mins=w.get('windowDurationMins');label='Weekly' if mins==10080 else ('5-hour' if mins==300 else f'{mins} min' if mins else 'Allowance')
            v=window(label,w.get('usedPercent'),w.get('resetsAt'))
            if v:windows.append(v)
    return windows
def codex():
    exe=shutil.which('codex') or str(pathlib.Path.home()/'.local/bin/codex')
    p=subprocess.Popen([exe,'app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    q=queue.Queue()
    def reader():
        for line in p.stdout:
            try:q.put(json.loads(line))
            except ValueError:pass
    threading.Thread(target=reader,daemon=True).start()
    def rpc(i,method,params):
        p.stdin.write(json.dumps(dict(id=i,method=method,params=params))+'\n');p.stdin.flush();end=time.monotonic()+15
        while time.monotonic()<end:
            v=q.get(timeout=max(.01,end-time.monotonic()))
            if v.get('id')==i:
                if 'error' in v:raise RuntimeError('Codex usage unavailable; check login')
                return v['result']
        raise TimeoutError()
    try:
        rpc(1,'initialize',{'clientInfo':{'name':'osaka_usage','version':'1.0.0'}})
        p.stdin.write('{"method":"initialized"}\n');p.stdin.flush()
        data=rpc(2,'account/rateLimits/read',{})
        windows=codex_windows(data)
        if not windows:raise RuntimeError('No subscription limits available')
        return dict(windows=windows,updatedAt=time.time(),error=None)
    finally:
        p.terminate()
        try:p.wait(timeout=3)
        except subprocess.TimeoutExpired:p.kill();p.wait()
def claude():
    config=pathlib.Path(os.environ.get('CLAUDE_CONFIG_DIR',pathlib.Path.home()/'.claude'))
    auth=json.loads((config/'.credentials.json').read_text()).get('claudeAiOauth',{})
    token=auth.get('accessToken')
    if not token:raise RuntimeError('Sign in with claude auth login')
    req=urllib.request.Request('https://api.anthropic.com/api/oauth/usage',headers={'Authorization':'Bearer '+token,'anthropic-beta':'oauth-2025-04-20','User-Agent':'osaka-jade-usage/1.0'})
    with urllib.request.urlopen(req,timeout=18) as response:data=json.load(response)
    windows=[]
    for key,label in [('five_hour','5-hour'),('seven_day','Weekly')]:
        w=data.get(key) or {};v=window(label,w.get('utilization'),w.get('resets_at'))
        if v:windows.append(v)
    for w in data.get('limits',[]):
        if w.get('kind')=='weekly_scoped':
            name=((w.get('scope') or {}).get('model') or {}).get('display_name')
            if name:
                v=window(name+' · Weekly',w.get('percent'),w.get('resets_at'))
                if v:windows.append(v)
    if not windows:raise RuntimeError('No subscription limits available')
    return dict(windows=windows,updatedAt=time.time(),error=None)
def error_text(e):
    if isinstance(e,urllib.error.HTTPError):return 'Sign in again' if e.code in [401,403] else 'Rate limited; retry later' if e.code==429 else 'Provider unavailable'
    if isinstance(e,FileNotFoundError):return 'CLI or login missing'
    if isinstance(e,RuntimeError):return str(e)
    return 'Could not refresh usage'
def main():
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'collector.lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        path=STATE/'usage.json'
        try:old=json.loads(path.read_text())
        except (OSError,ValueError):old={}
        # Bound manual refreshes too; no rapid repeated authenticated requests.
        if time.time()-old.get('attemptedAt',0)<60:return
        result={'version':1,'attemptedAt':time.time(),'providers':{}}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            jobs={name:pool.submit(fn) for name,fn in [('claude',claude),('codex',codex)]}
            for name,future in jobs.items():
                try:result['providers'][name]=future.result()
                except Exception as e:
                    result['providers'][name]={**old.get('providers',{}).get(name,{'windows':[],'updatedAt':None}),'error':error_text(e)}
        fd,tmp=tempfile.mkstemp(dir=STATE)
        with os.fdopen(fd,'w') as f:json.dump(result,f);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
if __name__=='__main__':main()
