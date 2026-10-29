'use strict';
// One stateless Vercel entry point; all durable state lives in hosted libSQL.
module.exports=async function(req,res){
 try{const {handler}=await require('../server.js').ready;return handler(req,res)}
 catch(error){console.error('Riptide initialization failed:',error.message);res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Database initialization failed. Check the hosted database environment variables and function logs.'}))}
};
module.exports.config={api:{bodyParser:false}};
