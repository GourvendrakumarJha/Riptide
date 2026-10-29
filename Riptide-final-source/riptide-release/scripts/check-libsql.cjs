'use strict';
const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','test/backend.test.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,RIPTIDE_TEST_DRIVER:'libsql',VERCEL:''},stdio:'inherit'});
process.exitCode=result.status??1;
