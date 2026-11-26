#!/usr/bin/env python3
"""Download ROMs from the project catalogs; reruns verify and skip valid files."""
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
SOURCES = {
    'nes': 'https://raw.githubusercontent.com/while-coder/nes-roms/main/catalog.json',
    'arcade': 'https://raw.githubusercontent.com/while-coder/arcade-roms/main/catalog.json',
    'neogeo': 'https://raw.githubusercontent.com/while-coder/neogeo-roms/main/catalog.json',
}


def valid(path, entry):
    if not path.is_file() or path.stat().st_size != entry['file_size']:
        return False
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest() == entry['sha256'].lower()


def resolve_download_url(catalog, source, entry):
    base = source
    if 'base_url' in catalog:
        value = catalog['base_url']
        if not isinstance(value, str) or not value.strip():
            raise ValueError('Invalid base_url')
        parsed = urllib.parse.urlsplit(urllib.parse.urljoin(source, value))
        base = parsed._replace(path=parsed.path.rstrip('/') + '/').geturl()
    return urllib.parse.urljoin(base, entry['download_url'])


def unpack_nes(response, entry):
    size = entry['archive_size']
    if type(size) is not int or size <= 0:
        raise ValueError('Invalid NES ZIP size')
    data = response.read(size + 1)
    if len(data) != size:
        raise ValueError('ZIP size mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = [file for file in archive.infolist()
                 if Path(file.filename).suffix.lower() == '.nes'
                 and '__MACOSX' not in file.filename.split('/')
                 and not Path(file.filename).name.startswith('._')]
        if len(files) != 1 or files[0].file_size != entry['file_size']:
            raise ValueError('Expected one NES ROM of the catalog size')
        with archive.open(files[0]) as rom:
            data = rom.read(entry['file_size'] + 1)
            if not data.startswith(b'NES\x1a'):
                raise ValueError('Invalid NES file in ZIP')
            return data


def download(task):
    group, entry, filename = task
    path = ROOT / group / 'roms' / filename
    if valid(path, entry):
        return 'cached', entry['file_size']
    partial = path.with_name(path.name + '.part')
    url = urllib.parse.urljoin(SOURCES[group], entry['download_url'])
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('Expected HTTPS: ' + url)
    for attempt in range(4):
        try:
            digest = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(url, timeout=60) as response, partial.open('wb') as output:
                blocks = (unpack_nes(response, entry),) if group == 'nes' and 'archive_size' in entry else iter(lambda: response.read(256 * 1024), b'')
                for block in blocks:
                    size += len(block)
                    if size > entry['file_size']:
                        raise ValueError('Response exceeds catalog size')
                    output.write(block)
                    digest.update(block)
            if size != entry['file_size'] or digest.hexdigest() != entry['sha256'].lower():
                raise ValueError('Size or SHA-256 mismatch')
            os.replace(partial, path)
            return 'downloaded', size
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def main():
    tasks = []
    counts = {}
    for group, source in SOURCES.items():
        directory = ROOT / group
        (directory / 'roms').mkdir(parents=True, exist_ok=True)
        catalog_path = directory / 'catalog.json'
        catalog = json.loads(catalog_path.read_bytes())
        games = catalog['games']
        versions = [version for game in games for version in game['versions']]
        files = {}
        for entry in versions + catalog.get('dependency_files', []):
            entry = {**entry, 'file_size': entry['size'], 'download_url': resolve_download_url(catalog, source, entry)}
            filename = entry.get('file_name') or urllib.parse.unquote(
                urllib.parse.urlsplit(entry['download_url']).path.rsplit('/', 1)[-1])
            if not filename or Path(filename).name != filename or filename in ('.', '..'):
                raise ValueError('Unsafe filename: ' + filename)
            if filename in files and files[filename]['sha256'] != entry['sha256']:
                raise ValueError('Conflicting filename: ' + filename)
            files[filename] = entry
        for entry in files.values():
            for dependency in entry.get('dependencies', []):
                if dependency not in files:
                    raise ValueError('Missing dependency: ' + dependency)
        tasks.extend((group, entry, filename) for filename, entry in files.items())
        counts[group] = {'games': len(games), 'files': len(files)}
    total_bytes = sum(entry['file_size'] for _, entry, _ in tasks)
    print(json.dumps({'catalogs': counts, 'total_files': len(tasks), 'total_bytes': total_bytes}), flush=True)
    failures = []
    completed = cached = received = 0
    started = last_report = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending = {pool.submit(download, task): task for task in tasks}
        for future in concurrent.futures.as_completed(pending):
            group, entry, filename = pending[future]
            try:
                status, size = future.result()
                completed += 1
                cached += status == 'cached'
                received += size
            except Exception as error:
                failures.append({'group': group, 'file': filename, 'error': str(error)})
                print('FAILED ' + group + '/' + filename + ': ' + str(error), flush=True)
            now = time.monotonic()
            if now - last_report >= 10:
                print(f'{completed}/{len(tasks)} verified, {received / 1024**2:.1f}/{total_bytes / 1024**2:.1f} MiB, {len(failures)} failed, {now-started:.0f}s', flush=True)
                last_report = now
    report = {'catalogs': counts, 'total_files': len(tasks), 'verified': completed,
              'cached': cached, 'verified_bytes': received, 'failures': failures,
              'elapsed_seconds': round(time.monotonic() - started, 1)}
    (ROOT / 'download-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
