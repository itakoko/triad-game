drop policy if exists "Authenticated users can view gacha cosmetic catalog" on public.player_cosmetic_catalog;
create policy "Authenticated users can view gacha cosmetic catalog"
on public.player_cosmetic_catalog for select to authenticated
using (exists(select 1 from public.gacha_pool gp where gp.item_code=player_cosmetic_catalog.item_code and gp.active));