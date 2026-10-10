import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRepositoryFile, filterSupportedFiles, githubJson, listRepositoryBranches, listRepositoryFiles, parseRepositoryUrl } from '../github-import.js';
test('accepts public GitHub URLs and strips .git suffix', () => assert.deepEqual(parseRepositoryUrl(' https://github.com/Kraverse/RepoDoctor-AI.git/ '), { owner:'Kraverse', repo:'RepoDoctor-AI', fullName:'Kraverse/RepoDoctor-AI', url:'https://github.com/Kraverse/RepoDoctor-AI' }));
test('rejects malformed URLs, nested paths, and non-GitHub hosts', () => {
  for (const value of ['not a URL','http://github.com/a/b','https://evil.example/a/b','https://github.com/a/b/issues/1','https://user:pass@github.com/a/b','https://github.com/a/b?token=x']) assert.throws(() => parseRepositoryUrl(value));
});
test('filters unsupported/generated/oversized files', () => {
  const result = filterSupportedFiles([{type:'blob',path:'src/main.py',size:30,sha:'abc'},{type:'blob',path:'node_modules/pkg/index.js',size:30},{type:'blob',path:'image.png',size:20},{type:'blob',path:'large.ts',size:20001},{type:'tree',path:'src',size:0}]);
  assert.deepEqual(result.files.map(x => x.path), ['src/main.py']); assert.equal(result.oversized, 1);
});
test('limits the displayed file count', () => {
  const result = filterSupportedFiles(Array.from({length:4},(_,i)=>({type:'blob',path:'file'+i+'.py',size:1})),2);
  assert.equal(result.files.length,2); assert.equal(result.truncated,true);
});
test('reports API rate limits and missing repositories', async () => {
  await assert.rejects(githubJson('https://api.github.com/test', async()=>({status:403,headers:{get:()=> '0'}})),/rate limit/);
  await assert.rejects(githubJson('https://api.github.com/test', async()=>({status:404,ok:false})),/not found/);
});
test('lists branches and refuses private repositories without credentials', async () => {
  const mock = async url => url.includes('/branches?') ? ({status:200,ok:true,json:async()=>[{name:'main'},{name:'dev'}]}) : ({status:200,ok:true,json:async()=>({private:false,default_branch:'main'})});
  assert.deepEqual(await listRepositoryBranches({owner:'a',repo:'b'},mock),{defaultBranch:'main',branches:['main','dev']});
  await assert.rejects(listRepositoryBranches({owner:'a',repo:'b'},async()=>({status:200,ok:true,json:async()=>({private:true,default_branch:'main'})})),/Private repositories/);
});
test('lists source files and rejects truncated trees', async () => {
  const mock = async()=>({status:200,ok:true,json:async()=>({truncated:false,tree:[{type:'blob',path:'main.py',size:8}]})});
  assert.equal((await listRepositoryFiles({owner:'a',repo:'b'},'main',mock)).files[0].path,'main.py');
  await assert.rejects(listRepositoryFiles({owner:'a',repo:'b'},'main',async()=>({status:200,ok:true,json:async()=>({truncated:true,tree:[]})})),/too large/);
});
test('loads source text and enforces size/binary limits', async () => {
  const repo={owner:'a',repo:'b'};
  assert.equal(await fetchRepositoryFile(repo,'main','src/main.py',async()=>({ok:true,status:200,text:async()=>'print(1)'})),'print(1)');
  await assert.rejects(fetchRepositoryFile(repo,'main','large.py',async()=>({ok:true,status:200,text:async()=>'x'.repeat(20001)})),/character limit/);
  await assert.rejects(fetchRepositoryFile(repo,'main','image.py',async()=>({ok:true,status:200,text:async()=>'x\u0000y'})),/binary/);
});