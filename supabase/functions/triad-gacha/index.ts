import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({error:"POST_ONLY"},405);
 const url=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anonKey||!serviceKey)return json({error:"SERVER_NOT_CONFIGURED"},503);
 const authorization=req.headers.get("Authorization")||"",token=authorization.toLowerCase().startsWith("bearer ")?authorization.slice(7).trim():authorization.trim();
 if(!token)return json({error:"AUTH_REQUIRED"},401);
 const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authData,error:authError}=await authClient.auth.getUser(token);
 if(authError||!authData.user)return json({error:"INVALID_SESSION"},401);
 let body:Record<string,unknown>;try{body=await req.json()}catch{return json({error:"INVALID_JSON"},400)}
 const count=Number(body.count),requestId=typeof body.request_id==="string"?body.request_id:"";
 if(![1,10].includes(count))return json({error:"INVALID_PULL_COUNT"},400);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))return json({error:"INVALID_REQUEST_ID"},400);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data,error}=await admin.rpc("gacha_execute",{p_user_id:authData.user.id,p_request_id:requestId,p_count:count});
  if(error){const message=String(error.message||error);if(message.includes("NOT_ENOUGH_COINS"))return json({error:"NOT_ENOUGH_COINS"},400);if(message.includes("GACHA_NOT_AVAILABLE"))return json({error:"GACHA_NOT_AVAILABLE"},503);if(message.includes("GACHA_POOL_EMPTY"))return json({error:"GACHA_POOL_EMPTY"},503);console.error("triad-gacha RPC failed",message);return json({error:"GACHA_REQUEST_FAILED"},500)}
  return json(data);
 }catch(error){console.error("triad-gacha request failed",error);return json({error:"GACHA_REQUEST_FAILED"},500)}
});
