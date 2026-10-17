"""Download pinned public dictionaries/models; never application data or API keys.

Requires Python 3.12+. Install the separate requirements.txt and npm project first.
Archives stay in the ignored .codex-dev cache; only hashes/notices are committed.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import tarfile
import zipfile

if sys.version_info < (3, 12):
    raise SystemExit('Python 3.12+ is required for safe archive extraction')
directory = pathlib.Path(__file__).resolve().parent
cache = directory.parents[2] / '.codex-dev' / 'local-engines'
cache.mkdir(parents=True, exist_ok=True)
assets = json.loads((directory / 'assets.json').read_text())
for asset in assets:
    archive = cache / asset['name']

    def verified():
        if not archive.is_file() or archive.stat().st_size != asset['bytes']:
            return False
        with archive.open('rb') as data:
            return hashlib.file_digest(data, 'sha256').hexdigest() == asset['sha256']

    if not verified():
        # A partial/mismatched file is replaced only inside this dedicated cache.
        temporary = archive.with_suffix(archive.suffix + '.download')
        subprocess.run(['curl', '-fL', '--connect-timeout', '15', '--max-time', '300', '--retry', '2',
                        '-o', str(temporary), asset['url']], check=True)
        temporary.replace(archive)
    if not verified():
        raise SystemExit(f'Checksum mismatch: {asset["name"]}')
    destination = cache / asset['name'].removesuffix('.zip').removesuffix('.tar.xz')
    destination.mkdir(exist_ok=True)
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as source:
            for name in source.namelist():
                if not (destination / name).resolve().is_relative_to(destination.resolve()):
                    raise SystemExit('Unsafe zip entry')
            source.extractall(destination)
    else:
        with tarfile.open(archive) as source:
            source.extractall(destination, filter='data')
    print(f'Verified {asset["name"]}')
