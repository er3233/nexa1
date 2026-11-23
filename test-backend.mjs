import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
const db = new PGlite({ extensions: { pgcrypto } });
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', c='00000000-0000-4000-8000-000000000003', conv='00000000-0000-4000-8000-000000000011';
try {
 await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create schema storage; create schema realtime; create schema extensions; create extension pgcrypto with schema extensions;
 create table auth.users (id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean default false);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create table realtime.messages(id uuid primary key default gen_random_uuid()); create function realtime.topic() returns text language sql as $$select ''::text$$; create publication supabase_realtime;`);
 const files=['supabase/new-project/supabase/migrations/20261123192236_base_schema.sql','supabase/new-project/supabase/migrations/20261123192253_disappearing_messages.sql','supabase/new-project/supabase/migrations/20261123192255_restrict_helper_privileges.sql','supabase/new-project/supabase/migrations/20261123192256_push_subscriptions.sql','supabase/new-project/supabase/migrations/20261123192258_block_direct_messages.sql','supabase/new-project/supabase/migrations/20261123192300_restrict_conversation_join.sql','supabase/new-project/supabase/migrations/20261123192608_restrict_anonymous_definers.sql','supabase/new-project/supabase/migrations/20261123192754_protect_message_identity.sql'];
 for (const file of files) { await db.exec(await readFile(file,'utf8')); console.log('PASS SQL',file); }
 await db.exec(`grant usage on schema public to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated;
 insert into auth.users(id,email,raw_user_meta_data) values ('${a}','a@example.test','{"username":"test_a"}'),('${b}','b@example.test','{"username":"test_b"}'),('${c}','c@example.test','{"username":"test_c"}');
 set session_replication_role=replica; update public.profiles set approval_status='approved'; set session_replication_role=origin;
 insert into public.conversations(id,created_by,is_group,type) values ('${conv}','${a}',false,'direct');
 insert into public.conversation_members(conversation_id,user_id) values ('${conv}','${a}'),('${conv}','${b}');`);
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${c}',false)`);
 try { await db.exec(`insert into public.conversation_members(conversation_id,user_id) values ('${conv}','${c}')`); throw new Error('unauthorized membership succeeded'); } catch(e) { if(!/row-level security/i.test(e.message)) throw e; console.log('PASS unauthorized membership rejected'); }
 await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
 await db.exec(`insert into public.messages(conversation_id,sender_id,content) values ('${conv}','${a}','test')`); console.log('PASS permitted message');
 await db.exec(`update public.messages set content='edited' where conversation_id='${conv}'`); console.log('PASS message edit');
 try { await db.exec(`update public.messages set conversation_id='00000000-0000-4000-8000-000000000099' where conversation_id='${conv}'`); throw new Error('message relocation succeeded'); } catch(e) { if(!/değiştirilemez/.test(e.message)) throw e; console.log('PASS message relocation rejected'); }
 await db.exec(`insert into public.blocked_users(blocker_id,blocked_id) values ('${a}','${b}')`);
 try { await db.exec(`insert into public.messages(conversation_id,sender_id,content) values ('${conv}','${a}','test')`); throw new Error('blocked message succeeded'); } catch(e) { if(!/row-level security/i.test(e.message)) throw e; console.log('PASS blocked message rejected'); }
 await db.exec(`insert into public.push_subscriptions(user_id,endpoint) values ('${a}','https://example.test/push')`);
 await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
 const sub=await db.query(`select endpoint from public.push_subscriptions`); if(sub.rows.length) throw new Error('other user can read push subscription'); console.log('PASS push subscription isolation');
 try { await db.exec(`insert into public.push_subscriptions(user_id,endpoint) values ('${a}','https://example.test/other')`); throw new Error('other user can insert push subscription'); } catch(e) { if(!/row-level security/i.test(e.message)) throw e; console.log('PASS push subscription ownership'); }
 await db.exec(`reset role; set session_replication_role=replica; update public.profiles set role='admin' where id='${a}'; update public.profiles set approval_status='pending' where id='${c}'; set session_replication_role=origin; set role authenticated; select set_config('request.jwt.claim.sub','${b}',false)`);
 try { await db.exec(`select public.admin_approve_user('${c}')`); throw new Error('non-admin approval succeeded'); } catch(e) { if(!/Yetki yok/i.test(e.message)) throw e; console.log('PASS non-admin approval rejected'); }
 await db.exec(`select set_config('request.jwt.claim.sub','${a}',false); select public.admin_approve_user('${c}')`); console.log('PASS admin approval and audit helper');
 const r=await db.query(`select has_function_privilege('authenticated','public.log_admin_action(text,text,uuid,jsonb)','EXECUTE') as audit_call,has_function_privilege('authenticated','public.find_direct_conversation(uuid,uuid)','EXECUTE') as direct_lookup,has_function_privilege('anon','public.get_unread_total_for(uuid)','EXECUTE') as push_call`);
 console.log('FUNCTION EXECUTE',JSON.stringify(r.rows));
} catch(e) { console.error('FAIL',e.message); process.exitCode=1; } finally { await db.close(); }


