import "server-only";
import { neon } from "@neondatabase/serverless";
import { emptyDesk, type DeskState } from "@/lib/desk-state";
export type DeskUser = { id: string; email: string; emailVerified: boolean };
export function database() { if(!process.env.DATABASE_URL)throw new Error("Database not configured"); return neon(process.env.DATABASE_URL); }
export async function initializeDesk(user: DeskUser) {
  const sql=database();
  await sql.query('INSERT INTO mydesk_documents(owner_id,data) VALUES($1,$2::jsonb) ON CONFLICT(owner_id) DO NOTHING',[user.id,JSON.stringify(emptyDesk())]);
}
export async function readDesk(user: DeskUser): Promise<DeskState> {
  await initializeDesk(user); const rows=await database().query('SELECT data FROM mydesk_documents WHERE owner_id=$1',[user.id]); return rows[0].data;
}
export async function updateDesk(user: DeskUser, change: (state: DeskState)=>DeskState): Promise<DeskState> {
  await initializeDesk(user); const sql=database();
  for(let attempt=0;attempt<5;attempt++) {
    const [row]=await sql.query('SELECT data,revision FROM mydesk_documents WHERE owner_id=$1',[user.id]);
    const next=change(row.data);
    const updated=await sql.query('UPDATE mydesk_documents SET data=$1::jsonb, revision=revision+1,updated_at=now() WHERE owner_id=$2 AND revision=$3 RETURNING data',[JSON.stringify(next),user.id,row.revision]);
    if(updated.length)return updated[0].data;
  }
  throw new Error("Concurrent update; try again");
}
