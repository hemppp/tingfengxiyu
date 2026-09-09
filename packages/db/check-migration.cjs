const Database = require('better-sqlite3');

const main = new Database('f:/novel-companion/data/novelmuse.db', { readonly: true });
const tables = main.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
console.log('Main DB tables:', tables.join(', '));

try {
  const c = main.prepare(`SELECT COUNT(*) as c FROM chapters`).get();
  console.log('Main chapters count:', c.c);
} catch (e) {
  console.log('Main chapters table: NOT EXISTS (good)');
}

const migrations = main.prepare(`SELECT filename FROM __novelmuse_migrations WHERE filename = '__project_dbs_split__'`).get();
console.log('Migration marker:', migrations ? 'PRESENT' : 'MISSING');

main.close();

// 检查项目库
const fs = require('fs');
const projectDir = 'f:/novel-companion/data/projects';
if (fs.existsSync(projectDir)) {
  const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.db'));
  for (const f of files) {
    console.log('\n--- Project DB:', f, '---');
    const pdb = new Database(`${projectDir}/${f}`, { readonly: true });
    const ptables = pdb.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
    console.log('Tables:', ptables.join(', '));
    try {
      const cc = pdb.prepare(`SELECT COUNT(*) as c FROM chapters`).get();
      const ch = pdb.prepare(`SELECT id, title, word_count, length(content) as content_len FROM chapters`).all();
      console.log('Chapters count:', cc.c);
      console.log('Chapter details:', JSON.stringify(ch, null, 2));
    } catch (e) {
      console.log('Chapters query failed:', e.message);
    }
    pdb.close();
  }
}
