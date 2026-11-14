// Production-only, additive migration. Preview/local builds never mutate a shared database.
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
if(process.env.VERCEL_ENV==='production') {
  if(!process.env.DATABASE_URL_UNPOOLED)throw new Error('DATABASE_URL_UNPOOLED is required for notifications');
  const url=new URL(process.env.DATABASE_URL_UNPOOLED);url.searchParams.set('sslmode','verify-full');
  const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000,query_timeout:15000});
  try {
    await client.connect();await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shield-complaint-notifications'))");
    await client.query(await readFile(new URL('../migrations/009_complaint_notifications.sql',import.meta.url),'utf8'));
    await client.query(await readFile(new URL('../migrations/010_public_data_source.sql',import.meta.url),'utf8'));
    await client.query('COMMIT');console.log('Complaint notification migration ready.');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Notification migration failed:',error.code||error.name);process.exitCode=1;}
  finally{await client.end();}
}
