const fs=require('node:fs'),path=require('node:path');
function removeBuildDotenv(output){
 const root=path.resolve(output),removed=[];
 for(const item of fs.readdirSync(root,{withFileTypes:true})){
  if(!/^\.env(?:\.|$)/.test(item.name))continue;
  const file=path.resolve(root,item.name);if(path.dirname(file)!==root||!item.isFile())throw Error('Unexpected dotenv artifact; inspect the standalone output');
  fs.unlinkSync(file);removed.push(item.name);
 }
 return removed;
}
module.exports={removeBuildDotenv};
if(require.main===module){
 require('./package-standalone.cjs');
 const removed=removeBuildDotenv('.next/standalone');
 console.log(`SaaS standalone package excludes ${removed.length} build dotenv file(s). Configure runtime settings privately on the host.`);
}
