"""Use POSIX ZIP paths: Windows aapt2 35 emits backslashes in nested assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED
import sys

base, assets, dex, output = map(Path, sys.argv[1:])
with ZipFile(output, 'w') as target:
    with ZipFile(base) as source:
        for entry in source.infolist():
            target.writestr(entry.filename.replace('\\','/'), source.read(entry), compress_type=entry.compress_type)
    for path in sorted(assets.rglob('*')):
        if path.is_file():
            name='assets/'+path.relative_to(assets).as_posix()
            target.write(path,name,compress_type=ZIP_STORED if path.suffix in ['.jpg','.png','.woff2'] else ZIP_DEFLATED)
    target.write(dex,'classes.dex',compress_type=ZIP_DEFLATED)
with ZipFile(output) as archive:
    assert all('\\' not in i.orig_filename for i in archive.infolist()), 'Non-portable ZIP path'
    assert archive.testzip() is None
