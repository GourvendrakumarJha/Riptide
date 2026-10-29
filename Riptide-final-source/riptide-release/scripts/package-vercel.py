"""Create a clean deployment ZIP without databases, tokens or dependencies."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
out = root.parent / 'releases' / 'Riptide-vercel.zip'
root_files = [
    'index.html','monitor.html','simulator.html','app.js','model.js','monitor.js',
    'server.js','storage.js','register.js','sw.js','style.css','portal.css','riptide.css',
    'icon.svg','voxel-city.svg','logo.jpg','manifest.json','package.json','package-lock.json',
    'vercel.json','.vercelignore','.env.example','README.md','VERCEL.md',
    'DEPLOYMENT.md','Dockerfile','.dockerignore','compose.yaml'
]
files = [root / name for name in root_files]
files += [p for folder in ['api','test','scripts'] for p in (root/folder).rglob('*')
          if p.is_file() and p.suffix in ['.js','.cjs','.py']]
files.sort(key=lambda p: p.relative_to(root).as_posix())
manifest = ''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(root).as_posix()+'\n' for p in files)
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file,'riptide-release/'+file.relative_to(root).as_posix())
    archive.writestr('riptide-release/SHA256SUMS',manifest)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    assert not any('/data/' in name or '/node_modules/' in name or name.endswith('/.env') or '.sqlite' in name for name in archive.namelist())
print(f'{out.name}: {len(files)+1} files, {out.stat().st_size:,} bytes. No runtime database or credentials included.')
