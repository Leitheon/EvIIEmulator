#!/usr/bin/env python3
"""Build a protocol spec from the decompiled Evony client.

Reads the JPEXS export and writes:
  protocol.json  - requests (cmd -> params, reply bean), replies (cmd -> bean), beans (fields)
  PROTOCOL.md    - the same as a readable reference
"""
import json, os, re, sys
from collections import defaultdict

ROOT = sys.argv[1]   # .../decomp/scripts/scripts
OUT = sys.argv[2]    # output dir

def read(p):
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read()

# ---------- index every class file ----------
files = {}
for d, _, fs in os.walk(ROOT):
    for f in fs:
        if f.endswith('.as'):
            files[f[:-3]] = os.path.join(d, f)

def ctor_body(src, cls):
    m = re.search(r'public function %s\(([^)]*)\)\s*\{' % re.escape(cls), src)
    if not m:
        return None, None
    i = m.end(); depth = 1
    while i < len(src) and depth:
        if src[i] == '{': depth += 1
        elif src[i] == '}': depth -= 1
        i += 1
    return m.group(1), src[m.end():i - 1]

def field_types(src):
    t = {}
    for name, ty in re.findall(r'public var (\w+):([\w.*]+)', src):
        t[name] = ty
    for name, ty in re.findall(r'public function set (\w+)\(param1:([\w.*]+)\)', src):
        t.setdefault(name, ty)
    for name, ty in re.findall(r'public function get (\w+)\(\)\s*:\s*([\w.*]+)', src):
        t.setdefault(name, ty)
    return t

bean_cache = {}
def parse_bean(cls):
    if cls in bean_cache:
        return bean_cache[cls]
    p = files.get(cls)
    if not p:
        bean_cache[cls] = None
        return None
    src = read(p)
    args, body = ctor_body(src, cls)
    if body is None:
        bean_cache[cls] = None
        return None
    # the data object is the 1st param for beans, the 2nd for responses (cmd, data, ...)
    names = [a.split(':')[0].strip() for a in args.split(',') if a.strip()]
    types = [a.split(':')[1].split('=')[0].strip() if ':' in a else '' for a in args.split(',') if a.strip()]
    obj = None
    for n, ty in zip(names, types):
        if ty == 'Object':
            obj = n
            break
    if obj is None:
        bean_cache[cls] = None
        return None
    ft = field_types(src)
    fields = {}
    o = re.escape(obj)
    # nested arrays of beans: new Y(obj.x[_locN_])
    for y, x in re.findall(r'new (\w+)\(%s\.(\w+)\[\w+\]\)' % o, body):
        fields[x] = {'type': y, 'array': True}
    # arrays of primitives: addItem(obj.x[_locN_]) / push(obj.x[i])
    for x in re.findall(r'(?:addItem|push)\(%s\.(\w+)\[\w+\]\)' % o, body):
        fields.setdefault(x, {'type': 'any', 'array': True})
    # nested beans: new Y(obj.x)
    for y, x in re.findall(r'new (\w+)\(%s\.(\w+)\)' % o, body):
        if x not in fields:
            fields[x] = {'type': y}
    # scalars: this.x = obj.x;
    for x in re.findall(r'this\.(\w+) = %s\.(?:\w+);' % o, body):
        pass
    for tgt, x in re.findall(r'this\.(\w+) = %s\.(\w+);' % o, body):
        if x not in fields:
            fields[x] = {'type': ft.get(tgt, ft.get(x, 'any'))}
    for x in re.findall(r'%s\.(\w+) != null' % o, body):
        fields.setdefault(x, {'type': ft.get(x, 'any')})
    sup = re.search(r'class %s extends (\w+)' % re.escape(cls), src)
    consts = dict(re.findall(r'public static const (\w+):(?:int|String|Number) = ([^;]+);', src))
    info = {'fields': fields, 'extends': sup.group(1) if sup else None, 'consts': consts}
    bean_cache[cls] = info
    for f in fields.values():
        if f['type'] in files and f['type'] not in ('String', 'int', 'Number', 'Boolean'):
            parse_bean(f['type'])
    return info

# ---------- replies ----------
rd = read(files['ResponseDispatcher'])
resp_map = dict(re.findall(r'respMap\["([^"]+)"\] = (\w+);', rd))
fn_bean = {}
for fn, bean, cmd in re.findall(r'private function (_resp_\w+)\(param1:Object\) : void\s*\{\s*var _loc2_:\w+ = (?:null;\s*_loc2_ = )?new (\w+)\("([^"]+)"', rd):
    fn_bean[fn] = (bean, cmd)
