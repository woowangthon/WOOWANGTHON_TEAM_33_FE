const test=require('node:test'),assert=require('node:assert/strict');
const {phoneHistoryScope,phoneHistorySelection}=require('./helpers/loader.cjs')()('lib/phone-history-scope.ts');
const call=(id,callerId,status='ended',startedAt='2026-11-15T01:00:00Z')=>({id,callerId,status,startedAt});
const history=[call('a-old','a'),call('b-old','b')];
test('idle reception remains empty even when stored history exists',()=>{
  assert.deepEqual(phoneHistoryScope(history),{current:undefined,history:[]});
  assert.equal(phoneHistorySelection(history,'','a-old','a-old'),'');
});
test('an incoming call reveals only that caller and their previous calls',()=>{
  const rows=[call('b-new','b','waiting','2026-11-15T02:00:00Z'),...history];
  assert.deepEqual(phoneHistoryScope(rows).history.map(c=>c.id),['b-new','b-old']);
  assert.equal(phoneHistorySelection(rows,'','a-old','a-old'),'b-new');
});
test('reading older history survives updates during the same call',()=>{
  const rows=[call('b-new','b','active'),...history];
  assert.equal(phoneHistorySelection(rows,'b-new','b-old','b-new'),'b-old');
});
test('a different incoming call resets the previous caller selection',()=>{
  const rows=[call('a-new','a','waiting'),call('b-new','b'),...history];
  assert.equal(phoneHistorySelection(rows,'','b-old','b-new'),'a-new');
  assert.deepEqual(phoneHistoryScope(rows).history.map(c=>c.callerId),['a','a']);
});
test('owned active call stays selected when another caller is waiting',()=>{
  const rows=[call('b-new','b','waiting'),call('a-new','a','active'),...history];
  assert.equal(phoneHistoryScope(rows,'a-new').current.id,'a-new');
  assert.ok(phoneHistoryScope(rows,'a-new').history.every(c=>c.callerId==='a'));
});
test('ended calls disappear and missing identities never group strangers',()=>{
  assert.equal(phoneHistoryScope([...history,call('a-new','a')]).history.length,0);
  assert.deepEqual(phoneHistoryScope([call('new',undefined,'waiting'),call('old',undefined)]).history.map(c=>c.id),['new']);
});
