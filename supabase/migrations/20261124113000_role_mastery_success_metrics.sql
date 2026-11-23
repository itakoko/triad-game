-- Make role mastery progress count successful ability outcomes, not ability activations.
do $$
declare v_def text;
begin
 select pg_get_functiondef('public.triad_claim_role_mission(text,integer)'::regprocedure) into v_def;
 v_def:=replace(v_def,
  'when ''僧侶'' then v_metric:=''protections'';v_targets:=array[1,3,6,10,15,22];',
  'when ''僧侶'' then v_metric:=''protection_blocks'';v_targets:=array[1,3,6,10,15,22];');
 v_def:=replace(v_def,
  'when ''インポスター'' then v_metric:=''sabotages'';v_targets:=array[1,3,6,10,15,22];',
  'when ''インポスター'' then v_metric:=''sabotage_kills'';v_targets:=array[1,3,6,10,15,22];');
 v_def:=replace(v_def,
  'when ''イノシシ'' then v_metric:=''charges'';v_targets:=array[1,3,6,10,15,22];',
  'when ''イノシシ'' then v_metric:=''charge_kills'';v_targets:=array[1,3,6,10,15,22];');
 v_def:=replace(v_def,
  'when ''百面相'' then v_metric:=''disguises'';v_targets:=array[1,3,6,10,15,22];',
  'when ''百面相'' then v_metric:=''disguise_kills'';v_targets:=array[1,3,6,10,15,22];');
 v_def:=replace(v_def,
  'when ''放浪者'' then v_metric:=''scents'';v_targets:=array[1,3,6,10,15,22];',
  'when ''放浪者'' then v_metric:=''scented_targets'';v_targets:=array[3,6,12,18,24,30];');
 v_def:=replace(v_def,
  'when ''ギャンブラー'' then v_metric:=''gambler_jackpots'';v_targets:=array[1,2,4,6,9,12];',
  'when ''ギャンブラー'' then v_metric:=''gambler_jackpot_kills'';v_targets:=array[1,2,4,6,9,12];');
 if position('v_metric:=''charge_kills''' in v_def)=0
 or position('v_metric:=''protection_blocks''' in v_def)=0
 or position('v_metric:=''sabotage_kills''' in v_def)=0
 or position('v_metric:=''disguise_kills''' in v_def)=0
 or position('v_metric:=''scented_targets''' in v_def)=0
 or position('v_metric:=''gambler_jackpot_kills''' in v_def)=0 then
  raise exception 'role metric mapping update incomplete';
 end if;
 execute v_def;
end $$;
