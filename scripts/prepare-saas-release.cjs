// Prepare an isolated Vercel source upload without the earlier project's link or dotenv files.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseEnv}=require('node:util');
const root=path.resolve(__dirname,'..');
const stamp=new Date().toISOString().replace(/[-:.]/g,'');
const output=path.join(root,'.data',`vercel-bizhub-release-${stamp}`);
const files=['package.json','package-lock.json','next.config.ts','tsconfig.json','next-env.d.ts','eslint.config.mjs','.gitattributes'];
const directories=['src','public','data','scripts','supabase'];
fs.mkdirSync(output,{recursive:true});
for(const file of files)if(fs.existsSync(path.join(root,file)))fs.copyFileSync(path.join(root,file),path.join(output,file));
for(const directory of directories)fs.cpSync(path.join(root,directory),path.join(output,directory),{recursive:true,filter:source=>{
 const entry=fs.lstatSync(source);if(entry.isSymbolicLink())throw Error('Inspect symbolic links before preparing a source upload');
 return !/^\.env(?:\.|$)/.test(path.basename(source));
}});
fs.mkdirSync(path.join(output,'config'));
fs.copyFileSync(path.join(root,'config/saas-deployment.json'),path.join(output,'config/saas-deployment.json'));
fs.writeFileSync(path.join(output,'vercel.json'),JSON.stringify({$schema:'https://openapi.vercel.sh/vercel.json',framework:'nextjs',installCommand:'npm ci --include=dev',buildCommand:'npm run build:saas'},null,2)+'\n');
fs.writeFileSync(path.join(output,'.vercelignore'),'.env*\n.data/\n.git/\nnode_modules/\n.next/\n*.tsbuildinfo\n');
fs.writeFileSync(path.join(output,'.gitignore'),'.env*\n.vercel/\nnode_modules/\n.next/\n*.tsbuildinfo\n');
const secrets=[];
for(const name of ['.env.local','.env.production','.env.saas.local']){
 const file=path.join(root,name);if(!fs.existsSync(file))continue;
 for(const [key,value]of Object.entries(parseEnv(fs.readFileSync(file,'utf8'))))if(!key.startsWith('NEXT_PUBLIC_')&&/SECRET|TOKEN|PASSWORD|DATABASE_URL|SERVICE_ROLE|ENCRYPTION/.test(key)&&value.length>=20)secrets.push(value);
}
const manifest=[];
function inspect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);if(entry.isDirectory()){if(['.git','.vercel','node_modules','.data'].includes(entry.name))throw Error('Unexpected private directory in release');inspect(file);continue;}
 if(/^\.env(?:\.|$)/.test(entry.name))throw Error('Unexpected dotenv file in release');
 const bytes=fs.readFileSync(file);if(secrets.some(secret=>bytes.includes(Buffer.from(secret))))throw Error('A private configuration value was found in the prepared source; upload has not been attempted');
 manifest.push({path:path.relative(output,file).split(path.sep).join('/'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}}
inspect(output);
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({prepared_at:new Date().toISOString(),supabase_project_ref:require('../config/saas-deployment.json').supabaseProjectRef,files:manifest},null,2)+'\n');
console.log(JSON.stringify({directory:output,files:manifest.length,private_dotenv_files:0,vercel_project_link:'not linked',build_command:'npm run build:saas'},null,2));
