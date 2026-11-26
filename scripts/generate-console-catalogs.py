#!/usr/bin/env python3
"""Build the mGBA/SFC catalogs from pinned GitHub sources and verified bytes.

Usage: python3 scripts/generate-console-catalogs.py [--workers 8] [--plan]
Outputs use the shared versioned catalog format in games/<system>/catalog.json.
ROMs are cached locally; catalogs use the verified upstream raw URLs.
"""
import argparse
import collections
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SOURCES_PATH = Path(__file__).with_name('console-catalog-sources.json')
EXTENSIONS = {'gba': {'.gba', '.gb', '.gbc'}, 'sfc': {'.sfc', '.smc'}}
PLATFORMS = {'gba': 'GBA', 'gb': 'GB', 'gbc': 'GBC', 'snes': 'SFC'}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def catalog_base(system):
    return f'https://raw.githubusercontent.com/while-coder/{system}-roms/main/'


def versioned_game(entry, base, source_base=None):
    source_base = source_base or base

    def asset(path):
        return urllib.parse.urljoin(source_base, path).removeprefix(base)

    game = {
        'name': entry['name'],
        'desc': entry.get('desc', ''),
        'genre': entry.get('genre', ''),
        'publisher': entry.get('publisher', ''),
    }
    for field in ('name_en', 'system', 'year', 'developer', 'category', 'source_url', 'tags'):
        if field in entry:
            game[field] = entry[field]
    game['screenshots'] = [asset(entry['screenshot_url'])] if entry.get('screenshot_url') else []
    version = {'name': '默认版', 'download_url': asset(entry['download_url']), 'size': entry['file_size'], 'sha256': entry['sha256']}
    filename = entry.get('file_name')
    url_name = urllib.parse.unquote(urllib.parse.urlsplit(version['download_url']).path.rsplit('/', 1)[-1])
    if filename and filename != url_name:
        version['file_name'] = filename
    game['versions'] = [version]
    return game


def request(url, origin=False):
    headers = {'User-Agent': 'GameEmulator-catalog/1.0'}
    if origin:
        headers['Origin'] = 'https://while-coder.github.io'
    for attempt in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(2 ** attempt)


def raw_url(source, file):
    return 'https://raw.githubusercontent.com/{}/{}/{}'.format(
        source['repository'], source['revision'], urllib.parse.quote(file, safe='/'))


def tree(source, refresh=False):
    cache = ROOT / '.tmp/console-catalog-research' / (source['repository'].replace('/', '--') + '-pinned-tree.json')
    if cache.exists() and not refresh:
        data = json.loads(cache.read_text(encoding='utf-8'))
        if data.get('revision') == source['revision']:
            return data['tree']
    url = 'https://api.github.com/repos/{}/git/trees/{}?recursive=1'.format(source['repository'], source['revision'])
    with request(url) as response:
        data = json.load(response)
    if data.get('truncated'):
        raise ValueError('GitHub tree was truncated: ' + source['repository'])
    dump(cache, {'revision': source['revision'], 'tree': data['tree']})
    return data['tree']


def homebrew_metadata(source):
    with request(raw_url(source, 'gamelist.xml')) as response:
        # ElementTree does not resolve external XML entities.
        root = ET.fromstring(response.read())
    return {game.findtext('path', '').removeprefix('./'): {
        'name': game.findtext('name', ''),
        'developer': game.findtext('developer', ''),
        'image': game.findtext('image', '').removeprefix('./'),
        'releasedate': game.findtext('releasedate', ''),
    } for game in root.findall('game')}


def classic_rank(file):
    # One region/revision per title. Prefer a US release, then its newest revision.
    name = file['path']
    revision = re.search(r'\(Rev (\d+)\)', name)
    return (2 if '(USA)' in name else 1 if 'USA' in name else 0,
            int(revision.group(1)) if revision else 0, name)


