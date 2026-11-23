create or replace function public.triad_record_period_mission_match(
 p_match_key text,p_role text,p_won boolean,p_survived boolean,p_metrics jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
 v_user uuid:=auth.uid();
 v_day text:=to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD');
 v_week text:=to_char(date_trunc('week',now() at time zone 'Asia/Tokyo')::date,'YYYY-MM-DD');
 v_tasks integer:=least(30,greatest(0,coalesce((p_metrics->>'tasks')::integer,0)));
 v_abilities integer:=0;
 v_last_match timestamptz;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if p_match_key is null or length(p_match_key)>160 then raise exception 'invalid_match_key'; end if;
 perform 1 from public.player_profiles where user_id=v_user for update;
 if not found then raise exception 'profile_not_found'; end if;
 if exists(select 1 from public.triad_period_match_events where user_id=v_user and match_key=p_match_key) then
  return jsonb_build_object('duplicate',true);
 end if;
 select max(created_at) into v_last_match from public.triad_period_match_events where user_id=v_user;
 if v_last_match is not null and v_last_match>now()-interval '60 seconds' then raise exception 'match_too_soon'; end if;
 v_abilities:=least(20,
   greatest(0,coalesce((p_metrics->>'seer_uses')::integer,0))+
   greatest(0,coalesce((p_metrics->>'protections')::integer,0))+
   greatest(0,coalesce((p_metrics->>'sabotages')::integer,0))+
   greatest(0,coalesce((p_metrics->>'charges')::integer,0))+
   greatest(0,coalesce((p_metrics->>'disguises')::integer,0))+
   greatest(0,coalesce((p_metrics->>'scents')::integer,0))+
   greatest(0,coalesce((p_metrics->>'gambler_rolls')::integer,0))+
   greatest(0,coalesce((p_metrics->>'kills')::integer,0)));
 insert into public.triad_period_match_events(user_id,match_key) values(v_user,p_match_key);
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