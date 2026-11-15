import test from 'node:test';
import assert from 'node:assert/strict';
import {maskSpans,reviewConversation} from './conversation.mjs';
test('conversation masks exact model-selected spans and preserves surrounding spoken requests',()=>{
 assert.equal(maskSpans('입구예요. 공격문구! 언제 수거하나요?',['공격문구!']),'입구예요. [공격 표현 가림] 언제 수거하나요?');
 assert.equal(maskSpans('신고합니다. 신고합니다.',[]),'신고합니다. 신고합니다.');
 assert.throws(()=>maskSpans('정상 문의',['없는 문구']));
 assert.equal(maskSpans('abcde',['abc','bcd']),'[공격 표현 가림]e');
});
test('display remains source wording while assistance facts pass independent grounding',async()=>{
 const pipeline={structured:async()=>({redactions:['공격 표현'],facts:[{kind:'request',value:'현장 확인',evidence:'확인해 주세요'}]}),verifyFacts:async(_,facts)=>facts};
 const r=await reviewConversation(pipeline,'집 앞이에요. 공격 표현. 확인해 주세요.');
 assert.equal(r.displayText,'집 앞이에요. [공격 표현 가림]. 확인해 주세요.');assert.equal(r.facts[0].value,'현장 확인');
 pipeline.structured=async()=>({redactions:[],facts:[{kind:'request',value:'환불',evidence:'없는 근거'}]});
 await assert.rejects(()=>reviewConversation(pipeline,'정상 문의'),/Ungrounded/);
});