def genre(title, homebrew=False):
    # Conservative categories; do not invent publisher or language metadata.
    if homebrew:
        return '自制游戏'
    if re.search(r'Wars|Fire Emblem|Ogre Battle|Tactics', title):
        return '策略'
    if re.search(r'Pokemon Pinball|Pinball', title):
        return '弹珠'
    if re.search(r'Mario Golf|Mario Tennis|Punch-Out', title):
        return '体育'
    if re.search(r'Mario Kart|F-Zero', title):
        return '竞速'
    if re.search(r'Tetris|Dr\. Mario|ChuChu|Puzzle|WarioWare|Alleyway', title):
        return '益智'
    if re.search(r'Harvest Moon', title):
        return '模拟经营'
    if re.search(r'Pokemon|Final Fantasy|Golden Sun|Dragon Warrior|Breath of Fire|EarthBound|Chrono|Lufia|Secret of|Mario.*RPG', title):
        return '角色扮演'
    if re.search(r'Zelda|Metroid|Castlevania|Metal Gear|Gargoyle|Illusion of Gaia|Soul Blazer|Shadowrun', title):
        return '动作冒险'
    if re.search(r'Contra|Gradius|Axelay|Star Fox|R-Type|Gunstar', title):
        return '射击'
    return '动作'


def select(sources, refresh=False):
    tasks, exclusions = [], []
    source = sources['classic']
    files = [file for file in tree(source, refresh) if file['type'] == 'blob']
    for folder, pattern in source['platforms'].items():
        chosen = {}
        system = 'sfc' if folder == 'snes' else 'gba'
        for file in files:
            if not file['path'].startswith(folder + '/') or Path(file['path']).suffix.lower() not in EXTENSIONS[system]:
                continue
            filename = Path(file['path']).name
            if not re.search(pattern, filename) or not re.search(r'\([^)]*(USA|World)[^)]*\)', filename):
                continue
            if re.search(r'\((?:Beta|Proto|Sample|Demo|Virtual Console)', filename, re.I):
                exclusions.append({'path': file['path'], 'reason': 'non-retail variant'})
                continue
            name = filename.split(' (')[0]
            if name not in chosen or classic_rank(file) > classic_rank(chosen[name]):
                chosen[name] = file
        for name, file in sorted(chosen.items()):
            tasks.append({'system': system, 'source': source, 'file': file, 'metadata': {
                'name': name, 'name_en': name, 'file_name': Path(file['path']).name,
                'genre': genre(name), 'system': PLATFORMS[folder], 'category': 'classic',
                'tags': [PLATFORMS[folder], '经典游戏', '英语'],
            }})
    for source in sources['homebrew']:
        files = {file['path']: file for file in tree(source, refresh) if file['type'] == 'blob'}
        metadata = homebrew_metadata(source)
        for path, file in sorted(files.items()):
            if Path(path).suffix.lower() not in EXTENSIONS[source['system']]:
                continue
            info = metadata.get(path, {})
            name = info.get('name') or Path(path).stem
            entry = {'name': name, 'name_en': name, 'file_name': Path(path).name,
                     'genre': genre(name, homebrew=True), 'system': 'GBA' if source['system'] == 'gba' else 'SFC',
                     'category': 'homebrew', 'tags': ['GBA' if source['system'] == 'gba' else 'SFC', '自制游戏']}
            if info.get('developer'):
                entry['developer'] = info['developer']
                entry['publisher'] = info['developer']
            if info.get('image') in files:
                entry['screenshot_url'] = raw_url(source, info['image'])
            if re.match(r'^\d{8}', info.get('releasedate', '')):
                entry['year'] = info['releasedate'][:4]
            tasks.append({'system': source['system'], 'source': source, 'file': file, 'metadata': entry})
    return tasks, exclusions