replies = {}
for cmd, fn in sorted(resp_map.items()):
    bean = fn_bean.get(fn, (None, None))[0]
    replies[cmd] = bean
    if bean:
        parse_bean(bean)

# ---------- requests ----------
requests = {}
act_dir = os.path.join(ROOT, 'com', 'evony', 'client', 'action')
for f in sorted(os.listdir(act_dir)):
    src = read(os.path.join(act_dir, f))
    for m in re.finditer(r'public function (\w+)\(([^)]*)\)\s*:\s*(\w+)\s*\{(.*?)\n      \}', src, re.S):
        name, args, ret, body = m.groups()
        cm = re.search(r'sendMessage\("([^"]+)"', body)
        if not cm:
            continue
        cmd = cm.group(1)
        ptypes = {}
        for a in args.split(','):
            a = a.strip()
            if ':' in a:
                n, t = a.split(':', 1)
                ptypes[n.strip()] = t.split('=')[0].strip()
        params = {}
        for key, val in re.findall(r'_loc\d+_\.(\w+) = ([^;]+);', body):
            v = val.strip()
            params[key] = ptypes.get(v, v if not v.startswith('param') else 'any')
        requests[cmd] = {'module': f[:-3], 'method': name, 'params': params, 'reply': ret if ret not in ('void',) else None}
        if ret in files:
            parse_bean(ret)

beans = {k: v for k, v in bean_cache.items() if v}
spec = {'client': 'EvonyClient1921.swf', 'version': '091103_11', 'requests': requests, 'replies': replies, 'beans': beans}
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'protocol.json'), 'w') as f:
    json.dump(spec, f, indent=1, sort_keys=True)

# ---------- markdown ----------
def ty(f):
    t = f['type']
    return f"{t}[]" if f.get('array') else t
lines = ['# Evony client protocol (EvonyClient1921.swf, version 091103_11)', '',
         'Generated from the decompiled client by tools/extract_protocol.py. Do not edit by hand.', '',
         '## Wire format', '',
         '- TCP socket, default port 443. Before connecting, Flash asks for a socket policy file (port 843, or the URL in config2.xml `<security>`).',
         '- Each message: 4-byte big-endian length, then an AMF3-encoded object `{cmd: String, data: Object}`.',
         '- Server to client only: if the top bit of the length is set, the payload is zlib-compressed (ByteArray.uncompress).',
         '- On connect the client sends `gameClient.version` with data `"091103_11"`. The server may answer `gameClient.errorVersion` or `gameClient.kickout`.',
         '- Replies to a request reuse the request\'s `cmd`; unsolicited pushes use `server.<Event>`.', '',
         f'## Requests ({len(requests)})', '']
by_mod = defaultdict(list)
for cmd, r in requests.items():
    by_mod[r['module']].append((cmd, r))
for mod in sorted(by_mod):
    lines.append(f'### {mod}')
    lines.append('')
    lines.append('| cmd | params | reply bean |')
    lines.append('|---|---|---|')
    for cmd, r in sorted(by_mod[mod]):
        ps = ', '.join(f'{k}:{v}' for k, v in r['params'].items()) or '—'
        rb = replies.get(cmd) or r['reply'] or '—'
        lines.append(f'| `{cmd}` | {ps} | {rb} |')
    lines.append('')
pushes = sorted(c for c in replies if c.startswith('server.'))
lines += [f'## Server pushes ({len(pushes)})', '', '| cmd | bean |', '|---|---|']
lines += [f'| `{c}` | {replies[c]} |' for c in pushes]
lines += ['', f'## Data classes ({len(beans)})', '']
for b in sorted(beans):
    info = beans[b]
    lines.append(f'### {b}' + (f' (extends {info["extends"]})' if info['extends'] and info['extends'] not in ('Object', 'EventDispatcher') else ''))
    if info['fields']:
        lines.append('')
        lines.append(', '.join(f'`{k}`:{ty(v)}' for k, v in sorted(info['fields'].items())))
    if info['consts']:
        lines.append('')
        lines.append('Constants: ' + ', '.join(f'{k}={v}' for k, v in sorted(info['consts'].items())))
    lines.append('')
with open(os.path.join(OUT, 'PROTOCOL.md'), 'w') as f:
    f.write('\n'.join(lines))
print(f'requests={len(requests)} replies={len(replies)} pushes={len(pushes)} beans={len(beans)}')
missing = [c for c, b in replies.items() if not b]
print('replies without bean:', len(missing), missing[:10])
noreply = [c for c in requests if c not in replies]
print('requests without registered reply:', len(noreply), noreply[:15])
