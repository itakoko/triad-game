-- Random cosmetic gacha. Existing shop catalog rows stay active=false and are not sold in the shop.
alter table public.player_cosmetic_inventory drop constraint if exists player_cosmetic_inventory_source_check;
alter table public.player_cosmetic_inventory add constraint player_cosmetic_inventory_source_check check (source = any (array['starter','shop','trade','gacha']::text[]));
alter table public.player_coin_transactions drop constraint if exists player_coin_transactions_reason_check;
alter table public.player_coin_transactions add constraint player_coin_transactions_reason_check check (reason = any (array['match_reward','shop_purchase','gacha_purchase','gacha_duplicate']::text[]));

insert into public.player_cosmetic_catalog(item_code,item_kind,cosmetic_id,display_name,price,active) values
('hat:paper_bag','hat','paper_bag','紙袋ヘッド',1,false),
('hat:cat_ears','hat','cat_ears','ねこ耳フード',1,false),
('scarf:ribbon','scarf','ribbon','星結びリボン',1,false),
('hat:wizard','hat','wizard','星詠みの帽子',1,false),
('scarf:stardust','scarf','stardust','星屑マフラー',1,false),
('hat:dragon_horns','hat','dragon_horns','竜角ヘルム',1,false),
('hat:aurora_crown','hat','aurora_crown','オーロラ王冠',1,false)
on conflict(item_code) do update set item_kind=excluded.item_kind,cosmetic_id=excluded.cosmetic_id,display_name=excluded.display_name,active=false;

create table if not exists public.gacha_banners(banner_id text primary key,display_name text not null,single_cost integer not null check(single_cost>0),ten_cost integer not null check(ten_cost>0),active boolean not null default true,created_at timestamptz not null default now());
insert into public.gacha_banners values('season1','TRIAD コレクションガチャ',100,900,true,now())
on conflict(banner_id) do update set display_name=excluded.display_name,single_cost=excluded.single_cost,ten_cost=excluded.ten_cost,active=excluded.active;

create table if not exists public.gacha_pool(
 banner_id text not null references public.gacha_banners(banner_id) on delete cascade,
 item_code text not null unique references public.player_cosmetic_catalog(item_code),
 display_name text not null,item_kind text not null check(item_kind in ('hat','scarf')),
 cosmetic_id text not null,rarity text not null check(rarity in ('N','R','SR','SSR','UR')),
 weight integer not null default 1 check(weight>0),active boolean not null default true,primary key(banner_id,item_code)
);
insert into public.gacha_pool(banner_id,item_code,display_name,item_kind,cosmetic_id,rarity,weight,active) values
('season1','hat:paper_bag','紙袋ヘッド','hat','paper_bag','N',1,true),
('season1','hat:cat_ears','ねこ耳フード','hat','cat_ears','R',1,true),
('season1','scarf:ribbon','星結びリボン','scarf','ribbon','R',1,true),
('season1','hat:wizard','星詠みの帽子','hat','wizard','SR',1,true),
('season1','scarf:stardust','星屑マフラー','scarf','stardust','SR',1,true),
('season1','hat:dragon_horns','竜角ヘルム','hat','dragon_horns','SSR',1,true),
('season1','hat:aurora_crown','オーロラ王冠','hat','aurora_crown','UR',1,true)
on conflict(item_code) do update set banner_id=excluded.banner_id,display_name=excluded.display_name,item_kind=excluded.item_kind,cosmetic_id=excluded.cosmetic_id,rarity=excluded.rarity,weight=excluded.weight,active=excluded.active;

create table if not exists public.gacha_history(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,draw_index integer not null,banner_id text not null references public.gacha_banners(banner_id),
 item_code text not null references public.player_cosmetic_catalog(item_code),display_name text not null,
 rarity text not null check(rarity in ('N','R','SR','SSR','UR')),duplicate boolean not null default false,
 compensation integer not null default 0 check(compensation>=0),created_at timestamptz not null default now(),
 unique(user_id,request_id,draw_index)
);
create index if not exists gacha_history_user_created_idx on public.gacha_history(user_id,created_at desc);
create table if not exists public.gacha_pull_requests(
 user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,
 banner_id text not null references public.gacha_banners(banner_id),pull_count integer not null check(pull_count in (1,10)),
 coin_cost integer not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);

alter table public.gacha_banners enable row level security;
alter table public.gacha_pool enable row level security;
alter table public.gacha_history enable row level security;
alter table public.gacha_pull_requests enable row level security;
drop policy if exists "gacha banners readable" on public.gacha_banners;
create policy "gacha banners readable" on public.gacha_banners for select to anon,authenticated using(active);
drop policy if exists "gacha pool readable" on public.gacha_pool;
create policy "gacha pool readable" on public.gacha_pool for select to anon,authenticated using(active and exists(select 1 from public.gacha_banners b where b.banner_id=gacha_pool.banner_id and b.active));
drop policy if exists "players read own gacha history" on public.gacha_history;
create policy "players read own gacha history" on public.gacha_history for select to authenticated using(user_id=auth.uid());
revoke all on public.gacha_pull_requests from anon,authenticated;
revoke insert,update,delete on public.gacha_history from anon,authenticated;
grant select on public.gacha_banners,public.gacha_pool to anon,authenticated;
grant select on public.gacha_history to authenticated;

