import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
const env=parseEnv(await readFile('.env.local','utf8'));
const url=new URL(env.DATABASE_URL_UNPOOLED||env.DATABASE_URL);url.searchParams.set('sslmode','verify-full');
const client=new Client({connectionString:url.toString()});
try{
  await client.connect();await client.query('BEGIN');
  await client.query(await readFile('migrations/009_phone_channel.sql','utf8'));
  // Optional correction for a known synthetic voice fixture created before the column existed.
  if(process.argv[2])await client.query("UPDATE complaints SET channel='phone' WHERE id=$1 AND is_sample=1",[process.argv[2]]);
  await client.query('COMMIT');console.log('Voice intake channel schema ready.');
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Migration failed:',error.code||error.name);process.exitCode=1;}finally{await client.end();}
