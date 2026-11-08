import { Pool, type QueryResultRow } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

let pool: Pool | undefined;
function connection() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
    const url=new URL(process.env.DATABASE_URL);url.searchParams.set('sslmode','verify-full');
    pool = new Pool({ connectionString:url.toString(), max:5, idleTimeoutMillis:10000, connectionTimeoutMillis:15000 });
    // pg removes the failed idle client; do not crash or dump connection metadata.
    pool.on('error',()=>console.warn('An idle database connection was closed; the pool will reconnect.'));
    attachDatabasePool(pool);
  }
  return pool;
}
class Statement {
  readonly sql:string;
  constructor(sql:string, readonly values:unknown[] = []) { let n=0; this.sql=sql.replace(/\?/g,()=>`$${++n}`); }
  bind(...values:unknown[]) { return new Statement(this.sql,values); }
  async first<T = Record<string,unknown>>():Promise<T|null> { const result=await connection().query(this.sql,this.values); return (result.rows[0] as T)??null; }
  async all<T = Record<string,unknown>>() { const result=await connection().query(this.sql,this.values); return {results:result.rows as T[]}; }
  async run() { const result=await connection().query(this.sql,this.values); return {meta:{changes:result.rowCount??0}}; }
}
export const database = () => ({
  prepare:(sql:string)=>new Statement(sql),
  async batch(statements:Statement[]) {
    const client=await connection().connect();
    try { await client.query('BEGIN'); const results:QueryResultRow[]=[];
      for (const statement of statements) { const r=await client.query(statement.sql,statement.values); results.push({results:r.rows,meta:{changes:r.rowCount??0}}); }
      await client.query('COMMIT'); return results;
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
  }
});
