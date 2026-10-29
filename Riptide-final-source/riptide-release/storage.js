'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const fs=require('node:fs');const path=require('node:path');
// Every invocation owns its transaction. Never share a mutable transaction between
// concurrent Vercel requests. file: URLs are for the integration tests only.
function openDatabase(dataDir){
 const url=process.env.TURSO_DATABASE_URL;
 if(process.env.VERCEL&&!url)throw Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying. Local SQLite is not persistent on Vercel.');
 if(!url){
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const {DatabaseSync}=require('node:sqlite'),native=new DatabaseSync(path.join(dataDir,'riptide.sqlite'));
  let queue=Promise.resolve();
  return {remote:false,prepare:sql=>native.prepare(sql),exec:sql=>native.exec(sql),close:()=>native.close(),withRequest(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task}};
 }
 if(process.env.VERCEL&&!/^(libsql|https):\/\//.test(url))throw Error('Vercel requires a hosted libSQL/Turso URL, not a file or local database.');
 if(process.env.VERCEL&&!process.env.TURSO_AUTH_TOKEN)throw Error('Set TURSO_AUTH_TOKEN for the hosted database.');
 const {createClient}=require('@libsql/client');const connection=()=>createClient({url,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'number'}),client=connection(),context=new AsyncLocalStorage();
 async function writeTransaction(){
  for(let attempt=0;;attempt++)try{return await (context.getStore()?.client||client).transaction('write')}catch(error){if(attempt>=7||!/SQLITE_BUSY|SQLITE_LOCKED/.test(String(error.code)))throw error;const state=context.getStore();if(state?.client){state.client.close();state.client=connection()}await new Promise(resolve=>setTimeout(resolve,Math.min(25*2**attempt,500)))}
 }
 const journalReady=url.startsWith('file:')?client.execute('PRAGMA journal_mode=WAL'):Promise.resolve();
 function executor(){return context.getStore()?.transaction||context.getStore()?.client||client}
 function row(value){if(!value)return undefined;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,v instanceof ArrayBuffer?Buffer.from(v):v]))}
 return {
  remote:true,
  async withRequest(fn,{write=false}={}){await journalReady;return context.run({},async()=>{
    const state=context.getStore();
    // The file driver's pooled read statements can retain an old WAL snapshot
    // after a busy BEGIN/rollback. Fresh connections per invocation mirror independent
    // hosted Hrana streams without ever reusing those native read cursors.
    if(url.startsWith('file:'))state.client=connection();
    try{if(write){state.transaction=await writeTransaction();state.depth=1}
    const result=await fn();if(write&&state.transaction){await state.transaction.commit();delete state.transaction}return result}
    finally{try{const tx=state.transaction;if(tx&&!tx.closed)await tx.rollback()}finally{state.client?.close()}}
   })},
  prepare(sql){return {
   async all(...args){const result=await executor().execute({sql,args});return result.rows.map(row)},
   async get(...args){const result=await executor().execute({sql,args});return row(result.rows[0])},
   async run(...args){const result=await executor().execute({sql,args});return {changes:result.rowsAffected,lastInsertRowid:Number(result.lastInsertRowid||0)}}
  }},
  async exec(sql){
   const value=sql.trim(),state=context.getStore();
   if(/^BEGIN(?: IMMEDIATE)?;?$/i.test(value)){if(!state)throw Error('Transaction requires request context');if(state.transaction){state.depth=(state.depth||1)+1;return}state.transaction=await writeTransaction();state.depth=1;return}
   if(/^COMMIT;?$/i.test(value)){if(!state?.transaction)throw Error('No transaction');if(state.depth>1){state.depth--;return}const tx=state.transaction;await tx.commit();delete state.transaction;return}
   if(/^ROLLBACK;?$/i.test(value)){if(state?.transaction){const tx=state.transaction;delete state.transaction;await tx.rollback()}return}
   const supported=value.replace(/PRAGMA\s+(?:journal_mode|foreign_keys|busy_timeout)\s*=\s*[^;]+;?/gi,'').trim();
   if(supported)await executor().executeMultiple(supported);
  },
  close:()=>client.close()
 };
}
module.exports={openDatabase};
