create table if not exists public.triad_period_mission_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('daily','weekly')),
  period_key text not null,
  mission_code text not null,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_type, period_key, mission_code)
);
create table if not exists public.triad_period_match_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, match_key)
);
alter table public.triad_period_mission_progress enable row level security;
alter table public.triad_period_match_events enable row level security;
drop policy if exists "Users read own period mission progress" on public.triad_period_mission_progress;
create policy "Users read own period mission progress" on public.triad_period_mission_progress
 for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.triad_period_mission_progress to authenticated;
revoke all on public.triad_period_match_events from anon, authenticated;

create or replace function public.triad_record_period_mission_match(p_match_key text,p_role text,p_won boolean,p_survived boolean,p_metrics jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
 v_user uuid:=auth.uid();
 v_day text:=to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD');
 v_week text:=to_char(date_trunc('week',now() at time zone 'Asia/Tokyo')::date,'YYYY-MM-DD');
 v_tasks integer:=greatest(0,coalesce((p_metrics->>'tasks')::integer,0));
 v_abilities integer:=0;
 v_inserted integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if p_match_key is null or length(p_match_key)>160 then raise exception 'invalid_match_key'; end if;
 v_abilities:=greatest(0,coalesce((p_metrics->>'seer_uses')::integer,0))
 +greatest(0,coalesce((p_metrics->>'protections')::integer,0))
 +greatest(0,coalesce((p_metrics->>'sabotages')::integer,0))
 +greatest(0,coalesce((p_metrics->>'charges')::integer,0))
 +greatest(0,coalesce((p_metrics->>'disguises')::integer,0))
 +greatest(0,coalesce((p_metrics->>'scents')::integer,0))
 +greatest(0,coalesce((p_metrics->>'gambler_rolls')::integer,0))
 +greatest(0,coalesce((p_metrics->>'kills')::integer,0));
 insert into public.triad_period_match_events(user_id,match_key) values(v_user,p_match_key) on conflict do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then return jsonb_build_object('duplicate',true); end if;
 insert into public.triad_period_mission_progress(user_id,period_type,period_key,mission_code,progress) values
 (v_user,'daily',v_day,'daily_matches',1),
 (v_user,'daily',v_day,'daily_wins',case when coalesce(p_won,false) then 1 else 0 end),
 (v_user,'daily',v_day,'daily_tasks',v_tasks),
 (v_user,'weekly',v_week,'weekly_matches',1),
 (v_user,'weekly',v_week,'weekly_wins',case when coalesce(p_won,false) then 1 else 0 end),
 (v_user,'weekly',v_week,'weekly_survivals',case when coalesce(p_survived,false) then 1 else 0 end),
 (v_user,'weekly',v_week,'weekly_abilities',v_abilities),
 (v_user,'weekly',v_week,'weekly_tasks',v_tasks)
 on conflict(user_id,period_type,period_key,mission_code)
 do update set progress=triad_period_mission_progress.progress+excluded.progress,updated_at=now();
 return jsonb_build_object('recorded',true,'daily_key',v_day,'weekly_key',v_week);
end;
$function$;
revoke all on function public.triad_record_period_mission_match(text,text,boolean,boolean,jsonb) from public,anon;
grant execute on function public.triad_record_period_mission_match(text,text,boolean,boolean,jsonb) to authenticated;

create or replace function public.triad_claim_period_mission(p_period_type text,p_mission_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
 v_user uuid:=auth.uid();v_key text;v_need integer;v_coins integer;v_xp integer;v_progress integer;v_balance integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if p_period_type='daily' then v_key:=to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD');
 elsif p_period_type='weekly' then v_key:=to_char(date_trunc('week',now() at time zone 'Asia/Tokyo')::date,'YYYY-MM-DD');
 else raise exception 'invalid_period_type'; end if;
 case p_mission_code
  when 'daily_matches' then v_need:=1;v_coins:=40;v_xp:=20;
  when 'daily_wins' then v_need:=1;v_coins:=60;v_xp:=30;
  when 'daily_tasks' then v_need:=3;v_coins:=50;v_xp:=25;
  when 'weekly_matches' then v_need:=10;v_coins:=200;v_xp:=100;
  when 'weekly_wins' then v_need:=5;v_coins:=250;v_xp:=125;
  when 'weekly_survivals' then v_need:=5;v_coins:=200;v_xp:=100;
  when 'weekly_abilities' then v_need:=15;v_coins:=300;v_xp:=150;
  when 'weekly_tasks' then v_need:=20;v_coins:=250;v_xp:=125;
  else raise exception 'invalid_period_mission';
 end case;
 update public.triad_period_mission_progress set claimed_at=now(),updated_at=now()
 where user_id=v_user and period_type=p_period_type and period_key=v_key
 and mission_code=p_mission_code and claimed_at is null and progress>=v_need
 returning progress into v_progress;
 if not found then raise exception 'mission_not_ready_or_claimed'; end if;
 insert into public.player_wallets(user_id,coins,updated_at) values(v_user,0,now()) on conflict(user_id) do nothing;
 update public.player_wallets set coins=coins+v_coins,updated_at=now() where user_id=v_user returning coins into v_balance;
 insert into public.player_coin_transactions(user_id,amount,reason,reference_key)
 values(v_user,v_coins,'mission_reward','mission:'||p_period_type||':'||v_key||':'||p_mission_code);
 update public.player_profiles set experience_points=experience_points+v_xp,
 player_level=((experience_points+v_xp)/100)+1,updated_at=now() where user_id=v_user;
 return jsonb_build_object('claimed',true,'period_type',p_period_type,'mission_code',p_mission_code,'progress',v_progress,'coins',v_coins,'xp',v_xp,'balance',v_balance);
end;
$function$;
revoke all on function public.triad_claim_period_mission(text,text) from public,anon;
grant execute on function public.triad_claim_period_mission(text,text) to authenticated;