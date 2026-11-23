create or replace function public.triad_claim_role_mission(p_role text,p_tier integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
 v_user uuid:=auth.uid();v_profile public.player_profiles%rowtype;v_mastery jsonb;v_metric text;v_targets integer[];
 v_value integer;v_need integer;v_code text;v_previous_code text;v_coins integer;v_xp integer;v_balance integer;v_title text;v_outfit_id text;v_outfit_name text;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if p_tier not between 1 and 6 then raise exception 'invalid_tier'; end if;
 case p_role
  when 'クルー' then v_metric:='tasks';v_targets:=array[3,12,30,45,65,90];
  when 'サイエンティスト' then v_metric:='scientist_checks';v_targets:=array[1,5,12,18,26,36];
  when '恋人' then v_metric:='partner_survivals';v_targets:=array[1,3,8,12,18,25];
  when '占い師' then v_metric:='seer_uses';v_targets:=array[1,3,6,10,16,24];
  when '狩人' then v_metric:='kills';v_targets:=array[1,2,4,6,9,12];
  when '保安官' then v_metric:='kills';v_targets:=array[1,2,3,5,7,10];
  when '僧侶' then v_metric:='protections';v_targets:=array[1,3,6,10,15,22];
  when 'ライトキーパー' then v_metric:='lightkeeper_survivals';v_targets:=array[1,4,10,15,22,30];
  when 'インポスター' then v_metric:='sabotages';v_targets:=array[1,3,6,10,15,22];
  when 'イノシシ' then v_metric:='charges';v_targets:=array[1,3,6,10,15,22];
  when '百面相' then v_metric:='disguises';v_targets:=array[1,3,6,10,15,22];
  when '放浪者' then v_metric:='scents';v_targets:=array[1,3,6,10,15,22];
  when '暗殺者' then v_metric:='bounty_kills';v_targets:=array[1,2,4,6,9,12];
  when 'てるてる' then v_metric:='jester_wins';v_targets:=array[1,2,4,6,9,12];
  when '狂人' then v_metric:='kills';v_targets:=array[1,2,4,6,9,12];
  when 'ギャンブラー' then v_metric:='gambler_jackpots';v_targets:=array[1,2,4,6,9,12];
  else raise exception 'invalid_role';
 end case;
 select * into v_profile from public.player_profiles where user_id=v_user for update;
 if not found then raise exception 'profile_not_found'; end if;
 v_mastery:=coalesce(v_profile.role_mastery,'{}'::jsonb);v_code:='role:'||p_role||':'||p_tier::text;
 if p_tier>1 then
  v_previous_code:='role:'||p_role||':'||(p_tier-1)::text;
  if not exists(select 1 from public.triad_role_mission_claims where user_id=v_user and mission_code=v_previous_code) then raise exception 'previous_tier_required'; end if;
 end if;
 v_value:=coalesce((v_mastery->p_role->'metrics'->>v_metric)::integer,0);v_need:=v_targets[p_tier];
 if v_value<v_need then raise exception 'mission_not_completed'; end if;
 v_coins:=(array[50,150,400,650,1000,1600])[p_tier];v_xp:=(array[25,75,200,325,500,800])[p_tier];
 if p_tier>=4 then
  v_title:=case p_role
   when 'クルー' then (array['不落の整備士','伝説の施設管理者','研究所の守護神'])[p_tier-3]
   when 'サイエンティスト' then (array['真理の観測者','生命記録の賢者','宇宙の研究者'])[p_tier-3]
   when '恋人' then (array['永遠の絆','運命共同体','双星の誓い'])[p_tier-3]
   when '占い師' then (array['星詠みの預言者','運命の導き手','未来を見通す者'])[p_tier-3]
   when '狩人' then (array['百戦錬磨の狩人','月影の追跡者','伝説の狩猟王'])[p_tier-3]
   when '保安官' then (array['秩序の執行者','正義の象徴','絶対の保安官'])[p_tier-3]
   when '僧侶' then (array['慈愛の守護者','聖域の番人','奇跡を呼ぶ祈り手'])[p_tier-3]
   when 'ライトキーパー' then (array['灯火の継承者','暁を守る者','永遠の灯台守'])[p_tier-3]
   when 'インポスター' then (array['完全犯罪の演出家','暗黒の支配者','誰も知らぬ黒幕'])[p_tier-3]
   when 'イノシシ' then (array['轟天の突進者','大地を砕く者','止められぬ暴走王'])[p_tier-3]
   when '百面相' then (array['千貌の幻影','真実なき変装者','究極の変幻自在'])[p_tier-3]
   when '放浪者' then (array['星間放浪の旅人','境界を越える者','果てなき銀河の旅人'])[p_tier-3]
   when '暗殺者' then (array['無音の処刑人','影を統べる者','闇夜の伝説'])[p_tier-3]
   when 'てるてる' then (array['喝采の道化王','疑心を操る天才','舞台を支配する者'])[p_tier-3]
   when '狂人' then (array['混沌の指揮者','狂気の演出家','混沌そのもの'])[p_tier-3]
   when 'ギャンブラー' then (array['運命を賭ける者','奇跡の勝負師','JACKPOTの化身'])[p_tier-3]
  end;
  v_mastery:=jsonb_set(v_mastery,array[p_role],coalesce(v_mastery->p_role,'{}'::jsonb)||
   jsonb_build_object('titles',case when coalesce(v_mastery->p_role->'titles','[]'::jsonb) ? v_title then coalesce(v_mastery->p_role->'titles','[]'::jsonb) else coalesce(v_mastery->p_role->'titles','[]'::jsonb)||jsonb_build_array(v_title) end),true);
 end if;
 if p_tier=6 then
  v_outfit_id:=case p_role
   when 'クルー' then 'crew_guardian' when 'サイエンティスト' then 'quantum_labcoat'
   when '恋人' then 'twin_star' when '占い師' then 'oracle' when '狩人' then 'moon_hunter'
   when '保安官' then 'marshal' when '僧侶' then 'sanctuary' when 'ライトキーパー' then 'aurora_lantern'
   when 'インポスター' then 'phantom' when 'イノシシ' then 'tusk_breaker' when '百面相' then 'chameleon'
   when '放浪者' then 'starfarer' when '暗殺者' then 'shadow' when 'てるてる' then 'jester_royal'
   when '狂人' then 'chaos' when 'ギャンブラー' then 'jackpot' end;
  v_outfit_name:=case p_role
   when 'クルー' then '守護整備士スーツ' when 'サイエンティスト' then '量子研究コート'
   when '恋人' then '双星のペアスーツ' when '占い師' then '星詠みのローブ' when '狩人' then '月影ハンターアーマー'
   when '保安官' then '治安執行ジャケット' when '僧侶' then '聖域の法衣' when 'ライトキーパー' then 'オーロラ灯守装束'
   when 'インポスター' then '深淵の潜伏スーツ' when 'イノシシ' then '轟天ブレイカーアーマー' when '百面相' then '千貌カメレオンスーツ'
   when '放浪者' then '銀河放浪コート' when '暗殺者' then '影縫いステルススーツ' when 'てるてる' then '喝采の道化王衣装'
   when '狂人' then '混沌オーバーローブ' when 'ギャンブラー' then 'JACKPOTディーラースーツ' end;
  if v_outfit_id is not null then
   v_mastery:=jsonb_set(v_mastery,array[p_role],coalesce(v_mastery->p_role,'{}'::jsonb)||
    jsonb_build_object('outfits',case when coalesce(v_mastery->p_role->'outfits','[]'::jsonb) ? v_outfit_id then coalesce(v_mastery->p_role->'outfits','[]'::jsonb) else coalesce(v_mastery->p_role->'outfits','[]'::jsonb)||jsonb_build_array(v_outfit_id) end),true);
  end if;
 end if;
 insert into public.triad_role_mission_claims(user_id,mission_code,role_name,tier,reward_coins,reward_xp)
 values(v_user,v_code,p_role,p_tier,v_coins,v_xp) on conflict(user_id,mission_code) do nothing;
 if not found then raise exception 'mission_already_claimed'; end if;
 insert into public.player_wallets(user_id,coins,updated_at) values(v_user,0,now()) on conflict(user_id) do nothing;
 update public.player_wallets set coins=coins+v_coins,updated_at=now() where user_id=v_user returning coins into v_balance;
 insert into public.player_coin_transactions(user_id,amount,reason,reference_key) values(v_user,v_coins,'mission_reward','mission:'||v_code);
 update public.player_profiles set role_mastery=v_mastery,experience_points=experience_points+v_xp,
 player_level=((experience_points+v_xp)/100)+1,updated_at=now() where user_id=v_user;
 return jsonb_build_object('claimed',true,'mission_code',v_code,'metric',v_metric,'progress',v_value,'required',v_need,'coins',v_coins,'xp',v_xp,'balance',v_balance,'title',v_title,'outfit',v_outfit_name);
end;
$function$;
revoke all on function public.triad_claim_role_mission(text,integer) from public,anon;
grant execute on function public.triad_claim_role_mission(text,integer) to authenticated;

do $backfill$
declare r record;v_id text;
begin
 for r in select distinct user_id,role_name from public.triad_role_mission_claims where tier=6 loop
  v_id:=case r.role_name
   when 'クルー' then 'crew_guardian' when 'サイエンティスト' then 'quantum_labcoat'
   when '恋人' then 'twin_star' when '占い師' then 'oracle' when '狩人' then 'moon_hunter'
   when '保安官' then 'marshal' when '僧侶' then 'sanctuary' when 'ライトキーパー' then 'aurora_lantern'
   when 'インポスター' then 'phantom' when 'イノシシ' then 'tusk_breaker' when '百面相' then 'chameleon'
   when '放浪者' then 'starfarer' when '暗殺者' then 'shadow' when 'てるてる' then 'jester_royal'
   when '狂人' then 'chaos' when 'ギャンブラー' then 'jackpot' end;
  if v_id is not null then
   update public.player_profiles pp set role_mastery=jsonb_set(coalesce(pp.role_mastery,'{}'::jsonb),array[r.role_name],
    coalesce(pp.role_mastery->r.role_name,'{}'::jsonb)||jsonb_build_object('outfits',
     case when coalesce(pp.role_mastery->r.role_name->'outfits','[]'::jsonb) ? v_id then coalesce(pp.role_mastery->r.role_name->'outfits','[]'::jsonb) else coalesce(pp.role_mastery->r.role_name->'outfits','[]'::jsonb)||jsonb_build_array(v_id) end),true)
   where pp.user_id=r.user_id;
  end if;
 end loop;
end;
$backfill$;

