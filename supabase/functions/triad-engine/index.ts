import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-triad-worker-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const rooms = [
  [110,130,300,250],[470,130,280,250],[1030,100,330,300],[1430,150,250,230],
  [120,690,300,250],[520,690,300,250],[990,650,340,330],[1430,690,250,250],
];
const corridors = [
  [80,420,1640,120],[1680,420,220,120],[1680,520,120,260],[80,540,120,150],
  [210,340,80,140],[570,340,80,140],[1155,340,80,140],[1515,340,80,140],
  [220,520,80,190],[630,520,80,190],[1120,520,80,190],[1515,520,80,190],
];
const props = [
  [145,185,34,54],[350,315,42,38],[500,305,36,46],[690,300,34,48],
  [1040,330,34,46],[1320,325,30,42],[1448,310,34,42],[1630,300,34,48],
  [145,852,42,40],[355,852,42,40],[540,850,34,44],[770,850,34,44],
  [1005,900,40,42],[1280,890,42,42],[1445,870,34,46],[1630,855,36,48],
  [790,445,34,42],[980,535,34,42],[420,432,38,22],[620,508,38,22],
  [1255,432,38,22],[1400,508,38,22],[1730,435,34,22],[1728,650,22,38],[120,590,22,38],
];

function clearLineOfSight(x1:number,y1:number,x2:number,y2:number) {
  const distance=Math.hypot(x2-x1,y2-y1),steps=Math.max(1,Math.ceil(distance/12));
  for(let i=1;i<steps;i++){
    const x=x1+(x2-x1)*i/steps,y=y1+(y2-y1)*i/steps;
    if(props.some(([px,py,w,h])=>x>=px-7&&x<=px+w+7&&y>=py-7&&y<=py+h+7))return false;
  }
  return true;
}

function walkable(x: number, y: number) {
  const inRoom = rooms.some(([rx,ry,w,h]) => x >= rx+10 && x <= rx+w-10 && y >= ry+10 && y <= ry+h-10);
  const inCorridor = corridors.some(([cx,cy,w,h]) => x >= cx+5 && x <= cx+w-5 && y >= cy+5 && y <= cy+h-5);
  const blocked = props.some(([px,py,w,h]) => x >= px-7 && x <= px+w+7 && y >= py-7 && y <= py+h+7);
  return (inRoom || inCorridor) && !blocked;
}

function findPath(sx: number, sy: number, gx: number, gy: number): number[][] {
  const step = 32, cols = Math.ceil(2000/step), rows = Math.ceil(1320/step), count = cols*rows;
  const point = (id: number): [number,number] => [(id%cols)*step+step/2, Math.floor(id/cols)*step+step/2];
  const closest = (x: number, y: number) => {
    const bx = Math.max(0,Math.min(cols-1,Math.floor(x/step)));
    const by = Math.max(0,Math.min(rows-1,Math.floor(y/step)));
    for(let radius=0;radius<7;radius++) {
      for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++) {
        if(Math.max(Math.abs(dx),Math.abs(dy))!==radius) continue;
        const x0=bx+dx,y0=by+dy;
        if(x0<0||y0<0||x0>=cols||y0>=rows) continue;
        if(walkable(x0*step+step/2,y0*step+step/2)) return y0*cols+x0;
      }
    }
    return -1;
  };
  const start=closest(sx,sy),goal=closest(gx,gy);
  if(start<0||goal<0)return [];
  const prev=new Int32Array(count);prev.fill(-2);prev[start]=-1;
  const queue=new Int32Array(count);let head=0,tail=0;queue[tail++]=start;
  while(head<tail&&prev[goal]===-2) {
    const id=queue[head++],x=id%cols,y=Math.floor(id/cols);
    const neighbors=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
    for(const [nx,ny] of neighbors) {
      if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
      const ni=ny*cols+nx;if(prev[ni]!==-2)continue;
      const [px,py]=point(ni);if(!walkable(px,py))continue;
      prev[ni]=id;queue[tail++]=ni;
    }
  }
  if(prev[goal]===-2)return [];
  const path:number[][]=[];
  for(let id=goal;id!==start;id=prev[id])path.push(point(id));
  return path.reverse();
}

function publicMeeting(meeting: any, ownSeat: number) {
  if (!meeting || meeting.active !== true) return { active:false, phase:null };
  const votes = meeting.votes && typeof meeting.votes === "object" ? meeting.votes : {};
  const messages=Array.isArray(meeting.messages)?meeting.messages.slice(-80).map((m:any)=>({seat:Number(m.seat),text:String(m.text||"").slice(0,180),at:m.at||null})):[];
  const base:any = { active:true, phase:meeting.phase, started_at:meeting.started_at || null, ends_at:meeting.ends_at || null, caller_seat:meeting.caller_seat ?? null, vote_count:Object.keys(votes).length, own_voted:Object.prototype.hasOwnProperty.call(votes,String(ownSeat)), messages };
  if (meeting.phase === "results") base.result = meeting.result || null;
  return base;
}

async function finalizeWinner(admin: any, matchId: string, winner: "white"|"black"|"third") {
  const { data, error } = await admin.rpc("ranked_engine_finalize", {p_match_id:matchId,p_winner_faction:winner});
  if (error) throw error;
  return data;
}
async function finalizeRoleWinner(admin: any, matchId: string, seat: number, role: "暗殺者"|"狂人"|"放浪者"|"てるてる"|"ギャンブラー") {
  const { data, error } = await admin.rpc("ranked_engine_finalize_role", {
    p_match_id:matchId,p_winner_seat:seat,p_winner_role:role
  });
  if (error) throw error;
  return data;
}
function soloRoleWinner(state:any): {seat:number,role:"暗殺者"|"狂人"|"放浪者"|"ギャンブラー"} | null {
  const alive=(state.players||[]).filter((p:any)=>p.alive);
  const assassin=alive.find((p:any)=>p.role==="暗殺者");
  const targets=Array.isArray(state.assassin_targets)?state.assassin_targets.map(Number):[];
  if(assassin&&targets.length===3&&targets.every((seat:number)=>!alive.some((p:any)=>Number(p.seat)===seat)))
    return {seat:Number(assassin.seat),role:"暗殺者"};
  const madman=alive.find((p:any)=>p.role==="狂人");
  if(madman){
    const black=alive.filter((p:any)=>p.faction==="black").length;
    const others=alive.filter((p:any)=>p.faction==="white"||(p.faction==="third"&&p.role!=="狂人")).length;
    if(others<black+1)return {seat:Number(madman.seat),role:"狂人"};
  }
  const wanderer=alive.find((p:any)=>p.role==="放浪者");
  if(wanderer){
    const others=alive.filter((p:any)=>Number(p.seat)!==Number(wanderer.seat));
    if(others.every((p:any)=>!!p.scented))return {seat:Number(wanderer.seat),role:"放浪者"};
  }
  const gambler=alive.find((p:any)=>p.role==="ギャンブラー"&&Number(p.gambler_prediction_hits||0)>=2);
  if(gambler)return {seat:Number(gambler.seat),role:"ギャンブラー"};
  return null;
}
function resolveGamblerPredictions(state:any) {
  for(const p of (state.players||[]).filter((v:any)=>v.alive&&v.role==="ギャンブラー")){
    const low=Number(p.gambler_low_count||0),high=Number(p.gambler_high_count||0);
    const prediction=String(p.gambler_prediction||"");
    if(prediction&&low!==high){
      const actual=low>high?"low":"high";
      if(actual===prediction){
        p.gambler_prediction_hits=Number(p.gambler_prediction_hits||0)+1;
        p.gambler_last_prediction_result="correct";
        if(prediction==="high")p.protected=true;
      }else p.gambler_last_prediction_result="miss";
    }else p.gambler_last_prediction_result="tie";
    p.gambler_low_count=0;p.gambler_high_count=0;p.gambler_prediction=null;
    if(p.is_ai)p.gambler_prediction=Math.random()<0.5?"low":"high";
    if(Number(p.gambler_prediction_hits||0)>=2)return {seat:Number(p.seat),role:"ギャンブラー"};
  }
  return null;
}
function rankedMatchResult(state:any, result:any) {
  return {
    ...result,
    role_reveal:(state.players||[]).map((p:any)=>({
      seat:Number(p.seat),role:String(p.role||"未設定"),faction:String(p.faction||"unknown"),alive:!!p.alive
    })),
    role_metrics:(state.players||[]).map((p:any)=>({
      seat:Number(p.seat),charge_kills:Number(p.charge_kills||0),protection_blocks:Number(p.protection_blocks||0),
      sabotage_kills:Number(p.sabotage_kills||0),disguise_kills:Number(p.disguise_kills||0),
      gambler_jackpot_kills:Number(p.gambler_jackpot_kills||0)
    }))
  };
}


