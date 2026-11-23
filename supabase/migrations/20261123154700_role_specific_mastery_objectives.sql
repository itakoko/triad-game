create or replace function public.triad_claim_role_mission(p_role text, p_tier integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_profile public.player_profiles%rowtype;
  v_mastery jsonb;
  v_metric text;
  v_targets integer[];
  v_value integer;
  v_need integer;
  v_code text;
  v_coins integer;
  v_xp integer;
  v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if p_tier not between 1 and 3 then raise exception 'invalid_tier'; end if;
  case p_role
    when 'クルー' then v_metric := 'tasks'; v_targets := array[3,12,30];
    when 'サイエンティスト' then v_metric := 'scientist_checks'; v_targets := array[1,5,12];
    when '恋人' then v_metric := 'partner_survivals'; v_targets := array[1,3,8];
    when '占い師' then v_metric := 'seer_uses'; v_targets := array[1,3,6];
    when '狩人' then v_metric := 'kills'; v_targets := array[1,2,4];
    when '保安官' then v_metric := 'kills'; v_targets := array[1,2,3];
    when '僧侶' then v_metric := 'protections'; v_targets := array[1,3,6];
    when 'ライトキーパー' then v_metric := 'lightkeeper_survivals'; v_targets := array[1,4,10];
    when 'インポスター' then v_metric := 'sabotages'; v_targets := array[1,3,6];
    when 'イノシシ' then v_metric := 'charges'; v_targets := array[1,3,6];
    when '百面相' then v_metric := 'disguises'; v_targets := array[1,3,6];
    when '放浪者' then v_metric := 'scents'; v_targets := array[1,3,6];
    when '暗殺者' then v_metric := 'bounty_kills'; v_targets := array[1,2,4];
    when 'てるてる' then v_metric := 'jester_wins'; v_targets := array[1,2,4];
    when '狂人' then v_metric := 'kills'; v_targets := array[1,2,4];
    when 'ギャンブラー' then v_metric := 'gambler_jackpots'; v_targets := array[1,2,4];
    else raise exception 'invalid_role';
  end case;
  select * into v_profile from public.player_profiles where user_id = v_user for update;
  if not found then raise exception 'profile_not_found'; end if;
  v_mastery := coalesce(v_profile.role_mastery, '{}'::jsonb);
  v_value := coalesce((v_mastery -> p_role -> 'metrics' ->> v_metric)::integer, 0);
  v_need := v_targets[p_tier];
  if v_value < v_need then raise exception 'mission_not_completed'; end if;
  v_code := 'role:' || p_role || ':' || p_tier::text;
  v_coins := (array[50,150,400])[p_tier];
  v_xp := (array[25,75,200])[p_tier];
  insert into public.player_wallets(user_id,coins,updated_at) values(v_user,0,now()) on conflict(user_id) do nothing;
  insert into public.triad_role_mission_claims(user_id,mission_code,role_name,tier,reward_coins,reward_xp)
  values(v_user,v_code,p_role,p_tier,v_coins,v_xp) on conflict(user_id,mission_code) do nothing;
  if not found then raise exception 'mission_already_claimed'; end if;
  update public.player_wallets set coins=coins+v_coins,updated_at=now()
  where user_id=v_user returning coins into v_balance;
  insert into public.player_coin_transactions(user_id,amount,reason,reference_key)
  values(v_user,v_coins,'mission_reward','mission:'||v_code);
  update public.player_profiles
  set experience_points=experience_points+v_xp,
      player_level=((experience_points+v_xp)/100)+1,updated_at=now()
  where user_id=v_user;
  return jsonb_build_object('claimed',true,'mission_code',v_code,'metric',v_metric,'progress',v_value,'required',v_need,'coins',v_coins,'xp',v_xp,'balance',v_balance);
end;
$function$;
revoke all on function public.triad_claim_role_mission(text, integer) from public, anon;
grant execute on function public.triad_claim_role_mission(text, integer) to authenticated;
