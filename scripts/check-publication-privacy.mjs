import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const git = (args, options={}) => execFileSync('git', args, {encoding:'utf8',maxBuffer:128*1024*1024,...options});
const project = JSON.parse(fs.readFileSync('package.json','utf8')).name;
const owner = project === 'youbeat' ? ['YouBeat Project','youbeat@project.invalid'] :
  project === 'tag-maestro' ? ['Tag Maestro Project','tag-maestro@project.invalid'] : null;
if (!owner) throw new Error('Unknown project identity policy');
const allowed = new Set([
  owner.join('\x1f'),
  'Lovable\x1fnoreply@lovable.dev',
  'gpt-engineer-app[bot]\x1f159125892+gpt-engineer-app[bot]@users.noreply.github.com',
]);
const refs = ['HEAD',...git(['for-each-ref','--format=%(refname)','refs/heads','refs/tags','refs/remotes/origin/main']).trim().split('\n').filter(Boolean)];
let problems=0;
function fail(message){problems++;console.error(message);}
for(const line of git(['log',...refs,'--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce']).trim().split('\n')){
  const [hash,an,ae,cn,ce]=line.split('\x1f');
  if(!allowed.has(an+'\x1f'+ae)||!allowed.has(cn+'\x1f'+ce))fail('Unapproved author/committer identity in commit '+hash.slice(0,12));
}
for(const line of git(['for-each-ref','--format=%(objectname)%1f%(taggername)%1f%(taggeremail)','refs/tags']).trim().split('\n').filter(Boolean)){
  const [hash,name,address]=line.split('\x1f');
  if(name && !allowed.has(name+'\x1f'+address.replace(/^<|>$/g,'')))fail('Unapproved tagger identity in tag object '+hash.slice(0,12));
}
const safeHomeNames=new Set(['user','username','your-name','example','demo','runner']);
function inspect(text,label){
  for(const m of text.matchAll(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)([A-Za-z0-9_.-]+)/g)){
    if(!safeHomeNames.has(m[1].toLowerCase())){fail('Private-looking home path in '+label);break;}
  }
  if(/@[A-Za-z0-9.-]+\.lan\b/i.test(text))fail('Local-machine email in '+label);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))fail('Private key material in '+label);
}
inspect(git(['log',...refs,'--format=%B']), 'commit messages');
const objects=new Map(git(['rev-list','--objects',...refs]).trim().split('\n').map(line=>{
  const cut=line.indexOf(' ');return cut<0?[line,'object']:[line.slice(0,cut),line.slice(cut+1)];
}));
const output=git(['cat-file','--batch'],{input:[...objects.keys()].join('\n')+'\n',encoding:null});
let offset=0, blobs=0;
while(offset<output.length){
  const end=output.indexOf(10,offset);if(end<0)throw new Error('Invalid object stream');
  const [hash,type,sizeRaw]=output.subarray(offset,end).toString().split(' ');
  const size=Number(sizeRaw);if(!Number.isFinite(size))throw new Error('Missing Git object');
  const data=output.subarray(end+1,end+1+size);offset=end+size+2;
  if(type!=='blob')continue;
  blobs++;
  if(!data.subarray(0,8000).includes(0))inspect(data.toString('utf8'),'tracked blob '+hash.slice(0,12));
  const name=objects.get(hash);
  if(/^(?:\.design-qa\/|Example Album \(1987\)\/)/.test(name))fail('Private QA/sample asset in published history');
}
const files=git(['ls-files','-z']).split('\0').filter(Boolean);
for(const file of files){if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;const data=fs.readFileSync(file);if(!data.subarray(0,8000).includes(0))inspect(data.toString('utf8'),'working file '+file);}
if(problems){console.error('Publication privacy check failed: '+problems+' finding(s). Values are deliberately not printed.');process.exit(1);}
console.log('Publication privacy passed: project-only contributor/tag identities, '+blobs+' historical blobs and current tracked files checked.');