def verify(task):
    file, source, system = task['file'], task['source'], task['system']
    expected_size = file['size']
    if not 0 < expected_size <= 64 * 1024 * 1024:
        raise ValueError('ROM size outside player limits')
    filename = '{}--{}'.format(file['sha'][:12], Path(file['path']).name)
    path = ROOT / 'games' / system / 'roms' / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    url = raw_url(source, file['path'])
    data = path.read_bytes() if path.exists() else None
    cached = data is not None
    cors = None
    if data is None or len(data) != expected_size or hashlib.sha1(('blob %d\0' % len(data)).encode() + data).hexdigest() != file['sha']:
        cached = False
        for attempt in range(3):
            try:
                with request(url, origin=True) as response:
                    data = response.read(expected_size + 1)
                    cors = response.headers.get('Access-Control-Allow-Origin')
                    if 'text/html' in response.headers.get('Content-Type', '').lower():
                        raise ValueError('Download returned an HTML page')
                if len(data) != expected_size:
                    raise ValueError('File size mismatch')
                if hashlib.sha1(('blob %d\0' % len(data)).encode() + data).hexdigest() != file['sha']:
                    raise ValueError('Git blob SHA-1 mismatch')
                if data.startswith(b'version https://git-lfs.github.com/spec/'):
                    raise ValueError('Download returned a Git LFS pointer')
                if cors not in ('*', 'https://while-coder.github.io'):
                    raise ValueError('Raw source does not allow browser CORS')
                partial = path.with_name(path.name + '.part')
                partial.write_bytes(data)
                os.replace(partial, path)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
    entry = {**task['metadata'], 'download_url': url, 'file_size': len(data),
             'sha256': hashlib.sha256(data).hexdigest(),
             'source_url': 'https://github.com/{}/blob/{}/{}'.format(
                 source['repository'], source['revision'], urllib.parse.quote(file['path'], safe='/')),
             'source_repository': source['repository'], 'source_revision': source['revision']}
    return entry, {'system': system, 'name': entry['name'], 'file': str(path.relative_to(ROOT)),
                   'size': len(data), 'sha256': entry['sha256'], 'cached': cached, 'cors': cors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--refresh-tree', action='store_true')
    args = parser.parse_args()
    sources = json.loads(SOURCES_PATH.read_text(encoding='utf-8'))
    tasks, exclusions = select(sources, args.refresh_tree)
    plan = {'games': dict(collections.Counter((task['system'] + '/' + task['metadata']['category']) for task in tasks)),
            'total_files': len(tasks), 'total_bytes': sum(task['file']['size'] for task in tasks)}
    print(json.dumps(plan, ensure_ascii=False), flush=True)
    if args.plan:
        return 0
    results = {'gba': [], 'sfc': []}
    failures, verified, duplicates = [], [], []
    started = last_report = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 16))) as pool:
        pending = {pool.submit(verify, task): task for task in tasks}
        for future in concurrent.futures.as_completed(pending):
            task = pending[future]
            try:
                entry, record = future.result()
                results[task['system']].append(entry)
                verified.append(record)
            except Exception as error:
                failure = {'system': task['system'], 'path': task['file']['path'], 'error': str(error)}
                failures.append(failure)
                print('FAILED ' + json.dumps(failure, ensure_ascii=False), flush=True)
            now = time.monotonic()
            if now - last_report >= 10:
                print('{}/{} verified; {:.1f} MiB; {} failed; {:.0f}s'.format(
                    len(verified), len(tasks), sum(record['size'] for record in verified) / 1024**2, len(failures), now-started), flush=True)
                last_report = now
    generated = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for system, games in results.items():
        # Preserve source selection order; completion order must not change catalogs.
        order = {(task['source']['repository'], task['metadata']['file_name']): index for index, task in enumerate(tasks)}
        unique = {}
        for entry in sorted(games, key=lambda game: order[(game['source_repository'], game['file_name'])]):
            if entry['sha256'] in unique:
                duplicates.append({'system': system, 'name': entry['name'], 'same_as': unique[entry['sha256']]['name']})
            else:
                unique[entry['sha256']] = entry
        base = catalog_base(system)
        dump(ROOT / 'games' / system / 'catalog.json', {
            'updated_at': generated[:10], 'generated_at': generated,
            'system': system, 'sources': [source for source in [sources['classic'], *sources['homebrew']] if 'system' not in source or source['system'] == system],
            'base_url': base,
            'games': [versioned_game(entry, base) for entry in unique.values()],
        })
    report = {'generated_at': generated, 'plan': plan, 'verified': len(verified),
              'catalog_games': {system: len(json.loads((ROOT/'games'/system/'catalog.json').read_text(encoding='utf-8'))['games']) for system in results},
              'verified_bytes': sum(record['size'] for record in verified), 'files': verified,
              'duplicates': duplicates, 'exclusions': exclusions, 'failures': failures,
              'elapsed_seconds': round(time.monotonic()-started, 1)}
    dump(ROOT / 'games/console-catalog-report.json', report)
    print(json.dumps({key: value for key, value in report.items() if key not in ('files', 'exclusions')}, ensure_ascii=False), flush=True)
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
