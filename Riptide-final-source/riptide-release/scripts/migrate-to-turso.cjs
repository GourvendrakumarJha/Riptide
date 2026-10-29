'use strict';
// Explicit one-time import. Never runs on a Vercel request or at build time.
const path=require('node:path');const {DatabaseSync}=require('node:sqlite');
const {openDatabase}=require('../storage');
const tables=['metadata','users','sessions','scenario','items','attachments','audit','staff_alerts','operator_work','alert_replies'];
(async()=>{
 const source=process.argv[2];if(!source||!process.env.TURSO_DATABASE_URL)throw Error('Usage: set TURSO_DATABASE_URL/TURSO_AUTH_TOKEN, then node scripts/migrate-to-turso.cjs /path/to/riptide.sqlite');
 // Use the normal schema initializer, but do not seed accounts or demo data.
 delete process.env.RIPTIDE_ADMIN_USER;delete process.env.RIPTIDE_ADMIN_PASSWORD;process.env.RIPTIDE_DEMO_MODE='false';
 const old=new DatabaseSync(path.resolve(source),{readOnly:true});const {db}=await require('../server').ready;
 try{
  if(!db.remote)throw Error('The target must use the hosted libSQL adapter');
  await db.withRequest(async()=>{
   await db.exec('BEGIN IMMEDIATE');
   for(const table of tables)if((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n)throw Error('Target database is not empty; refusing to overwrite '+table);
   const columns=old.prepare('PRAGMA table_info(users)').all();if(!columns.some(c=>c.name==='active')||old.prepare("SELECT 1 FROM users WHERE role IN ('responder','support') LIMIT 1").get())throw Error('Upgrade the local database with the latest local server before importing');
   for(const table of tables){
    if(!old.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    const rows=old.prepare(`SELECT * FROM ${table}`).all();for(const row of rows){const keys=Object.keys(row);if(keys.some(key=>!/^\w+$/.test(key)))throw Error('Unexpected column');await db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]))}
    console.log('Imported '+table+': '+rows.length+' records');
   }
   // Cookies/sessions have different deployment origins. Require fresh sign-in.
   await db.prepare('DELETE FROM sessions').run();await db.exec('COMMIT');
  });
  console.log('Import complete. Existing accounts, conversations, tasks, GPS and attachments were preserved. Sign in again on the deployment.');
 }finally{old.close();await db.close()}
})().catch(error=>{console.error('Import failed:',error.message);process.exitCode=1});
