import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import dotenv from 'dotenv';

const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const env = existsSync('.env') ? dotenv.parse(readFileSync('.env')) : {};
const sensitive = Object.entries(env).filter(([key,value])=>/KEY|SECRET|PASSWORD|CLIENT_ID|MERCHANT_ID/.test(key) && value.length>=6).map(([,value])=>Buffer.from(value));
const findings=[];
for(const file of files) {
  if ((/(^|\/)\.env(?:\.|$)/.test(file) && file!=='.env.example') || /(^|\/)(data|node_modules|dist|dist-pages)\//.test(file) || /\.(sqlite(?:-wal|-shm)?|pem|key|log)$/.test(file)) findings.push('Forbidden release path: '+file);
  const contents=execFileSync('git',['show',':'+file],{maxBuffer:20*1024*1024});
  if(sensitive.some(secret=>contents.includes(secret))) findings.push('Local credential value found in: '+file);
  if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AIza[\w-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(contents.toString('utf8'))) findings.push('Credential-like content found in: '+file);
}
for (const directory of ['dist','dist-pages']) if(existsSync(directory)) {
  const paths=readdirSync(directory,{recursive:true}).filter(file=>/\.(html|js|css|json)$/.test(String(file)));
  for (const path of paths) if(sensitive.some(secret=>readFileSync(directory+'/'+path).includes(secret))) findings.push('Local credential value in build: '+directory+'/'+path);
}
if(findings.length) { console.error(findings.join('\n'));process.exitCode=1; }
else console.log(`Release scan passed: ${files.length} tracked files; no forbidden paths or configured credential values. Build artifacts checked separately. This is not a guarantee against every possible secret.`);