function recordElimination(state:any,killer:any,victim:any,now:number) {
  if (!killer || !victim) return;
  const witnesses=(state.players||[]).filter((p:any)=>p.alive&&Number(p.seat)!==Number(killer.seat)&&Number(p.seat)!==Number(victim.seat)&&
    Math.hypot(Number(p.x)-Number(killer.x),Number(p.y)-Number(killer.y))<=155&&
    clearLineOfSight(Number(p.x),Number(p.y),Number(killer.x),Number(killer.y)))
    .map((p:any)=>Number(p.seat));
  state.last_elimination={killer_seat:Number(killer.seat),victim_seat:Number(victim.seat),at:now,witness_seats:witnesses};
}

function recordProtectionBlock(state:any,target:any): boolean {
  if(!target?.protected)return false;
  const protectorSeat=Number(target.protected_by_seat||0);
  const protector=(state.players||[]).find((p:any)=>Number(p.seat)===protectorSeat);
  if(protector)protector.protection_blocks=Number(protector.protection_blocks||0)+1;
  target.protected=false;
  target.protected_by_seat=null;
  return true;
}
function factionWinner(state: any): "white"|"black"|"third"|null {
  const alive=(state.players||[]).filter((p:any)=>p.alive);
  const white=alive.filter((p:any)=>p.faction==="white").length;
  const black=alive.filter((p:any)=>p.faction==="black").length;
  const third=alive.filter((p:any)=>p.faction==="third").length;
  // Black eliminated while white remains: white alone wins. Third-side players do not share this victory.
  if (black===0 && white>0) return "white";
  if (black>0 && black>=white) return "black";
  if (white===0 && black===0 && third>0) return "third";
  return null;
}