create or replace function public.gacha_execute(p_user_id uuid,p_request_id uuid,p_count integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_banner public.gacha_banners%rowtype;v_wallet integer;v_cost integer;v_roll numeric;v_rarity text;
 v_item public.gacha_pool%rowtype;v_duplicate boolean;v_comp integer;v_total_comp integer:=0;
 v_results jsonb:='[]'::jsonb;v_existing jsonb;v_i integer;v_new_balance integer;
begin
 if p_user_id is null or p_request_id is null or p_count not in (1,10) then raise exception 'INVALID_GACHA_REQUEST' using errcode='22023'; end if;
 insert into public.player_wallets(user_id,coins) values(p_user_id,0) on conflict(user_id) do nothing;
 select coins into v_wallet from public.player_wallets where user_id=p_user_id for update;
 select * into v_banner from public.gacha_banners where banner_id='season1' and active=true;
 if not found then raise exception 'GACHA_NOT_AVAILABLE'; end if;
 v_cost:=case when p_count=10 then v_banner.ten_cost else v_banner.single_cost end;
 select result into v_existing from public.gacha_pull_requests where user_id=p_user_id and request_id=p_request_id;
 if found then return v_existing; end if;
 if coalesce(v_wallet,0)<v_cost then raise exception 'NOT_ENOUGH_COINS' using errcode='P0001'; end if;
 for v_i in 1..p_count loop
  v_roll:=random()*100;
  v_rarity:=case when v_roll<50 then 'N' when v_roll<80 then 'R' when v_roll<95 then 'SR' when v_roll<99 then 'SSR' else 'UR' end;
  select * into v_item from public.gacha_pool where banner_id=v_banner.banner_id and active=true and rarity=v_rarity order by random()*weight desc limit 1;
  if not found then select * into v_item from public.gacha_pool where banner_id=v_banner.banner_id and active=true order by random()*weight desc limit 1; end if;
  if not found then raise exception 'GACHA_POOL_EMPTY'; end if;
  select exists(select 1 from public.player_cosmetic_inventory where user_id=p_user_id and item_code=v_item.item_code) into v_duplicate;
  v_comp:=case when v_duplicate then case v_item.rarity when 'N' then 20 when 'R' then 40 when 'SR' then 100 when 'SSR' then 300 when 'UR' then 1000 else 0 end else 0 end;
  v_total_comp:=v_total_comp+v_comp;
  if not v_duplicate then insert into public.player_cosmetic_inventory(user_id,item_code,source) values(p_user_id,v_item.item_code,'gacha') on conflict(user_id,item_code) do nothing; end if;
  insert into public.gacha_history(user_id,request_id,draw_index,banner_id,item_code,display_name,rarity,duplicate,compensation)
   values(p_user_id,p_request_id,v_i,v_banner.banner_id,v_item.item_code,v_item.display_name,v_item.rarity,v_duplicate,v_comp);
  v_results:=v_results||jsonb_build_array(jsonb_build_object('item_code',v_item.item_code,'display_name',v_item.display_name,'item_kind',v_item.item_kind,'cosmetic_id',v_item.cosmetic_id,'rarity',v_item.rarity,'duplicate',v_duplicate,'compensation',v_comp));
 end loop;
 update public.player_wallets set coins=coins-v_cost+v_total_comp,updated_at=now() where user_id=p_user_id returning coins into v_new_balance;
 insert into public.player_coin_transactions(user_id,amount,reason,reference_key) values(p_user_id,-v_cost,'gacha_purchase','gacha:'||p_request_id::text);
 if v_total_comp>0 then insert into public.player_coin_transactions(user_id,amount,reason,reference_key) values(p_user_id,v_total_comp,'gacha_duplicate','gacha-duplicate:'||p_request_id::text); end if;
 v_existing:=jsonb_build_object('banner_id',v_banner.banner_id,'pull_count',p_count,'coin_cost',v_cost,'duplicate_compensation',v_total_comp,'coins',v_new_balance,'results',v_results);
 insert into public.gacha_pull_requests(user_id,request_id,banner_id,pull_count,coin_cost,result) values(p_user_id,p_request_id,v_banner.banner_id,p_count,v_cost,v_existing);
 return v_existing;
end; $$;
revoke all on function public.gacha_execute(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.gacha_execute(uuid,uuid,integer) to service_role;
