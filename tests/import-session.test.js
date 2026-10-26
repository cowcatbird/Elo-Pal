import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeImportSession } from '../src/import-session.js';

const token = '12345678-abcd-4321-abcd-123456789abc';
const key = 'rook.import.' + token;
const valid = {version:1,status:'success',source:'chess.com',sourceUrl:'https://www.chess.com/game/live/123',createdAt:1000000,pgn:'1. e4 e5 *'};
function mock(payload) {
  const calls=[];
  let value=payload;
  return {
    calls,
    get:async name=>(calls.push(['get',name]),{[key]:value}),
    remove:async name=>{calls.push(['remove',name]);value=undefined;},
  };
}
test('successful import is consumed once with no PGN placed in the link',async()=>{
  const storage=mock(valid);const result=await consumeImportSession(token,{storage,now:1000001});
  assert.deepEqual(result,{status:'success',pgn:valid.pgn,source:'chess.com',sourceLabel:'Chess.com',sourceUrl:valid.sourceUrl,method:undefined});
  assert.deepEqual(storage.calls,[['get',key],['remove',key]]);
  assert.equal((await consumeImportSession(token,{storage,now:1000002})).status,'error');
});
test('Lichess handoffs expose the validated provider and canonical URL',async()=>{
  const payload={...valid,source:'lichess.org',sourceUrl:'https://lichess.org/AbCd1234/black?foo=bar#12',method:'game-export'};
  const storage=mock(payload);
  assert.deepEqual(await consumeImportSession(token,{storage,now:1000001}),{
    status:'success',pgn:payload.pgn,source:'lichess.org',sourceLabel:'Lichess',sourceUrl:'https://lichess.org/AbCd1234/black',method:'game-export',
  });
  assert.deepEqual(storage.calls,[['get',key],['remove',key]]);
});
test('handoffs require the declared source to match the validated URL provider',async()=>{
  for(const change of [
    {source:'chess.com',sourceUrl:'https://lichess.org/AbCd1234'},
    {source:'lichess.org',sourceUrl:'https://www.chess.com/game/live/123'},
    {source:'lichess.org',sourceUrl:'https://lichess.org.evil.test/AbCd1234'},
    {source:'lichess.org',sourceUrl:'https://evil.test/lichess.org/AbCd1234'},
    {source:'lichess.org',sourceUrl:'https://user:password@lichess.org/AbCd1234'},
    {source:'lichess.org',sourceUrl:'https://lichess.org:8443/AbCd1234'},
    {source:'lichess.org',sourceUrl:'http://lichess.org/AbCd1234'},
    {source:'Lichess',sourceUrl:'https://lichess.org/AbCd1234'},
    {source:undefined},
  ]) {
    const storage=mock({...valid,...change});
    assert.equal((await consumeImportSession(token,{storage,now:1000000})).status,'error',JSON.stringify(change));
    assert.deepEqual(storage.calls,[['get',key],['remove',key]]);
  }
});
test('missing or malformed tokens cannot address arbitrary session storage',async()=>{
  const storage=mock(valid);assert.equal(await consumeImportSession(null,{storage}),null);
  assert.equal((await consumeImportSession('other-key',{storage})).status,'error');assert.equal(storage.calls.length,0);
});
test('expired, missing, wrong-version and future handoffs report a recoverable error',async()=>{
  for(const payload of [undefined,{...valid,version:2},{...valid,createdAt:0},{...valid,createdAt:2000000},{...valid,createdAt:NaN}]) {
    assert.equal((await consumeImportSession(token,{storage:mock(payload),now:1000000})).status,'error');
  }
});
test('the existing fifteen-minute lifetime also applies to Lichess handoffs',async()=>{
  const payload={...valid,source:'lichess.org',sourceUrl:'https://lichess.org/AbCd1234'};
  assert.equal((await consumeImportSession(token,{storage:mock(payload),now:payload.createdAt+15*60*1000})).status,'success');
  assert.equal((await consumeImportSession(token,{storage:mock(payload),now:payload.createdAt+15*60*1000+1})).status,'error');
});
test('handoffs reject off-site PGNs and unbounded content',async()=>{
  for(const change of [{sourceUrl:'https://www.chess.com.evil.test/game/1'},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://x@www.chess.com/game/1'},{pgn:'x'.repeat(2*1024*1024+1)},{pgn:''},{status:'pending'}]) {
    assert.equal((await consumeImportSession(token,{storage:mock({...valid,...change}),now:1000000})).status,'error');
  }
});
test('extraction failures and unavailable extension storage are explicit',async()=>{
  const result=await consumeImportSession(token,{storage:mock({...valid,status:'error',message:'No game was detected.'}),now:1000000});
  assert.equal(result.message,'No game was detected.');
  assert.match((await consumeImportSession(token,{storage:null})).message,/installed Chrome extension/);
  assert.equal((await consumeImportSession(token,{storage:{get:async()=>{throw new Error('offline');}}})).status,'error');
  assert.equal((await consumeImportSession(token,{storage:{get:async()=>({[key]:valid}),remove:async()=>{throw new Error('cannot consume');}},now:1000000})).status,'error');
});
test('provider-neutral failures remain bounded and offer both supported sites',async()=>{
  const result=await consumeImportSession(token,{storage:mock({...valid,status:'error',message:'x'.repeat(1000)}),now:1000000});
  assert.equal(result.message.length,600);
  const fallback=await consumeImportSession(token,{storage:mock({...valid,status:'error',message:null}),now:1000000});
  assert.match(fallback.message,/Chess\.com or Lichess/);
  assert.match((await consumeImportSession('invalid',{storage:mock(valid)})).message,/Chess\.com or Lichess/);
});