function publicSnapshot(match: any, state: any, playerState: any) {
  const ownSeat = Number(playerState?.self?.seat);
  const self = (state.players || []).find((p:any) => Number(p.seat) === ownSeat);
  const ownMeta = (match.players || []).find((p:any) => !p.is_ai && Number(p.seat) === ownSeat);
  return {
    status: "ok",
    match_id: match.match_id,
    phase: state.phase,
    match_status: match.status,
    map_id: state.map_id,
    tick: state.tick,
    elapsed_seconds: state.elapsed_seconds,
    meeting: publicMeeting(state.meeting, ownSeat),
    sabotage_until:Number(state.sabotage_until||0),
    meeting_cooldown_until: state.meetingCooldownUntil || null,
    tasks: (state.tasks||[]).map((t:any)=>({id:t.id,x:t.x,y:t.y,done:!!t.done,remaining:t.remaining,completed_by:Array.isArray(t.completed_by)?t.completed_by:[]})),
    players: (state.players||[]).map((p:any)=>({seat:p.seat,x:p.x,y:p.y,alive:!!p.alive,is_ai:!!p.is_ai,appearance_seat:p.disguise_until>Date.now()?Number(p.disguise_seat||p.seat):Number(p.seat)})),
    dead: (state.players||[]).filter((p:any)=>!p.alive && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))).map((p:any)=>({seat:Number(p.seat),x:Number(p.x),y:Number(p.y),reported:(Array.isArray(state.reported_body_seats)?state.reported_body_seats.map(Number):[]).includes(Number(p.seat))})),
    self: self && ownMeta ? {seat:self.seat,role:playerState.self.role,faction:playerState.self.faction,alive:!!self.alive,x:self.x,y:self.y,ability_used:!!self.ability_used,charging:!!self.charging,role_ready_at:Number(self.role_ready_at||0),kill_ready_at:Number(self.kill_ready_at||0),sabotage_ready_at:Number(self.sabotage_ready_at||0),assassin_targets:playerState.self.role==="暗殺者"?(state.assassin_targets||[]):[],gambler_kill_ready:!!self.gambler_kill_ready,gambler_prediction:self.gambler_prediction||null,gambler_prediction_hits:Number(self.gambler_prediction_hits||0),gambler_low_count:Number(self.gambler_low_count||0),gambler_high_count:Number(self.gambler_high_count||0),gambler_bad_luck_count:Number(self.gambler_bad_luck_count||0),gambler_reveals:Array.isArray(self.gambler_reveals)?self.gambler_reveals:[],charge_kills:Number(self.charge_kills||0),protection_blocks:Number(self.protection_blocks||0),sabotage_kills:Number(self.sabotage_kills||0),disguise_kills:Number(self.disguise_kills||0),gambler_jackpot_kills:Number(self.gambler_jackpot_kills||0),lover_partner_seat:playerState.self.role==="恋人"?Number((state.players||[]).find((p:any)=>p.role==="恋人"&&Number(p.seat)!==ownSeat)?.seat||0):null,scented_seats:playerState.self.role==="放浪者"?(state.players||[]).filter((p:any)=>p.scented).map((p:any)=>Number(p.seat)):[]} : null,
    engine_revision: match.engine_revision + 1,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST_ONLY" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "SERVER_NOT_CONFIGURED" }, 503);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  const workerRequest = body.action === "worker_tick";
  let authData: any = null;
  if (workerRequest) {
    const expected = Deno.env.get("TRIAD_WORKER_TOKEN") || "";
    const supplied = req.headers.get("x-triad-worker-token") || "";
    if (!expected || !supplied || expected.length !== supplied.length) return json({ error: "WORKER_AUTH_REQUIRED" }, 401);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    if (diff !== 0) return json({ error: "WORKER_AUTH_REQUIRED" }, 401);
    if (typeof body.match_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.match_id)) return json({ error: "INVALID_MATCH_ID" }, 400);
  } else {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return json({ error: "INVALID_SESSION" }, 401);
    authData = data;
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (body.action === "ability") {
      const kind=String(body.kind||"");
      const { data: active, error: activeError } = await admin.rpc("ranked_engine_active_match", {p_user_id:authData.user.id});
      if(activeError)throw activeError;
      if(active?.status!=="ok"||!active.match_id)return json({status:"not_in_match"});
      const {data:match,error:readError}=await admin.rpc("ranked_engine_read",{p_match_id:active.match_id});
      if(readError)throw readError;
      if(match.status!=="active")return json({status:"match_not_active"});
      const {data:playerState,error:playerError}=await admin.rpc("ranked_engine_player_state",{p_user_id:authData.user.id});
      if(playerError)throw playerError;
      if(playerState?.status!=="ok")return json({status:"not_in_match"});
      const state=match.engine_state||{},players=state.players||[];
      const self=players.find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
      if(!self||!self.alive)return json({status:"dead"});
      if(state.phase!=="playing")return json({status:"not_playing"});
      if(kind==="attack_once"){
        if(!["狩人","保安官"].includes(self.role))return json({status:"wrong_role"});
        if(self.ability_used)return json({status:"ability_used"});
        const targetSeat=Number(body.target_seat);
        const target=players.find((p:any)=>Number(p.seat)===targetSeat&&p.alive);
        if(!Number.isInteger(targetSeat)||targetSeat===Number(self.seat)||!target)return json({status:"invalid_target"});
        const distance=Math.hypot(Number(self.x)-Number(target.x),Number(self.y)-Number(target.y));
        const visible=clearLineOfSight(Number(self.x),Number(self.y),Number(target.x),Number(target.y));
        const now=Date.now();
        if(distance>100||!visible)return json({status:"too_far"});
        self.ability_used=true;
        let outcome="attack_success";
        if(recordProtectionBlock(state,target)){outcome="attack_blocked"}
        else{
          recordElimination(state,self,target,now);
          target.alive=false;
          target.death_reason=self.role;
          target.died_at=new Date(now).toISOString();
          if(self.role==="保安官"&&target.faction==="white"){
            self.alive=false;self.death_reason="保安官の誤射";self.died_at=new Date(now).toISOString();outcome="sheriff_misfire";
          }
        }
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;
        if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        const solo=soloRoleWinner(state);
        if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",winner_role:solo.role,winner_seat:solo.seat,outcome,target_seat:target.seat}))}
        const winner=factionWinner(state);
        if(winner){await finalizeWinner(admin,match.match_id,winner);return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",winner_faction:winner,outcome,target_seat:target.seat}))}
        return json({status:outcome,target_seat:target.seat,actor_alive:!!self.alive,target_alive:!!target.alive});
      }
      if(kind==="boar_charge"){
        if(self.role!=="イノシシ")return json({status:"wrong_role"});
        const now=Date.now();
        if(now<Number(self.role_ready_at||0))return json({status:"cooldown",ready_at:self.role_ready_at});
        const dx=Number(body.dx),dy=Number(body.dy),len=Math.hypot(dx,dy);
        if(!Number.isFinite(dx)||!Number.isFinite(dy)||len<0.25||Math.abs(dx)>1.01||Math.abs(dy)>1.01)return json({status:"invalid_direction"});
        self.charging=true;
        self.charge={x:dx/len,y:dy/len};
        self.charge_started_at=now;
        self.role_ready_at=0;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;
        if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"charge_started"});
      }
      if(kind==="assassin_targets"){
        if(self.role!=="暗殺者")return json({status:"wrong_role"});
        const now=Date.now();
        if(now<Number(self.role_ready_at||0))return json({status:"cooldown",ready_at:self.role_ready_at});
        if(!Array.isArray(state.assassin_targets)||state.assassin_targets.length!==3){
          const whiteSeats=(match.players||[]).filter((p:any)=>p.faction==="white").map((p:any)=>Number(p.seat));
          for(let i=whiteSeats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[whiteSeats[i],whiteSeats[j]]=[whiteSeats[j],whiteSeats[i]];}
          state.assassin_targets=whiteSeats.slice(0,3);
        }
        if(state.assassin_targets.length!==3)return json({status:"targets_unavailable"});
        self.role_ready_at=now+20000;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;
        if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"targets",target_seats:state.assassin_targets});
      }
      if(kind==="scientist"){
        if(self.role!=="サイエンティスト")return json({status:"wrong_role"});
        return json({status:"alive_count",alive_count:players.filter((p:any)=>p.alive).length,players_count:players.length});
      }
      if(kind==="gambler_predict"){
        if(self.role!=="ギャンブラー")return json({status:"wrong_role"});
        const prediction=String(body.prediction||"");
        if(prediction!=="low"&&prediction!=="high")return json({status:"invalid_prediction"});
        if(self.gambler_prediction)return json({status:"prediction_already_set"});
        self.gambler_prediction=prediction;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"prediction_set",prediction,hits:Number(self.gambler_prediction_hits||0)});
      }
      if(kind==="gambler_roll"){
        if(self.role!=="ギャンブラー")return json({status:"wrong_role"});
        const rollNow=Date.now();
        if(!self.gambler_prediction)return json({status:"prediction_required"});
        if(rollNow<Number(self.role_ready_at||0))return json({status:"cooldown",ready_at:self.role_ready_at});
        const roll=1+Math.floor(Math.random()*6);
        const names=["","JACKPOT","強運","運命の目","小当たり","ハズレ","大凶"];
        self.role_ready_at=rollNow+(roll===4?5000:25000);
        if(roll<=3)self.gambler_low_count=Number(self.gambler_low_count||0)+1;
        else self.gambler_high_count=Number(self.gambler_high_count||0)+1;
        let targetSeat:number|null=null,targetFaction:string|null=null;
        if(roll===1)self.gambler_kill_ready=true;
        if(roll===2)self.protected=true;
        if(roll===3){
          const choices=players.filter((p:any)=>p.alive&&Number(p.seat)!==Number(self.seat));
          if(choices.length){
            const picked=choices[Math.floor(Math.random()*choices.length)];
            targetSeat=Number(picked.seat);targetFaction=String(picked.faction);
            self.gambler_reveals=Array.isArray(self.gambler_reveals)?self.gambler_reveals:[];
            self.gambler_reveals=self.gambler_reveals.filter((v:any)=>Number(v.seat)!==targetSeat);
            self.gambler_reveals.push({seat:targetSeat,faction:targetFaction});
          }
        }
        if(roll===6){
          self.gambler_bad_luck_count=Number(self.gambler_bad_luck_count||0)+1;
          if(self.gambler_bad_luck_count>=3){
            self.alive=false;self.death_reason="大凶を3回引いた";self.died_at=new Date(rollNow).toISOString();
          }
        }
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        const solo=soloRoleWinner(state);
        if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",winner_role:solo.role,winner_seat:solo.seat,roll,roll_name:names[roll]}))}
        const winner=factionWinner(state);
        if(winner){await finalizeWinner(admin,match.match_id,winner);return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",winner_faction:winner,roll,roll_name:names[roll]}))}
        return json({status:roll===6&&self.gambler_bad_luck_count>=3?"gambler_eliminated":"gambler_result",roll,roll_name:names[roll],target_seat:targetSeat,target_faction:targetFaction,gambler_kill_ready:!!self.gambler_kill_ready,bad_luck_count:Number(self.gambler_bad_luck_count||0),ready_at:self.role_ready_at});
      }
      if(kind==="sabotage"){
        if(self.role!=="インポスター"||self.faction!=="black")return json({status:"wrong_role"});
        const now=Date.now();
        if(!self.sabotage_ready_initialized){self.sabotage_ready_at=now+35000;self.sabotage_ready_initialized=true;const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);return json({status:"cooldown",ready_at:self.sabotage_ready_at});}
        if(now<Number(self.sabotage_ready_at||0))return json({status:"cooldown",ready_at:self.sabotage_ready_at});
        state.sabotage_until=now+10000;
        self.sabotage_ready_at=now+35000;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"sabotage_started",until:state.sabotage_until,ready_at:self.sabotage_ready_at});
      }
      const targetSeat=Number(body.target_seat);
      const target=players.find((p:any)=>Number(p.seat)===targetSeat&&p.alive);
      if(!Number.isInteger(targetSeat)||!target)return json({status:"invalid_target"});
      const distance=Math.hypot(Number(self.x)-Number(target.x),Number(self.y)-Number(target.y));
      const visible=clearLineOfSight(Number(self.x),Number(self.y),Number(target.x),Number(target.y));
      const now=Date.now();
      if(kind==="ranked_kill"){
        if(self.faction!=="black"&&self.role!=="狂人")return json({status:"wrong_role"});
        if(!self.kill_ready_initialized){self.kill_ready_at=now+30000;self.kill_ready_initialized=true;const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);return json({status:"cooldown",ready_at:self.kill_ready_at});}
        if(now<Number(self.kill_ready_at||0))return json({status:"cooldown",ready_at:self.kill_ready_at});
        if(Number(target.seat)===Number(self.seat))return json({status:"invalid_target"});
        if(self.faction==="black"&&target.faction==="black")return json({status:"invalid_target"});
        if(distance>88||!visible)return json({status:"too_far"});
        self.kill_ready_at=now+30000;
        let outcome="ranked_kill_success";
        if(recordProtectionBlock(state,target)){outcome="ranked_kill_blocked";}
        else{recordElimination(state,self,target,now);target.alive=false;target.death_reason=self.role;target.died_at=new Date(now).toISOString();if(self.role==="百面相"&&Number(self.disguise_until||0)>now)self.disguise_kills=Number(self.disguise_kills||0)+1;if(self.role==="インポスター"&&Number(state.sabotage_until||0)>now)self.sabotage_kills=Number(self.sabotage_kills||0)+1;}
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        const solo=soloRoleWinner(state);
        if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",winner_role:solo.role,winner_seat:solo.seat,outcome,target_seat:target.seat}))}
        const winner=factionWinner(state);
        if(winner){await finalizeWinner(admin,match.match_id,winner);return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",winner_faction:winner,outcome,target_seat:target.seat}))}
        return json({status:outcome,target_seat:target.seat,target_alive:!!target.alive});
      }
      if(kind==="gambler_kill"){
        if(self.role!=="ギャンブラー")return json({status:"wrong_role"});
        if(!self.gambler_kill_ready)return json({status:"ability_not_ready"});
        if(Number(target.seat)===Number(self.seat)||target.faction===self.faction)return json({status:"invalid_target"});
        if(distance>100||!visible)return json({status:"too_far"});
        self.gambler_kill_ready=false;
        let outcome="gambler_kill_success";
        if(recordProtectionBlock(state,target)){outcome="gambler_kill_blocked";}
        else{recordElimination(state,self,target,now);target.alive=false;target.death_reason="ギャンブラー";target.died_at=new Date(now).toISOString();self.gambler_jackpot_kills=Number(self.gambler_jackpot_kills||0)+1;}
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        const solo=soloRoleWinner(state);
        if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",winner_role:solo.role,winner_seat:solo.seat,outcome,target_seat:target.seat}))}
        const winner=factionWinner(state);
        if(winner){await finalizeWinner(admin,match.match_id,winner);return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",winner_faction:winner,outcome,target_seat:target.seat}))}
        return json({status:outcome,target_seat:target.seat,target_alive:!!target.alive});
      }
      if(kind==="assassin_kill"){
        if(self.role!=="暗殺者")return json({status:"wrong_role"});
        const targets=Array.isArray(state.assassin_targets)?state.assassin_targets.map(Number):[];
        if(targets.length!==3||!targets.includes(targetSeat))return json({status:"not_a_bounty_target"});
        if(now<Number(self.kill_ready_at||0))return json({status:"cooldown",ready_at:self.kill_ready_at});
        if(distance>88||!visible)return json({status:"too_far"});
        self.kill_ready_at=now+20000;
        let outcome="attack_success";
        if(recordProtectionBlock(state,target)){outcome="attack_blocked";}
        else{recordElimination(state,self,target,now);target.alive=false;target.death_reason="暗殺";target.died_at=new Date(now).toISOString();}
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;
        if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        const solo=soloRoleWinner(state);
        if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",winner_role:solo.role,winner_seat:solo.seat,outcome,target_seat:target.seat}));}
        const winner=factionWinner(state);
        if(winner){await finalizeWinner(admin,match.match_id,winner);return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",winner_faction:winner,outcome,target_seat:target.seat}));}
        return json({status:outcome,target_seat:target.seat,target_alive:!!target.alive});
      }
      if(kind==="seer"){
        if(self.role!=="占い師")return json({status:"wrong_role"});
        if(self.ability_used)return json({status:"ability_used"});
        if(distance>100||!visible)return json({status:"too_far"});
        self.ability_used=true;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"seer_result",target_seat:target.seat,target_faction:target.faction});
      }
      if(kind==="protect"){
        if(self.role!=="僧侶")return json({status:"wrong_role"});
        if(self.ability_used)return json({status:"ability_used"});
        if(!visible)return json({status:"too_far"});
        target.protected=true;target.protected_by_seat=Number(self.seat);self.ability_used=true;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"protected",target_seat:target.seat});
      }
      if(kind==="scent"){
        if(self.role!=="放浪者")return json({status:"wrong_role"});
        if(now<Number(self.role_ready_at||0))return json({status:"cooldown",ready_at:self.role_ready_at});
        if(distance>90||!visible)return json({status:"too_far"});
        target.scented=true;self.role_ready_at=now+15000;
        const remaining=players.filter((p:any)=>p.alive&&Number(p.seat)!==Number(self.seat)&&!p.scented);
        const won=remaining.length===0;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        if(won){await finalizeRoleWinner(admin,match.match_id,Number(self.seat),"放浪者");return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",winner_faction:"third",winner_role:"放浪者",winner_seat:Number(self.seat),scented_count:players.filter((p:any)=>p.scented).length}))}
        return json({status:"scented",target_seat:target.seat,scented_count:players.filter((p:any)=>p.alive&&p.scented).length});
      }
      if(kind==="disguise"){
        if(self.role!=="百面相")return json({status:"wrong_role"});
        if(now<Number(self.role_ready_at||0))return json({status:"cooldown",ready_at:self.role_ready_at});
        if(!visible)return json({status:"too_far"});
        self.disguise_seat=target.seat;self.disguise_until=now+10000;self.role_ready_at=now+45000;
        const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if(saveError)throw saveError;if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
        return json({status:"disguised",until:self.disguise_until});
      }
      return json({status:"unsupported_ability"});
    }
    if (body.action === "state") {
      const { data: playerState, error } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
      if (error) throw error;
      if (playerState?.status !== "ok") return json(playerState);
      const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: playerState.match_id });
      if (readError) throw readError;
      return json(publicSnapshot(match, match.engine_state || {}, playerState));
    }
    if (body.action === "body_report") {
      const { data: playerState, error: playerError } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
      if (playerError) throw playerError;
      if (playerState?.status !== "ok") return json({status:"not_in_match"});
      for(let attempt=0;attempt<6;attempt++){
        const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: playerState.match_id });
        if (readError) throw readError;
        const state = match.engine_state || {};
        if (match.status !== "active" || state.phase !== "playing" || state.meeting?.active===true) return json({status:"meeting_unavailable"});
        const self = (state.players || []).find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
        if (!self || !self.alive) return json({status:"dead"});
        state.reported_body_seats=Array.isArray(state.reported_body_seats)?state.reported_body_seats.map(Number):[];
        const body = (state.players || []).find((p:any)=>!p.alive && !state.reported_body_seats.includes(Number(p.seat)) && Math.hypot(Number(self.x)-Number(p.x),Number(self.y)-Number(p.y))<=82);
        if (!body) return json({status:"body_too_far"});
        state.reported_body_seats.push(Number(body.seat));
        state.phase="meeting";
        for(const p of (state.players||[])){if(p.charging){p.charging=false;p.charge=null;p.role_ready_at=Date.now()+20000;}}
        state.meeting={active:true,phase:"discussion",started_at:new Date().toISOString(),ends_at:new Date(Date.now()+90000).toISOString(),caller_seat:self.seat,reported_seat:Number(body.seat),votes:{},messages:[]};
        const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if (saveError) throw saveError;
        if (saved?.status==="revision_conflict") {await new Promise(resolve=>setTimeout(resolve,35*(attempt+1)));continue;}
        return json({status:"meeting_started",reported_seat:Number(body.seat)});
      }
      return json({status:"revision_conflict",retryable:true},409);
    }
    if (body.action === "meeting_call") {
      const { data: playerState, error: playerError } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
      if (playerError) throw playerError;
      if (playerState?.status !== "ok") return json({status:"not_in_match"});
      for(let attempt=0;attempt<6;attempt++){
        const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: playerState.match_id });
        if (readError) throw readError;
        const state = match.engine_state || {};
        if (match.status !== "active" || state.phase !== "playing" || state.meeting?.active===true) return json({status:"meeting_unavailable"});
        const self = (state.players || []).find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
        if (!self || !self.alive) return json({status:"dead"});
        if (state.meetingCooldownUntil && Date.now() < Number(state.meetingCooldownUntil)) return json({status:"meeting_cooldown"});
        if (Math.hypot(Number(self.x)-900,Number(self.y)-520)>90) return json({status:"too_far"});
        state.phase="meeting";
        for(const p of (state.players||[])){if(p.charging){p.charging=false;p.charge=null;p.role_ready_at=Date.now()+20000;}}
        state.meeting={active:true,phase:"discussion",started_at:new Date().toISOString(),ends_at:new Date(Date.now()+90000).toISOString(),caller_seat:self.seat,votes:{},messages:[]};
        const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if (saveError) throw saveError;
        if (saved?.status==="revision_conflict") {await new Promise(resolve=>setTimeout(resolve,35*(attempt+1)));continue;}
        return json({status:"meeting_started",meeting:publicMeeting(state.meeting)});
      }
      return json({status:"revision_conflict",retryable:true},409);
    }
    if (body.action === "chat") {
      const raw=typeof body.text==="string"?body.text:"";
      const message=raw.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim();
      if(!message||message.length>180)return json({status:"invalid_message"});
      const {data:playerState,error:playerError}=await admin.rpc("ranked_engine_player_state",{p_user_id:authData.user.id});
      if(playerError)throw playerError;
      if(playerState?.status!=="ok")return json({status:"not_in_match"});
      const {data:match,error:readError}=await admin.rpc("ranked_engine_read",{p_match_id:playerState.match_id});
      if(readError)throw readError;
      if(match.status!=="active")return json({status:"match_not_active"});
      const state=match.engine_state||{},meeting=state.meeting||{};
      if(state.phase!=="meeting"||meeting.active!==true||meeting.phase!=="discussion")return json({status:"chat_closed"});
      const self=(state.players||[]).find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
      if(!self||!self.alive)return json({status:"dead"});
      const now=Date.now();
      if(now-Number(self.last_chat_at||0)<800)return json({status:"chat_throttled"});
      self.last_chat_at=now;
      meeting.messages=Array.isArray(meeting.messages)?meeting.messages:[];
      meeting.messages.push({seat:Number(self.seat),text:message,at:new Date(now).toISOString()});
      meeting.messages=meeting.messages.slice(-80);
      const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
      if(saveError)throw saveError;
      if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
      return json({status:"sent",messages:publicMeeting(meeting,Number(self.seat)).messages});
    }
    if (body.action === "begin_vote") {
      const { data: playerState, error: playerError } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
      if (playerError) throw playerError;
      if (playerState?.status !== "ok") return json({status:"not_in_match"});
      const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: playerState.match_id });
      if (readError) throw readError;
      const state=match.engine_state||{}, meeting=state.meeting||{};
      if (state.phase!=="meeting" || meeting.active!==true || meeting.phase!=="discussion") return json({status:"meeting_not_discussing"});
      const self=(state.players||[]).find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
      if (!self?.alive) return json({status:"dead"});
      meeting.phase="voting";meeting.ends_at=new Date(Date.now()+30000).toISOString();meeting.votes=meeting.votes||{};
      state.meeting=meeting;
      const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
      if (saveError) throw saveError;
      if (saved?.status==="revision_conflict") return json({status:"revision_conflict"},409);
      return json({status:"voting_started",meeting:publicMeeting(meeting)});
    }
    if (body.action === "vote") {
      const target=body.target;
      if (!(target==="skip" || (Number.isInteger(Number(target)) && Number(target)>0 && Number(target)<=12))) return json({error:"INVALID_VOTE_TARGET"},400);
      const { data: playerState, error: playerError } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
      if (playerError) throw playerError;
      if (playerState?.status !== "ok") return json({status:"not_in_match"});
      const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: playerState.match_id });
      if (readError) throw readError;
      const state=match.engine_state||{},meeting=state.meeting||{};
      if (state.phase!=="meeting" || meeting.active!==true || meeting.phase!=="voting") return json({status:"voting_closed"});
      const self=(state.players||[]).find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
      if (!self?.alive) return json({status:"dead"});
      const votes=meeting.votes&&typeof meeting.votes==="object"?meeting.votes:{};
      const voterKey=String(self.seat);
      if (Object.prototype.hasOwnProperty.call(votes,voterKey)) return json({status:"already_voted"});
      if (target!=="skip") {
        const targetPlayer=(state.players||[]).find((p:any)=>Number(p.seat)===Number(target)&&p.alive);
        if (!targetPlayer) return json({status:"invalid_target"});
      }
      votes[voterKey]=target==="skip"?"skip":Number(target);
      meeting.votes=votes;state.meeting=meeting;
      const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
      if (saveError) throw saveError;
      if (saved?.status==="revision_conflict") return json({status:"revision_conflict"},409);
      return json({status:"vote_recorded",vote_count:Object.keys(votes).length});
    }
    if (body.action === "move") {
      if (typeof body.dx !== "number" || typeof body.dy !== "number" ||
          !Number.isFinite(body.dx) || !Number.isFinite(body.dy) ||
          Math.abs(body.dx)>1.01 || Math.abs(body.dy)>1.01) return json({error:"INVALID_MOVEMENT_VECTOR"},400);
      const { data, error } = await admin.rpc("ranked_engine_move", {
        p_user_id: authData.user.id, p_dx: body.dx, p_dy: body.dy,
      });
      if (error) throw error;
      return json(data);
    }
    if (body.action === "task") {
      const taskId = Number(body.task_id);
      if (!Number.isInteger(taskId) || taskId < 0 || taskId > 20) return json({error:"INVALID_TASK_ID"},400);
      const { data: active, error: activeError } = await admin.rpc("ranked_engine_active_match", { p_user_id: authData.user.id });
      if (activeError) throw activeError;
      if (active?.status !== "ok" || !active.match_id) return json({status:"not_in_match"});
      const { data: playerState, error: playerError } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
      if (playerError) throw playerError;
      if (playerState?.status !== "ok") return json({status:"not_in_match"});
      for (let attempt=0; attempt<6; attempt++) {
        const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: active.match_id });
        if (readError) throw readError;
        if (match.status !== "active") return json({status:"match_not_active"});
        const state = match.engine_state || {};
        if (state.phase !== "playing") return json({status:"not_playing"});
        const participant = (match.players || []).find((p:any)=>!p.is_ai && Number(p.seat) === Number(playerState.self?.seat) && p.profile_id);
        const self = (state.players || []).find((p:any)=>p.profile_id === participant?.profile_id && Number(p.seat) === Number(playerState.self?.seat));
        if (!self) return json({status:"player_state_missing"});
        if (!self.alive) return json({status:"dead"});
        const tasks = Array.isArray(state.tasks) ? state.tasks : [];
        const task = tasks.find((t:any)=>Number(t.id) === taskId);
        if (!task) return json({status:"task_not_found"},404);
        if (task.done || Number(task.remaining||0)<=0) return json({status:"already_done"});
        task.completed_by = Array.isArray(task.completed_by) ? task.completed_by : [];
        if (task.completed_by.map(Number).includes(Number(self.seat))) return json({status:"already_completed_by_player"});
        const distance = Math.hypot(Number(self.x)-Number(task.x),Number(self.y)-Number(task.y));
        if (distance > 58) return json({status:"too_far",distance:Math.round(distance)});
        const now = Date.now();
        if (now - Number(self.last_task_at || 0) < 950) return json({status:"task_throttled"});
        self.last_task_at = now;
        task.completed_by.push(Number(self.seat));
        if (playerState.self.faction === "white") {
          task.remaining = Math.max(0,Number(task.remaining||4)-1);
          task.done = task.remaining <= 0;
        }
        state.tasks = tasks;
        const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {
          p_match_id: match.match_id,
          p_expected_revision: match.engine_revision,
          p_engine_state: state,
        });
        if (saveError) throw saveError;
        if (saved?.status === "revision_conflict") {
          await new Promise(resolve=>setTimeout(resolve,35*(attempt+1)));
          continue;
        }
        if(tasks.length>0&&tasks.every((t:any)=>t.done)){await finalizeWinner(admin,match.match_id,"white");return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",winner_faction:"white",task_id:taskId,done:true}))}
        return json({status:task.done?"completed":"progress",task_id:taskId,progress:task.done?4:4-task.remaining,remaining:task.remaining,done:!!task.done,contribution_saved:true});
      }
      return json({status:"revision_conflict",retryable:true},409);
    }
    if (body.action === "heartbeat") {
      const {data:playerState,error:playerError}=await admin.rpc("ranked_engine_player_state",{p_user_id:authData.user.id});
      if(playerError)throw playerError;
      if(playerState?.status!=="ok")return json({status:"not_in_match"});
      const {data:match,error:readError}=await admin.rpc("ranked_engine_read",{p_match_id:playerState.match_id});
      if(readError)throw readError;
      if(match.status!=="active")return json({status:"match_not_active"});
      const state=match.engine_state||{},self=(state.players||[]).find((p:any)=>Number(p.seat)===Number(playerState.self?.seat));
      if(!self||self.is_ai)return json({status:"seat_taken_over"});
      self.last_seen_at=Date.now();
      const {data:saved,error:saveError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
      if(saveError)throw saveError;
      if(saved?.status==="revision_conflict")return json({status:"revision_conflict"},409);
      return json({status:"heartbeat_ok"});
    }
    if (body.action === "tick" || workerRequest) {
      let matchId: string;
      let playerState: any;
      if (workerRequest) {
        matchId = String(body.match_id);
        playerState = { status: "worker", self: { seat: -1 } };
      } else {
        const { data: active, error: activeError } = await admin.rpc("ranked_engine_active_match", { p_user_id: authData.user.id });
        if (activeError) throw activeError;
        if (active?.status !== "ok" || !active.match_id) return json({status:"not_in_match"});
        matchId = active.match_id;
      }
      const { data: match, error: readError } = await admin.rpc("ranked_engine_read", { p_match_id: matchId });
      if (readError) throw readError;
      if (match.status !== "active") return json({status:"match_not_active"});
      const state = match.engine_state || {};
      if (!workerRequest) {
        const { data, error: playerStateError } = await admin.rpc("ranked_engine_player_state", { p_user_id: authData.user.id });
        if (playerStateError) throw playerStateError;
        if (data?.status !== "ok") return json({status:"not_in_match"});
        playerState = data;
      }
      const now = Date.now();
      let takeoverChanged=false;
      for(const p of (state.players||[])){
        if(p.is_ai||!p.alive)continue;
        if(!p.last_seen_at){p.last_seen_at=now;takeoverChanged=true;continue;}
        if(now-Number(p.last_seen_at)>90000){p.is_ai=true;p.disconnected_at=now;p.ai_disconnected_takeover=true;p.ai_path=[];p.ai_goal=null;p.ai_chase_goal=null;takeoverChanged=true;}
      }
      // Persist AI takeovers together with the normal tick commit below.
      // A separate commit here increments engine_revision and makes the later
      // tick commit use a stale revision, causing an avoidable 409.
      const last = match.last_tick_at ? Date.parse(match.last_tick_at) : now;
      const delta = Math.max(0,Math.min(1.5,(now-last)/1000));
      if (delta < 0.18) return json({status:"tick_throttled",tick:state.tick||0});
      if (state.phase === "meeting") {
        const meeting=state.meeting||{};
        const players=Array.isArray(state.players)?state.players:[];
        const alive=players.filter((p:any)=>p.alive);
        const nowMs=Date.now();
        if(meeting.active!==true || !["discussion","voting","results"].includes(String(meeting.phase))){
          meeting.active=false;meeting.phase=null;meeting.votes={};state.phase="playing";state.meetingCooldownUntil=nowMs+5000;state.meeting=meeting;
          const {data:recovered,error:recoverError}=await admin.rpc("ranked_engine_commit",{p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
          if(recoverError)throw recoverError;if(recovered?.status==="revision_conflict")return json({status:"revision_conflict",tick:state.tick||0},409);
          return workerRequest?json({status:"worker_tick_ok",recovered_meeting:true,tick:state.tick||0}):json(publicSnapshot(match,state,playerState));
        }
        const parsedDeadline=meeting.ends_at?Date.parse(meeting.ends_at):NaN;
        const deadline=Number.isFinite(parsedDeadline)?parsedDeadline:nowMs;
        let gamblerSoloWinner:any=null;
        if(meeting.phase==="discussion"){
          meeting.messages=Array.isArray(meeting.messages)?meeting.messages:[];
          const due=alive.filter((p:any)=>p.is_ai&&nowMs>=Number(p.ai_next_meeting_message_at||0));
          if(due.length){
            const ai=due[Math.floor(Math.random()*due.length)],incident=state.last_elimination;
            const witnessed=incident&&Array.isArray(incident.witness_seats)&&incident.witness_seats.includes(Number(ai.seat));
            const victim=incident?players.find((p:any)=>Number(p.seat)===Number(incident.victim_seat)):null;
            const suspect=incident?players.find((p:any)=>Number(p.seat)===Number(incident.killer_seat)):null;
            const others=alive.filter((p:any)=>Number(p.seat)!==Number(ai.seat)),target=others[Math.floor(Math.random()*Math.max(1,others.length))];
            let line="";
            if(witnessed&&suspect&&victim&&ai.faction!=="black")line=(suspect.name||("プレイヤー"+suspect.seat))+"が"+(victim.name||("プレイヤー"+victim.seat))+"を倒すところを見ました。";
            else if(ai.role==="てるてる")line="まだ情報が少ないですね。もう少し話を聞いてから決めたいです。";
            else if(ai.faction==="black")line=target?(target.name||("プレイヤー"+target.seat))+"の行動が少し気になります。":"今のところ判断材料が足りません。";
            else line=target?(target.name||("プレイヤー"+target.seat))+"はどこにいましたか？行動を確認したいです。":"目撃した人は情報を共有してください。";
            meeting.messages.push({seat:Number(ai.seat),text:line,at:new Date(nowMs).toISOString()});meeting.messages=meeting.messages.slice(-80);ai.ai_next_meeting_message_at=nowMs+7000+Math.floor(Math.random()*6000);
          }
          for(const ai of alive.filter((p:any)=>p.is_ai&&!Number(p.ai_next_meeting_message_at||0)))ai.ai_next_meeting_message_at=nowMs+2500+Math.floor(Math.random()*3500);
        }
        if (meeting.active && meeting.phase==="discussion" && nowMs>=deadline) {
          meeting.phase="voting";meeting.ends_at=new Date(nowMs+30000).toISOString();meeting.votes=meeting.votes||{};
        } else if (meeting.active && meeting.phase==="voting") {
          const votes=meeting.votes&&typeof meeting.votes==="object"?meeting.votes:{};
          for (const ai of alive.filter((p:any)=>p.is_ai)) {
            const key=String(ai.seat);if(Object.prototype.hasOwnProperty.call(votes,key))continue;
            const incident=state.last_elimination;
            const witnessed=incident&&nowMs-Number(incident.at||0)<=180000&&
              Array.isArray(incident.witness_seats)&&incident.witness_seats.includes(Number(ai.seat));
            let choice:any="skip";
            if (ai.role==="てるてる") {
              // The jester deliberately seeks votes against itself.
              choice=Number(ai.seat);
            } else if(witnessed) {
              const suspect=alive.find((p:any)=>Number(p.seat)===Number(incident.killer_seat));
              if(suspect&&Number(suspect.seat)!==Number(ai.seat)&&
                !(ai.faction==="black"&&suspect.faction==="black")) choice=Number(suspect.seat);
            }
            votes[key]=choice;
          }
          const humans=alive.filter((p:any)=>!p.is_ai);
          const humansDone=humans.every((p:any)=>Object.prototype.hasOwnProperty.call(votes,String(p.seat)));
          const timedOut=nowMs>=deadline;
          if (humansDone || timedOut) {
            for (const human of humans) if(!Object.prototype.hasOwnProperty.call(votes,String(human.seat))) votes[String(human.seat)]="skip";
            const counts:any={skip:0};
            for (const p of alive) counts[String(p.seat)]=0;
            for (const value of Object.values(votes)) { const key=String(value);counts[key]=(counts[key]||0)+1; }
            const max=Math.max(0,...Object.values(counts).map((v:any)=>Number(v)||0));
            const leaders=Object.keys(counts).filter(k=>counts[k]===max && max>0);
            let ejected:any=null;
            if(leaders.length===1 && leaders[0]!=="skip") {
              ejected=alive.find((p:any)=>Number(p.seat)===Number(leaders[0]))||null;
              if(ejected)ejected.alive=false;
            }
            meeting.phase="results";meeting.ends_at=new Date(nowMs+5000).toISOString();
            meeting.result={ejected_seat:ejected?Number(ejected.seat):null,ejected_faction:ejected?.faction||null,tie:leaders.length!==1,counts,ballots:votes};
            if(ejected?.role==="てるてる"){meeting.result.special_winner="solo";meeting.result.special_role="てるてる";meeting.result.special_seat=Number(ejected.seat);}
          }
          meeting.votes=votes;
        } else if (meeting.active && meeting.phase==="results" && nowMs>=deadline) {
          meeting.active=false;meeting.phase=null;meeting.votes={};state.phase="playing";state.meetingCooldownUntil=nowMs+25000;
          // Keep completed_by for the whole match so a player cannot repeat the same task.
          gamblerSoloWinner=resolveGamblerPredictions(state);
        }
        state.meeting=meeting;state.tick=(Number(state.tick)||0)+1;state.elapsed_seconds=(Number(state.elapsed_seconds)||0)+delta;
        const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {p_match_id:match.match_id,p_expected_revision:match.engine_revision,p_engine_state:state});
        if (saveError) throw saveError;
        if (saved?.status==="revision_conflict") return json({status:"revision_conflict",tick:state.tick},409);
        if(meeting.result?.special_winner==="solo"){const seat=Number(meeting.result.special_seat);await finalizeRoleWinner(admin,match.match_id,seat,"てるてる");return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",match_status:"completed",winner_faction:"third",winner_role:"てるてる",winner_seat:seat}))}
        if(gamblerSoloWinner){await finalizeRoleWinner(admin,match.match_id,gamblerSoloWinner.seat,"ギャンブラー");return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",match_status:"completed",winner_faction:"third",winner_role:"ギャンブラー",winner_seat:gamblerSoloWinner.seat}))}
        const solo=soloRoleWinner(state);
        if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",match_status:"completed",winner_faction:"third",winner_role:solo.role,winner_seat:solo.seat}))}
        const winner=factionWinner(state);if(winner){await finalizeWinner(admin,match.match_id,winner);return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",match_status:"completed",winner_faction:winner}))}
        return workerRequest ? json({status:"worker_tick_ok",match_id:match.match_id,tick:state.tick||0}) : json(publicSnapshot(match,state,playerState));
      }
      if (state.phase !== "playing") return json({status:"not_playing"});
      const players = Array.isArray(state.players) ? state.players : [];
      const tasks = Array.isArray(state.tasks) ? state.tasks : [];
      const nowMs=Date.now();
      if(!Array.isArray(state.assassin_targets)||state.assassin_targets.length!==3){
        const whiteSeats=(match.players||[]).filter((p:any)=>p.faction==="white").map((p:any)=>Number(p.seat));
        for(let i=whiteSeats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[whiteSeats[i],whiteSeats[j]]=[whiteSeats[j],whiteSeats[i]];}
        if(whiteSeats.length>=3)state.assassin_targets=whiteSeats.slice(0,3);
      }
      for(const charger of players.filter((p:any)=>p.alive&&p.charging)){
        const direction=charger.charge||{x:1,y:0};
        const distance=230*delta,steps=Math.max(1,Math.ceil(distance/12));
        let ended=false;
        for(let step=0;step<steps;step++){
          const travel=Math.min(12,distance-step*12);
          const nx=Number(charger.x)+Number(direction.x)*travel;
          const ny=Number(charger.y)+Number(direction.y)*travel;
          if(!walkable(nx,ny)){ended=true;break;}
          charger.x=nx;charger.y=ny;
          const hit=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(charger.seat)&&Math.hypot(Number(p.x)-nx,Number(p.y)-ny)<30&&!(charger.faction==="black"&&p.faction==="black"));
          if(hit){
            if(recordProtectionBlock(state,hit)){}
            else{recordElimination(state,charger,hit,nowMs);hit.alive=false;hit.death_reason="イノシシの突進";hit.died_at=new Date(nowMs).toISOString();charger.charge_kills=Number(charger.charge_kills||0)+1;}
            ended=true;break;
          }
        }
        if(ended){charger.charging=false;charger.charge=null;charger.role_ready_at=nowMs+20000;}
      }
      for(const p of players.filter((v:any)=>v.alive&&(v.faction==="black"||v.role==="狂人"))){
        if(!p.kill_ready_initialized){p.kill_ready_at=nowMs+30000;p.kill_ready_initialized=true;}
        if(p.role==="インポスター"&&!p.sabotage_ready_initialized){p.sabotage_ready_at=nowMs+35000;p.sabotage_ready_initialized=true;}
      }
      const aiPlayers = players.filter((p:any)=>p.is_ai && p.alive);
      for(const ai of aiPlayers.filter((p:any)=>p.role==="ギャンブラー"&&!p.gambler_prediction))ai.gambler_prediction=Math.random()<0.5?"low":"high";
      // White AIs may contribute to multiple different tasks, with a short cooldown.
      // A player can only contribute once to each task during the match.
      const taskAIPlayers = aiPlayers.filter((p:any)=>p.faction==="white" && Number(p.ai_task_ready_at||0)<=nowMs);
      const assigned = new Set(taskAIPlayers.map((p:any)=>p.ai_goal_task).filter((v:any)=>v!==null&&v!==undefined));
      for (const ai of taskAIPlayers) {
        const ownSeat=Number(ai.seat);
        let task = tasks.find((t:any)=>t.id===ai.ai_goal_task && !t.done &&
          !(Array.isArray(t.completed_by)&&t.completed_by.map(Number).includes(ownSeat)));
        if (!task) {
          const choices = tasks.filter((t:any)=>!t.done &&
            !(Array.isArray(t.completed_by)&&t.completed_by.map(Number).includes(ownSeat))).sort((a:any,b:any)=>{
            const da=Math.hypot(ai.x-a.x,ai.y-a.y),db=Math.hypot(ai.x-b.x,ai.y-b.y);
            const aa=assigned.has(a.id)?450:0,ab=assigned.has(b.id)?450:0;
            return (da+aa)-(db+ab);
          });
          task = choices[0];
          if (!task) continue;
          ai.ai_goal_task = task.id;
          assigned.add(task.id);
          ai.ai_path = [];
        }
        // Do not run pathfinding while the AI is already close enough to work.
        if (Math.hypot(ai.x-task.x,ai.y-task.y)<=58) {
          task.completed_by=Array.isArray(task.completed_by)?task.completed_by:[];
          if(!task.completed_by.map(Number).includes(Number(ai.seat))){
            task.completed_by.push(Number(ai.seat));
            task.remaining=Math.max(0,Number(task.remaining||4)-1);
            task.done=task.remaining<=0;
            ai.ai_tasks_completed=Number(ai.ai_tasks_completed||0)+1;
            ai.ai_task_ready_at=nowMs+3500;
          }
          ai.ai_goal_task=null;ai.ai_path=[];ai.task_progress=0;
          continue;
        }
        if (!Array.isArray(ai.ai_path) || !ai.ai_path.length) {
          ai.ai_path = findPath(Number(ai.x),Number(ai.y),Number(task.x),Number(task.y));
        }
        while (ai.ai_path.length && Math.hypot(ai.ai_path[0][0]-ai.x,ai.ai_path[0][1]-ai.y)<16) ai.ai_path.shift();
        if (ai.ai_path.length) {
          const [tx,ty]=ai.ai_path[0],dx=tx-ai.x,dy=ty-ai.y,len=Math.hypot(dx,dy)||1,step=45*delta;
          const nx=ai.x+dx/len*Math.min(step,len),ny=ai.y+dy/len*Math.min(step,len);
          if(walkable(nx,ai.y))ai.x=nx;
          if(walkable(ai.x,ny))ai.y=ny;
        }
      }
      // All living AIs must keep moving even when they are not eligible to advance white tasks.
      const taskWorkers = new Set(taskAIPlayers.map((p:any)=>Number(p.seat)));
      const roamPoints = [[260,250],[610,250],[1195,250],[1555,265],[260,815],[670,815],[1150,815],[1555,815],[900,475],[900,585],[450,475],[1350,475]];
      for (const ai of aiPlayers) {
        if (taskWorkers.has(Number(ai.seat))) continue;
        const enemies = players.filter((p:any)=>p.alive && Number(p.seat)!==Number(ai.seat) &&
          (ai.faction==="black" ? p.faction==="white" : ai.faction==="third" ? p.faction!=="third" : p.faction==="black"));
        let goal:any=null;
        if ((ai.faction==="black" || ai.role==="暗殺者" || ai.role==="狩人" || ai.role==="保安官") && enemies.length) {
          enemies.sort((a:any,b:any)=>Math.hypot(ai.x-a.x,ai.y-a.y)-Math.hypot(ai.x-b.x,ai.y-b.y));
          goal=[Number(enemies[0].x),Number(enemies[0].y)];
        } else {
          if (!Array.isArray(ai.ai_path) || !ai.ai_path.length || !Array.isArray(ai.ai_roam_goal)) {
            const candidates=roamPoints.filter(([x,y]:number[])=>Math.hypot(ai.x-x,ai.y-y)>100);
            const pick=candidates[Math.floor(Math.random()*Math.max(1,candidates.length))]||roamPoints[0];
            ai.ai_roam_goal=[pick[0],pick[1]];
            ai.ai_path=findPath(Number(ai.x),Number(ai.y),pick[0],pick[1]);
          }
          goal=ai.ai_roam_goal;
        }
        if (goal && (ai.faction==="black" || ai.role==="暗殺者" || ai.role==="狩人" || ai.role==="保安官") && (!Array.isArray(ai.ai_path)||!ai.ai_path.length || !Array.isArray(ai.ai_chase_goal) || Math.hypot(ai.ai_chase_goal[0]-goal[0],ai.ai_chase_goal[1]-goal[1])>90)) {
          ai.ai_chase_goal=goal;ai.ai_path=findPath(Number(ai.x),Number(ai.y),goal[0],goal[1]);
        }
        while (Array.isArray(ai.ai_path)&&ai.ai_path.length&&Math.hypot(ai.ai_path[0][0]-ai.x,ai.ai_path[0][1]-ai.y)<16) ai.ai_path.shift();
        if (Array.isArray(ai.ai_path)&&ai.ai_path.length) {
          const [tx,ty]=ai.ai_path[0],dx=tx-ai.x,dy=ty-ai.y,len=Math.hypot(dx,dy)||1,step=45*delta;
          const nx=ai.x+dx/len*Math.min(step,len),ny=ai.y+dy/len*Math.min(step,len);
          if(walkable(nx,ai.y))ai.x=nx;
          if(walkable(ai.x,ny))ai.y=ny;
        }
      }
      // Detect AI agents that repeatedly fail to make progress (for example, trapped
      // against a wall or holding an unreachable path). Recover their position so a
      // single stuck impostor cannot leave the entire match permanently undecidable.
      for (const ai of aiPlayers) {
        const x = Number(ai.x), y = Number(ai.y);
        const validPosition = Number.isFinite(x) && Number.isFinite(y);
        if (!validPosition) {
          const safe = roamPoints.find(([rx, ry]:number[]) => walkable(rx, ry)) || [900, 475];
          ai.x = safe[0]; ai.y = safe[1];
          ai.ai_path = []; ai.ai_goal_task = null; ai.ai_chase_goal = null; ai.ai_roam_goal = null;
          ai.ai_last_progress_at = nowMs; ai.ai_last_motion_x = safe[0]; ai.ai_last_motion_y = safe[1];
          ai.ai_stuck_recoveries = Number(ai.ai_stuck_recoveries || 0) + 1;
          continue;
        }
        if (!Number.isFinite(Number(ai.ai_last_progress_at))) {
          ai.ai_last_progress_at = nowMs;
          ai.ai_last_motion_x = x; ai.ai_last_motion_y = y;
          continue;
        }
        const moved = Math.hypot(x - Number(ai.ai_last_motion_x ?? x), y - Number(ai.ai_last_motion_y ?? y));
        if (moved >= 3) {
          ai.ai_last_progress_at = nowMs;
        }
        ai.ai_last_motion_x = x; ai.ai_last_motion_y = y;
        const hasGoal = (ai.ai_goal_task !== null && ai.ai_goal_task !== undefined) ||
          Array.isArray(ai.ai_chase_goal) || Array.isArray(ai.ai_roam_goal) ||
          (Array.isArray(ai.ai_path) && ai.ai_path.length > 0);
        if (!hasGoal || nowMs - Number(ai.ai_last_progress_at || nowMs) < 12000) continue;

        // Choose a known walkable point and clear stale path targets. The normal AI
        // planner will choose a fresh task, chase target, or patrol route next tick.
        const safePoints = roamPoints.filter(([rx, ry]:number[]) => walkable(rx, ry));
        const safe = safePoints.sort((a:number[], b:number[]) =>
          Math.hypot(x - a[0], y - a[1]) - Math.hypot(x - b[0], y - b[1])
        )[0] || [900, 475];
        ai.x = safe[0]; ai.y = safe[1];
        ai.ai_path = []; ai.ai_goal_task = null; ai.ai_chase_goal = null; ai.ai_roam_goal = null;
        ai.ai_last_progress_at = nowMs; ai.ai_last_motion_x = safe[0]; ai.ai_last_motion_y = safe[1];
        ai.ai_stuck_recoveries = Number(ai.ai_stuck_recoveries || 0) + 1;
      }

      for(const ai of players.filter((p:any)=>p.is_ai&&p.alive&&p.role==="暗殺者")){
        const ready=Number(ai.kill_ready_at||0)<=nowMs;
        if(!ready)continue;
        const wanted=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat)&&
          Array.isArray(state.assassin_targets)&&state.assassin_targets.includes(Number(p.seat))&&
          Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=88&&
          clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
        if(wanted){
          ai.kill_ready_at=nowMs+20000;
          if(wanted.protected)wanted.protected=false;
          else{recordElimination(state,ai,wanted,nowMs);wanted.alive=false;wanted.death_reason="暗殺";wanted.died_at=new Date(nowMs).toISOString();}
        }
      }
      for(const ai of players.filter((p:any)=>p.is_ai&&p.alive)){
        if((ai.role==="狩人"||ai.role==="保安官")&&!ai.ability_used){
          const incident=state.last_elimination;
          const witnessed=incident&&nowMs-Number(incident.at||0)<=180000&&
            Array.isArray(incident.witness_seats)&&incident.witness_seats.includes(Number(ai.seat));
          const target=witnessed?players.find((p:any)=>p.alive&&Number(p.seat)===Number(incident.killer_seat)&&
            Number(p.seat)!==Number(ai.seat)&&Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=100&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y))):null;
          if(target){
            ai.ability_used=true;
            if(recordProtectionBlock(state,target)){}
            else{recordElimination(state,ai,target,nowMs);target.alive=false;target.death_reason=ai.role;target.died_at=new Date(nowMs).toISOString();}
          }
        }
        if(ai.role==="占い師"&&!ai.ability_used&&Math.random()<0.02){
          const target=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat)&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=100&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
          if(target){ai.ability_used=true;ai.seer_reveals=Array.isArray(ai.seer_reveals)?ai.seer_reveals:[];ai.seer_reveals.push({seat:Number(target.seat),faction:String(target.faction)});}
        }
        if(ai.role==="僧侶"&&!ai.ability_used&&Math.random()<0.02){
          const ally=players.find((p:any)=>p.alive&&p.faction==="white"&&Number(p.seat)!==Number(ai.seat)&&!p.protected&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=150);
          if(ally){ally.protected=true;ally.protected_by_seat=Number(ai.seat);ai.ability_used=true;}
        }
        if(ai.role==="百面相"&&nowMs>=Number(ai.role_ready_at||0)&&Math.random()<0.018){
          const target=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat)&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=140&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
          if(target){ai.disguise_seat=Number(target.seat);ai.disguise_until=nowMs+10000;ai.role_ready_at=nowMs+45000;}
        }
        if(ai.role==="放浪者"&&nowMs>=Number(ai.role_ready_at||0)&&Math.random()<0.025){
          const target=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat)&&!p.scented&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=90&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
          if(target){target.scented=true;ai.role_ready_at=nowMs+15000;}
        }
        if(ai.role==="イノシシ"&&!ai.charging&&nowMs>=Number(ai.role_ready_at||0)&&Math.random()<0.025){
          const target=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat)&&
            !(ai.faction==="black"&&p.faction==="black")&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=220&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
          if(target){const dx=Number(target.x)-Number(ai.x),dy=Number(target.y)-Number(ai.y),len=Math.hypot(dx,dy)||1;ai.charging=true;ai.charge={x:dx/len,y:dy/len};ai.charge_started_at=nowMs;}
        }
      }
      for(const ai of players.filter((p:any)=>p.is_ai&&p.alive&&(p.faction==="black"||p.role==="狂人"))){
        if(nowMs>=Number(ai.kill_ready_at||0)){
          const target=players.find((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat)&&
            (ai.faction!=="black"||p.faction!=="black")&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=88&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
          if(target){
            ai.kill_ready_at=nowMs+30000;
            if(recordProtectionBlock(state,target)){}
            else{recordElimination(state,ai,target,nowMs);target.alive=false;target.death_reason=ai.role;target.died_at=new Date(nowMs).toISOString();}
          }
        }
        if(ai.role==="インポスター"&&nowMs>=Number(ai.sabotage_ready_at||0)&&Number(state.sabotage_until||0)<nowMs&&Math.random()<0.035){
          state.sabotage_until=nowMs+10000;ai.sabotage_ready_at=nowMs+35000;
        }
      }
      for(const ai of players.filter((p:any)=>p.is_ai&&p.alive&&p.role==="ギャンブラー")){
        if(!ai.gambler_prediction)ai.gambler_prediction=Math.random()<0.5?"low":"high";
        if(!ai.gambler_kill_ready&&nowMs>=Number(ai.role_ready_at||0)&&Math.random()<0.035){
          const roll=1+Math.floor(Math.random()*6);
          ai.role_ready_at=nowMs+(roll===4?5000:25000);
          if(roll<=3)ai.gambler_low_count=Number(ai.gambler_low_count||0)+1;
          else ai.gambler_high_count=Number(ai.gambler_high_count||0)+1;
          if(roll===1)ai.gambler_kill_ready=true;
          else if(roll===2)ai.protected=true;
          else if(roll===3){
            const choices=players.filter((p:any)=>p.alive&&Number(p.seat)!==Number(ai.seat));
            if(choices.length){const picked=choices[Math.floor(Math.random()*choices.length)];ai.gambler_reveals=Array.isArray(ai.gambler_reveals)?ai.gambler_reveals:[];ai.gambler_reveals.push({seat:Number(picked.seat),faction:String(picked.faction)});}
          }else if(roll===6){
            ai.gambler_bad_luck_count=Number(ai.gambler_bad_luck_count||0)+1;
            if(ai.gambler_bad_luck_count>=3){ai.alive=false;ai.death_reason="大凶を3回引いた";ai.died_at=new Date(nowMs).toISOString();}
          }
        }
        if(ai.alive&&ai.gambler_kill_ready){
          const target=players.find((p:any)=>p.alive&&p.faction!==ai.faction&&Number(p.seat)!==Number(ai.seat)&&
            Math.hypot(Number(p.x)-Number(ai.x),Number(p.y)-Number(ai.y))<=100&&
            clearLineOfSight(Number(ai.x),Number(ai.y),Number(p.x),Number(p.y)));
          if(target){ai.gambler_kill_ready=false;if(recordProtectionBlock(state,target)){}else{recordElimination(state,ai,target,nowMs);target.alive=false;target.death_reason="ギャンブラー";target.died_at=new Date(nowMs).toISOString();}}
        }
      }
      state.players=players;
      state.tasks=tasks;
      state.tick=(Number(state.tick)||0)+1;
      state.elapsed_seconds=(Number(state.elapsed_seconds)||0)+delta;
      const { data: saved, error: saveError } = await admin.rpc("ranked_engine_commit", {
        p_match_id: match.match_id,
        p_expected_revision: match.engine_revision,
        p_engine_state: state,
      });
      if (saveError) throw saveError;
      if (saved?.status === "revision_conflict") return json({status:"revision_conflict",tick:state.tick},409);
      const solo=soloRoleWinner(state);
      if(solo){await finalizeRoleWinner(admin,match.match_id,solo.seat,solo.role);return json(rankedMatchResult(state,{match_id:match.match_id,status:"role_completed",match_status:"completed",winner_faction:"third",winner_role:solo.role,winner_seat:solo.seat}))}
      if(tasks.length>0&&tasks.every((t:any)=>t.done)){await finalizeWinner(admin,match.match_id,"white");return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",match_status:"completed",winner_faction:"white"}))}
      const winner=factionWinner(state);
      if(winner){
        await finalizeWinner(admin,match.match_id,winner);
        return json(rankedMatchResult(state,{match_id:match.match_id,status:"match_completed",match_status:"completed",winner_faction:winner}));
      }
      return json(publicSnapshot(match,state,playerState));
    }
    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("triad-engine request failed", error);
    return json({ error: "ENGINE_REQUEST_FAILED" }, 500);
  }
});
