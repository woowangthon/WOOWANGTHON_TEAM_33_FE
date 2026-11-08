import {Client} from 'pg';
import {readFile,readdir} from 'node:fs/promises';
const client=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED});
try {await client.connect();await client.query('BEGIN');for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await client.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));await client.query('COMMIT');console.log('Application schema ready.');}
catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Migration failed:',error.code||error.name);process.exitCode=1;}
finally{await client.end();}
